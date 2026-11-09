const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '../..');
const updateScript = path.join(root, 'update.sh');
const deployDoc = path.join(root, 'DEPLOY.md');

test('update.sh: синтаксис корректен', (t) => {
  const check = spawnSync('bash', ['-n', updateScript], { encoding: 'utf8' });
  if (check.error && check.error.code === 'ENOENT') {
    t.skip('bash не найден');
    return;
  }
  assert.equal(check.status, 0, check.stderr);
});

test('update.sh: до остановки сервиса печатает ветку и коммит', () => {
  // Ошибка «git pull пишет Already up to date» стоила простоя: сервер стоял
  // на main после reset --hard с рабочей ветки. Скрипт должен показывать это
  // сам, до всех изменений в базе.
  const script = fs.readFileSync(updateScript, 'utf8');

  const version = script.indexOf('Версия кода');
  const stop = script.indexOf('Остановка сервиса');
  assert.ok(version > 0, 'в update.sh нет шага «Версия кода»');
  assert.ok(stop > version, 'шаг «Версия кода» должен идти до остановки сервиса');

  assert.match(script, /git rev-parse --abbrev-ref HEAD/, 'ветка не определяется');
  assert.match(script, /git rev-list --count "HEAD\.\.\$\{UPSTREAM\}"/, 'нет проверки отставания от origin');
  assert.match(script, /git status --porcelain/, 'нет предупреждения о незакоммиченных правках');
});

test('DEPLOY.md: описано, что делать с «Already up to date»', () => {
  const doc = fs.readFileSync(deployDoc, 'utf8');

  assert.match(doc, /Already up to date/, 'нет раздела про «Already up to date»');
  assert.match(doc, /git checkout -B arena\/65030bab-atlanta-crm origin\/arena\/65030bab-atlanta-crm/,
    'нет команды переключения на рабочую ветку');
  assert.match(doc, /git branch -f main origin\/main/, 'main не возвращается к состоянию GitHub');
  assert.match(doc, /db:export-site/, 'не сказано, как вернуть выгруженные фото после reset --hard');
});
