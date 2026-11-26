/**
 * Отправка почты через SMTP — минимальный клиент без внешних библиотек.
 *
 * Зачем свой, а не nodemailer. Нужны две вещи: письмо администратору о заявке
 * и автоответ клиенту. Это обычный текст на русском, без вложений и вёрстки.
 * Nodemailer тянет дерево зависимостей и обновляется чаще, чем мы выкладываем
 * релизы; протокол SMTP здесь укладывается в одну команду на шаг.
 *
 * Поддерживается то, что реально нужно: EHLO, STARTTLS, AUTH LOGIN/PLAIN,
 * UTF-8 (RFC 2047 у заголовков, base64 в теле). Вложений нет намеренно:
 * фото приходят в CRM, а не почтой — вложение утяжеляет письмо и попадает
 * в спам-фильтры.
 *
 * Настройка в server/.env:
 *   SMTP_HOST=smtp.yandex.ru
 *   SMTP_PORT=465                465 — сразу TLS, 587 — STARTTLS
 *   SMTP_USER=sales@example.ru
 *   SMTP_PASSWORD=…
 *   MAIL_FROM="Атланта <sales@example.ru>"
 *   LEAD_EMAIL_TO=admin@example.ru
 *
 * Пустой SMTP_HOST — почта выключена, заявка всё равно принимается.
 */
const net = require('net');
const tls = require('tls');

const TIMEOUT_MS = Number(process.env.SMTP_TIMEOUT_MS) || 15000;

function isConfigured() {
  return Boolean(String(process.env.SMTP_HOST || '').trim());
}

function fromAddress() {
  return String(process.env.MAIL_FROM || process.env.SMTP_USER || '').trim();
}

/**
 * Заголовок письма в UTF-8: RFC 2047. Без этого «Заявка с сайта» в теме
 * превратится в кракозябры у половины почтовых клиентов.
 */
