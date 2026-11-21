/* Статистика клиента по месяцам: месяц, заказы, суммы, выплаты агенту.
 *
 * Считается в сервисе, поэтому проверяем три слоя: чистые функции месяца,
 * сборку сводки из строк и разметку окна в карточке клиента. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  monthKey,
  normalizeMonth,
  shiftMonth,
  monthLabel,
  recentMonths,
  buildMonthlyStats,
  monthlyStats,
} = require('../src/services/client-stats');

const root = path.join(__dirname, '../..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('месяцы: ключ, проверка ввода и сдвиг через Новый год', () => {
  assert.equal(monthKey(new Date(2026, 10, 18)), '2026-11');
  assert.equal(monthKey(new Date(2026, 0, 1)), '2026-01');

  // Пустое и битое значение превращается в текущий месяц — карточка не падает
  const now = new Date(2026, 10, 18);
  assert.equal(normalizeMonth('', now), '2026-11');
  assert.equal(normalizeMonth('2026-13', now), '2026-11');
  assert.equal(normalizeMonth('мусор', now), '2026-11');
  assert.equal(normalizeMonth('2025-03', now), '2025-03');

  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-05', 0), '2026-05');
  assert.equal(shiftMonth('2026-05', -13), '2025-04');

  assert.equal(monthLabel('2026-11'), 'Ноябрь 2026');
  assert.equal(monthLabel('2026-01', { genitive: true }), 'Января 2026');
  assert.deepEqual(recentMonths('2026-03', 3), ['2026-01', '2026-02', '2026-03']);
});

test('сводка: заказы месяца, сумма, выплаты агенту и средний чек', () => {
  const now = new Date(2026, 10, 18); // ноябрь 2026
  const result = buildMonthlyStats({
    orders: [
      { id: 1, order_number: 'ORD-0001', order_date: '2026-11-02', status: 'paid', total: 100000, subtotal: 100000, commission_amount: 10000, vat_amount: 22000, principal_name: 'ООО «Атланта»' },
      { id: 2, order_number: 'ORD-0002', order_date: '2026-11-20', status: 'in_progress', total: 50000, subtotal: 50000, commission_amount: 5000, vat_amount: 11000, principal_name: 'ГК «СветоТех»' },
      { id: 3, order_number: 'ORD-0003', order_date: '2026-10-30', status: 'completed', total: 30000, subtotal: 30000, commission_amount: 3000, vat_amount: 6600, principal_name: 'ООО «Атланта»' },
    ],
    proposals: [{ month: '2026-11' }, { month: '2026-11' }, { month: '2026-10' }],
    drawings: [{ month: '2026-11' }],
    events: [{ month: '2026-11' }, { month: '2026-09' }],
  }, '2026-11', now);

  assert.equal(result.month, '2026-11');
  assert.equal(result.label, 'Ноябрь 2026');
  assert.equal(result.summary.orders, 2);
  assert.equal(result.summary.total, 150000);
  assert.equal(result.summary.commission, 15000);
  assert.equal(result.summary.vat, 33000);
  assert.equal(result.summary.avg, 75000);
  assert.equal(result.summary.commission_pct, 10);
  assert.equal(result.summary.paid, 1);
  assert.equal(result.summary.in_progress, 1);

  assert.equal(result.extras.proposals, 2);
  assert.equal(result.extras.drawings, 1);
  assert.equal(result.extras.events, 1);

  // В списке только заказы выбранного месяца, свежие сверху
  assert.deepEqual(result.orders.map(o => o.number), ['ORD-0002', 'ORD-0001']);

  // По принципалам — суммы и комиссии внутри месяца
  assert.deepEqual(result.principals.map(p => [p.name, p.orders, p.total, p.commission]), [
    ['ООО «Атланта»', 1, 100000, 10000],
    ['ГК «СветоТех»', 1, 50000, 5000],
  ]);
});

test('сводка: пустой месяц не ломает окно и попадает в список месяцев', () => {
  const now = new Date(2026, 10, 18);
  const result = buildMonthlyStats({
    orders: [{ id: 1, order_number: 'ORD-0001', order_date: '2026-09-05', status: 'paid', total: 1000, subtotal: 1000, commission_amount: 100, vat_amount: 220 }],
  }, '2026-11', now);

  assert.equal(result.summary.orders, 0);
  assert.equal(result.summary.total, 0);
  assert.equal(result.summary.avg, 0);
  assert.equal(result.summary.commission_pct, 0);
  assert.deepEqual(result.orders, []);
  assert.deepEqual(result.principals, []);

  // Текущий месяц есть в списке даже без заказов — чтобы его можно было выбрать
  const months = result.months.map(m => m.month);
  assert.ok(months.includes('2026-11'));
  assert.ok(months.includes('2026-09'));

  // График — 12 месяцев, заканчивая выбранным
  assert.equal(result.chart.length, 12);
  assert.equal(result.chart[result.chart.length - 1].month, '2026-11');
  assert.equal(result.chart.find(c => c.month === '2026-09').total, 1000);
});

test('сводка: месяц по умолчанию — последний с данными, иначе текущий', () => {
  const now = new Date(2026, 10, 18);
  const empty = buildMonthlyStats({ orders: [] }, undefined, now);
  assert.equal(empty.month, '2026-11');
  assert.equal(empty.current_month, '2026-11');

  // В ноябре заказов ещё нет, последний — сентябрь: открываем сентябрь,
  // а не пустой текущий месяц
  const withData = buildMonthlyStats({
    orders: [{ id: 1, order_number: 'ORD-1', order_date: '2026-09-05', status: 'paid', total: 1000 }],
    proposals: [{ month: '2026-11' }],
  }, undefined, now);
  // КП в ноябре есть, но заказов нет — открываем месяц с заказами
  assert.equal(withData.month, '2026-09');
  assert.equal(withData.summary.orders, 1);
});

test('месячная статистика: запросы к БД фильтруют клиента и отдают 404', async () => {
  const queried = [];
  const runner = {
    query: async (sql, params) => {
      queried.push({ sql, params });
      if (/FROM clients/.test(sql)) return { rows: [{ id: 14, name: 'ООО «РУАТ»' }] };
      if (/FROM orders/.test(sql)) {
        return {
          rows: [{
            id: 7, order_number: 'ORD-0007', order_date: '2026-11-05',
            status: 'paid', total: '1200.50', subtotal: '1200.50',
            commission_amount: '120.05', vat_amount: '264.11', principal_name: 'ООО «Атланта»',
          }],
        };
      }
      return { rows: [{ month: '2026-11' }] };
    },
  };

  const result = await monthlyStats(14, '2026-11', runner, new Date(2026, 10, 18));
  assert.equal(result.client.id, 14);
  assert.equal(result.client.name, 'ООО «РУАТ»');
  assert.equal(result.summary.orders, 1);
  assert.equal(result.summary.total, 1200.5);
  assert.equal(result.summary.commission, 120.05);

  // Все запросы — только по этому клиенту
  assert.equal(queried.length, 5);
  for (const item of queried) assert.deepEqual(item.params, [14]);

  const missing = {
    query: async () => ({ rows: [] }),
  };
  await assert.rejects(() => monthlyStats(999, '2026-11', missing), /Клиент не найден/);
});

test('месячная статистика: маршрут объявлен и не перехватывается старым /stats', () => {
  const routes = read('server/src/routes/client-documents.js');
  const monthlyIndex = routes.indexOf("router.get('/stats/monthly'");
  const statsIndex = routes.indexOf("router.get('/stats'");

  assert.ok(monthlyIndex > 0, 'нет маршрута /stats/monthly');
  assert.ok(statsIndex > 0, 'пропал старый /stats');
  // Старый маршрут точечный и не может съесть /stats/monthly
  assert.match(routes, /router\.get\('\/stats', auth/);
  assert.match(routes, /monthlyStats\(req\.params\.id, req\.query\.month\)/);
});

/* === Разметка окна в карточке клиента === */

