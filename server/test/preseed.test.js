const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildNotes, diffClient, updateClient, parseArgs, placeDocument, readConfig,
  CLIENT_FIELDS, CLIENTS_JSON, FILES_DIR } = require('../src/db/preseed');

test('предзаполнение: файл данных есть и корректно разбирается', () => {
  assert.ok(fs.existsSync(CLIENTS_JSON), 'нет src/db/preseed/clients.json');

  const { clients } = readConfig();
  assert.ok(clients.length > 0, 'список клиентов пуст');

  for (const entry of clients) {
    assert.ok(entry.name, 'у клиента нет названия');
    assert.ok(entry.inn, `${entry.name}: не указан ИНН — поиск дублей по названию ненадёжен`);
    assert.match(String(entry.inn), /^\d{10}(\d{2})?$/, `${entry.name}: ИНН должен быть 10 или 12 цифр`);
    if (entry.client_type === 'ooo') {
      assert.match(String(entry.kpp), /^\d{9}$/, `${entry.name}: КПП ООО должен быть 9 цифр`);
      assert.match(String(entry.ogrn), /^\d{13}$/, `${entry.name}: ОГРН ООО должен быть 13 цифр`);
      assert.ok(!entry.ogrnip, `${entry.name}: у ООО не бывает ОГРНИП`);
    } else if (entry.client_type === 'ip') {
      assert.ok(!entry.kpp, `${entry.name}: у ИП не бывает КПП`);
      assert.ok(!entry.ogrn, `${entry.name}: у ИП ОГРНИП, а не ОГРН`);
      assert.match(String(entry.ogrnip), /^\d{15}$/, `${entry.name}: ОГРНИП должен быть 15 цифр`);
    } else {
      assert.fail(`${entry.name}: неизвестный client_type «${entry.client_type}»`);
    }
  }
});

test('предзаполнение: ИНН и названия не повторяются', () => {
  const { clients } = readConfig();
  const inns = clients.map(c => c.inn).filter(Boolean);
  const names = clients.map(c => String(c.name).toLowerCase());

  assert.equal(new Set(inns).size, inns.length, 'в файле повторяются ИНН');
  assert.equal(new Set(names).size, names.length, 'в файле повторяются названия');
});

test('предзаполнение: документы лежат в репозитории и открываются браузером', () => {
  const { clients } = readConfig();

  // Карточки приходят и PDF, и скриншотами — проверяем сигнатуру по расширению,
  // чтобы битый файл не попал в деплой молча.
  const signatures = {
    pdf: Buffer.from('%PDF-'),
    png: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    jpg: Buffer.from([0xff, 0xd8, 0xff]),
  };

  for (const entry of clients) {
    assert.ok(entry.documents && entry.documents.length > 0,
      `${entry.name}: к карточке не приложен исходный документ`);

    for (const doc of entry.documents) {
      const file = path.join(FILES_DIR, doc.file);
      assert.ok(fs.existsSync(file), `${entry.name}: нет файла ${doc.file}`);

      const ext = path.extname(doc.file).slice(1).toLowerCase();
      const signature = signatures[ext];
      assert.ok(signature, `${entry.name}: ${doc.file} — неподдерживаемый формат вложения`);
      const head = fs.readFileSync(file).subarray(0, signature.length);
      assert.ok(head.equals(signature), `${entry.name}: ${doc.file} не похож на ${ext.toUpperCase()}`);

      assert.ok(doc.name, `${entry.name}: у документа нет названия для карточки`);
    }
  }
});

test('предзаполнение: примечание собирает полное имя, коды и телефоны', () => {
  const notes = buildNotes({
    full_name: 'Общество с ограниченной ответственностью «Торговый дом «Вега»',
    extra: { ОКПО: '65638021', ОКВЭД: '45.31.1', Пусто: '' },
    extra_notes: ['Второй сайт: vega-vr.ru'],
  });

  assert.match(notes, /Полное наименование: Общество с ограниченной ответственностью/);
  assert.match(notes, /ОКПО 65638021/);
  assert.match(notes, /ОКВЭД 45\.31\.1/);
  assert.match(notes, /Второй сайт: vega-vr\.ru/);
  assert.doesNotMatch(notes, /Пусто/);

  assert.equal(buildNotes({}), null);
});

test('предзаполнение: файл копируется под стабильным именем и не дублируется', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'atlanta-preseed-'));
  const { clients } = readConfig();
  const doc = clients[0].documents[0];

  const first = placeDocument(doc.file, target);
  const second = placeDocument(doc.file, target);

  assert.equal(first.url, second.url, 'имя файла должно зависеть от содержимого');
  const ext = path.extname(doc.file).slice(1).toLowerCase();
  assert.match(first.url, new RegExp(`^/uploads/files/preseed_[0-9a-f]{16}\\.${ext}$`));
  assert.equal(first.type, ext);
  assert.equal(first.size, fs.statSync(path.join(FILES_DIR, doc.file)).size);
  assert.deepEqual(fs.readdirSync(target), [path.basename(first.url)]);

  fs.rmSync(target, { recursive: true, force: true });
});

