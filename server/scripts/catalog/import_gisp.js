/**
 * Ссылки на ГИСП из каталога сайта — в карточки CRM.
 *
 * Обратная сторона export_gisp.js: тот переносит ссылки из CRM в catalog.json,
 * этот — наоборот, чтобы отметки, заведённые списком (db:apply-gisp), были
 * видны менеджеру в карточке позиции.
 *
 *   cd server
 *   npm run db:import-gisp               # заполнить только пустые поля
 *   npm run db:import-gisp -- --dry-run  # показать, что изменится
 *   npm run db:import-gisp -- --force    # перезаписать и заполненные
 *
 * По умолчанию уже заполненное в CRM не трогаем: ручную правку менеджера
 * скрипт затирать не должен.
 */
const fs = require('fs');
const path = require('path');

const CATALOG_JSON = path.join(__dirname, '../../src/db/catalog/catalog.json');

/** Плоский список ссылок из каталога: артикул → url. */
function linksFromCatalog(config) {
  const links = new Map();
  for (const component of config.components || []) {
    const url = String(component.gisp_url || '').trim();
    if (url) links.set(component.article, url);
  }
  return links;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const force = args.has('--force');

  const config = JSON.parse(fs.readFileSync(CATALOG_JSON, 'utf8'));
  const links = linksFromCatalog(config);
  console.log(`🔗 Позиций со ссылкой на ГИСП в каталоге: ${links.size}`);

  const db = require('../../src/db');
  let rows;
  try {
    rows = await db.query('SELECT article, gisp_url FROM components');
  } catch (err) {
    const { describeDbError } = require('../../src/utils/db-error');
    console.error('❌ Не удалось прочитать базу:', describeDbError(err));
    console.error(process.env.PGLITE_DIR
      ? '   Демо-база: cd server && npm run demo:import-gisp'
      : '   Проверьте DATABASE_URL в server/.env (docs/deploy-vps.md).' +
        ' Демо-база: cd server && npm run demo:import-gisp');
    process.exitCode = 1;
    if (typeof db.close === 'function') await db.close();
    return;
  }

  const inDb = new Map(rows.rows.map(row => [row.article, String(row.gisp_url || '').trim()]));
  const toWrite = [];
  const skipped = [];
  const missing = [];

  for (const [article, url] of links) {
    if (!inDb.has(article)) {
      missing.push(article);
      continue;
    }
    const current = inDb.get(article);
    if (current === url) continue;
    if (current && !force) {
      skipped.push(article);
      continue;
    }
    toWrite.push([article, url]);
  }

  console.log(`   заполнить: ${toWrite.length}, уже заполнено (оставлено): ${skipped.length}` +
    (missing.length ? `, нет в базе: ${missing.length}` : ''));
  if (skipped.length) {
    console.log(`   ⚠️  в CRM своя ссылка, не трогаем: ${skipped.slice(0, 5).join(', ')}` +
      (skipped.length > 5 ? ' …' : ''));
  }
  if (missing.length) {
    console.log(`   ⚠️  нет в базе: ${missing.slice(0, 5).join(', ')}` +
      (missing.length > 5 ? ' …' : ''));
  }

  if (toWrite.length === 0) {
    console.log('ℹ️  карточки уже совпадают с каталогом — писать нечего.');
  } else if (dryRun) {
    console.log('ℹ️  --dry-run: база не изменена.');
  } else {
    for (const [article, url] of toWrite) {
      await db.query('UPDATE components SET gisp_url = $1 WHERE article = $2', [url, article]);
    }
    console.log(`✅ Обновлено карточек: ${toWrite.length}`);
  }

  if (typeof db.close === 'function') await db.close();
}

const viaDevRunner = /dev[\\/]run\.js$/.test(process.argv[1] || '');
if (require.main === module || viaDevRunner) {
  main().catch(err => {
    console.error('❌ Ошибка импорта ГИСП:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { linksFromCatalog };
