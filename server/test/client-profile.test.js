const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const clientDir = path.join(__dirname, '../../client/js');

/** Заглушка элемента DOM: тестам нужен только innerHTML и пара методов. */
function fakeElement() {
  return {
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
  };
}

/** Загружает cards клиента в песочницу с минимальными заглушками. */
function loadClientProfile({ isAdmin = false, client = null } = {}) {
  const elements = {};
  const storage = {};
  const sandbox = {
    window: {},
    console,
    localStorage: {
      getItem: key => (key in storage ? storage[key] : null),
      setItem: (key, value) => { storage[key] = String(value); },
      removeItem: key => { delete storage[key]; },
    },
    document: {
      getElementById: id => {
        if (!(id in elements)) {
          // render() пишет в контейнер и вешает обработчик на скрытый input
          if (['content-area', 'profile-tab-content', 'avatar-upload-input'].includes(id)) {
            elements[id] = fakeElement();
          } else {
            return null;
          }
        }
        return elements[id];
      },
      querySelectorAll: () => [],
    },
    Table: {
      formatMoney: v => `${Number(v).toFixed(2)} ₽`,
      formatMoneyRaw: v => Number(v).toFixed(2),
      loading: () => '',
      emptyState: text => `<div class="empty-state">${text}</div>`,
    },
    API: {
      isAdmin: () => isAdmin,
      can: () => isAdmin,
      get: async (url) => {
        if (!client) return { data: [] };
        if (url === `/clients/${client.id}`) return client;
        if (url.endsWith('/documents/stats')) return {};
        if (url === '/client-statuses') return { data: [] };
        return { data: [] };
      },
    },
    Toast: { error: () => {}, success: () => {}, info: () => {} },
    Modal: { open: () => {}, close: () => {} },
    ConfirmDialog: { delete: async () => true },
    App: { navigateTo: () => {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(clientDir, 'components/escape.js'), 'utf8'), sandbox);
  sandbox.esc = sandbox.window.esc;
  sandbox.safeUrl = sandbox.window.safeUrl;
  vm.runInContext(
    fs.readFileSync(path.join(clientDir, 'pages/client-profile.js'), 'utf8')
      + '\n;globalThis.ClientProfilePage = ClientProfilePage;',
    sandbox
  );
  return { page: sandbox.ClientProfilePage, elements, storage, sandbox };
}

test('карточка: админская вкладка «Файлы» видна только администратору и стоит справа', () => {
  const admin = loadClientProfile({ isAdmin: true });
  const tab = admin.page.filesTabButton();
  assert.match(tab, /data-tab="files"/);
  assert.match(tab, /tab-btn-admin/);
  assert.match(tab, /Файлы/);

  const manager = loadClientProfile({ isAdmin: false });
  assert.equal(manager.page.filesTabButton(), '');
});

test('карточка: файлы клиента недоступны не-админу даже при прямом вызове', async () => {
  const { page } = loadClientProfile({ isAdmin: false });
  page.clientId = 1;
  const container = { innerHTML: '' };

  await page.loadClientFiles(container);

  assert.match(container.innerHTML, /только администратору/);
});

test('карточка: доставка и реквизиты свёрнуты по умолчанию и запоминают состояние', () => {
  const { page, elements, storage } = loadClientProfile();
  const body = { hidden: true };
  const chip = { attrs: {}, setAttribute(name, value) { this.attrs[name] = value; } };
  elements['client-requisites-body'] = body;
  elements['requisites-toggle'] = chip;

  // По умолчанию localStorage пуст — блок остаётся свёрнутым
  page.applyHeaderState();
  assert.equal(body.hidden, true);
  assert.equal(chip.attrs['aria-expanded'], 'false');

  page.toggleRequisites();
  assert.equal(body.hidden, false);
  assert.equal(chip.attrs['aria-expanded'], 'true');
  assert.equal(storage[page.REQUISITES_KEY], '1');

  page.toggleRequisites();
  assert.equal(body.hidden, true);
  assert.equal(chip.attrs['aria-expanded'], 'false');
  assert.equal(storage[page.REQUISITES_KEY], '0');
});

test('карточка: раскрытые блоки шапки переживают перерисовку', () => {
  const { page, elements } = loadClientProfile();
  const requisites = { hidden: true };
  const delivery = { hidden: true };
  elements['client-requisites-body'] = requisites;
  elements['client-delivery-body'] = delivery;
  elements['requisites-toggle'] = { setAttribute() {} };
  elements['delivery-toggle'] = { setAttribute() {} };

  page.applyHeaderState();
  page.toggleRequisites();
  page.toggleDelivery();

  // Карточка перерисовалась: разметка пришла свёрнутой, состояние вернули из localStorage
  requisites.hidden = true;
  delivery.hidden = true;
  page.applyHeaderState();

  assert.equal(requisites.hidden, false, 'реквизиты снова свернулись после перерисовки');
  assert.equal(delivery.hidden, false, 'доставка снова свернулась после перерисовки');
});

test('карточка: показатели склоняются по-русски', () => {
  const { page } = loadClientProfile();
  const orders = (n) => page.plural(n, 'заказ', 'заказа', 'заказов');

  assert.equal(orders(1), 'заказ');
  assert.equal(orders(2), 'заказа');
  assert.equal(orders(5), 'заказов');
  assert.equal(orders(11), 'заказов');
  assert.equal(orders(21), 'заказ');
  assert.equal(orders(0), 'заказов');
});

test('карточка: сайт клиента превращается в безопасную ссылку', () => {
  const { page } = loadClientProfile();

  assert.equal(page.siteHref('smirnov.ru'), 'https://smirnov.ru');
  assert.equal(page.siteHref('www.smirnov.ru'), 'https://www.smirnov.ru');
  assert.equal(page.siteHref('https://smirnov.ru/about'), 'https://smirnov.ru/about');
  assert.equal(page.siteHref('javascript:alert(1)'), '');
  assert.equal(page.siteHref(''), '');
  assert.equal(page.siteHref(null), '');
});

test('карточка: размер файла показывается в удобных единицах', () => {
  const { page } = loadClientProfile();

  assert.equal(page._formatSize(512), '512 Б');
  assert.equal(page._formatSize(2048), '2 КБ');
  assert.equal(page._formatSize(5 * 1024 * 1024), '5.0 МБ');
  assert.equal(page._formatSize(null), '0 Б');
});

test('карточка: шапка и реквизиты показывают карточку организации целиком', async () => {
  const client = {
    id: 14,
    name: 'ООО «РУАТ»',
    full_name: 'Общество с ограниченной ответственностью «РуАуто Трейлер»',
    full_name_en: 'RuAuto Trailer Limited Liability Company',
    name_en: 'RUAT LLC',
    client_type: 'ooo',
    status_name: 'Новый',
    status_color: '#3b82f6',
    pricing_level_name: 'Крупный опт',
    pricing_markup_pct: 5,
    phone: '+7 492 442 70 07',
    email: 'ruautotrailer@bk.ru',
    address: '601446, Владимирская область, м.р-н Вязниковский, г. Вязники, ул. Железнодорожная, д. 13, помещ. 414',
    legal_address: '601446, Владимирская область, м.р-н Вязниковский, г. Вязники, ул. Железнодорожная, д. 13, помещ. 414',
    inn: '3300013912',
    kpp: '330001001',
    ogrn: '1243300005651',
    okpo: '96134892',
    okved: '29.20',
    bank_account: '40702810524630001427',
    bank_name: 'ФИЛИАЛ "ЦЕНТРАЛЬНЫЙ" БАНКА ВТБ (ПАО)',
    corr_account: '30101810145250000411',
    bik: '044525411',
    director: 'Холов Наиль Хусанович',
    director_position: 'Генеральный директор',
    director_basis: 'Устава',
  };

  const { page, elements } = loadClientProfile({ client });
  await page.render(client.id);

  const html = elements['content-area'].innerHTML;
  assert.match(html, /Общество с ограниченной ответственностью «РуАуто Трейлер»/);
  assert.match(html, /RuAuto Trailer Limited Liability Company/);
  assert.match(html, /ОКПО 96134892 · ОКВЭД 29\.20/);
  assert.match(html, /Р\/С: 40702810524630001427/);
  assert.match(html, /БИК: 044525411/);
  assert.match(html, /Генеральный директор: Холов Наиль Хусанович \(действует на основании Устава\)/);
  // Адрес в реквизитах не задваивается, если фактический совпадает с юридическим
  assert.doesNotMatch(html, /Факт\. адрес/);
});

test('карточка: реквизиты скачиваются в Word одним нажатием', async () => {
  const client = {
    id: 13,
    name: 'ООО «Вологодские машины»',
    full_name: 'Общество с ограниченной ответственностью «Вологодские машины»',
    client_type: 'ooo',
    status_name: 'Новый',
    status_color: '#3b82f6',
    pricing_level_name: 'Крупный опт',
    pricing_markup_pct: 5,
    inn: '3525232448',
    kpp: '352501001',
    ogrn: '1093525017277',
    bank_account: '40702810112000009669',
    bank_name: 'Мурманское отделение № 8627 ПАО Сбербанк',
    bik: '044705615',
    director: 'Кузнецов Василий Петрович',
  };

  const { page, elements, sandbox } = loadClientProfile({ client });
  await page.render(client.id);

  const html = elements['content-area'].innerHTML;
  assert.match(html, /⤓ DOCX/, 'в строке чипов нужна кнопка выгрузки');
  assert.match(html, /ClientProfilePage\.downloadRequisites\(\)/);
  // кнопка не должна заодно сворачивать блок: у неё свой обработчик
  assert.ok(!/toggleRequisites\(\)[^>]*>[^<]*DOCX/.test(html));

  // Сам вызов: файл берётся с сервера, а не собирается в браузере
  let requested = null;
  let saved = null;
  sandbox.API.getBlob = async (path) => { requested = path; return { size: 10 }; };
  sandbox.downloadBlob = (blob, fileName) => { saved = { blob, fileName }; };
  page.client = client;
  page.clientId = client.id;

  await page.downloadRequisites();
  assert.equal(requested, '/clients/13/requisites.docx');
  assert.deepEqual(saved, { blob: { size: 10 }, fileName: 'Реквизиты ООО Вологодские машины.docx' });

  // Ошибка сервера не роняет карточку, а показывается тостом
  let errorText = '';
  sandbox.API.getBlob = async () => { throw new Error('у клиента не заполнены реквизиты'); };
  sandbox.Toast.error = (text) => { errorText = text; };
  await page.downloadRequisites();
  assert.match(errorText, /не заполнены реквизиты/);
});

test('карточка: компактная шапка — всё на виду, доставка и реквизиты в чипах', async () => {
  const client = {
    id: 15,
    name: 'ООО «ТД «ССТ»»',
    full_name: 'Общество с ограниченной ответственностью «Торговый дом «СаранскСпецТехника»»',
    client_type: 'ooo',
    status_name: 'Новый',
    status_color: '#38bdf8',
    pricing_level_name: 'Крупный опт',
    pricing_markup_pct: 15,
    phone: '+7 (8342) 38-04-27',
    email: 'info@sstrm.ru',
    site: 'www.sstrm.ru',
    address: '430030, Республика Мордовия, г. Саранск, ул. Строительная, д. 11, этаж 2',
    delivery_address: 'г. Саранск — ТК «Деловые линии», до терминала',
    delivery_contact_name: 'Алексей Храмов',
    delivery_contact_phone: '+7 (927) 641-81-40',
    inn: '1326206104',
    kpp: '132601001',
    ogrn: '1151326001234',
    legal_address: '430030, Республика Мордовия, г. Саранск, ул. Строительная, д. 11',
    bank_account: '40702810524630001427',
    bank_name: 'ПАО Сбербанк',
    bik: '044525225',
  };

  const { page, elements } = loadClientProfile({ client });
  await page.render(client.id);
  const html = elements['content-area'].innerHTML;

  // Старых плиток KPI больше нет — показатели идут одной строкой
  assert.doesNotMatch(html, /profile-kpi/);
  assert.match(html, /class="profile-header profile-header--compact"/);
  assert.match(html, /class="profile-strip"/);
  assert.match(html, /<b>0<\/b> заказов/);

  // Тип и ИНН — рядом с названием, а не отдельным блоком
  assert.match(html, /class="profile-meta">ООО · ИНН 1326206104/);

  // Доставка и реквизиты — чипы, блоки свёрнуты до нажатия
  assert.match(html, /id="delivery-toggle" aria-expanded="false"/);
  assert.match(html, /id="requisites-toggle" aria-expanded="false"/);
  assert.match(html, /id="client-delivery-body" hidden/);
  assert.match(html, /id="client-requisites-body" hidden/);
  assert.match(html, /📦 Доставка/);
  assert.match(html, /🏛️ Реквизиты/);

  // Контакты и адрес на месте, адрес обрезается «…» и целиком живёт в подсказке
  assert.match(html, /info@sstrm\.ru/);
  assert.match(html, /profile-contact-item--address" title="430030/);

  // Реквизиты по-прежнему доступны — они просто спрятаны в раскрывающемся блоке
  assert.match(html, /ИНН 1326206104 \/ КПП 132601001/);
  assert.match(html, /, БИК: 044525225/);
});

test('карточка: в «Документах» видны Word, Excel и текст, форматы подписаны', async () => {
  const { page, sandbox } = loadClientProfile({ isAdmin: true });
  page.clientId = 1;

  const now = new Date().toISOString();
  sandbox.API.get = async () => ({
    data: [
      { id: 1, name: 'Договор поставки', file_type: 'docx', file_path: '/uploads/documents/a.docx', created_at: now, uploaded_by_name: 'Админ' },
      { id: 2, name: 'Смета', file_type: 'xlsx', file_path: '/uploads/documents/a.xlsx', created_at: now, uploaded_by_name: 'Админ' },
      { id: 3, name: 'Письмо', file_type: 'txt', file_path: '/uploads/documents/a.txt', created_at: now, uploaded_by_name: 'Админ' },
      { id: 4, name: 'Презентация', file_type: 'pptx', file_path: '/uploads/documents/a.pptx', created_at: now, uploaded_by_name: 'Админ' },
    ],
  });

  const container = { innerHTML: '' };
  await page.loadDocuments(container);

  assert.match(container.innerHTML, /PDF, Word, Excel, PowerPoint, текст и фото до 50 МБ/);
  assert.match(container.innerHTML, /Договор поставки/);
  assert.match(container.innerHTML, /📝/, 'Word с иконкой документа');
  assert.match(container.innerHTML, /📊/, 'Excel с иконкой таблицы');
  assert.match(container.innerHTML, /📃/, 'текст с иконкой листа');
  assert.match(container.innerHTML, /📽️/, 'презентация с иконкой слайдов');
});

test('карточка: окно загрузки документа предлагает Word, Excel, PowerPoint и текст', () => {
  const { page, sandbox } = loadClientProfile({ isAdmin: true });
  page.clientId = 1;

  let modalBody = '';
  sandbox.Modal.open = ({ body }) => { modalBody = body; };
  // _uploadFile после открытия окна вешает обработчики на поля
  sandbox.document.getElementById = () => ({
    addEventListener() {}, value: '', disabled: false, textContent: '', click() {},
  });

  page.uploadDocument();

  assert.match(modalBody, /accept="\.pdf,\.txt,\.csv,\.md,\.rtf,\.doc,\.docx,\.xls,\.xlsx,\.ppt,\.pptx/);
  assert.match(modalBody, /\.heic/, 'HEIC с телефона тоже можно');
  assert.match(modalBody, /Word \(doc\/docx\), Excel \(xls\/xlsx\), PowerPoint \(pptx\)/);
  assert.match(modalBody, /до 50 МБ/);
});

test('карточка: фото в «Документах» открывается в просмотре, остальное — новой вкладкой', async () => {
  const { page, sandbox } = loadClientProfile({ isAdmin: true });
  page.clientId = 1;

  const now = new Date().toISOString();
  const docs = [
    { id: 1, name: 'Скан договора', file_type: 'jpg', file_path: '/uploads/documents/a.jpg', created_at: now, uploaded_by_name: 'Админ' },
    { id: 2, name: 'Скан акта', file_type: 'heic', file_path: '/uploads/documents/b.jpg', created_at: now, uploaded_by_name: 'Админ' },
    { id: 3, name: 'Договор', file_type: 'docx', file_path: '/uploads/documents/c.docx', created_at: now, uploaded_by_name: 'Админ' },
  ];
  sandbox.API.get = async () => ({ data: docs });

  const container = { innerHTML: '' };
  await page.loadDocuments(container);

  const calls = [];
  sandbox.Lightbox = { open: options => calls.push(options) };
  const opened = [];
  sandbox.window.open = (url) => opened.push(url);

  page.viewDocument(1);
  assert.equal(calls.length, 1, 'фото открылось в просмотре');
  assert.deepEqual(calls[0].images, ['/uploads/documents/a.jpg', '/uploads/documents/b.jpg']);
  assert.equal(calls[0].index, 0);
  assert.equal(typeof calls[0].onRotate, 'function', 'админ может повернуть фото');

  page.viewDocument(2);
  assert.equal(calls[1].index, 1, 'второе фото листается со своей позиции');

  page.viewDocument(3);
  assert.deepEqual(opened, ['/uploads/documents/c.docx'], 'Word открывается новой вкладкой');
});

test('карточка: поворот фото документа сохраняется и обновляет список', async () => {
  const { page, sandbox } = loadClientProfile({ isAdmin: true });
  page.clientId = 1;

  const posted = [];
  sandbox.API.post = async (url, body) => { posted.push([url, body]); return { path: body.path }; };
  const switched = [];
  page.switchTab = tab => switched.push(tab);

  const src = await page.rotateDocumentPhoto('/uploads/documents/a.jpg?v=1', 90);

  assert.deepEqual(posted, [['/upload/rotate', { path: '/uploads/documents/a.jpg', degrees: 90 }]]);
  assert.deepEqual(switched, ['documents']);
  assert.match(src, /^\/uploads\/documents\/a\.jpg\?v=\d+$/);
});

test('карточка: без права на изменение фото открывается без кнопок поворота', async () => {
  const { page, sandbox } = loadClientProfile({ isAdmin: false });
  page.clientId = 1;

  const now = new Date().toISOString();
  sandbox.API.get = async () => ({
    data: [{ id: 1, name: 'Скан', file_type: 'jpg', file_path: '/uploads/documents/a.jpg', created_at: now, uploaded_by_name: 'Админ' }],
  });

  const container = { innerHTML: '' };
  await page.loadDocuments(container);

  const calls = [];
  sandbox.Lightbox = { open: options => calls.push(options) };
  page.viewDocument(1);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].onRotate, null);
});

