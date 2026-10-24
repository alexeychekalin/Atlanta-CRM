const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildNotes, placeDocument, readConfig, CLIENTS_JSON, FILES_DIR } =
  require('../src/db/preseed');

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
