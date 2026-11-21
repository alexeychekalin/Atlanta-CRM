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

  // артикул — в заголовке окна, название — в шапке карточки
  assert.equal(modal.title, 'А.3716.002');
  assert.match(modal.body, /Фонарь противотуманный/);
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

// === Поиск по модификациям ===

/** Мини-DOM: элементы, которые читает filterAndRender. */
function makeFakeDocument(values = {}) {
  const nodes = {
    'comp-search': { value: values.search || '', addEventListener() {} },
    'comp-category-filter': { value: values.category || '', addEventListener() {} },
    'comp-sort': { value: values.sort || 'name', addEventListener() {} },
    'comp-count': { textContent: '' },
    'components-table': { innerHTML: '' },
    'comp-category-chips': { innerHTML: '' },
  };
  return {
    nodes,
    getElementById: id => nodes[id] || null,
    querySelectorAll: () => [],
    querySelector: () => null,
  };
}

test('поиск: находит компонент по коду модификации', () => {
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage');
  const component = {
    id: 1, article: 'А.3776.001', name: 'Фонарь задний', description: '', modifications: [
      { id: 11, code: '01', name: 'с 7-контактным разъёмом' },
      { id: 12, code: '02.02', name: 'под быстрый обжим' },
    ],
  };
  const query = page._buildSearchQuery('02.02');
  const hit = page._searchHit(component, query);

  assert.ok(hit, 'компонент должен найтись по коду модификации');
  assert.equal(hit.direct, false, 'совпадение не по основному артикулу');
  assert.deepEqual(hit.mods.map(m => m.code), ['02.02']);
});

test('поиск: находит по полному артикулу модификации и по её названию', () => {
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage');
  const component = {
    id: 1, article: 'А.3776.001', name: 'Фонарь задний', description: '', modifications: [
      { id: 11, code: '01', name: 'с 7-контактным разъёмом' },
      { id: 12, code: '02.02', name: 'под быстрый обжим' },
    ],
  };

  assert.deepEqual(page._searchHit(component, page._buildSearchQuery('А.3776.001-02.02')).mods.map(m => m.code), ['02.02']);
  assert.deepEqual(page._searchHit(component, page._buildSearchQuery('быстрый обжим')).mods.map(m => m.code), ['02.02']);
  // пробелы в артикуле не мешают
  assert.deepEqual(page._searchHit(component, page._buildSearchQuery('а.3776.001 - 02.02')).mods.map(m => m.code), ['02.02']);
});

test('поиск: прощает латиницу и разделители в артикуле', () => {
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage');
  const component = {
    id: 1, article: 'БК-101', name: 'Блок коммутации', description: '', modifications: [],
  };
  const other = {
    id: 2, article: 'А.3724.106', name: 'Жгут плоский', description: '', modifications: [
      { id: 21, code: '02.01', name: 'Кабель с адаптером' },
    ],
  };

  // латинские B и K вместо кириллических (частая опечатка при наборе)
  assert.equal(page._searchHit(component, page._buildSearchQuery('BK-101')).direct, true);
  // артикул набран без дефиса
  assert.equal(page._searchHit(component, page._buildSearchQuery('бк101')).direct, true);
  // полный артикул модификации без точек
  assert.deepEqual(page._searchHit(other, page._buildSearchQuery('а3724.106-02.01')).mods.map(m => m.code), ['02.01']);
});

test('поиск: точку в артикуле можно не ставить', () => {
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage');
  const component = {
    id: 1, article: 'А.3724.106', name: 'Жгут плоский', description: '',
    modifications: [{ id: 21, code: '02.01', name: 'Кабель с адаптером' }],
  };

  // «а37» — короткий запрос, но с буквой: точку после «А» ставить не нужно
  assert.equal(page._searchHit(component, page._buildSearchQuery('а37')).direct, true);
  // код исполнения без точки
  assert.deepEqual(page._searchHit(component, page._buildSearchQuery('0201')).mods.map(m => m.code), ['02.01']);
  // короткий числовой запрос без разделителей не расширяем — иначе «15» цепляет полкаталога
  assert.equal(page._bareSearchable('15'), false);
  assert.equal(page._bareSearchable('а3'), true);
  assert.equal(page._searchHit(component, page._buildSearchQuery('15')), null);
});

