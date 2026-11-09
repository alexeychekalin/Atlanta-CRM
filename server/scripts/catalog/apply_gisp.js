/**
 * Ссылки на реестр ГИСП из списка — в каталог сайта.
 *
 * Список записей лежит в gisp-links.json и правится руками: у каждой строки
 * либо точный артикул (match отсутствует или exact), либо семейство
 * (match: prefix) — тогда отметку получают все артикулы, которые начинаются
 * с этого значения, вместе со всеми исполнениями.
 *
 *   cd server
 *   npm run db:apply-gisp              # записать в src/db/catalog/catalog.json
 *   npm run db:apply-gisp -- --dry-run # только показать, кого заденет
 *   npm run demo:apply-gisp            # то же, но с подсказками демо-базы
 *
 * Сайт собирается из catalog.json, поэтому после применения — python3 site/build.py.
 * Чтобы ссылки появились и в карточках CRM, есть обратная команда: db:import-gisp.
 */
const fs = require('fs');
const path = require('path');

const CATALOG_JSON = path.join(__dirname, '../../src/db/catalog/catalog.json');
const LINKS_JSON = path.join(__dirname, 'gisp-links.json');

/** Применить список ссылок к компонентам каталога. Возвращает отчёт. */
function applyLinks(components, links) {
  const report = { matched: 0, changed: 0, unchanged: 0, rules: [], unmatched: [] };

  for (const rule of links) {
    const match = (rule.match || 'exact').toLowerCase();
    if (!rule.article || !rule.url) {
      report.unmatched.push({ article: rule.article || '—', reason: 'нет артикула или ссылки' });
      continue;
    }
    const hits = match === 'prefix'
      ? components.filter(entry => entry.article.startsWith(rule.article))
      : components.filter(entry => entry.article === rule.article);

    report.rules.push({ article: rule.article, match, url: rule.url, hits: hits.length });
    if (hits.length === 0) {
      report.unmatched.push({ article: rule.article, reason: 'нет такой позиции в каталоге' });
      continue;
    }

    for (const component of hits) {
      report.matched += 1;
      if (component.gisp_url === rule.url) {
        report.unchanged += 1;
      } else {
        component.gisp_url = rule.url;
        report.changed += 1;
      }
    }
  }

  return report;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');

  const config = JSON.parse(fs.readFileSync(CATALOG_JSON, 'utf8'));
  const { links } = JSON.parse(fs.readFileSync(LINKS_JSON, 'utf8'));
  const report = applyLinks(config.components, links);

  for (const rule of report.rules) {
    const scope = rule.match === 'prefix' ? 'семейство' : 'артикул';
    console.log(`  ${rule.match === 'prefix' ? '◆' : '·'} ${rule.article} (${scope}): ` +
      `${rule.hits} поз. → ${rule.url.split('/').pop()}`);
  }

  if (report.unmatched.length) {
    for (const item of report.unmatched) {
      console.log(`  ⚠️  ${item.article}: ${item.reason}`);
    }
  }

  const total = config.components.filter(entry => entry.gisp_url).length;
  console.log(`\n🔗 Отметку получили: ${report.matched} поз. ` +
    `(изменилось ${report.changed}, без изменений ${report.unchanged})`);
  console.log(`   Всего позиций с ГИСП в каталоге: ${total} из ${config.components.length}`);

  if (report.changed === 0) {
    console.log('ℹ️  catalog.json уже совпадает со списком — писать нечего.');
    return;
  }
  if (dryRun) {
    console.log('ℹ️  --dry-run: catalog.json не изменён.');
    return;
  }

  fs.writeFileSync(CATALOG_JSON, `${JSON.stringify(config, null, 1)}\n`, 'utf8');
  console.log(`✅ Записано: ${CATALOG_JSON}`);
  console.log('   Дальше: python3 site/build.py — раздел «Сделано в России» пересоберётся.');
}

const viaDevRunner = /dev[\\/]run\.js$/.test(process.argv[1] || '');
if (require.main === module || viaDevRunner) {
  try {
    main();
  } catch (err) {
    console.error('❌ Ошибка применения ссылок ГИСП:', err.message);
    process.exitCode = 1;
  }
}

module.exports = { applyLinks, LINKS_JSON, CATALOG_JSON };