function encodeHeader(value) {
  const text = String(value || '');
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

/** Адрес в формате «Имя <box@example.ru>» или просто box@example.ru. */
function formatAddress(value) {
  const text = String(value || '').trim();
  const match = /^(.*)<([^>]+)>$/.exec(text);
  if (!match) return text;
  const name = match[1].trim().replace(/^"|"$/g, '');
  return name ? `${encodeHeader(name)} <${match[2].trim()}>` : match[2].trim();
}

function buildMessage({ to, subject, text, replyTo }) {
  const from = formatAddress(fromAddress());
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean).join(', ');
  const headers = [
    `From: ${from}`,
    `To: ${recipients}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  if (replyTo) headers.push(`Reply-To: ${formatAddress(replyTo)}`);

  // тело в base64 по 76 символов: так гарантированно выживают кириллица,
  // длинные строки и точки в начале строки (SMTP считает их концом письма)
  const body = Buffer.from(String(text || ''), 'utf8')
    .toString('base64')
    .replace(/.{1,76}/g, '$&\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}

/**
 * Диалог с SMTP-сервером.
 *
 * Ответ приходит строками «КОД текст». Многострочный ответ отличается тем,
 * что после кода стоит дефис (`250-STARTTLS`), а заканчивается строкой с
 * пробелом (`250 AUTH LOGIN PLAIN`). Собираем строки в буфере, пока не
 * увидим финальную: только тогда отдаём ответ.
 */
function createSession(socket) {
  let buffer = '';
  const queue = [];
  const waiters = [];

  const deliver = response => {
    if (waiters.length > 0) waiters.shift().resolve(response);
    else queue.push(response);
  };

  socket.on('data', chunk => {
    buffer += chunk.toString('utf8');
    let response = null;
    let code = null;
    const lines = [];

    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const raw = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      const match = /^(\d{3})([ -])([\s\S]*)$/.exec(raw);
      if (!match) continue; // служебная строка — пропускаем
      code = Number(match[1]);
      lines.push(raw);
      if (match[2] === ' ') {
        // финальная строка ответа
        response = { code, text: lines.join('\r\n') };
        lines.length = 0;
        deliver(response);
      }
    }
  });

  socket.on('error', err => {
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      // отклоняем ожидающего, чтобы sendViaSocket не висел до таймаута
      if (waiter.reject) waiter.reject(err);
    }
  });

  // Приветствие «220» приходит сразу после подключения — часто раньше, чем
  // createSession успевает подписаться. Копим всё, что пришло до этого.
  if (socket.readableLength > 0) {
    const early = socket.read();
    if (early) socket.emit('data', early);
  }

  return {
    read() {
      if (queue.length > 0) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    write(line) {
      socket.write(`${line}\r\n`);
    },
  };
}

/** Одна сессия: подключиться, поздороваться, отправить письмо, попрощаться. */
function sendViaSocket(socket, message) {
  return new Promise((resolve, reject) => {
    const session = createSession(socket);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('SMTP: таймаут'));
    }, TIMEOUT_MS);

    let step = 0;
    const fail = err => {
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    };

    // шаги SMTP: приветствие → EHLO → AUTH → MAIL FROM → RCPT TO → DATA → .
    const say = async () => {
      try {
        if (step === 0) {
          const greeting = await session.read();
          if (greeting.code !== 220) throw new Error(`SMTP: ${greeting.text.trim()}`);
        } else if (step === 1) {
          session.write('EHLO atlanta-crm');
          const ehlo = await session.read();
          if (ehlo.code !== 250) throw new Error(`SMTP EHLO: ${ehlo.text.trim()}`);
          const hasAuth = /AUTH/i.test(ehlo.text);
          if (process.env.SMTP_USER && hasAuth) {
            session.write('AUTH LOGIN');
            const auth = await session.read();
            if (auth.code !== 334) throw new Error(`SMTP AUTH: ${auth.text.trim()}`);
            session.write(Buffer.from(process.env.SMTP_USER, 'utf8').toString('base64'));
            const user = await session.read();
            if (user.code !== 334) throw new Error(`SMTP логин: ${user.text.trim()}`);
            session.write(Buffer.from(String(process.env.SMTP_PASSWORD || ''), 'utf8').toString('base64'));
            const pass = await session.read();
            if (pass.code !== 235) throw new Error(`SMTP пароль: ${pass.text.trim()}`);
          }
        } else if (step === 2) {
          session.write(`MAIL FROM:<${extractEmail(fromAddress())}>`);
          const from = await session.read();
          if (from.code !== 250) throw new Error(`SMTP отправитель: ${from.text.trim()}`);
        } else if (step === 3) {
          for (const recipient of message.to) {
            session.write(`RCPT TO:<${extractEmail(recipient)}>`);
            const rcpt = await session.read();
            if (rcpt.code !== 250 && rcpt.code !== 251) {
              throw new Error(`SMTP получатель ${recipient}: ${rcpt.text.trim()}`);
            }
          }
        } else if (step === 4) {
          session.write('DATA');
          const data = await session.read();
          if (data.code !== 354) throw new Error(`SMTP DATA: ${data.text.trim()}`);
        } else if (step === 5) {
          // конец данных в SMTP — строка из одной точки. Без неё сервер ждёт
          // продолжения письма и диалог висит до таймаута
          session.write(`${message.body}\r\n.`);
          const end = await session.read();
          if (end.code !== 250) throw new Error(`SMTP отправка: ${end.text.trim()}`);
        } else if (step === 6) {
          session.write('QUIT');
          clearTimeout(timer);
          socket.end();
          resolve({ ok: true });
          return;
        }
        step += 1;
        say();
      } catch (err) {
        fail(err);
      }
    };
    say();
  });
}

function extractEmail(value) {
  const match = /<([^>]+)>/.exec(String(value || ''));
  return (match ? match[1] : String(value || '')).trim();
}

/**
 * Отправить письмо.
 * @returns {Promise<{ ok: boolean, error?: string, skipped?: boolean }>}
 */
async function sendMail({ to, subject, text, replyTo }) {
  if (!isConfigured()) return { ok: false, skipped: true, error: 'SMTP не настроен' };

  const recipients = (Array.isArray(to) ? to : [to]).map(extractEmail).filter(Boolean);
  if (recipients.length === 0) return { ok: false, error: 'не указан получатель' };
  if (!fromAddress()) return { ok: false, error: 'не задан MAIL_FROM/SMTP_USER' };

  const message = { to: recipients, body: buildMessage({ to: recipients, subject, text, replyTo }) };
  const port = Number(process.env.SMTP_PORT) || 587;
  const host = String(process.env.SMTP_HOST).trim();

  // SMTP_SECURITY: auto (по умолчанию) — 465 сразу TLS, остальные STARTTLS;
  // 'none' — открытый канал только для внутреннего relay на 127.0.0.1, где
  // TLS нет вовсе (пароль по такому каналу не отправляем вообще).
  const security = String(process.env.SMTP_SECURITY || 'auto').toLowerCase();

  try {
    if (security === 'none') {
      if (process.env.SMTP_USER) return { ok: false, error: 'SMTP_SECURITY=none несовместим с паролем' };
      const plain = net.connect({ host, port });
      await new Promise((resolve, reject) => {
        plain.once('connect', resolve);
        plain.once('error', reject);
      });
      return await sendViaSocket(plain, message);
    }

    if (port === 465) {
      // 465 — TLS сразу, без STARTTLS
      const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: process.env.SMTP_TLS_INSECURE !== 'true' });
      await new Promise((resolve, reject) => {
        socket.once('secureConnect', resolve);
        socket.once('error', reject);
      });
      return await sendViaSocket(socket, message);
    }

    // 587/25 — сначала открытый канал, потом STARTTLS
    const plain = net.connect({ host, port });
    await new Promise((resolve, reject) => {
      plain.once('connect', resolve);
      plain.once('error', reject);
    });
    const session = createSession(plain);
    const greeting = await session.read();
    if (greeting.code !== 220) throw new Error(`SMTP: ${greeting.text.trim()}`);
    session.write('EHLO atlanta-crm');
    const ehlo = await session.read();
    if (ehlo.code !== 250) throw new Error(`SMTP EHLO: ${ehlo.text.trim()}`);
    if (!/STARTTLS/i.test(ehlo.text)) {
      if (process.env.SMTP_USER) {
        throw new Error('SMTP: сервер не предлагает STARTTLS, а без шифрования пароль отправлять нельзя. '
          + 'Для внутреннего relay задайте SMTP_SECURITY=none и уберите SMTP_USER.');
      }
      return await sendViaSocket(plain, message);
    }
    session.write('STARTTLS');
    const ready = await session.read();
    if (ready.code !== 220) throw new Error(`SMTP STARTTLS: ${ready.text.trim()}`);

    const secure = tls.connect({
      socket: plain,
      servername: host,
      rejectUnauthorized: process.env.SMTP_TLS_INSECURE !== 'true',
    });
    await new Promise((resolve, reject) => {
      secure.once('secureConnect', resolve);
      secure.once('error', reject);
    });
    return await sendViaSocket(secure, message);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { sendMail, isConfigured, buildMessage, encodeHeader, formatAddress, extractEmail };
