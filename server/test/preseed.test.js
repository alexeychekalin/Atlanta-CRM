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

test('предзаполнение: Бонум Траст и Арсенал-Авто заведены по присланным реквизитам', () => {
  const { clients } = readConfig();
  const byInn = Object.fromEntries(clients.map(entry => [entry.inn, entry]));

  const bonum = byInn['6150103172'];
  assert.ok(bonum, 'нет ООО «Бонум Траст»');
  assert.equal(bonum.name, 'ООО «Бонум Траст»');
  assert.equal(bonum.full_name, 'Общество с ограниченной ответственностью «БОНУМ ТРАСТ»');
  assert.equal(bonum.kpp, '615001001');
  assert.equal(bonum.ogrn, '1226100033587');
  assert.equal(bonum.okpo, '77280033');
  assert.equal(bonum.okved, '29.20');
  assert.match(bonum.legal_address, /^346404, Ростовская область.*Новочеркасск.*Харьковское шоссе, 10$/);
  assert.equal(bonum.bank_account, '40702810612010952650');
  assert.equal(bonum.bank_name, 'Филиал "Корпоративный" ПАО "Совкомбанк"');
  assert.equal(bonum.corr_account, '30101810445250000360');
  assert.equal(bonum.bik, '044525360');
  assert.equal(bonum.director, 'Михайленко Василий Сергеевич');
  assert.equal(bonum.director_basis, 'Устава');

  const arsenal = byInn['7452021714'];
  assert.ok(arsenal, 'нет ООО ПФ «Арсенал-Авто»');
  assert.equal(arsenal.name, 'ООО ПФ «Арсенал-Авто»');
  assert.equal(arsenal.full_name, 'Общество с ограниченной ответственностью производственная фирма «Арсенал-Авто»');
  assert.equal(arsenal.kpp, '744801001');
  assert.equal(arsenal.ogrn, '1027403778137');
  assert.equal(arsenal.okved, '45.3');
  assert.match(arsenal.address, /^454036, г\. Челябинск, ул\. Радонежская, 6, офис 204$/);
  assert.equal(arsenal.phone, '+7 (351) 268-98-39');
  assert.equal(arsenal.email, 'info@arsenalavto.ru');
  assert.equal(arsenal.site, 'www.arsenalavto.ru');
  assert.equal(arsenal.bank_account, '40702810972190053846');
  assert.equal(arsenal.bank_name, 'Челябинское отделение №8597 ПАО Сбербанк');
  assert.equal(arsenal.corr_account, '30101810700000000602');
  assert.equal(arsenal.bik, '047501602');
  assert.equal(arsenal.director, 'Соколов Андрей Анатольевич');
  assert.equal(arsenal.director_position, 'Директор');
});

test('предзаполнение: к РУАТ приложена присланная карточка организации', () => {
  const { clients } = readConfig();
  const ruat = clients.find(entry => entry.inn === '3300013912');

  const files = ruat.documents.map(doc => doc.file);
  assert.ok(files.includes('ruat-org-card.pdf'), 'нет карточки организации');
  assert.ok(files.includes('ruauto-trailer-egrul.pdf'), 'пропала выписка ЕГРЮЛ');
});

