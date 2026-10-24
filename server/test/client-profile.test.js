const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const clientDir = path.join(__dirname, '../../client/js');

/** Загружает cards клиента в песочницу с минимальными заглушками. */
function loadClientProfile({ isAdmin = false } = {}) {
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
      getElementById: id => elements[id] || null,
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
      get: async () => ({ data: [] }),
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
