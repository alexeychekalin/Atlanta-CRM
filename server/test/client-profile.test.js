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

test('карточка: реквизиты свёрнуты по умолчанию и запоминают состояние', () => {
  const { page, elements, storage } = loadClientProfile();
  elements['client-requisites-body'] = { style: { display: 'none' }, textContent: '' };
  elements['requisites-toggle-label'] = { textContent: '' };

  // По умолчанию localStorage пуст — блок остаётся свёрнутым
  page.applyRequisitesState();
  assert.equal(elements['client-requisites-body'].style.display, 'none');
  assert.equal(elements['requisites-toggle-label'].textContent, 'Развернуть ▾');

  page.toggleRequisites();
  assert.equal(elements['client-requisites-body'].style.display, '');
  assert.equal(elements['requisites-toggle-label'].textContent, 'Свернуть ▴');
  assert.equal(storage[page.REQUISITES_KEY], '1');

  // Состояние «развёрнуто» переживает перерисовку карточки
  const reopened = loadClientProfile();
  assert.equal(reopened.page.requisitesOpen(), false);
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
