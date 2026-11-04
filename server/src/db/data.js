/**
 * Наполнение базы данными проекта — один шаг вместо двух.
 *
 * Раньше deploy.sh вызывал по очереди preseed.js (контрагенты из карточек
 * предприятий) и, при WITH_CATALOG=1, catalog.js (каталог АТЛАНТА-26 вместе
 * с жгутами). Ошибки предзаполнения при этом прятались (`2>/dev/null || warn`),
 * и было легко получить базу без клиентов или без каталога, не заметив этого.
 *
 * Теперь оба импорта идут одним шагом: контрагенты → каталог → сводка
 * по фактическим счётчикам в базе. Оба импорта идемпотентны и не
 * перезаписывают правки из интерфейса.
 *
 * Флаги (см. DEPLOY.md, «Варианты наполнения базы»):
 *   WITH_CATALOG=1        — включить каталог (в deploy.sh по умолчанию выключен)
 *   SKIP_CATALOG=1        — то же, что WITH_CATALOG=0
 *   SKIP_PRESEED=1        — не загружать контрагентов
 *   SEED_DEMO / SKIP_PRESEED разбираются в deploy.sh, здесь — только данные
 *
 * Запуск:
 *   npm run db:data       # обычная база (DATABASE_URL)
 *   npm run demo:data     # демо на PGlite (PGLITE_DIR)
 *   WITH_CATALOG=0 npm run db:data   # только контрагенты
 */
const preseed = require('./preseed');
const catalog = require('./catalog');

/**
 * Что загружать. Без переменных окружения — всё: ручной запуск
 * `npm run db:data` наполняет базу целиком.
 */
function resolvePlan(env = process.env) {
  const withCatalog = env.WITH_CATALOG;
  const catalogEnabled = env.SKIP_CATALOG === '1'
    ? false
    : withCatalog === undefined ? true : withCatalog === '1';

  return {
    preseed: env.SKIP_PRESEED !== '1',
    catalog: catalogEnabled,
  };
}

function describe(plan) {
  const parts = [];
  parts.push(plan.preseed ? 'контрагенты (8 карточек предприятий)' : 'контрагенты — пропуск');
  parts.push(plan.catalog ? 'каталог АТЛАНТА-26' : 'каталог — пропуск');
  return parts.join(', ');
}

/** Сводка по фактическим счётчикам — быстрый способ проверить деплой. */
async function reportCounts(runner) {
  const tables = [
    ['клиенты', 'clients'],
    ['позиции каталога', 'components'],
    ['модификации', 'component_modifications'],
  ];

  const parts = [];
  for (const [label, table] of tables) {
    const result = await runner.query(`SELECT count(*)::int AS c FROM ${table}`);
    parts.push(`${label} ${result.rows[0].c}`);
  }
  console.log(`📊 Итого в базе: ${parts.join(', ')}`);
}

async function run(db = require('../db'), env = process.env) {
  const plan = resolvePlan(env);
  if (!plan.preseed && !plan.catalog) {
    console.log('ℹ️  Наполнение: нечего загружать (SKIP_PRESEED=1 и каталог выключен)');
    return plan;
  }

  console.log(`\n📦 Наполнение базы: ${describe(plan)}`);

  if (plan.preseed) {
    await preseed.run(db);
  }
  if (plan.catalog) {
    await catalog.run(db);
  }

  try {
    await reportCounts(db);
  } catch (err) {
    console.warn(`ℹ️  Счётчики недоступны: ${err.message}`);
  }

  return plan;
}

if (require.main === module) {
  const db = require('../db');
  run(db)
    .catch((err) => {
      console.error('❌ Ошибка наполнения базы:', err.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        await db.close();
      } catch {
        /* соединение могло не открыться */
      }
    });
}

module.exports = { run, resolvePlan, reportCounts };
