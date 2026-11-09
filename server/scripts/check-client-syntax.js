/* Проверка клиентского JS без выполнения.

   Что проверяем:
   1. синтаксис — `node --check`;
   2. использование `const`/`let` до объявления внутри той же области
      (TDZ). Именно так ломался просмотр компонентов с модификациями:
      `const fullArticle = fullArticle(...)` — имя переменной затеняет
      функцию, и в момент инициализации она ещё не существует.

   Запуск: node scripts/check-client-syntax.js */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Linter } = require('eslint');

const root = path.resolve(__dirname, '../../client');
const files = [];

// ESLint сопоставляет файлы с конфигом относительно cwd: из server/
// клиентские файлы лежат «выше» и не попадают ни под один шаблон
process.chdir(path.resolve(root, '..'));

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
}

walk(root);

const linter = new Linter();
const tdzConfig = [{
  // файлы лежат вне cwd (server/), поэтому шаблон общий, а filename
  // передаётся относительно текущего каталога — иначе ESLint не найдёт конфиг
  files: ['**/*.js'],
  languageOptions: { ecmaVersion: 2022, sourceType: 'script' },
  rules: {
    'no-use-before-define': ['error', {
      variables: true,
      functions: false,
      classes: false,
      allowNamedExports: false,
    }],
  },
}];

let failed = 0;
for (const file of files) {
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (res.status !== 0) {
    failed++;
    console.error(`✖ ${path.relative(root, file)}\n${res.stderr.trim()}`);
    continue;
  }

  const code = fs.readFileSync(file, 'utf8');
  const filename = path.relative(process.cwd(), file) || file;
  const messages = linter.verify(code, tdzConfig, { filename });
  // «No matching configuration found» приходит предупреждением — это ошибка проверки,
  // иначе она молча пропускает весь файл
  const errors = messages.filter(m => m.fatal || m.severity === 2 || /configuration/i.test(m.message));
  if (errors.length > 0) {
    failed++;
    console.error(`✖ ${path.relative(root, file)}`);
    for (const m of errors) {
      console.error(`    ${m.line}:${m.column}  ${m.message}  (${m.ruleId || 'parse'})`);
    }
  }
}

if (failed > 0) {
  console.error(`\nОшибки в клиентском JS: ${failed} из ${files.length}`);
  process.exit(1);
}
console.log(`✅ Клиентский JS в порядке: синтаксис и порядок объявлений (${files.length} файлов)`);
