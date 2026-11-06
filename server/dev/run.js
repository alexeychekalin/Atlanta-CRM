/* =============================================
   DEMO: запуск скрипта с настройками PGlite по умолчанию
   Использование: node dev/run.js src/db/migrate.js
   ============================================= */
const path = require('path');

process.env.PGLITE_DIR = process.env.PGLITE_DIR || path.resolve(__dirname, '../../.pglite');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const target = process.argv[2];
if (!target) {
  console.error('Укажите скрипт: node dev/run.js src/db/migrate.js');
  process.exit(1);
}

require(path.resolve(__dirname, '..', target));