test('поиск: по основному артикулу модификации не засоряют выдачу', () => {
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage');
  const component = {
    id: 1, article: 'А.3776.001', name: 'Фонарь задний', description: '', modifications: [
      { id: 11, code: '01', name: 'с 7-контактным разъёмом' },
    ],
  };
  const hit = page._searchHit(component, page._buildSearchQuery('А.3776.001'));

  assert.equal(hit.direct, true);
  assert.deepEqual(hit.mods, [], 'подсказки по модификациям не нужны');
  assert.equal(page._searchHit(component, page._buildSearchQuery('нет-такого')), null);
});

test('поиск: выдача фильтруется, сортируется и показывает совпавшую модификацию', () => {
  const components = [
    { id: 1, article: 'А.3776.001', name: 'Фонарь задний', description: '', price: 100, category_id: 1,
      modifications_count: 1, modifications: [{ id: 11, code: '02.02', name: 'под быстрый обжим' }] },
    { id: 2, article: 'А.3776.001-02.02', name: 'Фонарь с обжимом', description: '', price: 200, category_id: 1,
      modifications_count: 0, modifications: [] },
    { id: 3, article: 'А.3700.500', name: 'Фонарь габаритный', description: '', price: 300, category_id: 1,
      modifications_count: 0, modifications: [] },
  ];
  const doc = makeFakeDocument({ search: '02.02' });
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    globals: { document: doc },
  });
  page.allComponents = components;
  page.categories = [];
  page.filterAndRender();

  assert.match(doc.nodes['comp-count'].textContent, /Найдено: 2/);
  assert.match(doc.nodes['comp-count'].textContent, /по модификациям: 1/);

  const grid = doc.nodes['components-table'].innerHTML;
  assert.ok(!grid.includes('Фонарь габаритный'), 'несовпавшие не показываем');
  assert.match(grid, /comp-mod-hit/, 'у найденного по модификации есть подсказка');
  assert.match(grid, /мод\. 02\.02/);
  // прямое совпадение по артикулу — выше найденного по модификации
  assert.ok(grid.indexOf('Фонарь с обжимом') < grid.indexOf('Фонарь задний'));
});

test('фильтры: в чипсах категорий видно, сколько позиций найдено', () => {
  const components = [
    { id: 1, article: 'А.3776.001', name: 'Фонарь задний', description: '', price: 100,
      category_id: 1, category_name: 'Фонари задние', modifications: [] },
    { id: 2, article: 'А.3700.500', name: 'Фонарь габаритный', description: '', price: 300,
      category_id: 1, category_name: 'Фонари задние', modifications: [] },
    { id: 3, article: 'БК-101', name: 'Блок коммутации', description: '', price: 400,
      category_id: 2, category_name: 'Блоки', modifications: [] },
  ];
  const doc = makeFakeDocument();
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    globals: { document: doc },
  });
  page.allComponents = components;
  page.categories = [{ id: 1, name: 'Фонари задние' }, { id: 2, name: 'Блоки' }, { id: 3, name: 'Разъёмы' }];
  page.filterAndRender();

  const chips = doc.nodes['comp-category-chips'].innerHTML;
  assert.match(chips, /Все \(3\)/);
  assert.match(chips, /Фонари задние \(2\)/);
  assert.match(chips, /Блоки \(1\)/);
  assert.match(chips, /Разъёмы \(0\)/);
  // пустая категория приглушена: видно, что фильтр никуда не ведёт
  assert.match(chips, /chip-filter\s+chip-filter--empty"[^>]*>Разъёмы/);
  assert.ok(!/chip-filter\s+chip-filter--empty"[^>]*>Блоки/.test(chips),
    'непустая категория не должна считаться пустой');
});

