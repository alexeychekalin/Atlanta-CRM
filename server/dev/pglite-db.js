/* =============================================
   Dev-адаптер: PGlite (PostgreSQL в WASM) → API, совместимый с pg.Pool
   =============================================
   Используется ТОЛЬКО для локальной разработки/демо без установленного Postgres.
   Включается переменной окружения PGLITE_DIR (путь к каталогу с данными).

   Продакшн-код продолжает работать через обычный `pg` (см. ../db.js).
   ============================================= */
const { PGlite } = require('@electric-sql/pglite');

const dataDir = process.env.PGLITE_DIR || '/tmp/atlanta-pglite';
const pglite = new PGlite(dataDir);

// Одна физическая сессия — транзакции сериализуем вручную,
// чтобы BEGIN/COMMIT разных запросов не перемешивались.
let queue = Promise.resolve();
function withLock(fn) {
  const run = queue.then(fn, fn);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

function hasMultipleStatements(sql) {
  // Грубая, но достаточная для dev проверка: ; в конце одного statement допустим,
  // ; + непробельный текст после него — уже несколько statement'ов.
  if (/\$\$/.test(sql) || /\$[a-z_]*\$/i.test(sql)) {
    // dollar-quoted блоки (DO $$ ... $$) могут содержать ; — считаем файлом/скриптом,
    // если после закрывающего $$ есть ещё SQL
    const withoutDollarBlocks = sql.replace(/\$[a-z_]*\$[\s\S]*?\$[a-z_]*\$/gi, "''");
    return /;\s*(?=\S)/.test(withoutDollarBlocks);
  }
  return /;\s*(?=\S)/.test(sql.replace(/--[^\n]*/g, ''));
}

async function runQuery(text, params) {
  const sql = String(text || '');
  if ((!params || params.length === 0) && hasMultipleStatements(sql)) {
    await pglite.exec(sql);
    return { rows: [], fields: [], rowCount: 0 };
  }
  const res = await pglite.query(sql, params ? [...params] : undefined);
  return {
    rows: res.rows || [],
    fields: res.fields || [],
    rowCount: typeof res.affectedRows === 'number' ? res.affectedRows : (res.rows || []).length,
  };
}

function createClient() {
  let released = false;
  return {
    query: (text, params) => {
      if (released) return Promise.reject(new Error('Client was released'));
      return withLock(() => runQuery(text, params));
    },
    release: () => { released = true; },
  };
}

module.exports = {
  pglite,
  query: (text, params) => withLock(() => runQuery(text, params)),
  pool: {
    connect: () => withLock(async () => createClient()),
    query: (text, params) => withLock(() => runQuery(text, params)),
    on: () => {},
    end: () => pglite.close(),
  },
  close: () => pglite.close(),
};
