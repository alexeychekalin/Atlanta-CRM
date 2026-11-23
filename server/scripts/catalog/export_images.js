/**
 * Фотографии из карточек CRM — в каталог сайта.
 *
 * Сайт собирается из src/db/catalog/catalog.json и папки files. Менеджер
 * меняет фото в карточке позиции CRM (обложка, галерея, снимки исполнений) —
 * эти файлы лежат в uploads/images и в catalog.json сами не попадают. Скрипт
 * копирует их в files под стабильным именем и обновляет catalog.json, чтобы
 * после `python3 site/build.py` фото появились на сайте.
 *
 *   cd server
 *   npm run db:export-images              # из DATABASE_URL
 *   npm run demo:export-images            # из демо-базы PGlite
 *   npm run db:export-images -- --dry-run # только показать, что изменится
 *   npm run db:export-images -- --prune   # заменить галерею тем, что в CRM
 *
 * Без --prune фото, которых в CRM уже нет, из catalog.json не удаляются:
 * иначе одно неполное заполнение в CRM стёрло бы галерею на сайте.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '../../src/db/catalog');
const FILES_DIR = path.join(CATALOG_DIR, 'files');
const CATALOG_JSON = path.join(CATALOG_DIR, 'catalog.json');
const UPLOADS_IMAGES = path.join(__dirname, '../../uploads/images');

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function slugify(text) {
  const out = [];
  for (const char of String(text || '').toLowerCase()) {
    if (TRANSLIT[char] !== undefined) out.push(TRANSLIT[char]);
    else if (/[a-z0-9]/.test(char)) out.push(char);
    else out.push('-');
  }
  return out.join('').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
}

/** Путь из CRM (`/uploads/images/x.jpg`) → относительное имя файла. */
function uploadName(url) {
  const match = /^\/?uploads\/images\/(.+)$/.exec(String(url || '').trim());
  return match ? match[1] : null;
}

async function readFromDb(db) {
  const components = await db.query('SELECT id, article, image_path FROM components');
  // убранные в карточке снимки (deleted_at) на сайт не уезжают
  const gallery = await db.query(
    `SELECT component_id, image_path FROM component_images
      WHERE deleted_at IS NULL ORDER BY component_id, sort_order, id`);
  const mods = await db.query(
    `SELECT m.component_id, m.code, i.image_path
       FROM component_modification_images i
       JOIN component_modifications m ON m.id = i.modification_id
      WHERE i.deleted_at IS NULL
      ORDER BY m.component_id, m.sort_order, i.sort_order, i.id`);

  const byId = new Map(components.rows.map(row => [row.id, row.article]));
  const result = new Map();
  const entry = article => {
    if (!result.has(article)) {
      result.set(article, { image: null, images: [], mods: new Map() });
    }
    return result.get(article);
  };

  for (const row of components.rows) {
    entry(row.article).image = row.image_path || null;
  }
  for (const row of gallery.rows) {
    const article = byId.get(row.component_id);
    if (article) entry(article).images.push(row.image_path);
  }
  for (const row of mods.rows) {
    const article = byId.get(row.component_id);
    if (!article) continue;
    const modsOf = entry(article).mods;
    if (!modsOf.has(row.code)) modsOf.set(row.code, []);
    modsOf.get(row.code).push(row.image_path);
  }

  // обложка, оставшаяся от убранного снимка, на сайте не нужна: пусть её
  // возьмёт первое живое фото (в CRM так же поступает coverSync)
  for (const item of result.values()) {
    if (item.image && !item.images.includes(item.image)) item.image = null;
  }
  return result;
}

/**
 * Снимки, убранные в карточках (deleted_at), — только их и снимаем с сайта.
 *
 * Сравнивать сайт с базой «целиком» нельзя: в catalog.json есть позиции,
 * которых в базе нет вовсе (каталог шире выгрузки), и такая «синхронизация»
 * стёрла бы у них все фото. Поэтому удаление — это ровно отметка в карточке.
 */
async function readRemoved(db) {
  const gallery = await db.query(
    `SELECT ci.component_id, ci.image_path
       FROM component_images ci
      WHERE ci.deleted_at IS NOT NULL`);
  const mods = await db.query(
    `SELECT m.component_id, m.code, i.image_path
       FROM component_modification_images i
       JOIN component_modifications m ON m.id = i.modification_id
      WHERE i.deleted_at IS NOT NULL`);
  const components = await db.query('SELECT id, article FROM components');

  const byId = new Map(components.rows.map(row => [row.id, row.article]));
  const removed = new Map();
  const entry = article => {
    if (!removed.has(article)) removed.set(article, { images: [], mods: new Map() });
    return removed.get(article);
  };

  for (const row of gallery.rows) {
    const article = byId.get(row.component_id);
    if (article) entry(article).images.push(row.image_path);
  }
  for (const row of mods.rows) {
    const article = byId.get(row.component_id);
    if (!article) continue;
    const modsOf = entry(article).mods;
    if (!modsOf.has(row.code)) modsOf.set(row.code, []);
    modsOf.get(row.code).push(row.image_path);
  }
  return removed;
}

