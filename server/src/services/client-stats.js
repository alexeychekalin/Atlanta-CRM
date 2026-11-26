/* Месячная статистика клиента для карточки: заказы, суммы, выплаты агенту.
 *
 * Считаем в JS, а из БД берём уже готовые строки: так логика не зависит от
 * диалекта SQL и одинаково работает в PostgreSQL и в PGlite демо-режима.
 * Даты форматируем в SQL в 'YYYY-MM-DD' — иначе драйвер вернёт Date и месяц
 * поедет от часового пояса.
 */

const MONTHS_IN_YEAR = 12;

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** 'YYYY-MM' из даты; часы и минуты не нужны. */
function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

/**
 * Проверяет месяц из запроса. Пустое или битое значение заменяем текущим:
 * карточка должна открываться с осмысленными цифрами, а не с ошибкой.
 */
function normalizeMonth(value, now = new Date()) {
  const raw = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})$/.exec(raw);
  if (match) {
    const month = Number(match[2]);
    if (month >= 1 && month <= MONTHS_IN_YEAR) return `${match[1]}-${pad2(month)}`;
  }
  return monthKey(now);
}

/** Сдвиг месяца на delta: '2026-01' + (-1) → '2025-12'. */
function shiftMonth(month, delta) {
  const [year, mon] = String(month).split('-').map(Number);
  const index = (year * MONTHS_IN_YEAR + (mon - 1)) + Number(delta || 0);
  const nextYear = Math.floor(index / MONTHS_IN_YEAR);
  const nextMonth = (index % MONTHS_IN_YEAR + MONTHS_IN_YEAR) % MONTHS_IN_YEAR + 1;
  return `${nextYear}-${pad2(nextMonth)}`;
}

/** Название месяца для заголовка и выпадающего списка. */
const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

const MONTH_NAMES_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function monthLabel(month, { genitive = false } = {}) {
  const [year, mon] = normalizeMonth(month).split('-').map(Number);
  const names = genitive ? MONTH_NAMES_GENITIVE : MONTH_NAMES;
  const name = names[mon - 1] || '';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

/** Множество последних N месяцев, включая текущий, — для графика и списка. */
function recentMonths(current, count = 12) {
  const months = [];
  for (let i = count - 1; i >= 0; i -= 1) months.push(shiftMonth(current, -i));
  return months;
}

/** Собирает месячную сводку из строк заказов клиента. */
function buildMonthlyStats({ orders = [], proposals = [], drawings = [], events = [] }, month, now = new Date()) {
  const currentMonth = monthKey(now);
  // Явно запрошенный месяц уважаем; если его не передали — открываем последний
  // месяц, где есть данные: иначе карточка показывала бы нули в начале месяца.
  const explicit = /^\d{4}-\d{2}$/.test(String(month || '').trim());
  const keysOf = (rows) => rows
    .map(row => String(row.order_date || row.month || '').slice(0, 7))
    .filter(key => /^\d{4}-\d{2}$/.test(key))
    .sort();
  // Приоритет — последний месяц с заказами: именно их показывают KPI.
  // Если заказов нет вовсе, берём последний месяц с любыми данными.
  const orderMonths = keysOf(orders);
  const anyMonths = keysOf([...orders, ...proposals, ...drawings, ...events]);
  const latest = orderMonths.length > 0
    ? orderMonths[orderMonths.length - 1]
    : (anyMonths.length > 0 ? anyMonths[anyMonths.length - 1] : '');
  const selected = explicit ? normalizeMonth(month, now) : (latest || currentMonth);

  // Заказы по месяцам: сумма, комиссия, число заказов
  const byMonth = new Map();
  const ensure = (key) => {
    if (!byMonth.has(key)) {
      byMonth.set(key, {
        month: key,
        orders: 0,
        total: 0,
        subtotal: 0,
        commission: 0,
        vat: 0,
        paid: 0,
        in_progress: 0,
        new: 0,
        completed: 0,
        cancelled: 0,
      });
    }
    return byMonth.get(key);
  };

  const normalizedOrders = orders.map((row) => ({
    id: row.id,
    number: row.order_number || '',
    date: String(row.order_date || '').slice(0, 10),
    month: String(row.order_date || '').slice(0, 7),
    status: row.status || 'new',
    total: toNumber(row.total),
    subtotal: toNumber(row.subtotal),
    commission: toNumber(row.commission_amount),
    vat: toNumber(row.vat_amount),
    principal: row.principal_name || '',
  }));

  for (const order of normalizedOrders) {
    if (!/^\d{4}-\d{2}$/.test(order.month)) continue;
    const bucket = ensure(order.month);
    bucket.orders += 1;
    bucket.total = round2(bucket.total + order.total);
    bucket.subtotal = round2(bucket.subtotal + order.subtotal);
    bucket.commission = round2(bucket.commission + order.commission);
    bucket.vat = round2(bucket.vat + order.vat);
    if (bucket[order.status] !== undefined) bucket[order.status] += 1;
  }

  // Чертежи, КП и события — по месяцу создания
  const countByMonth = (rows) => {
    const map = new Map();
    for (const row of rows) {
      const key = String(row.month || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(key)) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  };
  const proposalsByMonth = countByMonth(proposals);
  const drawingsByMonth = countByMonth(drawings);
  const eventsByMonth = countByMonth(events);

  const empty = ensure(selected);
  const monthOrders = normalizedOrders
    .filter((order) => order.month === selected)
    .sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1));

  // Разбивка по принципалам внутри выбранного месяца
  const byPrincipal = new Map();
  for (const order of monthOrders) {
    const name = order.principal || 'Без принципала';
    if (!byPrincipal.has(name)) {
      byPrincipal.set(name, { name, orders: 0, total: 0, commission: 0 });
    }
    const row = byPrincipal.get(name);
    row.orders += 1;
    row.total = round2(row.total + order.total);
    row.commission = round2(row.commission + order.commission);
  }

  // Месяцы для списка и графика: всё, где есть хоть какие-то данные,
  // плюс текущий календарный — чтобы «нулевой» месяц тоже можно было увидеть.
  const keys = new Set([...byMonth.keys(), ...proposalsByMonth.keys(), ...drawingsByMonth.keys(), ...eventsByMonth.keys(), currentMonth]);
  const months = [...keys].sort().map((key) => {
    const bucket = byMonth.get(key);
    return {
      month: key,
      label: monthLabel(key),
      orders: bucket ? bucket.orders : 0,
      total: bucket ? bucket.total : 0,
      commission: bucket ? bucket.commission : 0,
      proposals: proposalsByMonth.get(key) || 0,
      drawings: drawingsByMonth.get(key) || 0,
      events: eventsByMonth.get(key) || 0,
    };
  });

  const chart = recentMonths(selected, 12).map((key) => {
    const found = months.find((item) => item.month === key);
    return {
      month: key,
      label: monthLabel(key),
      short: MONTH_NAMES[Number(key.slice(5, 7)) - 1].slice(0, 3),
      orders: found ? found.orders : 0,
      total: found ? found.total : 0,
    };
  });

  return {
    month: selected,
    label: monthLabel(selected),
    current_month: currentMonth,
    summary: {
      orders: empty.orders,
      total: empty.total,
      subtotal: empty.subtotal,
      commission: empty.commission,
      vat: empty.vat,
      avg: empty.orders > 0 ? round2(empty.total / empty.orders) : 0,
      commission_pct: empty.total > 0 ? round2(empty.commission / empty.total * 100) : 0,
      new: empty.new,
      in_progress: empty.in_progress,
      paid: empty.paid,
      completed: empty.completed,
      cancelled: empty.cancelled,
    },
    extras: {
      proposals: proposalsByMonth.get(selected) || 0,
      drawings: drawingsByMonth.get(selected) || 0,
      events: eventsByMonth.get(selected) || 0,
    },
    principals: [...byPrincipal.values()].sort((a, b) => b.total - a.total),
    orders: monthOrders,
    months: months.slice().reverse(),
    chart,
  };
}