function loadClientProfile() {
  const elements = {};
  const sandbox = {
    window: {},
    console,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: {
      getElementById: (id) => {
        if (!(id in elements)) {
          if (['content-area', 'profile-tab-content', 'avatar-upload-input'].includes(id)) {
            elements[id] = { innerHTML: '', textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} };
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
      formatDate: v => String(v).split('-').reverse().join('.'),
      statusBadge: s => `<span class="badge badge-${s}">${s}</span>`,
      loading: () => '',
      emptyState: () => '',
    },
    API: { can: () => true, isAdmin: () => false, get: async () => ({}) },
    Toast: { error: () => {}, success: () => {}, info: () => {} },
    Modal: { open: () => {}, close: () => {} },
    ConfirmDialog: { delete: async () => true },
    App: { navigateTo: () => {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(read('client/js/components/escape.js'), sandbox);
  sandbox.esc = sandbox.window.esc;
  sandbox.safeUrl = sandbox.window.safeUrl;
  vm.runInContext(
    read('client/js/pages/client-profile.js') + '\n;globalThis.ClientProfilePage = ClientProfilePage;',
    sandbox
  );
  return { page: sandbox.ClientProfilePage, sandbox };
}

function sampleStats() {
  return {
    client: { id: 14, name: 'ООО «РУАТ»' },
    month: '2026-11',
    label: 'Ноябрь 2026',
    current_month: '2026-11',
    summary: {
      orders: 2, total: 150000, subtotal: 150000, commission: 15000, vat: 33000,
      avg: 75000, commission_pct: 10, new: 0, in_progress: 1, paid: 1, completed: 0, cancelled: 0,
    },
    extras: { proposals: 2, drawings: 1, events: 3 },
    principals: [
      { name: 'ООО «Атланта»', orders: 1, total: 100000, commission: 10000 },
      { name: 'ГК «СветоТех»', orders: 1, total: 50000, commission: 5000 },
    ],
    orders: [
      { id: 2, number: 'ORD-0002', date: '2026-11-20', status: 'in_progress', total: 50000, commission: 5000 },
      { id: 1, number: 'ORD-0001', date: '2026-11-02', status: 'paid', total: 100000, commission: 10000 },
    ],
    months: [
      { month: '2026-11', label: 'Ноябрь 2026', orders: 2, total: 150000, commission: 15000 },
      { month: '2026-10', label: 'Октябрь 2026', orders: 0, total: 0, commission: 0 },
    ],
    chart: [
      { month: '2026-10', label: 'Октябрь 2026', short: 'окт', orders: 0, total: 0 },
      { month: '2026-11', label: 'Ноябрь 2026', short: 'ноя', orders: 2, total: 150000 },
    ],
  };
}

test('окно: месяц, заказы, сумма и выплаты агенту на месте', () => {
  const { page } = loadClientProfile();
  const html = page._monthStatsBody(sampleStats());

  // Выбор месяца и стрелки
  assert.match(html, /class="form-control mstats-select"/);
  assert.match(html, /<option value="2026-11" selected>Ноябрь 2026<\/option>/);
  assert.match(html, /changeMonth\(-1\)/);
  assert.match(html, /changeMonth\(1\)/);

  // Четыре карточки: заказы, сумма, выплаты агенту, средний чек
  assert.match(html, /<div class="mstats-card__value">2<\/div>\s*<div class="mstats-card__label">заказа<\/div>/);
  assert.match(html, /150000\.00 ₽<\/div>\s*<div class="mstats-card__label">Сумма заказов/);
  assert.match(html, /15000\.00 ₽<\/div>\s*<div class="mstats-card__label">Выплаты агенту/);
  assert.match(html, /75000\.00 ₽<\/div>\s*<div class="mstats-card__label">Средний чек/);
  assert.match(html, /10\.0% от суммы/);

  // Разбивка по принципалам и таблица заказов месяца
  assert.match(html, /По принципалам/);
  assert.match(html, /ООО «Атланта»/);
  assert.match(html, /ORD-0002/);
  assert.match(html, /ORD-0001/);
  assert.match(html, /badge badge-paid/);
  assert.match(html, /За месяц также: 2 КП · 1 чертёж · 3 события/);

  // Столбики графика: клик переключает месяц
  assert.match(html, /ClientProfilePage\.setMonthStats\('2026-10'\)/);
  assert.match(html, /mstats-bar is-active[^>]*onclick="ClientProfilePage\.setMonthStats\('2026-11'\)"/);
});

test('окно: пустой месяц показывает нули и подсказку вместо таблицы', () => {
  const { page } = loadClientProfile();
  const stats = sampleStats();
  stats.summary = { orders: 0, total: 0, subtotal: 0, commission: 0, vat: 0, avg: 0, commission_pct: 0 };
  stats.orders = [];
  stats.principals = [];
  stats.extras = { proposals: 0, drawings: 0, events: 0 };

  const html = page._monthStatsBody(stats);
  assert.match(html, /Заказов за месяц нет/);
  assert.match(html, /За этот месяц заказов нет/);
  assert.doesNotMatch(html, /По принципалам/);
  assert.doesNotMatch(html, /За месяц также/);
  // Нули не превращаются в пустоту или «undefined»
  assert.doesNotMatch(html, /undefined/);
});

test('окно: кнопка в строке показателей открывает статистику', async () => {
  const { page, sandbox } = loadClientProfile();
  let requested = null;
  let opened = null;
  sandbox.API.get = async (url) => {
    requested = url;
    return sampleStats();
  };
  sandbox.Modal.open = (options) => { opened = options; };
  page.clientId = 14;

  await page.openMonthStats();

  assert.equal(requested, '/clients/14/documents/stats/monthly');
  assert.equal(opened.title, 'Статистика по месяцам');
  assert.match(opened.body, /id="month-stats-body"/);
  assert.match(opened.footer, /Modal\.close\(\)/);
});

test('окно: смена месяца и стрелки запрашивают нужный месяц', async () => {
  const { page, sandbox } = loadClientProfile();
  const requested = [];
  sandbox.API.get = async (url) => { requested.push(url); return sampleStats(); };
  page.clientId = 14;
  page._monthStats = { month: '2026-01' };

  // Стрелка назад через границу года
  page.changeMonth(-1);
  await new Promise(resolve => setTimeout(resolve, 10));

  // В тестовой песочнице нет самого окна — проверяем вычисленный месяц
  assert.deepEqual(page._lastMonthRequest, '2025-12');
});