test('карточка: цена без BOM видна в списке чертежей, а не «—»', async () => {
  const { page, sandbox } = loadClientProfile({ isAdmin: true });
  page.clientId = 1;

  const now = new Date().toISOString();
  sandbox.API.get = async () => ({
    data: [{
      id: 6,
      name: 'Фонарь габаритный',
      components_count: 0,
      // фикс-цена живёт на связи клиента, у самого чертежа её нет
      fixed_price: null,
      client_fixed_price: 48500,
      base_cost: 48500,
      total_cost: 48500,
      fixed_without_bom: true,
      created_at: now,
      author_name: 'Администратор',
    }],
  });

  const container = { innerHTML: '' };
  await page.loadDrawings(container);

  assert.match(container.innerHTML, /48500\.00 ₽/, 'сумма вместо прочерка');
  assert.doesNotMatch(container.innerHTML, />—</);
  assert.match(container.innerHTML, />без BOM</);
});

test('карточка: заметка к расчёту видна в списке чертежей', async () => {
  const { page, sandbox } = loadClientProfile({ isAdmin: true });
  page.clientId = 1;

  sandbox.API.get = async () => ({
    data: [{
      id: 7,
      name: 'Фонарь',
      components_count: 3,
      base_cost: 1000,
      total_cost: 1200,
      notes: 'снизить цену на 5% при следующем заказе',
      created_at: new Date().toISOString(),
      author_name: 'Администратор',
    }],
  });

  const container = { innerHTML: '' };
  await page.loadDrawings(container);

  assert.match(container.innerHTML, /📝 снизить цену на 5% при следующем заказе/);
});
