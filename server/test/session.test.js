const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  DEFAULT_TTL, parseSessionTtl, ttlToSeconds, cookieMaxAgeMs, renewThresholdSeconds,
} = require('../src/services/session');

test('сессия: срок по умолчанию — 7 суток, а не зашитые 12 часов', () => {
  assert.equal(DEFAULT_TTL, '7d');
  const parsed = parseSessionTtl(undefined);
  assert.equal(parsed.value, '7d');
  assert.equal(parsed.seconds, 7 * 24 * 60 * 60);
  assert.equal(parsed.source, 'default');

  // пустая переменная — это «не задано», а не «ноль»
  assert.equal(parseSessionTtl('').value, '7d');
  assert.equal(parseSessionTtl('   ').value, '7d');
});

test('сессия: срок задаётся часами или строкой вида 12h/7d/30m', () => {
  assert.deepEqual(
    { value: parseSessionTtl('12').value, seconds: parseSessionTtl('12').seconds },
    { value: '12', seconds: 43200 }
  );
  assert.equal(parseSessionTtl('12h').seconds, 43200);
  assert.equal(parseSessionTtl('24h').seconds, 86400);
  assert.equal(parseSessionTtl('7d').seconds, 604800);
  assert.equal(parseSessionTtl('30m').seconds, 1800);
  assert.equal(parseSessionTtl('1w').seconds, 604800);
  assert.equal(parseSessionTtl('12').source, 'env');

  // регистр не важен
  assert.equal(parseSessionTtl('12H').seconds, 43200);
});

test('сессия: опечатка в .env падает с понятным текстом, а не молча', () => {
  for (const bad of ['12 часов', 'сутки', '7 д', 'abc', '-1', '12,5']) {
    assert.throws(() => parseSessionTtl(bad), /SESSION_TTL/, `значение «${bad}» должно быть отвергнуто`);
  }
  assert.throws(() => parseSessionTtl('0'), /больше нуля/);
  assert.throws(() => parseSessionTtl('0h'), /больше нуля/);
});

test('сессия: cookie живёт столько же, сколько токен', () => {
  assert.equal(cookieMaxAgeMs(43200), 12 * 60 * 60 * 1000);
  assert.equal(cookieMaxAgeMs(ttlToSeconds('7d')), 7 * 24 * 60 * 60 * 1000);
});

test('сессия: продление — на половине срока, порог можно переопределить', () => {
  const original = process.env.SESSION_RENEW_AFTER;
  try {
    delete process.env.SESSION_RENEW_AFTER;
    assert.equal(renewThresholdSeconds(ttlToSeconds('12h')), 6 * 60 * 60);
    assert.equal(renewThresholdSeconds(ttlToSeconds('7d')), 3.5 * 24 * 60 * 60);

    process.env.SESSION_RENEW_AFTER = '12h';
    assert.equal(renewThresholdSeconds(ttlToSeconds('7d')), 12 * 60 * 60);

    // порог больше срока бессмысленен — возвращаемся к половине
    process.env.SESSION_RENEW_AFTER = '30d';
    assert.equal(renewThresholdSeconds(ttlToSeconds('7d')), 3.5 * 24 * 60 * 60);
  } finally {
    if (original === undefined) delete process.env.SESSION_RENEW_AFTER;
    else process.env.SESSION_RENEW_AFTER = original;
  }
});

test('сессия: auth.js берёт срок из конфигурации, а не из константы', () => {
  const auth = fs.readFileSync(path.join(__dirname, '../src/routes/auth.js'), 'utf8');
  assert.ok(!/const TOKEN_TTL = '12h'/.test(auth), 'срок не должен быть зашит константой');
  assert.match(auth, /parseSessionTtl\(\)/, 'срок должен читаться из SESSION_TTL');
  assert.match(auth, /needsRenewal\(/, '/auth/me должен продлевать сессию');
  assert.match(auth, /res\.locals\.renewedToken/, 'новый токен надо отдавать клиенту');
});

test('сессия: клиент сохраняет продлённый токен и продлевает по активности', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../client/js/app.js'), 'utf8');
  assert.match(app, /refreshSession\(\)/, 'нужен метод обновления сессии');
  assert.match(app, /user\.token/, 'клиент должен подхватывать новый токен из ответа');
  assert.match(app, /visibilitychange/, 'сессию надо продлевать при возврате во вкладку');
  assert.match(app, /setInterval\([\s\S]{0,200}refreshSession/, 'и раз в час, пока вкладка открыта');

  const api = fs.readFileSync(path.join(__dirname, '../../client/js/api.js'), 'utf8');
  assert.match(api, /setToken\(data\.token\)/, 'вход по-прежнему сохраняет токен');
});

test('сессия: документирована в .env.example и README', () => {
  const env = fs.readFileSync(path.join(__dirname, '../../.env.example'), 'utf8');
  assert.match(env, /SESSION_TTL/, 'нет SESSION_TTL в .env.example');
  assert.match(env, /SESSION_RENEW_AFTER/);

  const readme = fs.readFileSync(path.join(__dirname, '../../README.md'), 'utf8');
  assert.match(readme, /SESSION_TTL/, 'README должен объяснять, как увеличить сессию');
  assert.ok(!/TTL 12 часов/.test(readme), 'старое описание 12-часовой сессии надо обновить');
});
