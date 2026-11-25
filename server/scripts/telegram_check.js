/* Проверка Telegram-уведомлений о заявках.

   Отвечает на вопрос «вписал токен и chat_id, а заявки в Telegram не приходят»
   без ожидания новой заявки с сайта:

     1. токен и chat_id разобраны из server/.env (те же, что видит сервер);
     2. getMe — токен живой, показывает имя бота;
     3. getChat по каждому получателю — бот вообще видит этот чат
        (частая ошибка: chat_id взят до добавления бота в группу);
     4. пробное sendMessage — проверяет права на отправку.

   Запуск:  cd server && npm run telegram:check
            npm run telegram:check -- --send  (без --send сообщения не шлём)

   Ничего не пишет в базу; токен в вывод не попадает.
*/
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const telegram = require('../src/services/telegram');

const API_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
const TIMEOUT_MS = Number(process.env.TELEGRAM_TIMEOUT_MS) || 8000;
const send = process.argv.includes('--send');

async function call(token, method, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  } catch (err) {
    return { status: 0, data: { ok: false, description: err.name === 'AbortError' ? 'таймаут' : err.message } };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const problems = telegram.configProblems();
  const token = telegram.botToken();
  const ids = telegram.chatIds();

  console.log('Настройки Telegram');
  console.log(`  токен:    ${token ? `${token.slice(0, 6)}…${token.slice(-4)} (${token.length} символов)` : 'не задан'}`);
  console.log(`  chat_ids: ${ids.length ? ids.join(', ') : 'не заданы'}`);
  console.log(`  источник: ${require('path').join(__dirname, '../.env')}`);
  console.log('');

  if (problems.length > 0) {
    console.log('❌ Настройки не готовы:');
    for (const problem of problems) console.log(`   • ${problem}`);
    console.log('');
    console.log('Где взять значения:');
    console.log('   token    — @BotFather → /mybots → API Token');
    console.log('   chat_id  — у группы: добавьте бота в группу, отправьте сообщение,');
    console.log('              затем https://api.telegram.org/bot<ТОКЕН>/getUpdates');
    console.log('              (личный чат — просто число, супергруппа — с -100)');
    console.log('После правки server/.env: sudo systemctl restart atlanta-crm');
    return 1;
  }

  // 1. Токен живой?
  const me = await call(token, 'getMe');
  if (!me.data.ok) {
    console.log(`❌ Токен не принят Telegram: ${telegram.explainError(me.data.description, '', me.status)}`);
    return 1;
  }
  console.log(`✓ Бот: @${me.data.result.username} (${me.data.result.first_name})`);

  let failures = 0;
  for (const chatId of ids) {
    const chat = await call(token, 'getChat', { chat_id: chatId });
    if (!chat.data.ok) {
      failures += 1;
      console.log(`✗ ${chatId}: ${telegram.explainError(chat.data.description, chatId, chat.status)}`);
      continue;
    }
    const found = chat.data.result;
    const title = found.title || [found.first_name, found.last_name].filter(Boolean).join(' ')
      || found.username || 'без названия';
    console.log(`✓ ${chatId}: «${title}» (${found.type})`);

    if (send) {
      const sent = await telegram.sendMessage(chatId, '✅ Проверка уведомлений CRM «Атланта» — заявки с сайта будут приходить сюда.');
      if (sent.ok) console.log(`   ✓ пробное сообщение отправлено`);
      else {
        failures += 1;
        console.log(`   ✗ пробное сообщение не ушло: ${sent.error}`);
      }
    }
  }

  console.log('');
  if (failures > 0) {
    console.log(`❌ Проблемы у ${failures} получател${failures === 1 ? 'я' : 'ей'} — см. строки выше.`);
    return 1;
  }
  console.log(send
    ? '✅ Всё готово: бот видит чаты и может в них писать.'
    : '✅ Токен и чаты в порядке. Отправку проверьте флагом --send.');
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    console.error('Ошибка проверки:', err.message);
    process.exitCode = 1;
  });
