/* Проверка синтаксиса клиентского JS без выполнения.
   Запуск: node scripts/check-client-syntax.js */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../client');
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
}

walk(root);

let failed = 0;
for (const file of files) {
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (res.status !== 0) {
    failed++;
    console.error(`✖ ${path.relative(root, file)}\n${res.stderr.trim()}`);
  }
}

if (failed > 0) {
  console.error(`\nСинтаксические ошибки: ${failed} из ${files.length}`);
  process.exit(1);
}
console.log(`✅ Синтаксис клиентского JS в порядке (${files.length} файлов)`);
