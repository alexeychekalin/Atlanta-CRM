const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '../..');
const publishScript = path.join(root, 'site/publish.py');
const testsScript = path.join(root, 'site/test_publish.py');

test('выкладка сайта: скрипт есть и компилируется', (t) => {
  assert.ok(fs.existsSync(publishScript), 'нет site/publish.py');
  const check = spawnSync('python3', ['-m', 'py_compile', publishScript], { encoding: 'utf8' });
  if (check.error && check.error.code === 'ENOENT') {
    t.skip('python3 не найден');
    return;
  }
  assert.equal(check.status, 0, check.stderr);
});

test('выкладка сайта: тесты publish.py (папка и FTP на поддельном сервере)', (t) => {
  const check = spawnSync('python3', [testsScript], { encoding: 'utf8', timeout: 120000 });
  if (check.error && check.error.code === 'ENOENT') {
    t.skip('python3 не найден');
    return;
  }
  assert.equal(check.status, 0, `${check.stdout}\n${check.stderr}`);
});

test('выкладка сайта: build.py умеет --publish, update.sh включает шаг сайта', () => {
  const build = fs.readFileSync(path.join(root, 'site/build.py'), 'utf8');
  assert.match(build, /--publish/, 'у сборки нет флага --publish');
  assert.match(build, /def publish_site/, 'нет функции выкладки');
  assert.match(build, /--prune/, 'нет флага --prune');

  const update = fs.readFileSync(path.join(root, 'update.sh'), 'utf8');
  assert.match(update, /site\/build\.py .*--publish/, 'update.sh не собирает и не выкладывает сайт');
  assert.match(update, /WITH_SITE=0/, 'шаг сайта нельзя выключить');
});