test('предзаполнение: все поля карточки есть в схеме базы', () => {
  // CLIENT_FIELDS — единственный список колонок, который пишет предзаполнение:
  // опечатка в имени поля иначе всплывёт только на боевой базе.
  const schema = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
  for (const field of CLIENT_FIELDS) {
    assert.match(schema, new RegExp(`\\b${field}\\s+(VARCHAR|TEXT|INT)`),
      `поля ${field} нет в clients (schema.sql)`);
  }

  const migration = fs.readFileSync(path.join(__dirname, '../src/db/migration_client_org.sql'), 'utf8');
  for (const field of ['full_name', 'name_en', 'full_name_en', 'okpo', 'okved',
    'director_position', 'director_basis']) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${field}\\b`),
      `миграция не добавляет ${field}`);
  }
});

test('предзаполнение: карточка РУАТ заполнена по карточке организации', () => {
  const { clients } = readConfig();
  const ruat = clients.find(c => c.inn === '3300013912');
  assert.ok(ruat, 'нет клиента с ИНН 3300013912');
  assert.equal(ruat.name, 'ООО «РУАТ»');
  assert.match(ruat.full_name, /^Общество с ограниченной ответственностью «РуАуто Трейлер»$/);
  assert.equal(ruat.name_en, 'RUAT LLC');
  assert.equal(ruat.full_name_en, 'RuAuto Trailer Limited Liability Company');
  assert.equal(ruat.okpo, '96134892');
  assert.equal(ruat.okved, '29.20');
  assert.match(ruat.phone, /^\+7 492 442 70 07$/);
  assert.equal(ruat.email, 'ruautotrailer@bk.ru');
  assert.match(ruat.legal_address, /^601446, Владимирская область/);
  assert.match(ruat.legal_address, /Железнодорожная, д\. 13, помещ\. 414$/);
  assert.equal(ruat.legal_address, ruat.address, 'фактический адрес совпадает с юридическим');
  assert.equal(ruat.bank_account, '40702810524630001427');
  assert.equal(ruat.bank_name, 'ФИЛИАЛ "ЦЕНТРАЛЬНЫЙ" БАНКА ВТБ (ПАО)');
  assert.equal(ruat.corr_account, '30101810145250000411');
  assert.equal(ruat.bik, '044525411');
  assert.equal(ruat.director, 'Холов Наиль Хусанович');
  assert.equal(ruat.director_position, 'Генеральный директор');
  assert.equal(ruat.director_basis, 'Устава');
});

test('предзаполнение: банковские реквизиты заполняются только целиком', () => {
  // Р/С без банка или без БИК в счёте — это счёт, который некуда отправить.
  const { clients } = readConfig();
  for (const entry of clients) {
    const bank = [entry.bank_account, entry.bank_name, entry.bik, entry.corr_account];
    const filled = bank.filter(Boolean).length;
    assert.ok(filled === 0 || filled === bank.length,
      `${entry.name}: банковские реквизиты заполнены частично`);
  }
});

test('--refresh: пустое поле в файле не стирает значение в карточке', () => {
  const entry = { name: 'ООО «РУАТ»', email: 'new@example.ru', phone: '', bank_name: null };

  const changes = diffClient(entry, {
    name: 'ООО «РУАТ»', email: 'old@example.ru', phone: '+7 000', bank_name: 'Банк',
  });

  assert.deepEqual(Object.keys(changes).sort(), ['email']);
  assert.equal(changes.email.from, 'old@example.ru');
  assert.equal(changes.email.to, 'new@example.ru');

  // Ничего не поменялось — обновлять нечего
  assert.deepEqual(diffClient({ name: 'ООО «РУАТ»' }, { name: ' ООО «РУАТ» ' }), {});
});

test('--refresh: UPDATE собирается только из полей карточки', async () => {
  const calls = [];
  const runner = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };

  const count = await updateClient(runner, 42, {
    email: { from: null, to: 'ruautotrailer@bk.ru' },
    bik: { from: null, to: '044525411' },
  });

  assert.equal(count, 2);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /^UPDATE clients SET email = \$1, bik = \$2 WHERE id = \$3$/);
  assert.deepEqual(calls[0].params, ['ruautotrailer@bk.ru', '044525411', 42]);
  assert.equal(await updateClient(runner, 42, {}), 0, 'пустой набор не должен ходить в базу');
});

test('флаги командной строки: --refresh и --dry-run', () => {
  assert.deepEqual(parseArgs([]), { refresh: false, dryRun: false });
  assert.deepEqual(parseArgs(['--refresh']), { refresh: true, dryRun: false });
  assert.deepEqual(parseArgs(['--refresh', '--dry-run']), { refresh: true, dryRun: true });
});
