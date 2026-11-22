const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { parseItems } = require('../src/routes/leads-shared');
const { telegramText, mailText, autoReplyText, adminRecipients } = require('../src/services/lead-notify');
const telegram = require('../src/services/telegram');
const mail = require('../src/services/mail');

const LEAD = {
  id: 7,
  name: 'Иван Петров',
  phone: '+7 900 123-45-67',
  email: 'ivan@example.ru',
  company: 'ООО «Ромашка»',
  message: 'Нужен габаритный фонарь на прицеп, 5-контактный разъём',
  page: '/catalog/gabaritnye-fonari/',
};

const ITEMS = [
  { article: 'А.3731.006', name: 'Фонарь габаритный', quantity: 5 },
  { article: 'А.3776.001', name: 'Жгут', quantity: 1 },
];

// --- разбор заявки ---------------------------------------------------------

test('заявки: позиции разбираются из массива и из JSON-строки', () => {
  const fromArray = parseItems({ items: ITEMS });
  assert.deepEqual(fromArray.map(item => item.article), ['А.3731.006', 'А.3776.001']);
  assert.equal(fromArray[0].quantity, 5);

  // multipart-форма присылает items строкой
  const fromString = parseItems({ items: JSON.stringify(ITEMS) });
  assert.equal(fromString.length, 2);
  assert.equal(fromString[1].name, 'Жгут');
});

test('заявки: старый формат с одним артикулом продолжает работать', () => {
  const items = parseItems({ article: 'А.3731.010' });
  assert.deepEqual(items, [{ article: 'А.3731.010', name: '', quantity: 1 }]);
});

test('заявки: мусор в позициях не ломает приём', () => {
  assert.deepEqual(parseItems({}), []);
  assert.deepEqual(parseItems({ items: 'не json' }), []);
  assert.deepEqual(parseItems({ items: [{}, { article: '' }] }), []);

  // количество приводим к разумному: 0 → 1, 100000 → 9999
  const items = parseItems({ items: [{ article: 'A', quantity: 0 }, { article: 'B', quantity: 100000 }] });
  assert.equal(items[0].quantity, 1);
  assert.equal(items[1].quantity, 9999);

  // длинный список обрезаем, чтобы одна заявка не положила сервер
  const many = Array.from({ length: 150 }, (_, i) => ({ article: `A${i}` }));
  assert.equal(parseItems({ items: many }).length, 100);
});

// --- текст уведомлений -----------------------------------------------------

test('заявки: в Telegram уходит имя, телефон, позиции и экранирование', () => {
  const text = telegramText({ lead: LEAD, items: ITEMS, files: [{}] });

  assert.match(text, /Заявка с сайта №7/);
  assert.match(text, /Иван Петров/);
  assert.match(text, /\+7 900 123-45-67/);
  assert.match(text, /А\.3731\.006 — Фонарь габаритный × 5/);
  assert.match(text, /Жгут/);           // количество 1 не печатаем
  assert.ok(!/Жгут × 1/.test(text));
  assert.match(text, /Файлов: 1/);

  // < и & в тексте клиента не должны ломать HTML-разметку Telegram
  const dangerous = telegramText({
    lead: { ...LEAD, name: '<b>Взлом</b> & Ко', message: 'a < b & c > d' },
    items: [],
  });
  assert.ok(dangerous.includes('&lt;b&gt;Взлом&lt;/b&gt; &amp; Ко'));
  assert.ok(!dangerous.includes('<b>Взлом</b>'));
});

test('заявки: письмо администратору — текст, без разметки', () => {
  const text = mailText({ lead: LEAD, items: ITEMS, files: [] });
  assert.match(text, /Заявка с сайта №7/);
  assert.match(text, /Телефон: \+7 900 123-45-67/);
  assert.match(text, /А\.3731\.006 — Фонарь габаритный × 5/);
  assert.ok(!text.includes('<b>'), 'в письме не должно быть HTML');
});

test('заявки: автоответ клиенту содержит номер заявки и телефон', () => {
  const text = autoReplyText(LEAD);
  assert.match(text, /Иван Петров, здравствуйте!/);
  assert.match(text, /заявка №7/);
  assert.match(text, /\+7 985 964-11-23/);
  assert.match(text, /Пн–Пт, 9:00–18:00/);
});

// --- Telegram --------------------------------------------------------------

test('telegram: без токена уведомления выключены, но не падают', async () => {
  const saved = { token: process.env.TELEGRAM_BOT_TOKEN, chats: process.env.TELEGRAM_CHAT_IDS };
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_IDS;
  try {
    assert.equal(telegram.isConfigured(), false);
    assert.match(telegram.describeConfig(), /выключены/);
    const result = await telegram.sendToAll('текст');
    assert.equal(result.ok, false);
    assert.equal(result.disabled, true);
  } finally {
    if (saved.token !== undefined) process.env.TELEGRAM_BOT_TOKEN = saved.token;
    if (saved.chats !== undefined) process.env.TELEGRAM_CHAT_IDS = saved.chats;
  }
});

