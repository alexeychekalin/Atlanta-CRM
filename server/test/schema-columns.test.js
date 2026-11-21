const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/**
 * Страховка от ошибок вида «column "is_active" does not exist»:
 * сверяем колонки, которые маршруты пишут в INSERT/UPDATE,
 * со схемой — schema.sql плюс все миграции (ALTER TABLE ... ADD COLUMN).
 */

const dbDir = path.join(__dirname, '../src/db');
const srcDir = path.join(__dirname, '../src');

// Служебные таблицы создаёт сам код миграций, в schema.sql их нет
const SKIP_TABLES = new Set(['schema_migrations']);

const TYPE_RE = /^(SERIAL|BIGSERIAL|INT|INTEGER|SMALLINT|BIGINT|VARCHAR|TEXT|NUMERIC|DECIMAL|BOOLEAN|TIMESTAMP|DATE|TIME|JSONB|JSON|UUID|DOUBLE|REAL|CHAR|MONEY|INTERVAL)\b/i;

/** Колонки всех CREATE TABLE в куске SQL: таблица → набор колонок. */
function collectTables(sql, into = new Map()) {
  const re = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-z_][\w]*)\s*\(/gi;
  let match;
  while ((match = re.exec(sql)) !== null) {
    const table = match[1].toLowerCase();
    // тело таблицы — до парной закрывающей скобки
    let depth = 1;
    let i = re.lastIndex;
    const start = i;
    while (i < sql.length && depth > 0) {
      if (sql[i] === '(') depth += 1;
      else if (sql[i] === ')') depth -= 1;
      i += 1;
    }
    const body = sql.slice(start, i - 1);
    const columns = into.get(table) || new Set();
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('--')) continue;
      const column = line.match(/^([a-z_][\w]*)\s+(\w+)/i);
      if (!column) continue;
      if (!TYPE_RE.test(column[2])) continue; // PRIMARY KEY, CONSTRAINT, CHECK …
      columns.add(column[1].toLowerCase());
    }
    into.set(table, columns);
  }
  return into;
}

/** Колонки, добавленные миграциями: ALTER TABLE x ADD COLUMN [IF NOT EXISTS] y. */
function collectAddedColumns(sql, into) {
  const re = /ALTER TABLE\s+([a-z_][\w]*)[\s\S]*?ADD COLUMN(?:\s+IF NOT EXISTS)?\s+([a-z_][\w]*)/gi;
  let match;
  while ((match = re.exec(sql)) !== null) {
    const table = match[1].toLowerCase();
    if (!into.has(table)) into.set(table, new Set());
    into.get(table).add(match[2].toLowerCase());
  }
  return into;
}

function schemaColumns() {
  const files = fs.readdirSync(dbDir)
    .filter(name => name === 'schema.sql' || /^migration_.*\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const tables = new Map();
  for (const name of files) {
    const sql = fs.readFileSync(path.join(dbDir, name), 'utf8');
    collectTables(sql, tables);
    collectAddedColumns(sql, tables);
  }
  return tables;
}

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Колонки, которые код пишет в INSERT INTO t (...). */
function insertColumns(sql) {
  const out = [];
  const re = /INSERT INTO\s+([a-z_][\w]*)\s*\(([^)]*)\)/gi;
  let match;
  while ((match = re.exec(sql)) !== null) {
    const table = match[1].toLowerCase();
    const columns = match[2].split(',')
      .map(part => part.trim().toLowerCase())
      .filter(part => /^[a-z_][\w]*$/.test(part));
    if (columns.length > 0) out.push({ table, columns });
  }
  return out;
}

/** Колонки, которые код пишет в UPDATE t SET a = …, b = …. */
function updateColumns(sql) {
  const out = [];
  const re = /UPDATE\s+([a-z_][\w]*)\s+SET\s+([\s\S]*?)(?:\bWHERE\b|\bRETURNING\b|`|$)/gi;
  let match;
  while ((match = re.exec(sql)) !== null) {
    const table = match[1].toLowerCase();
    const body = match[2];
    const columns = [];
    const colRe = /(?:^|,)\s*([a-z_][\w]*)\s*=/gi;
    let col;
    while ((col = colRe.exec(body)) !== null) columns.push(col[1].toLowerCase());
    if (columns.length > 0) out.push({ table, columns });
  }
  return out;
}

test('все колонки из INSERT/UPDATE маршрутов есть в схеме или миграциях', () => {
  const tables = schemaColumns();
  assert.ok(tables.size > 20, 'схема не разобрана');

  const problems = [];
  for (const file of sourceFiles(srcDir)) {
    const code = fs.readFileSync(file, 'utf8');
    const rel = path.relative(srcDir, file);
    for (const { table, columns } of [...insertColumns(code), ...updateColumns(code)]) {
      if (SKIP_TABLES.has(table)) continue;
      if (!tables.has(table)) {
        problems.push(`${rel}: таблицы ${table} нет ни в schema.sql, ни в миграциях`);
        continue;
      }
      for (const column of columns) {
        if (!tables.get(table).has(column)) {
          problems.push(`${rel}: ${table}.${column} — колонки нет в схеме`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('модификации: активность есть в схеме, миграции и маршруте', () => {
  const schema = fs.readFileSync(path.join(dbDir, 'schema.sql'), 'utf8');
  const table = schema.match(/CREATE TABLE IF NOT EXISTS component_modifications[\s\S]*?\n\);/);
  assert.ok(table, 'нет таблицы component_modifications в schema.sql');
  assert.match(table[0], /is_active BOOLEAN NOT NULL DEFAULT true/, 'в свежей схеме нет is_active');

  const migrationFile = path.join(dbDir, 'migration_component_modifications_active.sql');
  assert.ok(fs.existsSync(migrationFile), 'нет миграции для уже развёрнутых баз');
  const migration = fs.readFileSync(migrationFile, 'utf8');
  assert.match(migration, /ALTER TABLE component_modifications\s+ADD COLUMN IF NOT EXISTS is_active/i);
  assert.match(migration, /DEFAULT true/i);
});
