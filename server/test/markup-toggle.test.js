/* Наценка клиента в КП и заказах: её можно отключить — на весь документ
   или на отдельную позицию. В поле «Цена» менеджер видит итог для клиента,
   а базовая цена хранится отдельно, чтобы наценку можно было вернуть.

   Проверяем три слоя: миграция и схема, расчёт на сервере, разметка строки. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const clientDir = path.join(root, 'client/js');
const dbDir = path.join(root, 'server/src/db');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

/** Песочница с минимальными заглушками — как в client-render.test.js. */
function loadMarkupMath() {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(read('client/js/components/markup.js'), sandbox);
  return sandbox.window.MarkupMath;
}

function loadPage(file, objectName, sandbox) {
  const context = sandbox || {
    window: {},
    console,
    document: { getElementById: () => null, querySelectorAll: () => [] },
    Table: {
      formatMoney: v => `${Number(v).toFixed(2)} ₽`,
      formatMoneyRaw: v => Number(v).toFixed(2),
      loading: () => '',
      emptyState: () => '',
    },
    Toast: { error: () => {}, success: () => {}, info: () => {} },
    Modal: { open: () => {}, close: () => {} },
    ConfirmDialog: { delete: async () => true },
    API: { can: () => true, isAdmin: () => true, get: async () => ({}), post: async () => ({}), put: async () => ({}) },
    App: { navigateTo: () => {} },
  };
  vm.createContext(context);
  for (const helper of ['components/escape.js', 'components/article.js', 'components/markup.js']) {
    vm.runInContext(fs.readFileSync(path.join(clientDir, helper), 'utf8'), context);
  }
  context.esc = context.window.esc;
  context.safeUrl = context.window.safeUrl;
  context.fullArticle = context.window.fullArticle;
  context.MarkupMath = context.window.MarkupMath;
  vm.runInContext(
    fs.readFileSync(path.join(clientDir, `pages/${file}.js`), 'utf8')
      + `\n;globalThis.${objectName} = ${objectName};`,
    context
  );
  return { page: context[objectName], sandbox: context };
}

test('наценка: миграция добавляет флаг в позиции КП и заказа', () => {
  const file = path.join(dbDir, 'migration_no_level_markup.sql');
  assert.ok(fs.existsSync(file), 'нет migration_no_level_markup.sql');
  const sql = fs.readFileSync(file, 'utf8');

  assert.match(sql, /ALTER TABLE proposal_items ADD COLUMN IF NOT EXISTS no_level_markup BOOLEAN NOT NULL DEFAULT false/);
  assert.match(sql, /ALTER TABLE order_items\s+ADD COLUMN IF NOT EXISTS no_level_markup BOOLEAN NOT NULL DEFAULT false/);

  // Свежая база собирается из schema.sql — поле должно быть и там
  const schema = fs.readFileSync(path.join(dbDir, 'schema.sql'), 'utf8');
  const orderItems = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS order_items'));
  assert.match(orderItems.slice(0, 1200), /no_level_markup BOOLEAN NOT NULL DEFAULT false/);
  const proposalItems = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS proposal_items'));
  assert.match(proposalItems.slice(0, 700), /no_level_markup BOOLEAN NOT NULL DEFAULT false/);
});

test('наценка: маршруты КП и заказов сохраняют и переносят флаг', () => {
  const proposals = read('server/src/routes/proposals.js');
  const orders = read('server/src/routes/orders.js');

  // обе вставки в proposal_items и обе в order_items
  assert.ok((proposals.match(/no_level_markup/g) || []).length >= 3);
  assert.ok((orders.match(/no_level_markup/g) || []).length >= 3);
  // при переводе КП в заказ флаг не теряется
  assert.match(proposals, /item\.no_level_markup \|\| false/);
  // значения позиции передаются во все вставки
  assert.match(proposals, /item\.level_markup_pct, item\.no_level_markup\]/);
  assert.match(orders, /item\.level_markup_pct, item\.no_level_markup/);
});

