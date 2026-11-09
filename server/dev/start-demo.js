/* =============================================
   DEMO: локальный запуск без PostgreSQL (PGlite)
   =============================================
   Использование:
     cd server
     npm run demo:init   # один раз — схема + роли + демо-данные
     npm run demo        # запуск на http://localhost:3000
   ============================================= */
const path = require('path');

process.env.PGLITE_DIR = process.env.PGLITE_DIR || path.join(__dirname, '../../.pglite');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.PORT = process.env.PORT || '3000';

require('../src/index.js');
