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
  const gallery = await db.query(
    'SELECT component_id, image_path FROM component_images ORDER BY component_id, sort_order, id');
  const mods = await db.query(
    `SELECT m.component_id, m.code, i.image_path
       FROM component_modification_images i
       JOIN component_modifications m ON m.id = i.modification_id
      ORDER BY m.component_id, m.sort_order, i.sort_order, i.id`);

  const byId = new Map(components.rows.map(row => [row.id, row.article]));
  const result = new Map();
  const entry = article => {
    if (!result.has(article)) result.set(article, { image: null, images: [], mods: new Map() });
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
  return result;
}

/**
 * Перенести фото из базы в catalog.json.
 *
 * `place(url)` — функция, которая кладёт файл в catalog/files и возвращает
 * имя в каталоге (или null, если файла нет). Вынесена наружу, чтобы правило
 * слияния проверялось тестом без диска и базы.
 */
function applyImages(components, fromDb, { place, prune = false } = {}) {
  const report = { components: 0, removed: 0 };

  const merge = (current, incoming, put) => {
    const names = [];
    for (const url of incoming) {
      const name = put(url, current || []);
      if (name && !names.includes(name)) names.push(name);
    }
    if (names.length === 0) return current || [];
    if (prune) {
      if (Array.isArray(current)) report.removed += current.filter(n => !names.includes(n)).length;
      return names;
    }
    // порядок каталога — основной: правки в CRM только добавляют снимки,
    // иначе каждая выгрузка тасовала бы галереи и засоряла историю
    const merged = (current || []).slice();
    for (const name of names) {
      if (!merged.includes(name)) merged.push(name);
    }
    return merged;
  };

  for (const component of components) {
    const entry = fromDb.get(component.article);
    if (!entry) continue;

    const put = (url, hints = []) => place(url, component.article, hints);
    const before = JSON.stringify([component.image, component.images,
      (component.modifications || []).map(mod => mod.images)]);
    const coverUrl = entry.image || entry.images[0] || null;
    const cover = coverUrl
      ? put(coverUrl, [component.image, ...(component.images || [])].filter(Boolean))
      : null;
    const gallery = merge(component.images, entry.images.length ? entry.images : (coverUrl ? [coverUrl] : []), put);

    if (cover) component.image = cover;
    else if (prune && entry.image === null && gallery.length === 0) delete component.image;
    if (gallery.length) component.images = gallery;

    for (const mod of component.modifications || []) {
      const incoming = entry.mods.get(mod.code);
      if (!incoming || incoming.length === 0) continue;
      const names = merge(mod.images, incoming, put);
      if (names.length) mod.images = names;
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
  const missing = [];

  for (const name of fs.existsSync(FILES_DIR) ? fs.readdirSync(FILES_DIR) : []) {
    const full = path.join(FILES_DIR, name);
    try {
      const digest = crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex');
      if (!byDigest.has(digest)) byDigest.set(digest, []);
      byDigest.get(digest).push(name);
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

  const placer = makePlacer({ dryRun });
  const report = applyImages(config.components, fromDb, { place: placer, prune });

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

module.exports = { applyImages, slugify, uploadName, readFromDb };