test('фильтры: счётчики пересчитываются с учётом поиска', () => {
  const components = [
    { id: 1, article: 'А.3776.001', name: 'Фонарь задний', description: '', price: 100,
      category_id: 1, category_name: 'Фонари задние', modifications: [] },
    { id: 2, article: 'БК-101', name: 'Блок коммутации', description: '', price: 400,
      category_id: 2, category_name: 'Блоки', modifications: [] },
  ];
  const doc = makeFakeDocument({ search: 'А.3776' });
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    globals: { document: doc },
  });
  page.allComponents = components;
  page.categories = [{ id: 1, name: 'Фонари задние' }, { id: 2, name: 'Блоки' }];
  page.filterAndRender();

  const chips = doc.nodes['comp-category-chips'].innerHTML;
  assert.match(chips, /Все \(1\)/);
  assert.match(chips, /Фонари задние \(1\)/);
  assert.match(chips, /Блоки \(0\)/);
});

// === Карточка просмотра: компактная раскладка ===

/** Модификация в том виде, в каком её отдаёт API. */
function makeMod(code, overrides = {}) {
  return {
    id: Number(code.replace(/\D/g, '')) || 1,
    code,
    name: `исполнение ${code}`,
    price_override: null,
    images: [],
    ...overrides,
  };
}

/** Мини-DOM для _applyModFilter: набор строк со classList и dataset. */
function makeRowsDom(rows, nodes = {}) {
  const byId = {
    'mods-more': { textContent: '', classList: { values: new Set(), toggle(c, on) { on ? this.values.add(c) : this.values.delete(c); }, contains(c) { return this.values.has(c); } } },
    'mods-empty': { hidden: false },
    ...nodes,
  };
  return {
    querySelectorAll: selector => (selector === '.mod-row' ? rows : []),
    getElementById: id => byId[id] || null,
    querySelector: () => null,
    nodes: byId,
  };
}

test('карточка компонента: артикул в заголовке, название ниже, копирование — иконкой', async () => {
  const component = {
    id: 21,
    article: 'А.3731.013',
    name: 'Фонарь габаритный',
    // описание начинается с названия — в карточке оно уже стоит заголовком
    description: 'Фонарь габаритный, с креплением на два болта',
    price: 0,
    is_active: true,
    images: [],
    modifications: [],
  };
  let modal = null;
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    api: { get: async url => (url.endsWith('/documents') ? { data: [] } : component) },
    globals: { Modal: { open: options => { modal = options; }, close: () => {} } },
  });

  await page.viewComponent(21);

  assert.equal(modal.className, 'modal-comp', 'карточка открывается в компактном варианте модалки');
  assert.equal(modal.autoFocus, false, 'фокус не прыгает в поиск по модификациям');
  assert.match(modal.body, /comp-view__head/);
  // местами: артикул — заголовок окна, название — первая строка в шапке
  assert.equal(modal.title, 'А.3731.013', 'в заголовке карточки — артикул');
  assert.match(modal.body, /comp-view__name[^>]*>Фонарь габаритный</);
  assert.ok(!/copyable/.test(modal.body), 'артикул больше не копируется кликом по тексту');
  assert.match(modal.titleAction, /class="copy-btn"/, 'рядом с артикулом — кнопка копирования');
  assert.match(modal.titleAction, /data-copy="А\.3731\.013"/);
  assert.match(modal.titleAction, /aria-label="Скопировать артикул А\.3731\.013"/);
  assert.ok(!/Фонарь габаритный, с креплением/.test(modal.body),
    'описание не должно повторять название целиком');
  assert.match(modal.body, /с креплением на два болта/);
  // нулевая цена — это «не задана», а не ноль рублей
  assert.match(modal.body, /не задана/);
});

