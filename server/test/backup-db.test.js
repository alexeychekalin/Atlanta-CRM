/* Бэкап перед заливкой каталога: scripts/backup-db.sh.
 *
 * Скрипт запускается на боевом сервере, поэтому проверяем не «красоту», а
 * свойства, без которых бэкап бесполезен: pg_dump вызывается с -Fc (custom,
 * восстанавливается pg_restore), дамп проверяется до объявления успеха,
 * загрузки (фото и вложения) попадают в архив, а старые дампы удаляются
 * только по числу хранимых копий.
 *
 * pg_dump/pg_restore подменяются шелл-скриптами во временном PATH — настоящая
 * база и настоящий PostgreSQL для теста не нужны.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/backup-db.sh');

function sh(cmd, opts = {}) {
  return spawnSync('bash', ['-c', cmd], { encoding: 'utf8', ...opts });
}

/** Временный «сервер»: app/scripts/backup-db.sh + server/.env + uploads. */
function makeApp({ dumpOk = true, tables = ['components', 'component_modifications', 'clients', 'drawings', 'leads'] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
  fs.mkdirSync(path.join(dir, 'app/scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'app/server/uploads'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(dir, 'app/scripts/backup-db.sh'));
  fs.chmodSync(path.join(dir, 'app/scripts/backup-db.sh'), 0o755);
  fs.writeFileSync(path.join(dir, 'app/server/.env'),
    'DATABASE_URL=postgresql://atlanta_user:pa%40ss@localhost:5432/atlanta_crm\n');
  fs.writeFileSync(path.join(dir, 'app/server/uploads/photo.jpg'), 'jpeg');

  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const calls = path.join(dir, 'calls.log');

  fs.writeFileSync(path.join(bin, 'pg_dump'), `#!/bin/bash
out=""; db=""; args=("$@")
for ((i=0;i<\${#args[@]};i++)); do
  case "\${args[$i]}" in
    -f) out="\${args[$((i+1))]}"; i=$((i+1));;
    -h|-p|-U) i=$((i+1));;
    -Fc) ;;
    *) db="\${args[$i]}";;
  esac
done
echo "PGPASSWORD=[$PGPASSWORD] DB=$db FMT=\${args[*]}" >> "${calls}"
${dumpOk ? 'printf "FAKE-DUMP" > "$out"' : 'echo "pg_dump: error: connection failed" >&2; exit 1'}
`);
  fs.writeFileSync(path.join(bin, 'pg_restore'), `#!/bin/bash
if [ "$1" = "--list" ]; then
  printf '%s\\n' ${tables.map((t) => `'TABLE DATA public ${t} 0'`).join(' ')}
  exit 0
fi
exit 0
`);
  for (const f of ['pg_dump', 'pg_restore']) fs.chmodSync(path.join(bin, f), 0o755);
  return { dir, app: path.join(dir, 'app'), calls, path: `${bin}:${process.env.PATH}` };
}

test('backup-db.sh: синтаксис корректен', () => {
  const res = sh(`bash -n "${SCRIPT}"`);
  assert.equal(res.status, 0, res.stderr);
});

test('бэкап: дамп в custom-формате, пароль из URL декодируется', () => {
  const { app, calls, path: envPath } = makeApp();
  const res = sh(`cd "${app}" && ./scripts/backup-db.sh`, { env: { ...process.env, PATH: envPath } });
  assert.equal(res.status, 0, res.stderr + res.stdout);

  const call = fs.readFileSync(calls, 'utf8');
  assert.match(call, /FMT=.*-Fc/, 'pg_dump должен писать custom-формат');
  // %40 в пароле — это «@», с процентами PostgreSQL ответил бы «пароль неверен»
  assert.match(call, /PGPASSWORD=\[pa@ss\]/);
  assert.match(call, /DB=atlanta_crm/);
  assert.doesNotMatch(call, /PGPASSWORD=\[pa%40ss\]/);
});

test('бэкап: дамп и архив загрузок на месте, с контрольными суммами', () => {
  const { app, dir, path: envPath } = makeApp();
  const res = sh(`cd "${app}" && ./scripts/backup-db.sh`, { env: { ...process.env, PATH: envPath } });
  assert.equal(res.status, 0, res.stderr);

  const files = fs.readdirSync(path.join(app, 'backups'));
  const dump = files.find((f) => f.endsWith('.dump'));
  const tar = files.find((f) => f.endsWith('.tar.gz'));
  assert.ok(dump, 'нет дампа');
  assert.ok(tar, 'нет архива загрузок');
  assert.ok(files.includes(`${dump}.sha256`), 'нет контрольной суммы дампа');

  // архив действительно содержит фото, а не пустую папку
  const list = sh(`tar tzf "${path.join(app, 'backups', tar)}"`);
  assert.match(list.stdout, /uploads\/photo\.jpg/);

  // дамп проверяется на месте — иначе «бэкап» может оказаться битым
  assert.match(res.stdout, /таблиц с данными: 5/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('бэкап: ошибка pg_dump — ненулевой код и нет битого файла', () => {
  const { app, dir, path: envPath } = makeApp({ dumpOk: false });
  const res = sh(`cd "${app}" && ./scripts/backup-db.sh`, { env: { ...process.env, PATH: envPath } });
  assert.notEqual(res.status, 0, 'сбой бэкапа должен быть виден по коду возврата');
  const leftovers = fs.existsSync(path.join(app, 'backups'))
    ? fs.readdirSync(path.join(app, 'backups')).filter((f) => f.endsWith('.dump') && !f.endsWith('.sha256'))
    : [];
  assert.equal(leftovers.length, 0, 'обрывок дампа надо удалять');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('бэкап: старые дампы удаляются по --keep', () => {
  const { app, dir, path: envPath } = makeApp();
  const backups = path.join(app, 'backups');
  fs.mkdirSync(backups, { recursive: true });
  // три «старых» дампа с разным временем изменения
  for (let i = 1; i <= 3; i += 1) {
    const f = path.join(backups, `atlanta_crm_2020-01-0${i}_00-00-00.dump`);
    fs.writeFileSync(f, 'old');
    fs.utimesSync(f, new Date(2020, 0, i), new Date(2020, 0, i));
  }
  const res = sh(`cd "${app}" && ./scripts/backup-db.sh --keep 2 --no-uploads`, {
    env: { ...process.env, PATH: envPath },
  });
  assert.equal(res.status, 0, `status=${res.status} stderr=${res.stderr} stdout=${res.stdout}`);
  const dumps = fs.readdirSync(backups).filter((f) => f.endsWith('.dump') && !f.endsWith('.sha256'));
  assert.equal(dumps.length, 2, 'должны остаться только последние копии');
  fs.rmSync(dir, { recursive: true, force: true });
});