/** Загружает строки клиента и собирает сводку за месяц. */
async function monthlyStats(clientId, month, runner, now = new Date()) {
  const database = runner || require('../db');
  const clientRes = await database.query('SELECT id, name FROM clients WHERE id = $1', [clientId]);
  if (clientRes.rows.length === 0) {
    const error = new Error('Клиент не найден');
    error.status = 404;
    throw error;
  }

  const orders = await database.query(
    `SELECT o.id, o.order_number, to_char(o.order_date, 'YYYY-MM-DD') AS order_date,
            o.status, o.total, o.subtotal, o.commission_amount, o.vat_amount,
            p.name AS principal_name
     FROM orders o
     LEFT JOIN principals p ON p.id = o.principal_id
     WHERE o.client_id = $1
     ORDER BY o.order_date DESC, o.id DESC`,
    [clientId]
  );

  const proposals = await database.query(
    `SELECT to_char(created_at, 'YYYY-MM') AS month FROM proposals WHERE client_id = $1`,
    [clientId]
  );

  const drawings = await database.query(
    `SELECT to_char(created_at, 'YYYY-MM') AS month FROM drawings WHERE client_id = $1`,
    [clientId]
  );

  const events = await database.query(
    `SELECT to_char(created_at, 'YYYY-MM') AS month FROM client_timeline WHERE client_id = $1`,
    [clientId]
  );

  const result = buildMonthlyStats({
    orders: orders.rows,
    proposals: proposals.rows,
    drawings: drawings.rows,
    events: events.rows,
  }, month, now);

  result.client = { id: Number(clientId), name: clientRes.rows[0].name || '' };
  return result;
}

module.exports = {
  monthKey,
  normalizeMonth,
  shiftMonth,
  monthLabel,
  recentMonths,
  buildMonthlyStats,
  monthlyStats,
  MONTH_NAMES,
  MONTH_NAMES_GENITIVE,
};
