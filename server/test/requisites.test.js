const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const {
  clientRequisites, officeTitle, requisitesFileName, isIp,
} = require('../src/services/requisites');
const { buildRequisitesDocx } = require('../src/services/requisites-docx');

// Вологодские машины — карточка, по которой проверяли выгрузку:
// банковские реквизиты пришли отдельным PDF уже после ЕГРЮЛ.
const VOLOGDA = {
  name: 'ООО «Вологодские машины»',
  full_name: 'Общество с ограниченной ответственностью «Вологодские машины»',
  client_type: 'ooo',
  inn: '3525232448',
  kpp: '352501001',
  ogrn: '1093525017277',
  okpo: '64611764',
  okved: '29.20.4',
  legal_address: '160004, Вологодская обл., г. Вологда, ул. Маяковского, д. 38, здание 4, 5, 6',
  postal_address: '160004, Вологодская обл., г. Вологда, ул. Маяковского, д. 38',
  address: '160004, Вологодская обл., г. Вологда, ул. Маяковского, д. 38, здание 4, 5, 6',
  bank_name: 'Мурманское отделение № 8627 ПАО Сбербанк',
  bank_account: '40702810112000009669',
  corr_account: '30101810300000000615',
  bik: '044705615',
  phone: '+7 (8172) 54-70-70',
  director: 'Кузнецов Василий Петрович',
  director_position: 'Директор',
  director_basis: 'Устава',
};

test('реквизиты: строки карточки идут в порядке печатной карточки предприятия', () => {
  const rows = clientRequisites(VOLOGDA);
  const labels = rows.map(row => row.label);
  assert.deepEqual(labels, [
    'ИНН / КПП', 'ОГРН', 'ОКПО', 'ОКВЭД',
    'Юридический адрес', 'Почтовый адрес',
    'Банк', 'Расчётный счёт', 'Корреспондентский счёт', 'БИК',
    'Телефон', 'Руководитель',
  ]);

  const value = label => rows.find(row => row.label === label).value;
  assert.equal(value('ИНН / КПП'), '3525232448 / 352501001');
  assert.equal(value('Банк'), 'Мурманское отделение № 8627 ПАО Сбербанк');
  assert.equal(value('Расчётный счёт'), '40702810112000009669');
  assert.equal(value('БИК'), '044705615');
  assert.equal(value('Руководитель'),
    'Директор: Кузнецов Василий Петрович, действует на основании Устава');
  // фактический адрес совпадает с юридическим — второй раз не печатаем
  assert.ok(!labels.includes('Фактический адрес'));
});

test('реквизиты: у ИП нет КПП, вместо ОГРН — ОГРНИП', () => {
  const ip = {
    name: 'ИП Барановская Виктория Сергеевна',
    full_name: 'Индивидуальный предприниматель Барановская Виктория Сергеевна',
    client_type: 'ip',
    inn: '463311521603',
    ogrnip: '319463200033261',
    legal_address: '307178, Курская область, г. Железногорск, ул. Заводской проезд, д. 9, кв. 112',
    postal_address: '305008, г. Курск, ул. Пучковка, д. 51, кв. 19',
    bank_name: 'Курское отделение №8596 ПАО Сбербанк',
    bank_account: '40802810433000013614',
    corr_account: '30101810300000000606',
    bik: '043807606',
    director: 'Барановская В.С.',
  };

  assert.equal(isIp(ip), true);
  const rows = clientRequisites(ip);
  const labels = rows.map(row => row.label);
  assert.ok(!labels.includes('ОГРН'), 'у ИП ОГРН не бывает');
  assert.ok(!labels.includes('КПП'));
  assert.equal(rows.find(row => row.label === 'ИНН / КПП').value, '463311521603');
  assert.equal(rows.find(row => row.label === 'ОГРНИП').value, '319463200033261');
  assert.equal(rows.find(row => row.label === 'Руководитель').value, 'Барановская В.С.');
  assert.equal(officeTitle(ip).full, 'Индивидуальный предприниматель Барановская Виктория Сергеевна');
  assert.equal(officeTitle(ip).short, 'ИП Барановская Виктория Сергеевна');
});