test('список компонентов: артикул первым, копирование — отдельной иконкой', () => {
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage');
  const component = {
    id: 5, article: 'А.3731.010', name: 'Фонарь габаритный',
    price: 0, is_active: true, modifications_count: 3,
    category_name: 'Габаритные фонари', image_path: null, description: 'маркер 10',
  };

  const grid = { innerHTML: '' };
  page._renderGrid(grid, [component]);
  assert.match(grid.innerHTML, /comp-card-art">А\.3731\.010</);
  assert.match(grid.innerHTML, /class="copy-btn"[^>]*data-copy="А\.3731\.010"/);
  assert.match(grid.innerHTML, /aria-label="Скопировать артикул А\.3731\.010"/);
  assert.ok(!/class="copyable"/.test(grid.innerHTML),
    'артикул должен быть обычным текстом, а не кнопкой копирования');
  assert.ok(grid.innerHTML.indexOf('А.3731.010') < grid.innerHTML.indexOf('Фонарь габаритный'),
    'артикул идёт перед названием');

  const table = { innerHTML: '' };
  page._renderTable(table, [component]);
  assert.match(table.innerHTML, /comp-art">А\.3731\.010</);
  assert.match(table.innerHTML, /class="copy-btn"[^>]*data-copy="А\.3731\.010"/);
  assert.ok(!/class="copyable"/.test(table.innerHTML));
  // название — обычный текст, артикул — моноширинный и выделен цветом
  assert.ok(!/<td[^>]*><strong>А\.3731\.010/.test(table.innerHTML));
});

test('модификации: артикул строки копируется иконкой, а не кликом по тексту', () => {
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage');
  const component = { id: 5, article: 'А.3731.010', name: 'Фонарь габаритный' };
  const mod = { id: 11, code: '01.09', name: 'передний', price_override: null, images: [] };

  const html = page._modRowHtml(component, mod, false, 0, false);
  assert.match(html, /class="mod-row__art">А\.3731\.010-01\.09</);
  assert.match(html, /class="copy-btn"[^>]*data-copy="А\.3731\.010-01\.09"/);
  assert.ok(!/copyable/.test(html), 'текст артикула не должен быть кнопкой копирования');
});

test('карточка компонента: раскрытый список фото не сворачивается после удаления', async () => {
  const component = {
    id: 7, article: 'А.3731.013', name: 'Фонарь габаритный', description: '',
    price: 990, is_active: true,
    image_path: '/uploads/images/a.jpg',
    images: [
      { id: 11, image_path: '/uploads/images/a.jpg' },
      { id: 12, image_path: '/uploads/images/b.jpg' },
      { id: 13, image_path: '/uploads/images/c.jpg' },
    ],
    modifications: [],
  };
  const other = { ...component, id: 8, article: 'А.3731.014', images: component.images };

  let modal = null;
  // перерисовка идёт в открытой карточке: модалка на экране
  const overlay = { style: { display: 'flex' } };
  const modalBody = { scrollTop: 180 };
  const group = { hidden: true };
  const document = {
    getElementById: (id) => ({
      'modal-overlay': overlay,
      'modal-body': modalBody,
      'comp-photos': group,
    }[id] || null),
    querySelector: () => null,
    querySelectorAll: () => [],
  };

  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    api: {
      get: async (url) => {
        const path = String(url);
        if (path.endsWith('/documents')) return { data: [] };
        // обновление списка после удаления — без этого filterAndRender падает
        if (!/\/\d+$/.test(path)) return { data: [], categories: [] };
        return path.endsWith('/8') ? other : component;
      },
    },
    globals: {
      document,
      Modal: { open: options => { modal = options; }, close: () => {} },
    },
  });

  // 1. карточка открывается со свёрнутым списком фото
  await page.viewComponent(7);
  assert.match(modal.body, /aria-expanded="false" onclick="ComponentsCatalogPage\.toggleGroup\(this, 'comp-photos'\)"/);
  assert.match(modal.body, /id="comp-photos" hidden>/);

  // 2. пользователь раскрыл список
  page.toggleGroup({ setAttribute() {} }, 'comp-photos');
  assert.equal(page.isGroupOpen('comp-photos'), true, 'раскрытие должно запоминаться');

  // список после удаления перерисовывается отдельно — здесь важен только просмотр
  page.filterAndRender = () => {};

  // 3. после удаления фото карточка перерисовывается — список остаётся раскрытым
  await page.deleteComponentImage(7, 12);
  // удаление перерисовывает карточку без await — даём рендеру завершиться
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(modal.body, /aria-expanded="true" onclick="ComponentsCatalogPage\.toggleGroup\(this, 'comp-photos'\)"/,
    'после удаления фото список снова свернулся');
  assert.match(modal.body, /id="comp-photos">/, 'блок фото должен остаться раскрытым');

  // 4. в другой карточке состояние своё — там список снова свёрнут
  await page.viewComponent(8);
  assert.match(modal.body, /aria-expanded="false" onclick="ComponentsCatalogPage\.toggleGroup\(this, 'comp-photos'\)"/);
  assert.match(modal.body, /id="comp-photos" hidden>/);
});

