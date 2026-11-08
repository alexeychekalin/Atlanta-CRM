/**
 * Ссылки на реестр ГИСП: из карточки позиции в CRM — в catalog.json сайта.
 *
 * Сайт статический и собирается из src/db/catalog/catalog.json, а отметку
 * «Сделано в России» менеджер ставит в CRM: карточка позиции → «Ссылка на ГИСП».
 * Скрипт переносит эти ссылки обратно в catalog.json, чтобы раздел
 * /made-in-russia/ и бейджи в карточках появились после следующей сборки.
 *
 *   cd server
 *   npm run db:export-gisp            # из DATABASE_URL
 *   npm run demo:export-gisp          # из демо-базы PGlite
 *   npm run db:export-gisp -- --dry-run
 *
 * Пустая ссылка в базе не стирает значение из catalog.json: если ГИСП-запись
 * убрали в CRM, её надо убрать и из catalog.json руками (или передать --prune).
 */
const fs = require('fs');
const path = require('path');

const CATALOG_JSON = path.join(__dirname, '../../src/db/catalog/catalog.json');

async function readFromDb(db) {
  const result = await db.query(
    `SELECT article, gisp_url FROM components
     WHERE gisp_url IS NOT NULL AND btrim(gisp_url) <> ''`);
  return new Map(result.rows.map(row => [row.article, row.gisp_url.trim()]));
}

function apply(components, gisp, { prune = false } = {}) {
  const changes = { added: [], updated: [], removed: [], missing: [] };
  for (const entry of components) {
    const url = gisp.get(entry.article);
    if (url) {
      if (!entry.gisp_url) {
        entry.gisp_url = url;
        changes.added.push(entry.article);
      } else if (entry.gisp_url !== url) {
        entry.gisp_url = url;
        changes.updated.push(entry.article);
      }
    } else if (prune && entry.gisp_url) {
      delete entry.gisp_url;
      changes.removed.push(entry.article);
    }
  }
  const known = new Set(components.map(entry => entry.article));
  for (const article of gisp.keys()) {
    if (!known.has(article)) changes.missing.push(article);
  }
  return changes;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const prune = args.has('--prune');

  let db;
  try {
    db = require('../../src/db');
  } catch (err) {
    console.error('❌ Не удалось подключиться к базе:', err.message);
    process.exitCode = 1;
    return;
  }

  const config = JSON.parse(fs.readFileSync(CATALOG_JSON, 'utf8'));
  const gisp = await readFromDb(db);
  console.log(`🔗 Позиций со ссылкой на ГИСП в базе: ${gisp.size}`);

  const changes = apply(config.components, gisp, { prune });
  const total = changes.added.length + changes.updated.length + changes.removed.length;
  console.log(`   новых: ${changes.added.length}, изменённых: ${changes.updated.length}` +
    (prune ? `, снятых: ${changes.removed.length}` : ''));
  if (changes.missing.length > 0) {
    console.log(`   ⚠️  нет в catalog.json: ${changes.missing.slice(0, 10).join(', ')}` +
      (changes.missing.length > 10 ? ' …' : ''));
  }

  if (total === 0) {
    console.log('ℹ️  catalog.json уже совпадает с базой — писать нечего.');
  } else if (dryRun) {
    console.log('ℹ️  --dry-run: catalog.json не изменён.');
  } else {
    fs.writeFileSync(CATALOG_JSON, `${JSON.stringify(config, null, 1)}\n`, 'utf8');
    console.log(`✅ Записано: ${CATALOG_JSON}`);
    console.log('   Дальше: python3 site/build.py — раздел «Сделано в России» пересоберётся.');
  }

  if (typeof db.close === 'function') await db.close();
}

// Запуск напрямую или через dev/run.js (демо-база PGlite): при обычном
// require() из тестов main() не выполняется.
const viaDevRunner = /dev[\\/]run\.js$/.test(process.argv[1] || '');
if (require.main === module || viaDevRunner) {
  main().catch(err => {
    console.error('❌ Ошибка экспорта ГИСП:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { apply };
