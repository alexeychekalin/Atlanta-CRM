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

test('предзаполнение: документы лежат в репозитории и являются PDF', () => {
  const { clients } = readConfig();

  for (const entry of clients) {
    for (const doc of entry.documents || []) {
      const file = path.join(FILES_DIR, doc.file);
      assert.ok(fs.existsSync(file), `${entry.name}: нет файла ${doc.file}`);
      const head = fs.readFileSync(file).subarray(0, 5).toString('ascii');
      assert.equal(head, '%PDF-', `${entry.name}: ${doc.file} не похож на PDF`);
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
  assert.match(first.url, /^\/uploads\/files\/preseed_[0-9a-f]{16}\.pdf$/);
  assert.equal(first.type, 'pdf');
  assert.equal(first.size, fs.statSync(path.join(FILES_DIR, doc.file)).size);
  assert.deepEqual(fs.readdirSync(target), [path.basename(first.url)]);

  fs.rmSync(target, { recursive: true, force: true });
});