test('карточка компонента: раскрытые документы тоже переживают перерисовку', async () => {
  const component = {
    id: 7, article: 'А.3731.013', name: 'Фонарь габаритный', description: '',
    price: 990, is_active: true, images: [], modifications: [],
  };

  let modal = null;
  const group = { hidden: true };
  const document = {
    getElementById: (id) => ({
      'modal-overlay': { style: { display: 'flex' } },
      'modal-body': { scrollTop: 0 },
      'comp-docs': group,
    }[id] || null),
    querySelector: () => null,
    querySelectorAll: () => [],
  };

  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    api: { get: async url => (String(url).endsWith('/documents') ? { data: [] } : component) },
    globals: {
      document,
      Modal: { open: options => { modal = options; }, close: () => {} },
    },
  });

  await page.viewComponent(7);
  assert.match(modal.body, /id="comp-docs" hidden>/);

  page.toggleGroup({ setAttribute() {} }, 'comp-docs');
  await page.viewComponent(7);

  assert.match(modal.body, /aria-expanded="true" onclick="ComponentsCatalogPage\.toggleGroup\(this, 'comp-docs'\)"/);
  assert.match(modal.body, /id="comp-docs">/);
});

test('карточка компонента: длинный список модификаций свёрнут по шесть', async () => {
  const component = {
    id: 22,
    article: 'А.3731.027',
    name: 'Фонарь',
    description: '',
    price: 1000,
    is_active: true,
    images: [],
    modifications: ['01', '02', '03', '04', '05', '06', '07', '08'].map((code, i) => makeMod(code, { id: 100 + i })),
  };
  let modal = null;
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    api: { get: async url => (url.endsWith('/documents') ? { data: [] } : component) },
    globals: { Modal: { open: options => { modal = options; }, close: () => {} } },
  });

  await page.viewComponent(22);

  assert.match(modal.body, /Модификации \(8\)/);
  // первые шесть строк идут в разметке без «скрыто», остальные — с классом
  const hidden = modal.body.match(/mod-row--hidden/g) || [];
  assert.equal(hidden.length, 2, 'за лимитом остаются только две строки из восьми');
  assert.match(modal.body, /comp-mods__more/, 'есть кнопка «Показать ещё»');
  assert.match(modal.body, /Артикул, длина, потребитель/, 'поиск появляется при длинном списке');
});

test('карточка компонента: короткий список — без поиска и лишних элементов', async () => {
  const component = {
    id: 23,
    article: 'А.3724.050',
    name: 'Кабель',
    description: '',
    price: 500,
    is_active: true,
    images: [],
    modifications: [makeMod('01.01')],
  };
  let modal = null;
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    api: { get: async url => (url.endsWith('/documents') ? { data: [] } : component) },
    globals: { Modal: { open: options => { modal = options; }, close: () => {} } },
  });

  await page.viewComponent(23);

  assert.ok(!/comp-mods__search/.test(modal.body), 'при одной модификации поиск не нужен');
  assert.ok(!/mod-row--hidden/.test(modal.body), 'все строки видны сразу');
});

test('карточка компонента: поиск по модификациям прячет несовпавшие строки', async () => {
  const rows = [
    { dataset: { search: 'А.3724.402-01.01 Жгут 0,6 м' }, classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); }, toggle(c, on) { on ? this.set.add(c) : this.set.delete(c); } } },
    { dataset: { search: 'А.3724.402-02.02 Блок 800 мм' }, classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); }, toggle(c, on) { on ? this.set.add(c) : this.set.delete(c); } } },
  ];
  const doc = makeRowsDom(rows);
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', { globals: { document: doc } });

  page._modView = { query: '800', filter: 'all', limit: 6 };
  page._applyModFilter();

  assert.ok(rows[0].classList.contains('mod-row--hidden'), 'строка без совпадения скрыта');
  assert.ok(!rows[1].classList.contains('mod-row--hidden'), 'строка с совпадением видна');

  // «Показать ещё» показывает остальные
  page._modView.query = '';
  page._modView.limit = Number.POSITIVE_INFINITY;
  page._applyModFilter();
  assert.ok(!rows[0].classList.contains('mod-row--hidden'));
  assert.equal(doc.nodes['mods-more'].classList.contains('is-visible'), false);
});