/**
 * Перенести фото из базы в catalog.json.
 *
 * `place(url)` — функция, которая кладёт файл в catalog/files и возвращает
 * имя в каталоге (или null, если файла нет). Вынесена наружу, чтобы правило
 * слияния проверялось тестом без диска и базы.
 */
function applyImages(components, fromDb, { place, prune = false, removed = new Map() } = {}) {
  const report = { components: 0, removed: 0 };

  /**
   * `dropped` — имена в каталоге, которые в CRM убрали (deleted_at).
   * Раньше --prune приводил галерею к ответу базы целиком, но в каталоге есть
   * позиции, которых в базе нет, — у них стирались бы все фото. Теперь с
   * сайта снимается ровно то, что убрали в карточке.
   */
  const merge = (current, incoming, put, dropped = []) => {
    const names = [];
    for (const url of incoming) {
      const name = put(url, current || []);
      if (name && !names.includes(name)) names.push(name);
    }
    const drop = new Set(dropped.filter(Boolean));
    if (prune && drop.size > 0) {
      report.removed += (current || []).filter(name => drop.has(name)).length;
    }
    const kept = (current || []).filter(name => !drop.has(name));
    if (names.length === 0) return kept;
    // Порядок задаёт CRM: менеджер переставляет снимки и меняет обложку, и это
    // должно быть видно на сайте. Прежние «хвосты» (фото, которое в карточке
    // уже не показывается) уходят в конец, а не пропадают: в каталоге бывают
    // позиции, которых в базе нет, и терять их снимки нельзя.
    const merged = names.slice();
    for (const name of kept) {
      if (!merged.includes(name)) merged.push(name);
    }
    return merged;
  };

  for (const component of components) {
    const entry = fromDb.get(component.article);
    const gone = removed.get(component.article) || { images: [], mods: new Map() };
    if (!entry && gone.images.length === 0) continue;

    const put = (url, hints = []) => place(url, component.article, hints);
    // путь убранного в карточке снимка → имя файла в каталоге (файл там уже есть).
    // Если файла в uploads/images уже нет (почистили), place() вернёт null — тогда
    // ищем имя по имени файла из пути: иначе удалённое фото так и осталось бы
    // на сайте, ведь отметка deleted_at есть, а снять её не с чем.
    const droppedNames = gone.images
      .map(url => {
        const placed = place(url, component.article, component.images || []);
        if (placed) return placed;
        const file = uploadName(url);
        return file ? path.basename(file) : null;
      })
      .filter(Boolean);
    const before = JSON.stringify([component.image, component.images,
      (component.modifications || []).map(mod => mod.images)]);
    const living = entry ? entry.images : [];
    const coverUrl = (entry && entry.image) || living[0] || null;
    const cover = coverUrl
      ? put(coverUrl, [component.image, ...(component.images || [])].filter(Boolean))
      : null;
    const gallery = merge(component.images, living, put, droppedNames);

    const coverGone = droppedNames.includes(component.image);
    if (cover && !droppedNames.includes(cover)) component.image = cover;
    else if (cover && droppedNames.includes(cover)) {
      // обложку убрали — на сайте первой становится первая оставшаяся
      component.image = gallery[0];
      if (!component.image) delete component.image;
    } else if (coverGone || (!cover && droppedNames.includes(component.image))) {
      // обложку убрали, и других фото не осталось: поле image указывало на
      // удалённый файл — на сайте он бы продолжал показываться
      component.image = gallery[0];
      if (!component.image) delete component.image;
    }
    if (gallery.length) component.images = gallery;
    else if (prune && entry && living.length === 0) component.images = [];

    for (const mod of component.modifications || []) {
      const incoming = (entry && entry.mods.get(mod.code)) || [];
      const goneMods = (gone.mods.get(mod.code) || [])
        .map(url => place(url, component.article, mod.images || []))
        .filter(Boolean);
      if (incoming.length === 0 && goneMods.length === 0) continue;
      const names = merge(mod.images, incoming, put, goneMods);
      if (names.length) mod.images = names;
      else if (prune && goneMods.length > 0) mod.images = [];
    }

    const after = JSON.stringify([component.image, component.images,
      (component.modifications || []).map(mod => mod.images)]);
    if (after !== before) report.components += 1;
  }
  return report;
}

