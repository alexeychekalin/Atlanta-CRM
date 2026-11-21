/* =============================================
   DEMO: наполнение базы на PGlite — контрагенты + каталог
   =============================================
   Использование:
     cd server
     npm run demo:data                    # контрагенты и каталог
     WITH_CATALOG=0 npm run demo:data     # только контрагенты
   ============================================= */
const path = require('path');

process.env.PGLITE_DIR = process.env.PGLITE_DIR || path.resolve(__dirname, '../../.pglite');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const db = require('../src/db');
const { run } = require('../src/db/data');

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