test('telegram: получатели разбираются из списка через запятую', () => {
  const saved = process.env.TELEGRAM_CHAT_IDS;
  try {
    process.env.TELEGRAM_CHAT_IDS = ' -1001234567890, 123456789 ,,';
    assert.deepEqual(telegram.chatIds(), ['-1001234567890', '123456789']);
    process.env.TELEGRAM_CHAT_IDS = '';
    assert.deepEqual(telegram.chatIds(), []);
  } finally {
    if (saved === undefined) delete process.env.TELEGRAM_CHAT_IDS;
    else process.env.TELEGRAM_CHAT_IDS = saved;
  }
});

test('telegram: один недоступный чат не мешает остальным', async () => {
  const saved = { token: process.env.TELEGRAM_BOT_TOKEN, base: process.env.TELEGRAM_API_BASE, fetch: global.fetch };
  process.env.TELEGRAM_BOT_TOKEN = '123:test';
  process.env.TELEGRAM_API_BASE = 'https://telegram.test';
  const calls = [];
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body.chat_id);
    // личка работает, группа «заблокировала» бота
    if (body.chat_id === '-100') {
      return { ok: false, status: 403, json: async () => ({ ok: false, description: 'bot was blocked by the user' }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  try {
    const result = await telegram.sendToAll('текст', { chatIds: ['-100', '555'] });
    assert.equal(result.sent, 1);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].chatId, '-100');
    assert.match(result.failed[0].error, /blocked/);
    assert.equal(result.ok, true, 'хотя бы один получатель — уже успех');
    assert.deepEqual(calls, ['-100', '555']);
  } finally {
    global.fetch = saved.fetch;
    if (saved.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = saved.token;
    if (saved.base === undefined) delete process.env.TELEGRAM_API_BASE;
    else process.env.TELEGRAM_API_BASE = saved.base;
  }
});

test('telegram: длинный текст обрезается, а не отклоняется API', () => {
  const long = telegram.trimMessage('я'.repeat(9000));
  assert.ok(long.length <= 3800);
  assert.ok(long.endsWith('…'));
});

// --- почта -----------------------------------------------------------------

test('почта: заголовки с кириллицей кодируются по RFC 2047', () => {
  assert.equal(mail.encodeHeader('Заявка с сайта'), '=?UTF-8?B?0JfQsNGP0LLQutCwINGBINGB0LDQudGC0LA=?=');
  assert.equal(mail.encodeHeader('Lead 7'), 'Lead 7', 'латиница остаётся как есть');

  const message = mail.buildMessage({
    to: ['admin@example.ru'],
    subject: 'Заявка с сайта №7',
    text: 'Имя: Иван',
  });
  assert.match(message, /Subject: =\?UTF-8\?B\?/);
  assert.match(message, /Content-Type: text\/plain; charset=UTF-8/);
  // тело в base64 — кириллица доедет без перекодировок
  const body = message.split('\r\n\r\n')[1].replace(/\r\n/g, '');
  assert.equal(Buffer.from(body, 'base64').toString('utf8'), 'Имя: Иван');
});

test('почта: адрес «Имя <box@example.ru>» разбирается', () => {
  assert.equal(mail.formatAddress('Атланта <sales@example.ru>'), '=?UTF-8?B?0JDRgtC70LDQvdGC0LA=?= <sales@example.ru>');
  assert.equal(mail.formatAddress('sales@example.ru'), 'sales@example.ru');
  assert.equal(mail.extractEmail('Атланта <sales@example.ru>'), 'sales@example.ru');
});

test('почта: без SMTP_HOST отправка выключена, приём заявок не страдает', async () => {
  const saved = process.env.SMTP_HOST;
  delete process.env.SMTP_HOST;
  try {
    assert.equal(mail.isConfigured(), false);
    const result = await mail.sendMail({ to: ['a@b.ru'], subject: 's', text: 't' });
    assert.equal(result.ok, false);
    assert.equal(result.skipped, true);
  } finally {
    if (saved !== undefined) process.env.SMTP_HOST = saved;
  }
});

test('почта: получатели заявок — из LEAD_EMAIL_TO', () => {
  const saved = process.env.LEAD_EMAIL_TO;
  try {
    process.env.LEAD_EMAIL_TO = 'a@example.ru, b@example.ru';
    assert.deepEqual(adminRecipients(), ['a@example.ru', 'b@example.ru']);
    delete process.env.LEAD_EMAIL_TO;
    assert.deepEqual(adminRecipients(), []);
  } finally {
    if (saved === undefined) delete process.env.LEAD_EMAIL_TO;
    else process.env.LEAD_EMAIL_TO = saved;
  }
});

// --- связка с CRM ----------------------------------------------------------

test('заявки: публичный приёмник без авторизации, раздел — с правами', () => {
  const index = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
  assert.match(index, /app\.use\('\/api\/public\/leads', require\('\.\/routes\/public-leads'\)\)/,
    'публичный приёмник должен быть отдельным роутером');
  assert.match(index, /app\.use\('\/api\/leads', require\('\.\/routes\/leads'\)\)/);

  const router = fs.readFileSync(path.join(__dirname, '../src/routes/leads.js'), 'utf8');
  assert.match(router, /requirePermission\('leads', 'view'\)/);
  assert.match(router, /requirePermission\('leads', 'edit'\)/);
  assert.match(router, /requirePermission\('leads', 'delete'\)/);

  // в публичном роутере не должно быть проверок прав: там посетитель сайта
  const publicRouter = fs.readFileSync(path.join(__dirname, '../src/routes/public-leads.js'), 'utf8');
  assert.ok(!publicRouter.includes('requirePermission'), 'публичный приёмник не может требовать прав');
  assert.match(publicRouter, /rateLimit/, 'публичная форма обязана иметь лимит запросов');
  assert.match(publicRouter, /company/, 'нужна ловушка для ботов');
});

test('заявки: раздел есть в меню, роутинге и правах ролей', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../client/js/app.js'), 'utf8');
  assert.match(app, /leads: \{ title: 'Заявки с сайта'/, 'нет страницы заявок в роутере');
  assert.match(app, /refreshLeadsBadge/, 'нет счётчика новых заявок');

  const html = fs.readFileSync(path.join(__dirname, '../../client/index.html'), 'utf8');
  assert.match(html, /data-page="leads"/, 'нет пункта меню «Заявки»');
  assert.match(html, /js\/pages\/leads\.js/, 'страница заявок не подключена');

  const roles = fs.readFileSync(path.join(__dirname, '../src/db/migrate_roles.js'), 'utf8');
  assert.ok((roles.match(/leads: \{/g) || []).length >= 5, 'права на заявки нужны всем ролям');
  assert.match(roles, /leads: \{ view: true, edit: true, delete: false \}/, 'менеджер обрабатывает заявки');
  assert.match(roles, /leads: \{ view: false, edit: false, delete: false \}/, 'гостю заявки закрыты');
});

test('заявки: таблицы создаются и на существующей базе', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../src/db/migration_leads.sql'), 'utf8');
  for (const table of ['leads', 'lead_items', 'lead_files', 'lead_notifications']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`),
      `нет таблицы ${table} в миграции`);
  }
  const schema = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
  for (const table of ['leads', 'lead_items', 'lead_files', 'lead_notifications']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`),
      `нет таблицы ${table} в schema.sql`);
  }
});

