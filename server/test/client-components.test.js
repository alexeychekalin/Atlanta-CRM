/* Рендер клиентских страниц в песочнице: ловим ошибки, которые не видит
   проверка синтаксиса, — например обращение к const до её объявления.

   Регрессия: `const fullArticle = fullArticle(...)` в списке модификаций
   роняло просмотр компонента с «can't access lexical declaration
   'fullArticle' before initialization». */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const clientDir = path.join(__dirname, '../../client/js');

/** Песочница с заглушками браузерного окружения. */
function makeSandbox(overrides = {}) {
  const sandbox = {
    window: {},
    console,
    document: { getElementById: () => null },
    localStorage: { getItem: () => null, setItem: () => {} },
    Table: {
      formatMoney: v => `${Number(v).toFixed(2)} ₽`,
      formatMoneyRaw: v => Number(v).toFixed(2),
      loading: () => '',
      emptyState: () => '',
      editIcon: '',
      deleteIcon: '',
      actionBtn: () => '',
    },
    API: {
      can: () => true,
      isAdmin: () => true,
      get: async () => ({}),
      post: async () => ({}),
      del: async () => ({}),
      ...overrides.api,
    },
    Toast: { error: () => {}, success: () => {}, info: () => {} },
    Modal: { open: () => {}, close: () => {} },
    Lightbox: { open: () => {}, close: () => {} },
    ConfirmDialog: { delete: async () => true },
    App: { navigateTo: () => {} },
    ...overrides.globals,
  };
  vm.createContext(sandbox);
  for (const helper of ['components/escape.js', 'components/article.js']) {
    vm.runInContext(fs.readFileSync(path.join(clientDir, helper), 'utf8'), sandbox);
  }
  // в браузере helpers лежат на window и видны как глобальные
  sandbox.esc = sandbox.window.esc;
  sandbox.safeUrl = sandbox.window.safeUrl;
  sandbox.fullArticle = sandbox.window.fullArticle;
  return sandbox;
}

/** Загружает модуль страницы и отдаёт её объект.
 *  file — имя файла в pages/, objectName — переменная внутри модуля. */
function loadPage(file, objectName, overrides = {}) {
  const sandbox = makeSandbox(overrides);
  const full = path.join(clientDir, `pages/${file}.js`);
  // const на верхнем уровне скрипта не попадает в объект песочницы — выносим сами
  const code = fs.readFileSync(full, 'utf8') + `\n;globalThis.${objectName} = ${objectName};`;
  vm.runInContext(code, sandbox);
  return { page: sandbox[objectName], sandbox };
}

test('модификации: карточка компонента рендерится с полным артикулом', async () => {
  const component = {
    id: 7,
    article: 'А.3776.001',
    name: 'Фонарь задний (квадрат)',
    description: '',
    price: 1200,
    images: [],
    is_active: true,
    modifications: [
      { id: 1, code: '01', name: 'с 7-контактным разъёмом', price_override: null, images: [] },
      { id: 2, code: '02.02', name: 'под быстрый обжим', price_override: 1350, images: [] },
    ],
  };
  let modal = null;
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    api: {
      get: async url => (url.endsWith('/documents') ? { data: [] } : component),
    },
    globals: { Modal: { open: options => { modal = options; }, close: () => {} } },
  });

  await page.viewComponent(7);

  assert.ok(modal, 'модальное окно должно открыться');
  assert.match(modal.body, /Модификации \(2\)/);
  // базовый артикул + код модификации через дефис
  assert.match(modal.body, /А\.3776\.001-01/);
  assert.match(modal.body, /А\.3776\.001-02\.02/);
  assert.match(modal.body, /1350\.00/);
});

test('модификации: код подставляется и когда модификаций нет', async () => {
  const component = {
    id: 8, article: 'А.3716.002', name: 'Фонарь противотуманный',
    price: 990, images: [], is_active: true, description: '', modifications: [],
  };
  let modal = null;
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    api: { get: async url => (url.endsWith('/documents') ? { data: [] } : component) },
    globals: { Modal: { open: options => { modal = options; }, close: () => {} } },
  });

  await page.viewComponent(8);

  assert.match(modal.body, /А\.3716\.002/);
  assert.match(modal.body, /Нет модификаций/);
});

test('галерея: просмотр листает все фото карточки, начиная с выбранного', async () => {
  const component = {
    id: 9,
    article: 'А.3731.013',
    name: 'Фонарь габаритный',
    price: 1200,
    is_active: true,
    image_path: '/uploads/cover.jpg',
    // обложка повторяется в галерее — в просмотре она должна быть один раз
    images: [
      { id: 1, image_path: '/uploads/cover.jpg' },
      { id: 2, image_path: '/uploads/second.jpg' },
      { id: 3, image_path: '/uploads/third.jpg' },
    ],
    modifications: [],
  };
  let opened = null;
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    api: { get: async url => (url.endsWith('/documents') ? { data: [] } : component) },
    globals: { Lightbox: { open: options => { opened = options; }, close: () => {} } },
  });

  await page.viewComponent(9);
  page.viewComponentImage(2);

  assert.deepEqual(opened.images, ['/uploads/cover.jpg', '/uploads/second.jpg', '/uploads/third.jpg']);
  assert.equal(opened.index, 2, 'открывается то фото, по которому кликнули');
  assert.equal(opened.title, 'Фонарь габаритный');

  // закрытие просмотра не трогает карточку: Modal остаётся как был
  assert.ok(!Object.prototype.hasOwnProperty.call(opened, 'footer'));
});

test('галерея: фото модификации листаются отдельным набором', async () => {
  const component = {
    id: 10,
    article: 'А.3776.005Л',
    name: 'Фонарь задний',
    price: 2500,
    is_active: true,
    images: [],
    modifications: [
      { id: 4, code: '01', name: 'левый', images: [{ image_path: '/uploads/m1-1.jpg' }, { image_path: '/uploads/m1-2.jpg' }] },
      { id: 5, code: '05', name: 'левый расширенный', images: [{ image_path: '/uploads/m2-1.jpg' }] },
    ],
  };
  let opened = null;
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    api: { get: async url => (url.endsWith('/documents') ? { data: [] } : component) },
    globals: { Lightbox: { open: options => { opened = options; }, close: () => {} } },
  });

  await page.viewComponent(10);
  page.viewModImage(4, 1);

  assert.deepEqual(opened.images, ['/uploads/m1-1.jpg', '/uploads/m1-2.jpg']);
  assert.equal(opened.index, 1);
  assert.match(opened.title, /01/);

  // у второй модификации свой набор
  page.viewModImage(5, 0);
  assert.deepEqual(opened.images, ['/uploads/m2-1.jpg']);
});
