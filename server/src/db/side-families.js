/**
 * Перенос данных при разделении изделия на стороны.
 *
 * Каталог АТЛАНТА-26 печатает габаритные фонари одной позицией на семейство
 * («А.3731.010» — 28 исполнений, сторона спрятана в первой цифре кода).
 * В CRM менеджеры ищут фонарь по стороне, поэтому семейство разделено на
 * отдельные изделия (А.3731.010-01 / -02 / -03) — см.
 * scripts/catalog/split_marker_sides.py и families[] в catalog.json.
 *
 * Импорт каталога идемпотентен: он создаёт новые изделия и исполнения, но
 * не переносит данные, которых в catalog.json нет, — цены, правки из
 * интерфейса, загруженные фото и документы. Без этого шага прежнее изделие
 * удалилось бы вместе с ними (retireLegacyFlats).
 *
 * Что делает adoptSplitFamilies:
 *   - исполнение с тем же кодом уже есть у нового изделия → переносим на него
 *     цену исполнения и описание; фото исполнения копируем; ссылки из чертежей
 *     и продукции переводим на новое исполнение; прежнюю строку удаляем;
 *   - кода у нового изделия нет → переносим строку целиком (component_id),
 *     вместе с фото и ссылками;
 *   - цену изделия (если она была задана) копируем на все стороны и пишем
 *     предупреждение: цена в базе была одна на семейство, проверить;
 *   - фото и документы изделия копируем на каждую сторону, у прежнего изделия
 *     удаляем — иначе retireLegacyFlats увидит ссылки и оставит дубль.
 *
 * Шаг идемпотентен: если прежнего изделия уже нет (или у него не осталось
 * исполнений), он ничего не делает.
 */
const REFERENCE_MODIFICATION_TABLES = ['drawing_components', 'manufacturer_product_components'];

async function adoptSplitFamilies(runner, families, options = {}) {
  const log = options.log || (() => {});
  const report = { families: 0, moved: 0, merged: 0, images: 0, documents: 0, warnings: [] };

  if (!Array.isArray(families) || families.length === 0) return report;

  for (const family of families) {
    const children = Array.isArray(family.children) ? family.children : [];
    if (!family.article || children.length === 0) continue;

    const old = await runner.query(
      'SELECT id, article, price, image_path FROM components WHERE article = $1 LIMIT 1',
      [family.article]);
    if (old.rows.length === 0) continue; // новое развёртывание — переносить нечего
    const source = old.rows[0];

    const kids = await runner.query(
      'SELECT id, article, price, image_path FROM components WHERE article = ANY($1::text[]) ' +
      'ORDER BY article',
      [children]);
    if (kids.rows.length === 0) continue; // импорт ещё не создал новые изделия

    // все исполнения прежнего изделия один раз: иначе чужой код уедет не в ту сторону
    const oldMods = await runner.query(
      `SELECT id, code, name, price_override, description
         FROM component_modifications WHERE component_id = $1 ORDER BY sort_order, id`,
      [source.id]);

    // какое исполнение какой стороне принадлежит, знает сама база: импорт уже
    // создал у сторон те же коды. Карта из catalog.json — подсказка на случай
    // переименования кода в каталоге.
    const owner = oldMods.rows.length > 0 ? await codeOwners(runner, family, kids.rows) : new Map();

    report.families += 1;
    const prices = new Set();

    for (const child of kids.rows) {
      const own = oldMods.rows.filter(mod => owner.get(String(mod.code).toLowerCase()) === child.article);
      await adoptModifications(runner, own, child.id, report);

      // цена изделия была одна на всё семейство — раскладывать её по сторонам
      // автоматически нечем, поэтому копируем как есть и предупреждаем
      if (Number(source.price) > 0) prices.add(String(source.price));
      await runner.query(
        `UPDATE components
            SET price = CASE WHEN price = 0 THEN $2 ELSE price END,
                image_path = COALESCE(image_path, $3)
          WHERE id = $1`,
        [child.id, source.price, source.image_path]);

      report.images += await copyImages(runner, source.id, child.id);
      report.documents += await copyDocuments(runner, source.id, child.id);
    }

    // исполнение, которого нет в каталоге (завели вручную): сторону ему не
    // определить — переносим на первую сторону и предупреждаем
    const rest = oldMods.rows.filter(mod => !owner.has(String(mod.code).toLowerCase()));
    if (rest.length > 0 && kids.rows.length > 0) {
      await adoptModifications(runner, rest, kids.rows[0].id, report);
      report.warnings.push(
        `${family.article}: исполнения вне каталога (${rest.map(mod => mod.code).join(', ')}) ` +
        `перенесены в ${kids.rows[0].article} — проверьте сторону`);
    }

    if (prices.size > 0) {
      report.warnings.push(
        `${family.article}: цена ${[...prices].join('/')} была задана на семейство — ` +
        `скопирована на все стороны, проверьте в карточках`);
    }

    // у прежнего изделия данные перенесены — иначе retireLegacyFlats сочтёт
    // фото и документы ссылками и оставит дубль вместо удаления
    await runner.query('DELETE FROM component_images WHERE component_id = $1', [source.id]);
    await runner.query('DELETE FROM component_documents WHERE component_id = $1', [source.id]);
  }

  if (report.families > 0) {
    log(`↪️  Разделение по стороне: семейств ${report.families}, ` +
        `исполнений перенесено ${report.moved + report.merged} ` +
        `(фото исполнений ${report.moved}, объединено с новыми ${report.merged}), ` +
        `фото ${report.images}, документов ${report.documents}`);
    for (const warning of report.warnings) log(`⚠️  ${warning}`);
  }
  return report;
}