test('заявки: форма сайта шлёт файлы и позиции на приёмник', () => {
  const siteJs = fs.readFileSync(path.join(__dirname, '../../site/static/js/site.js'), 'utf8');
  assert.match(siteJs, /new FormData\(\)/, 'файлы нельзя отправить JSON-ом');
  assert.match(siteJs, /append\('items'/, 'позиции заявки должны уходить на сервер');
  assert.match(siteJs, /append\('files'/);
  assert.match(siteJs, /atlanta_request_items/, 'корзина должна переживать переход по страницам');

  const build = fs.readFileSync(path.join(__dirname, '../../site/build.py'), 'utf8');
  assert.match(build, /data-add-to-request/, 'на карточке товара нужна кнопка «В заявку»');
  assert.match(build, /name="files"/, 'в форме нужно поле файлов');
  assert.match(build, /data-basket-count/, 'в шапке нужен счётчик заявки');
});

test('заявки: инструкция по боту и почте есть в README и .env.example', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../../README.md'), 'utf8');
  assert.match(readme, /Заявки с сайта: подключить Telegram и почту/, 'нет пошаговой инструкции');
  assert.match(readme, /getUpdates/, 'как узнать chat_id — самый частый вопрос');
  assert.match(readme, /CORS_ORIGINS/, 'сайт и CRM на разных доменах — нужен CORS');

  const env = fs.readFileSync(path.join(__dirname, '../../.env.example'), 'utf8');
  for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_IDS', 'SMTP_HOST', 'LEAD_EMAIL_TO']) {
    assert.match(env, new RegExp(`# ${key}=`), `нет ${key} в .env.example`);
  }
});

test('заявки: при старте в логе видно, работают ли уведомления', () => {
  const index = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
  assert.match(index, /describeConfig\(\)/, 'Telegram: состояние при старте');
  assert.match(index, /SMTP настроен|выключена/, 'почта: состояние при старте');
});
