/* Комментарий к расчёту чертежа.
 *
 * Заметка пишется в калькуляторе («снизить цену на 5% при следующем заказе»)
 * и живёт вместе с чертежом: сохраняется, показывается в каталоге и в карточке
 * клиента, ищется поиском и стирается, если поле очистили. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const migration = fs.readFileSync(path.join(__dirname, '../src/db/migration_drawing_notes.sql'), 'utf8');
const routes = fs.readFileSync(path.join(__dirname, '../src/routes/drawings.js'), 'utf8');
const calculator = fs.readFileSync(path.join(ROOT, 'client/js/pages/calculator.js'), 'utf8');
const drawingsPage = fs.readFileSync(path.join(ROOT, 'client/js/pages/drawings.js'), 'utf8');
const profilePage = fs.readFileSync(path.join(ROOT, 'client/js/pages/client-profile.js'), 'utf8');

test('миграция добавляет колонку notes и безопасна при повторном запуске', () => {
  assert.match(migration, /ALTER TABLE drawings ADD COLUMN IF NOT EXISTS notes TEXT/);
});

test('сервер принимает заметку при создании чертежа', () => {
  assert.match(routes, /description, notes, components/);
  assert.match(routes, /file_hash, notes\)/);
  assert.match(routes, /hash, normalizeNotes\(notes\)/);
});

test('сервер сохраняет и умеет стирать заметку при обновлении', () => {
  // COALESCE не позволил бы записать NULL — очистка идёт через CASE WHEN
  assert.match(routes, /notes = CASE WHEN \$9 THEN \$10 ELSE notes END/);
  assert.match(routes, /notes !== undefined, notes !== undefined \? normalizeNotes\(notes\) : null/);
});

test('заметка обрезается и не превращается в документ', () => {
  const fn = routes.match(/function normalizeNotes\(value\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'нет normalizeNotes');
  assert.match(fn[0], /\.trim\(\)/);
  assert.match(fn[0], /slice\(0, 2000\)/);
  assert.match(fn[0], /return null/);
});

test('поиск по чертежам находит по тексту заметки', () => {
  assert.match(routes, /d\.notes ILIKE/);
});

test('калькулятор: поле комментария и подсказка с примером', () => {
  assert.match(calculator, /id="calc-notes"/);
  assert.match(calculator, /Комментарий к расчёту/);
  assert.match(calculator, /снизить цену на 5% при следующем заказе/);
  assert.match(calculator, /maxlength="2000"/);
});

test('калькулятор: заметка подставляется из шаблона и уходит вместе с чертежом', () => {
  assert.match(calculator, /notesInput\.value = drawing\.notes \|\| ''/);
  assert.match(calculator, /notes: document\.getElementById\('calc-notes'\)\?\.value\.trim\(\) \|\| null/);
});

test('заметка видна в каталоге чертежей: таблица, карточки, карточка чертежа', () => {
  assert.match(drawingsPage, /noteLine\(note\)/);
  assert.match(drawingsPage, /drawing-note" title="\$\{esc\(note\)\}"/);
  assert.match(drawingsPage, /this\.noteLine\(d\.notes\)/);
  assert.match(drawingsPage, /drawing-card-note/);
  assert.match(drawingsPage, /📝 \$\{esc\(drawing\.notes\)\}/);
});

test('заметка экранируется — в тексте можно писать что угодно', () => {
  // Везде, где заметка попадает в разметку, рядом стоит esc()
  const uses = [...drawingsPage.matchAll(/esc\((?:d|drawing|note)\.?notes?\)/g)];
  assert.ok(uses.length >= 3, 'esc для заметки не найден');
  assert.match(profilePage, /title="\$\{esc\(d\.notes\)\}">📝 \$\{esc\(d\.notes\)\}/);
});

test('карточка клиента показывает заметку в списке чертежей', () => {
  assert.match(profilePage, /📝 \$\{esc\(d\.notes\)\}/);
});

/* Рендер каталога чертежей: заметка попадает в таблицу и подсказку целиком. */
const vm = require('vm');