test('предзаполнение: СИС Плюс и ИП Гарипов заведены по присланным документам', () => {
  const { clients } = readConfig();
  const byInn = Object.fromEntries(clients.map(entry => [entry.inn, entry]));

  const sis = byInn['5752200319'];
  assert.ok(sis, 'нет ООО «СИС Плюс»');
  assert.equal(sis.name, 'ООО «СИС Плюс»');
  assert.equal(sis.full_name, 'Общество с ограниченной ответственностью «СТРОЙИНВЕСТСЕРВИС ПЛЮС»');
  assert.equal(sis.kpp, '575101001');
  assert.equal(sis.ogrn, '1135749001410');
  assert.equal(sis.okpo, '11953571');
  assert.equal(sis.okved, '28.30.7');
  assert.match(sis.legal_address, /^302006, Орловская область.*Московская, д\. 155, помещ\. 4$/);
  assert.equal(sis.bank_account, '40702810247000004419');
  assert.equal(sis.bank_name, 'Орловское отделение №8595 ПАО Сбербанк');
  assert.equal(sis.corr_account, '30101810300000000601');
  assert.equal(sis.bik, '045402601');
  assert.equal(sis.director, 'Семёнов Юрий Анатольевич');
  assert.equal(sis.director_position, 'Генеральный директор');
  assert.equal(sis.email, 'semenov-orel2010@yandex.ru');
  assert.equal(sis.site, 'www.sis-plus.ru');

  const garipov = byInn['164608092395'];
  assert.ok(garipov, 'нет ИП Гарипов Р.Р.');
  assert.equal(garipov.client_type, 'ip');
  assert.equal(garipov.name, 'ИП Гарипов Р.Р.');
  assert.equal(garipov.full_name, 'Индивидуальный предприниматель Гарипов Рамиль Рафисович');
  assert.equal(garipov.ogrnip, '319169000044830');
  assert.match(garipov.legal_address, /^423600, Республика Татарстан, г\. Елабуга.*проспект Мира, д\. 31, кв\. 106$/);
  assert.equal(garipov.bank_account, '40802810901500219933');
  assert.equal(garipov.bank_name, 'ООО «Банк Точка»');
  assert.equal(garipov.corr_account, '30101810745374525104');
  assert.equal(garipov.bik, '044525104');
  assert.equal(garipov.director, 'Гарипов Рамиль Рафисович');
  // у ИП нет КПП и ОГРН — только ОГРНИП
  assert.ok(!garipov.kpp && !garipov.ogrn);
});

test('предзаполнение: данные доставки Вологодских машин и СИС Плюс', () => {
  const { clients } = readConfig();
  const byKey = Object.fromEntries(clients.map(entry => [entry.key, entry]));

  const vol = byKey['vologodskie-mashiny'];
  assert.match(vol.delivery_address, /^160004, Вологодская область, г\. Вологда, ул\. Маяковского, дом 38/);
  assert.match(vol.delivery_address, /Деловые линии/);
  assert.match(vol.delivery_address, /до терминала/);
  assert.equal(vol.delivery_contact_name, 'Данилов Евгений Витальевич');
  assert.equal(vol.delivery_contact_phone, '+7 (911) 520-01-26');
  // контакт по доставке — начальник ОМТС, а не директор
  assert.notEqual(vol.delivery_contact_name, vol.director);

  const sis = byKey['sis-plus'];
  assert.match(sis.delivery_address, /Орёл.*50 лет Октября, 17б/);
  assert.match(sis.delivery_address, /СДЭК/);
  assert.equal(sis.delivery_contact_name, 'Семёнов Андрей Юрьевич');
  assert.equal(sis.delivery_contact_phone, '+7 (919) 204-42-35');
  assert.notEqual(sis.delivery_contact_name, sis.director);
});

test('предзаполнение: доставка Бонум Траст, Барановской и ССТ', () => {
  const { clients } = readConfig();
  const byKey = Object.fromEntries(clients.map(entry => [entry.key, entry]));

  // Бонум Траст — площадка на трассе М-4, телефон дали без ФИО получателя
  const bonum = byKey['bonum-trust'];
  assert.match(bonum.delivery_address, /Аксайский район, М-4 Дон, 1082-й километр, 1с4/);
  assert.match(bonum.delivery_address, /Деловые линии/);
  assert.equal(bonum.delivery_contact_phone, '+7 (928) 122-08-43');
  assert.equal(bonum.delivery_contact_name, null);

  // Барановская — пункт выдачи СДЭК в Курске, ФИО не давали
  const bar = byKey['ip-baranovskaya'];
  assert.match(bar.delivery_address, /Курск, ул\. Энгельса, 115\/2/);
  assert.match(bar.delivery_address, /СДЭК/);
  assert.equal(bar.delivery_contact_phone, '+7 (920) 736-58-88');
  assert.equal(bar.delivery_contact_name, null);

  // ССТ — Деловые линии до терминала Саранска, контакт Алексей Храмов
  const sst = byKey['sst'];
  assert.match(sst.delivery_address, /Саранск/);
  assert.match(sst.delivery_address, /Деловые линии/);
  assert.match(sst.delivery_address, /до терминала/);
  assert.equal(sst.delivery_contact_name, 'Алексей Храмов');
  assert.equal(sst.delivery_contact_phone, '+7 (927) 641-81-40');
  assert.notEqual(sst.delivery_contact_name, sst.director);
});