test('наценка: цена на экране — итоговая, базовая считается обратно', () => {
  const math = loadMarkupMath();

  // клиент «Крупный опт +15%», позиция 1000 ₽ без ручной наценки
  assert.equal(math.toFinal(1000, 15, 0, false), 1150);
  assert.equal(math.toFinal(1000, 15, 0, true), 1000);
  assert.equal(math.toFinal(1000, 15, 10, false), 1265); // 1000 * 1.15 * 1.1
  assert.equal(math.levelAmount(1000, 15, false), 150);

  // менеджер ввёл 1234,56 ₽ — базовая подбирается так, чтобы итог совпал
  const base = math.toBase(1234.56, 15, 0, false);
  assert.equal(base, 1073.53);
  assert.equal(math.toFinal(base, 15, 0, false), 1234.56);

  // при отключённой наценке итог равен базовой
  assert.equal(math.toBase(1000, 15, 0, true), 1000);
});

test('наценка: в строке КП видна итоговая цена и тумблер наценки', () => {
  const { page } = loadPage('proposals', 'ProposalsPage');
  page.clients = [{ id: 1, name: 'ООО «РУАТ»', pricing_markup_pct: 15, pricing_level_name: 'Крупный опт' }];

  const html = page._renderItemCard(
    { product_name: 'БАЗА', article: 'А.3731.001', base_price: 1000, unit_price: 1150, quantity: 2 },
    0,
    15
  );
  // В поле цены — итог, а не базовая
  assert.match(html, /class="form-control prop-item-price" value="1150"/);
  assert.match(html, /class="prop-item-base-price" value="1000"/);
  assert.match(html, /class="markup-toggle is-on"[^>]*>\+15%</);
  assert.match(html, /class="prop-item-no-level" value=""/);

  const off = page._renderItemCard(
    { product_name: 'БАЗА', base_price: 1000, unit_price: 1000, no_level_markup: true },
    1,
    15
  );
  assert.match(off, /class="form-control prop-item-price" value="1000"/);
  assert.match(off, /class="markup-toggle is-off"[^>]*>без</);
  assert.match(off, /class="prop-item-no-level" value="1"/);

  // чертёж: цена уже итоговая, тумблер неактивен
  const drawing = page._renderItemCard({ product_name: 'Чертёж', unit_price: 5000, is_drawing: true }, 2, 15);
  assert.match(drawing, /class="form-control prop-item-price" value="5000"/);
  assert.match(drawing, /class="markup-toggle is-disabled"/);
});

test('наценка: в строке заказа то же поведение', () => {
  const { page } = loadPage('orders', 'OrdersPage');

  const html = page._renderItemCard(
    { product_name: 'БАЗА', article: 'А.3731.001', base_price: 1000, unit_price: 1150, quantity: 1 },
    0,
    15
  );
  assert.match(html, /class="form-control item-price" value="1150"/);
  assert.match(html, /class="item-base-price" value="1000"/);
  assert.match(html, /class="markup-toggle is-on"[^>]*>\+15%</);
  assert.match(html, /class="item-no-level" value=""/);

  const off = page._renderItemCard({ product_name: 'БАЗА', base_price: 2000, no_level_markup: true }, 1, 15);
  assert.match(off, /class="form-control item-price" value="2000"/);
  assert.match(off, /class="markup-toggle is-off"/);
});

test('наценка: оба документа умеют отключать наценку на всё и на строку', () => {
  for (const [file, page] of [['proposals', 'ProposalsPage'], ['orders', 'OrdersPage']]) {
    const source = read(`client/js/pages/${file}.js`);
    assert.match(source, /toggleLevelMarkup\(checked\)/, `${file}: нет общего переключателя`);
    assert.match(source, /toggleRowMarkup\(button\)/, `${file}: нет переключателя на позицию`);
    assert.match(source, /_syncDocMarkup\(/, `${file}: общий переключатель не согласуется со строками`);
    assert.match(source, /no_level_markup: noLevelMarkup/, `${file}: флаг не уходит на сервер`);

    const { page: loaded } = loadPage(file, page);
    assert.equal(typeof loaded.toggleLevelMarkup, 'function');
    assert.equal(typeof loaded.toggleRowMarkup, 'function');
  }
});
