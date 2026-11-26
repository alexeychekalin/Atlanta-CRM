require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// --- Dev-режим без PostgreSQL: PGlite (WASM) ---
// Включается только при PGLITE_DIR=... и не влияет на продакшн-запуск через `pg`.
if (process.env.PGLITE_DIR) {
  module.exports = require('../dev/pglite-db');
  return;
}

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Непредвиденная ошибка подключения к БД:', err);
  process.exit(1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  close: () => pool.end(),
};