/* Поворот фото: кнопки в просмотре появляются у тех, кто может править
 * карточку, а запрос уходит на общий маршрут /upload/rotate. */

test('галерея: у редактора есть поворот фото, путь уходит без ?v', async () => {
  const component = {
    id: 11, article: 'А.3731.013', name: 'Фонарь', price: 100, is_active: true,
    image_path: '/uploads/cover.jpg', images: [{ id: 1, image_path: '/uploads/cover.jpg' }],
    modifications: [],
  };
  let opened = null;
  const posted = [];
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    api: {
      get: async url => (url.endsWith('/documents') ? { data: [] } : component),
      post: async (url, body) => { posted.push([url, body]); return { path: body.path }; },
    },
    globals: { Lightbox: { open: options => { opened = options; }, close: () => {} } },
  });

  await page.viewComponent(11);
  page.viewComponentImage(0);
  assert.equal(typeof opened.onRotate, 'function', 'редактор может повернуть фото');

  const src = await opened.onRotate('/uploads/cover.jpg', 90, 0);
  assert.deepEqual(posted[0], ['/upload/rotate', { path: '/uploads/cover.jpg', degrees: 90 }]);
  assert.match(src, /^\/uploads\/cover\.jpg\?v=\d+$/);
});

test('галерея: без права на изменение карточки поворота нет', async () => {
  const component = {
    id: 12, article: 'А.3731.013', name: 'Фонарь', price: 100, is_active: true,
    image_path: '/uploads/cover.jpg', images: [], modifications: [],
  };
  let opened = null;
  const { page, sandbox } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    api: { get: async url => (url.endsWith('/documents') ? { data: [] } : component) },
    globals: { Lightbox: { open: options => { opened = options; }, close: () => {} } },
  });
  sandbox.API.can = () => false;

  await page.viewComponent(12);
  page.viewComponentImage(0);
  assert.equal(opened.onRotate, null);
});

test('галерея: фото модификации тоже можно повернуть', async () => {
  const component = {
    id: 13, article: 'А.3776.005Л', name: 'Фонарь задний', price: 2500, is_active: true,
    images: [],
    modifications: [{ id: 7, code: '01', name: 'левый', images: [{ image_path: '/uploads/m1.jpg' }] }],
  };
  let opened = null;
  const posted = [];
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    api: {
      get: async url => (url.endsWith('/documents') ? { data: [] } : component),
      post: async (url, body) => { posted.push([url, body]); return { path: body.path }; },
    },
    globals: { Lightbox: { open: options => { opened = options; }, close: () => {} } },
  });

  await page.viewComponent(13);
  page.viewModImage(7, 0);
  assert.equal(typeof opened.onRotate, 'function');

  await opened.onRotate('/uploads/m1.jpg', -90, 0);
  assert.deepEqual(posted[0], ['/upload/rotate', { path: '/uploads/m1.jpg', degrees: -90 }]);
});

test('модификации: снятая с продажи помечена, активная — без пометки', () => {
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage');
  const component = { id: 5, article: 'А.3731.010', name: 'Фонарь габаритный' };
  const base = { id: 11, code: '01.09', name: 'передний', price_override: 640, images: [] };

  const off = page._modRowHtml(component, { ...base, is_active: false }, false, 0, false);
  assert.match(off, /mod-row__flag--off[^>]*>неактивна</);
  assert.match(off, /mod-row__price">640\.00/);

  const on = page._modRowHtml(component, { ...base, is_active: true }, false, 0, false);
  assert.doesNotMatch(on, /неактивна/);

  // старые записи без поля считаем активными
  const legacy = page._modRowHtml(component, base, false, 0, false);
  assert.doesNotMatch(legacy, /неактивна/);
});