test('реквизиты: пустые поля не попадают в документ, лишние пробелы убираются', () => {
  const rows = clientRequisites({
    name: 'ООО  «Пусто»', inn: '  7700000000 ', kpp: '', ogrn: null,
    legal_address: '', address: '  ', bank_name: undefined,
  });
  assert.deepEqual(rows, [{ label: 'ИНН / КПП', value: '7700000000' }]);
  assert.deepEqual(clientRequisites({}), []);
});

test('реквизиты: имя файла — без кавычек и запрещённых символов', () => {
  assert.equal(requisitesFileName(VOLOGDA), 'Реквизиты ООО Вологодские машины.docx');
  assert.equal(requisitesFileName({ name: 'ООО "Ромашка"/Ко' }), 'Реквизиты ООО Ромашка Ко.docx');
  assert.equal(requisitesFileName({}), 'Реквизиты контрагента.docx');
});

test('docx: файл — валидный архив Word с таблицей реквизитов', async () => {
  const buffer = await buildRequisitesDocx(VOLOGDA, { date: new Date(2026, 9, 22) });
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 2).toString(), 'PK', 'docx — это zip-архив');

  const zip = await JSZip.loadAsync(buffer);
  assert.ok(zip.file('[Content_Types].xml'), 'нет [Content_Types].xml — Word не откроет файл');
  assert.ok(zip.file('word/document.xml'), 'нет word/document.xml');

  const xml = await zip.file('word/document.xml').async('string');
  for (const text of ['РЕКВИЗИТЫ', 'Вологодские машины', '3525232448 / 352501001',
    '40702810112000009669', '044705615', 'Сформировано в CRM «Атланта» 22.10.2026']) {
    assert.ok(xml.includes(text), `в документе нет «${text}»`);
  }
  // таблица — не текст подряд: у Word это <w:tbl>
  assert.match(xml, /<w:tbl>/, 'реквизиты должны быть таблицей');
});

test('docx: спецсимволы экранируются, а не ломают документ', async () => {
  const buffer = await buildRequisitesDocx({
    name: 'ООО «Ромашка & Ко»', full_name: 'ООО «Ромашка & Ко»',
    inn: '7700000000', kpp: '770001001', bank_name: 'Банк <Тест>',
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.ok(xml.includes('Ромашка &amp; Ко'));
  assert.ok(xml.includes('Банк &lt;Тест&gt;'));
  assert.ok(!xml.includes('Банк <Тест>'));
});

test('docx: карточка без реквизитов не даёт пустой файл', async () => {
  await assert.rejects(() => buildRequisitesDocx({ name: 'ООО «Пусто»' }),
    /не заполнены реквизиты/);
  // телефон и сайт — не реквизиты: карточку предприятия из них не собрать
  await assert.rejects(() => buildRequisitesDocx({
    name: 'ООО «Только телефон»', phone: '+7 000 000-00-00', site: 'example.ru',
  }), /не заполнены реквизиты/);
});

test('docx: маршрут в CRM и кнопка в карточке клиента на месте', () => {
  const route = fs.readFileSync(path.join(__dirname, '../src/routes/clients.js'), 'utf8');
  assert.match(route, /router\.get\('\/:id\/requisites\.docx'/,
    'нет маршрута GET /api/clients/:id/requisites.docx');
  assert.match(route, /buildRequisitesDocx/);
  assert.match(route, /Content-Disposition[\s\S]{0,160}filename\*=UTF-8''/);

  const page = fs.readFileSync(path.join(__dirname, '../../client/js/pages/client-profile.js'), 'utf8');
  assert.match(page, /downloadRequisites\(\)/);
  assert.match(page, /\/clients\/\$\{this\.clientId\}\/requisites\.docx/,
    'карточка должна скачивать файл с сервера, а не собирать его сама');

  const html = fs.readFileSync(path.join(__dirname, '../../client/index.html'), 'utf8');
  assert.match(html, /components\/download\.js/, 'подключите client/js/components/download.js');

  const sw = fs.readFileSync(path.join(__dirname, '../../client/sw.js'), 'utf8');
  assert.match(sw, /'\/js\/components\/download\.js'/, 'новый файл нужно добавить в кэш service worker');
});
