/* =============================================
   DEMO: предзаполнение клиентами на PGlite
   =============================================
   Использование:
     cd server
     npm run demo:preseed

   Отдельная обёртка вместо dev/run.js: тому скрипту нужен файл-цель,
   который сам себя запускает (require.main === module), а preseed —
   модуль с экспортами, поэтому здесь мы вызываем run() напрямую.
   ============================================= */
const path = require('path');

process.env.PGLITE_DIR = process.env.PGLITE_DIR || path.resolve(__dirname, '../../.pglite');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const db = require('../src/db');
const { run } = require('../src/db/preseed');

run(db)
  .catch((err) => {
    console.error('❌ Ошибка предзаполнения:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.close();
    } catch {
      /* соединение могло не открыться */
    }
  });