function loadDrawingsPage() {
  const clientDir = path.join(ROOT, 'client/js');
  const sandbox = {
    window: {},
    console,
    document: { getElementById: () => null },
    Table: {
      formatMoney: v => `${Number(v).toFixed(2)} ₽`,
      formatMoneyRaw: v => Number(v).toFixed(2),
      loading: () => '',
      emptyState: () => '',
    },
    API: { can: () => true, isAdmin: () => true, get: async () => ({}) },
    Toast: { error: () => {}, success: () => {}, info: () => {} },
    Modal: { open: () => {}, close: () => {} },
    ConfirmDialog: { delete: async () => true },
    App: { navigateTo: () => {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(clientDir, 'components/escape.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(clientDir, 'components/article.js'), 'utf8'), sandbox);
  sandbox.esc = sandbox.window.esc;
  sandbox.safeUrl = sandbox.window.safeUrl;
  sandbox.fullArticle = sandbox.window.fullArticle;
  vm.runInContext(
    fs.readFileSync(path.join(clientDir, 'pages/drawings.js'), 'utf8') + '\n;globalThis.DrawingsPage = DrawingsPage;',
    sandbox
  );
  return sandbox.DrawingsPage;
}

function catalogRow(extra = {}) {
  return {
    id: 1,
    name: 'Фонарь габаритный',
    client_id: 1,
    client_name: 'ООО «ТрансПрицеп»',
    components_count: 0,
    base_cost: 48500,
    total_cost: 48500,
    created_at: '2026-11-20T07:06:46.547Z',
    ...extra,
  };
}

test('таблица каталога: заметка видна и полностью лежит в подсказке', () => {
  const page = loadDrawingsPage();
  const container = { innerHTML: '' };
  const note = 'снизить цену на 5% при следующем заказе';

  page.renderTable([catalogRow({ notes: note })], container);

  assert.match(container.innerHTML, /📝 снизить цену на 5% при следующем заказе/);
  assert.match(container.innerHTML, new RegExp(`title="${note}"`));
  // Обе колонки показывают одну сумму — наценки нет
  assert.match(container.innerHTML, /48500\.00 ₽[\s\S]*48500\.00 ₽/);
});

test('таблица каталога: без заметки лишних строк нет', () => {
  const page = loadDrawingsPage();
  const container = { innerHTML: '' };

  page.renderTable([catalogRow()], container);

  assert.doesNotMatch(container.innerHTML, /📝/);
});

test('заметка экранируется при выводе', () => {
  const page = loadDrawingsPage();
  const container = { innerHTML: '' };

  page.renderTable([catalogRow({ notes: '<img src=x onerror=alert(1)>' })], container);

  assert.doesNotMatch(container.innerHTML, /<img src=x/);
  assert.match(container.innerHTML, /&lt;img/);
});

test('в каталоге видно, что цена задана без BOM', () => {
  const page = loadDrawingsPage();
  const container = { innerHTML: '' };

  page.renderTable([catalogRow({ fixed_without_bom: true })], container);
  assert.match(container.innerHTML, />без BOM<\/span>/);

  const withoutFlag = { innerHTML: '' };
  page.renderTable([catalogRow()], withoutFlag);
  assert.doesNotMatch(withoutFlag.innerHTML, />без BOM<\/span>/);
});

test('карточка клиента: фикс-цена без BOM показывает сумму, а не «—»', () => {
  // hasCalc раньше смотрел только на fixed_price самого чертежа,
  // а фикс-цена без BOM живёт на связи клиента (client_fixed_price)
  assert.match(profilePage, /d\.fixed_price \|\| d\.client_fixed_price/);
  assert.match(profilePage, /d\.fixed_without_bom \? '<div><span class="badge"/);
});
