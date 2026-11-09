/**
 * Применяет SQL-миграции по порядку и ведёт реестр schema_migrations.
 * Повторный запуск безопасен: применённые файлы пропускаются.
 *
 * Использование: npm run db:migrate  (нужен DATABASE_URL в server/.env)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const db = require('../db');

async function run() {
  const client = await db.pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    const files = fs.readdirSync(__dirname)
      .filter(name => /^migration_.*\.sql$/i.test(name))
      .sort((a, b) => a.localeCompare(b, 'en'));

    if (files.length === 0) {
      console.log('ℹ️  Файлов миграций не найдено');
      return;
    }

    const appliedResult = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(appliedResult.rows.map(row => row.filename));

    let count = 0;
    for (const filename of files) {
      if (applied.has(filename)) {
        console.log(`↷  ${filename} — уже применена`);
        continue;
      }

      const sql = fs.readFileSync(path.join(__dirname, filename), 'utf8');
      console.log(`→  ${filename}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        count += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Миграция ${filename} не применена: ${err.message}`);
      }
    }

    console.log(`✅ Применено миграций: ${count}. Всего файлов: ${files.length}`);
  } finally {
    client.release();
  }
}

run()
  .then(async () => {
    if (typeof db.close === 'function') await db.close();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('❌ Ошибка миграции:', err.message);
    if (typeof db.close === 'function') await db.close();
    process.exit(1);
  });