/** Кладёт файл из uploads/images в catalog/files; повторный вызов — тот же файл. */
function makePlacer({ dryRun = false } = {}) {
  // один и тот же снимок в каталоге лежит под несколькими именами (Л/П, 008/008.1);
  // храним все, чтобы выбрать имя «своей» позиции, а не первую попавшуюся
  const byDigest = new Map();
  // sha256 содержимого каталога → имена файлов. По нему узнаём снимок, который
  // уже лежит в каталоге, но в базе записан под именем из placeImage
  // (catalog_<sha256[:16]>): после нормализации файл перекодирован в JPEG и
  // побайтово отличается, а имя хранит хэш оригинала.
  const byOriginal = new Map();
  const missing = [];

  for (const name of fs.existsSync(FILES_DIR) ? fs.readdirSync(FILES_DIR) : []) {
    const full = path.join(FILES_DIR, name);
    try {
      const buffer = fs.readFileSync(full);
      const digest = crypto.createHash('sha1').update(buffer).digest('hex');
      if (!byDigest.has(digest)) byDigest.set(digest, []);
      byDigest.get(digest).push(name);

      const sha = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
      if (!byOriginal.has(sha)) byOriginal.set(sha, []);
      if (!byOriginal.get(sha).includes(name)) byOriginal.get(sha).push(name);
    } catch {
      /* каталог с картинками — не повод падать */
    }
  }

  // из имён с одинаковым содержимым берём то, что уже стоит в каталоге:
  // иначе выгрузка плодила бы дубли вроде a-3731-023-1_… и a-3731-023-3_…
  const pick = (names, base, hints) => {
    for (const hint of hints || []) {
      if (names.includes(hint)) return hint;
    }
    return names.find(name => name.startsWith(`${base}_`) || name.startsWith(`${base}.`)) || names[0];
  };

  const place = (url, article = '', hints = []) => {
    const file = uploadName(url);
    if (!file) {
      missing.push(String(url));
      return null;
    }
    const source = path.join(UPLOADS_IMAGES, file);
    if (!fs.existsSync(source)) {
      missing.push(url);
      return null;
    }
    const buffer = fs.readFileSync(source);
    const digest = crypto.createHash('sha1').update(buffer).digest('hex');
    // файл из базы после нормализации: имя помнит хэш оригинала из каталога
    const known = /^catalog_([0-9a-f]{16})\.(jpe?g|png|webp)$/i.exec(file);
    if (known && byOriginal.has(known[1])) {
      const ext = (path.extname(file) || '.jpg').toLowerCase();
      const base = slugify(article || path.basename(file, ext)) || 'foto';
      return pick(byOriginal.get(known[1]), base, hints);
    }
    const ext = (path.extname(file) || '.jpg').toLowerCase();
    const base = slugify(article || path.basename(file, ext)) || 'foto';
    if (byDigest.has(digest)) return pick(byDigest.get(digest), base, hints);

    const name = `${base}_${digest.slice(0, 12)}${ext}`;
    if (!dryRun && !fs.existsSync(path.join(FILES_DIR, name))) {
      fs.writeFileSync(path.join(FILES_DIR, name), buffer);
    }
    byDigest.set(digest, [name]);
    return name;
  };

  place.missing = missing;
  return place;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const prune = args.has('--prune');

  const db = require('../../src/db');
  const config = JSON.parse(fs.readFileSync(CATALOG_JSON, 'utf8'));

  let fromDb;
  try {
    fromDb = await readFromDb(db);
  } catch (err) {
    const { describeDbError } = require('../../src/utils/db-error');
    console.error('❌ Не удалось прочитать базу:', describeDbError(err));
    console.error(process.env.PGLITE_DIR
      ? '   Демо-база: cd server && npm run demo:export-images'
      : '   Проверьте DATABASE_URL в server/.env (docs/deploy-vps.md).' +
        ' Демо-база: cd server && npm run demo:export-images');
    process.exitCode = 1;
    if (typeof db.close === 'function') await db.close();
    return;
  }

  const withPhoto = [...fromDb.values()].filter(entry => entry.image || entry.images.length).length;
  console.log(`🖼  Позиций с фото в базе: ${withPhoto}`);

  let removed = new Map();
  if (prune) {
    try {
      removed = await readRemoved(db);
    } catch (err) {
      // база без миграции: снимать нечего, выгрузка остаётся «только добавлять»
      if (!/deleted_at/i.test(err.message || '')) throw err;
      console.log('ℹ️  Отметок об убранных фото в базе нет — примените миграции.');
    }
  }

  const placer = makePlacer({ dryRun });
  const report = applyImages(config.components, fromDb, { place: placer, prune, removed });

  if (placer.missing.length) {
    console.log(`   ⚠️  файлов нет в uploads/images: ${placer.missing.slice(0, 5).join(', ')}` +
      (placer.missing.length > 5 ? ` и ещё ${placer.missing.length - 5}` : ''));
  }

  if (report.components === 0) {
    console.log('ℹ️  catalog.json уже совпадает с карточками — писать нечего.');
  } else if (dryRun) {
    console.log(`ℹ️  --dry-run: изменились бы ${report.components} позиций, файлы не скопированы.`);
  } else {
    fs.writeFileSync(CATALOG_JSON, `${JSON.stringify(config, null, 1)}\n`, 'utf8');
    console.log(`✅ Обновлено позиций: ${report.components}` +
      (prune ? `, снято снимков: ${report.removed}` : ''));
    console.log(`   catalog.json: ${CATALOG_JSON}`);
    console.log('   Дальше: python3 site/build.py — фото появятся на сайте.');
  }

  if (typeof db.close === 'function') await db.close();
}

// Запуск напрямую или через dev/run.js (демо-база PGlite).
const viaDevRunner = /dev[\\/]run\.js$/.test(process.argv[1] || '');
if (require.main === module || viaDevRunner) {
  main().catch(err => {
    console.error('❌ Ошибка экспорта фото:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { applyImages, slugify, uploadName, readFromDb, readRemoved };
