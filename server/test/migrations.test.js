const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const dbDir = path.join(__dirname, '../src/db');

/** Все SQL-файлы схемы и миграций. */
function sqlFiles() {
  return fs.readdirSync(dbDir)
    .filter(name => name === 'schema.sql' || /^migration_.*\.sql$/.test(name))
    .map(name => ({ name, sql: fs.readFileSync(path.join(dbDir, name), 'utf8') }));
}

/** Достаёт INSERT-выражения в указанные таблицы. */
function insertsInto(sql, table) {
  const re = new RegExp(`INSERT INTO ${table}[\\s\\S]*?;`, 'gi');
  return sql.match(re) || [];
}

test('словарные вставки идемпотентны: повторный deploy не задваивает значения', () => {
  const tables = ['client_work_statuses', 'component_categories', 'equipment_types'];
  const problems = [];

  for (const { name, sql } of sqlFiles()) {
    for (const table of tables) {
      for (const statement of insertsInto(sql, table)) {
        // ON CONFLICT DO NOTHING без уникального ключа ничего не делает —
        // именно из-за этого статусы и типы техники задваивались при деплое.
        if (/ON CONFLICT DO NOTHING/i.test(statement) && !/WHERE NOT EXISTS/i.test(statement)) {
          problems.push(`${name}: ${table} — ON CONFLICT DO NOTHING без уникального ключа`);
        }
        if (!/WHERE NOT EXISTS/i.test(statement)) {
          problems.push(`${name}: ${table} — вставка без WHERE NOT EXISTS`);
        }
      }
    }
  }

  assert.deepEqual(problems, []);
});

test('миграция чистит уже накопившиеся дубли и ставит уникальные индексы', () => {
  const file = path.join(dbDir, 'migration_dedupe_dictionaries.sql');
  assert.ok(fs.existsSync(file), 'нет migration_dedupe_dictionaries.sql');

  const sql = fs.readFileSync(file, 'utf8');
  for (const table of ['client_work_statuses', 'component_categories', 'equipment_types']) {
    assert.match(sql, new RegExp(`DELETE FROM ${table}`), `дубли ${table} не удаляются`);
  }
  assert.match(sql, /ux_client_work_statuses_name/);
  assert.match(sql, /ux_component_categories_name/);
  assert.match(sql, /ux_equipment_types_name/);
  // Ссылки клиентов/компонентов/оборудования должны переехать на оставшуюся запись
  assert.match(sql, /UPDATE clients/);
  assert.match(sql, /UPDATE components/);
  assert.match(sql, /UPDATE manufacturer_products/);
});

test('новые поля карточки клиента и файлы описаны в схеме и миграциях', () => {
  const schema = fs.readFileSync(path.join(dbDir, 'schema.sql'), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS client_files/);
  assert.match(schema, /site VARCHAR\(500\)/);

  const site = fs.readFileSync(path.join(dbDir, 'migration_client_site.sql'), 'utf8');
  assert.match(site, /ADD COLUMN IF NOT EXISTS site/i);

  const files = fs.readFileSync(path.join(dbDir, 'migration_client_files.sql'), 'utf8');
  assert.match(files, /CREATE TABLE IF NOT EXISTS client_files/);
  assert.match(files, /REFERENCES clients\(id\) ON DELETE CASCADE/);
});
