/* Клиентский API: методы HTTP и удаление заявки.
 *
 * Поводом стал «API.delete is not a function» на кнопке «Удалить» в заявке:
 * в объекте API был только `del`, а страница вызывала `delete`. Тест держит
 * оба имени и проверяет, что удаление действительно уходит методом DELETE,
 * а не падает где-то между кнопкой и сервером.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../..');
const apiSource = fs.readFileSync(path.join(root, 'client/js/api.js'), 'utf8');
const leadsSource = fs.readFileSync(path.join(root, 'client/js/pages/leads.js'), 'utf8');

/** Загрузить API в песочницу с подставным fetch и localStorage. */
function loadApi(handler) {
  const calls = [];
  const storage = new Map();
  const sandbox = {
    console,
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    fetch: async (url, config) => {
      calls.push({ url, method: config.method, body: config.body });
      return handler(url, config);
    },
    window: {},
    FormData: class {},
    JSON,
  };
  sandbox.window.App = {};
  vm.createContext(sandbox);
  vm.runInContext(`${apiSource}\n;globalThis.__API = API;`, sandbox, { filename: 'api.js' });
  return { api: sandbox.__API, calls };
}

test('API: delete и del одинаково удаляют и шлют DELETE', async () => {
  for (const method of ['delete', 'del']) {
    const { api, calls } = loadApi(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));
    assert.equal(typeof api[method], 'function', `API.${method} — функция`);
    await api[method]('/leads/7');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'DELETE');
    assert.equal(calls[0].url, '/api/leads/7');
  }
});

test('API: ошибку удаления сервер отдаёт текстом, а клиент — исключением', async () => {
  const { api } = loadApi(async () => ({
    ok: false,
    status: 404,
    json: async () => ({ error: 'Заявка не найдена' }),
  }));
  await assert.rejects(() => api.delete('/leads/999'), /Заявка не найдена/);
});

test('заявки: кнопка «Удалить» вызывает существующий метод API', () => {
  // «Удалить» в карточке зовёт LeadsPage.remove, а тот — API.delete
  assert.match(leadsSource, /onclick="LeadsPage\.remove\(\$\{lead\.id\}\)"/,
    'в карточке есть кнопка удаления');
  assert.match(leadsSource, /async remove\(id\)[\s\S]*?API\.delete\(`\/leads\/\$\{id\}`\)/,
    'удаление идёт через API.delete');
});
