#!/usr/bin/env node
/* Что нового принёс каталог по фотографиям и добор снимков по явной команде.
 *
 *   cd server
 *   npm run db:catalog-photos               # только показать, что появится
 *   npm run db:catalog-photos -- --apply    # приложить новые снимки
 *   npm run demo:catalog-photos             # то же на демо-базе
 *
 * Зачем отдельная команда: обычное обновление (update.sh → src/db/data.js)
 * больше не трогает фото у позиций, которые уже есть в базе. Иначе любое
 * удаление в карточке откатывалось бы. Если поставщик прислал новые кадры к
 * уже заведённой позиции, их видно здесь: скрипт перечисляет, что добавятся
 * (с учётом убранных снимков — они не возвращаются), и пишет, сколько будет
 * пропущено.
 *
 * `--apply` идёт через обычный импорт с флагом refreshPhotos: фото уже
 * существующих позиций дозаполняются, убранные остаются убранными.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const db = require('../src/db');
const catalog = require('../src/db/catalog');

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');

/**
 * Путь из catalog.json → адрес в uploads/images. Считаем по той же формуле,
 * что placeImage, но файл не копируем: просмотр списка не должен ничего менять.
 */
function photoUrl(fileName) {
  const source = path.join(catalog.FILES_DIR, fileName);
  if (!fs.existsSync(source)) return null;
  const buffer = fs.readFileSync(source);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  return `/uploads/images/catalog_${hash}${path.extname(fileName).toLowerCase()}`;
}

/** Что из каталога ещё не приложено к позициям в базе. */
async function pendingPhotos(runner, config) {
  const pending = [];
  const hidden = [];
  const missing = [];

  for (const entry of config.components) {
    if (!entry || !entry.article) continue;
    const found = await runner.query('SELECT id FROM components WHERE article = $1', [entry.article]);
    if (found.rows.length === 0) continue; // новую позицию импорт заведёт сам
    const componentId = found.rows[0].id;

    const gallery = Array.isArray(entry.images) ? entry.images : [];
    for (const fileName of gallery) {
      const url = photoUrl(fileName);
      if (!url) { missing.push(`${entry.article}: ${fileName}`); continue; }
      const row = await runner.query(
        `SELECT deleted_at FROM component_images WHERE component_id = $1 AND image_path = $2 LIMIT 1`,
        [componentId, url]
      );
      if (row.rows.length === 0) pending.push({ article: entry.article, url, kind: 'галерея' });
      else if (row.rows[0].deleted_at) hidden.push({ article: entry.article, url, kind: 'галерея' });
    }

    for (const mod of entry.modifications || []) {
      const files = Array.isArray(mod.images) ? mod.images : [];
      if (files.length === 0) continue;
      const modRow = await runner.query(
        `SELECT id FROM component_modifications WHERE component_id = $1 AND lower(code) = lower($2) LIMIT 1`,
        [componentId, mod.code]
      );
      if (modRow.rows.length === 0) continue;
      const modificationId = modRow.rows[0].id;
      for (const fileName of files) {
        const url = photoUrl(fileName);
        if (!url) { missing.push(`${entry.article}-${mod.code}: ${fileName}`); continue; }
        const row = await runner.query(
          `SELECT deleted_at FROM component_modification_images
            WHERE modification_id = $1 AND image_path = $2 LIMIT 1`,
          [modificationId, url]
        );
        if (row.rows.length === 0) pending.push({ article: `${entry.article}-${mod.code}`, url, kind: 'исполнение' });
        else if (row.rows[0].deleted_at) hidden.push({ article: `${entry.article}-${mod.code}`, url, kind: 'исполнение' });
      }
    }
  }

  return { pending, hidden, missing };
}

async function main() {
  const config = catalog.readConfig();
  const { pending, hidden, missing } = await pendingPhotos(db, config);

  console.log(`\n🖼  Каталог: ${config.components.length} позиций`);
  console.log(`   новых снимков для уже заведённых позиций: ${pending.length}`);
  for (const item of pending.slice(0, 40)) {
    console.log(`   + ${item.article} (${item.kind}) ${path.basename(item.url)}`);
  }
  if (pending.length > 40) console.log(`   … ещё ${pending.length - 40}`);

  if (hidden.length > 0) {
    console.log(`   убрано в карточках (не вернём): ${hidden.length}`);
    for (const item of hidden.slice(0, 20)) {
      console.log(`   − ${item.article} (${item.kind}) ${path.basename(item.url)}`);
    }
    if (hidden.length > 20) console.log(`   … ещё ${hidden.length - 20}`);
  }

  if (missing.length > 0) {
    console.log(`   ⚠ нет файла в каталоге: ${missing.length}`);
    for (const item of missing.slice(0, 10)) console.log(`   ? ${item}`);
  }

  if (pending.length === 0) {
    console.log('   ✅ добор не требуется');
    return;
  }
  if (!APPLY) {
    console.log('\n   Приложить новые снимки: npm run db:catalog-photos -- --apply');
    return;
  }

  console.log('\n📥 Прикладываю новые снимки…');
  await catalog.run(db, { refreshPhotos: true });
  console.log('✅ Готово: галереи существующих позиций дополнены, убранные фото остались убранными');
}

if (require.main === module) {
  main()
    .catch((err) => {
      const { describeDbError } = require('../src/utils/db-error');
      console.error('❌ Ошибка:', describeDbError(err));
      process.exitCode = 1;
    })
    .finally(async () => {
      try { await db.close(); } catch { /* соединение могло не открыться */ }
    });
}

module.exports = { pendingPhotos, photoUrl };