/**
 * Код исполнения → артикул стороны.
 *
 * Источник правды — код исполнения у самой стороны в базе: импорт создал его
 * из catalog.json. Карта families[].codes добавляется как подсказка, если код
 * в каталоге переименовали: иначе старое исполнение осталось бы без стороны.
 */
async function codeOwners(runner, family, kids) {
  const map = new Map();
  const rows = await runner.query(
    `SELECT component_id, lower(code) AS code FROM component_modifications
      WHERE component_id = ANY($1::int[])`,
    [kids.map(item => item.id)]);
  const byId = new Map(kids.map(item => [item.id, item.article]));
  for (const row of rows.rows) {
    map.set(row.code, byId.get(row.component_id));
  }
  for (const [article, codes] of Object.entries(family.codes || {})) {
    for (const code of codes || []) {
      const key = String(code).toLowerCase();
      if (!map.has(key)) map.set(key, article);
    }
  }
  return map;
}

/** Исполнения прежнего изделия → стороне: слить по коду или перенести строку. */
async function adoptModifications(runner, mods, childId, report) {
  for (const mod of mods) {
    const existing = await runner.query(
      'SELECT id, name, price_override, description FROM component_modifications ' +
      'WHERE component_id = $1 AND lower(code) = lower($2) LIMIT 1',
      [childId, mod.code]);

    if (existing.rows.length === 0) {
      await runner.query('UPDATE component_modifications SET component_id = $2 WHERE id = $1',
        [mod.id, childId]);
      report.moved += 1;
      continue;
    }

    const target = existing.rows[0];
    // цена и правки из интерфейса важнее значений из каталога: переносим
    // их на новое исполнение, но не затираем уже заполненное
    await runner.query(
      `UPDATE component_modifications
          SET price_override = COALESCE(price_override, $2),
              description = COALESCE(NULLIF(description, ''), $3)
        WHERE id = $1`,
      [target.id, mod.price_override, mod.description]);

    await runner.query(
      `INSERT INTO component_modification_images (modification_id, image_path, sort_order)
       SELECT $1, i.image_path, i.sort_order
         FROM component_modification_images i
        WHERE i.modification_id = $2
          AND NOT EXISTS (SELECT 1 FROM component_modification_images x
                           WHERE x.modification_id = $1 AND x.image_path = i.image_path)`,
      [target.id, mod.id]);

    for (const table of REFERENCE_MODIFICATION_TABLES) {
      await runner.query(
        `UPDATE ${table} SET modification_id = $1 WHERE modification_id = $2`,
        [target.id, mod.id]);
    }

    await runner.query('DELETE FROM component_modifications WHERE id = $1', [mod.id]);
    report.merged += 1;
  }
}

/** Галерея прежнего изделия → стороне (без дублей по имени файла). */
async function copyImages(runner, sourceId, childId) {
  const result = await runner.query(
    `INSERT INTO component_images (component_id, image_path, sort_order)
     SELECT $1, i.image_path, i.sort_order
       FROM component_images i
      WHERE i.component_id = $2
        AND NOT EXISTS (SELECT 1 FROM component_images x
                         WHERE x.component_id = $1 AND x.image_path = i.image_path)`,
    [childId, sourceId]);
  return result.rowCount || 0;
}

/** Документы прежнего изделия → стороне (без дублей по файлу). */
async function copyDocuments(runner, sourceId, childId) {
  const result = await runner.query(
    `INSERT INTO component_documents
       (component_id, doc_type, file_path, original_name, file_type, file_size, comment)
     SELECT $1, d.doc_type, d.file_path, d.original_name, d.file_type, d.file_size, d.comment
       FROM component_documents d
      WHERE d.component_id = $2
        AND NOT EXISTS (SELECT 1 FROM component_documents x
                         WHERE x.component_id = $1 AND x.file_path = d.file_path)`,
    [childId, sourceId]);
  return result.rowCount || 0;
}

module.exports = { adoptSplitFamilies, REFERENCE_MODIFICATION_TABLES };
