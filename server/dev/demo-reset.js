/* =============================================
   DEMO: пересоздание схемы в PGlite (только для локальной разработки)
   Запуск: node dev/demo-reset.js
   ============================================= */
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

(async () => {
  if (!process.env.PGLITE_DIR) {
    console.error('PGLITE_DIR не задан — скрипт только для dev-режима PGlite.');
    process.exit(1);
  }
  await db.pglite.waitReady;
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const schema = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
  await db.query(schema);
  console.log('✅ Схема пересоздана');
  await db.close();
})().catch(err => { console.error(err); process.exit(1); });
