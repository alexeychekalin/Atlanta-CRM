const test = require('node:test');
const assert = require('node:assert');

const { adoptSplitFamilies } = require('../src/db/side-families');

/**
 * Поддельная БД: отвечает по шаблону запроса и записывает всё, что сделали.
 * Проверяем сценарий, ради которого шаг и написан, — в базе уже были цены,
 * фото и правки прежнего изделия, а импорт создал новые изделия по сторонам.
 */
function fakeRunner() {
  const statements = [];
  let oldModsTaken = false;
  const runner = {
    query: async (sql, params = []) => {
      statements.push({ sql, params });
      const text = sql.replace(/\s+/g, ' ').trim();

      if (/FROM components WHERE article = \$1 LIMIT 1/.test(text)) {
        return { rows: [{ id: 1, article: 'А.3731.010', price: 1500, image_path: '/uploads/images/old.jpg' }] };
      }
      if (/FROM components WHERE article = ANY/.test(text)) {
        return { rows: [
          { id: 11, article: 'А.3731.010-01', price: 0, image_path: null },
          { id: 12, article: 'А.3731.010-02', price: 0, image_path: '/uploads/images/two.jpg' },
        ] };
      }
      if (/FROM component_modifications WHERE component_id = \$1 ORDER BY/.test(text)) {
        if (params[0] === 1 && !oldModsTaken) {
          oldModsTaken = true;   // в базе строки прежнего изделия удаляются по ходу
          return { rows: [
            { id: 101, code: '01.09', name: 'Передний', price_override: 210, description: '' },
            { id: 102, code: '01.10', name: 'Передний без кронштейна', price_override: null, description: 'из интерфейса' },
          ] };
        }
        return { rows: [] };
      }
      if (/SELECT component_id, lower\(code\) AS code FROM component_modifications/.test(text)) {
        // у сторон уже есть свои исполнения — по ним и определяется сторона
        return { rows: [
          { component_id: 11, code: '01.09' },
          { component_id: 11, code: '01.10' },
          { component_id: 12, code: '02.09' },
        ] };
      }
      if (/FROM component_modifications WHERE component_id = \$1 AND lower\(code\)/.test(text)) {
        // у нового изделия уже есть исполнение 01.09 (его создал импорт), 01.10 — нет
        if (params[1] === '01.09') {
          return { rows: [{ id: 201, name: 'Передний', price_override: null, description: null }] };
        }
        return { rows: [] };
      }
      if (/^INSERT INTO component_modification_images/.test(text)) return { rows: [], rowCount: 1 };
      if (/^INSERT INTO component_images/.test(text)) return { rows: [], rowCount: 2 };
      if (/^INSERT INTO component_documents/.test(text)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
  return { runner, statements };
}

test('разделение по стороне: исполнения, цены, фото и документы переезжают на новые изделия', async () => {
  const { runner, statements } = fakeRunner();
  const families = [{ article: 'А.3731.010', children: ['А.3731.010-01', 'А.3731.010-02'] }];

  const report = await adoptSplitFamilies(runner, families);
  assert.equal(report.families, 1);
  // 01.09 у нового изделия уже есть — слили (1), 01.10 перенесли строкой (1)
  assert.equal(report.merged, 1);
  assert.equal(report.moved, 1);
  assert.ok(report.warnings.some(text => /цена 1500/.test(text)),
    'цена семейства скопирована — об этом должно быть предупреждение');

  const sqlOf = s => s.sql.replace(/\s+/g, ' ').trim();
  const reparented = statements.find(s => /UPDATE component_modifications SET component_id = \$2 WHERE id = \$1/.test(sqlOf(s)));
  assert.deepEqual(reparented.params, [102, 11], 'исполнение без пары переносится строкой на сторону');

  const merged = statements.find(s => /SET price_override = COALESCE\(price_override, \$2\)/.test(sqlOf(s)));
  assert.deepEqual(merged.params, [201, 210, ''],
    'цена исполнения из прежнего изделия переносится на новое');

  // ссылки из чертежей и продукции переводим на новое исполнение, прежнюю строку удаляем
  const refs = statements.filter(s => /^UPDATE (drawing_components|manufacturer_product_components) SET modification_id/.test(sqlOf(s)));
  assert.deepEqual(refs.map(s => s.params), [[201, 101], [201, 101]]);
  assert.ok(statements.some(s => /DELETE FROM component_modifications WHERE id = \$1/.test(sqlOf(s))
    && s.params[0] === 101), 'прежняя строка исполнения удаляется');

  // цена изделия копируется на сторону, где она не задана, и не затирает заданную
  const prices = statements.filter(s => /UPDATE components SET price = CASE WHEN price = 0/.test(sqlOf(s)));
  assert.deepEqual(prices.map(s => s.params), [
    [11, 1500, '/uploads/images/old.jpg'],
    [12, 1500, '/uploads/images/old.jpg'],
  ]);
  assert.ok(statements.some(s => /DELETE FROM component_images WHERE component_id = \$1/.test(sqlOf(s))
    && s.params[0] === 1), 'фото прежнего изделия не остаются дублем');
  assert.ok(statements.some(s => /DELETE FROM component_documents WHERE component_id = \$1/.test(sqlOf(s))
    && s.params[0] === 1), 'документы прежнего изделия не остаются дублем');
});

test('разделение по стороне: повторный прогон и чистая база ничего не делают', async () => {
  // прежнего изделия нет — импорт уже отработал
  const empty = { query: async () => ({ rows: [], rowCount: 0 }) };
  assert.deepEqual(await adoptSplitFamilies(empty,
    [{ article: 'А.3731.010', children: ['А.3731.010-01'] }]),
  { families: 0, moved: 0, merged: 0, images: 0, documents: 0, warnings: [] });

  // нет семейств — нет запросов вообще
  let calls = 0;
  const counter = { query: async () => { calls += 1; return { rows: [] }; } };
  await adoptSplitFamilies(counter, []);
  assert.equal(calls, 0);
});

test('разделение по стороне: без исполнений цена и документы всё равно переезжают', async () => {
  // у прежнего изделия нет ни одного исполнения (завели только карточку):
  // сопоставлять нечего, но цена и документы теряться не должны
  const statements = [];
  const runner = {
    query: async (sql, params = []) => {
      statements.push({ sql, params });
      const text = sql.replace(/\s+/g, ' ').trim();
      if (/FROM components WHERE article = \$1 LIMIT 1/.test(text)) {
        return { rows: [{ id: 1, article: 'А.3731.014', price: 980, image_path: '/uploads/images/a.jpg' }] };
      }
      if (/FROM components WHERE article = ANY/.test(text)) {
        return { rows: [{ id: 31, article: 'А.3731.014-01', price: 0, image_path: null }] };
      }
      if (/^INSERT INTO component_documents/.test(text)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };

  const report = await adoptSplitFamilies(runner,
    [{ article: 'А.3731.014', children: ['А.3731.014-01'] }]);
  assert.equal(report.families, 1);
  assert.equal(report.documents, 1, 'документ должен переехать');
  assert.ok(statements.some(s => /UPDATE components SET price = CASE WHEN price = 0/.test(
    s.sql.replace(/\s+/g, ' '))), 'цена изделия должна переехать');
});

test('каталог: семейства по стороне описаны в catalog.json', () => {
  const { readConfig } = require('../src/db/catalog');
  const { components, families } = readConfig();
  const byArticle = new Map(components.map(c => [c.article, c]));

  assert.equal(families.length, 14, 'семейств, разделённых по стороне');

  const children = components.filter(c => c.split_from);
  assert.equal(children.length, 37, 'новых изделий по стороне');

  const total = components.reduce((sum, c) => sum + (c.modifications || []).length, 0);
  assert.equal(total, 1003, 'число исполнений не изменилось');

  for (const family of families) {
    assert.ok(family.article && family.name, 'у семейства нет артикула или названия');
    assert.ok(family.children.length >= 2, `${family.article}: меньше двух сторон`);
    for (const article of family.children) {
      const child = byArticle.get(article);
      assert.ok(child, `${article}: нет изделия стороны`);
      assert.ok(child.split_from === family.article, `${article}: не помечено семейством`);
      assert.ok(['front', 'rear', 'side'].includes(child.side), `${article}: неизвестная сторона`);
      assert.ok(child.images && child.images.length > 0, `${article}: нет фото`);
      assert.equal(child.images[0], child.image, `${article}: обложка должна быть первой в галерее`);
      // исполнения стороны — только её: код начинается с кода стороны
      assert.ok(child.modifications.length > 0, `${article}: нет исполнений`);
    }
  }

  // карта миграции: код исполнения → сторона. По ней из прежнего изделия
  // раскладываются цены, правки и ссылки, поэтому она должна совпадать с самими
  // исполнениями сторон, а коды — не повторяться
  for (const family of families) {
    const codes = family.codes || {};
    assert.deepEqual(Object.keys(codes).sort(), [...family.children].sort(),
      `${family.article}: в codes не тот набор сторон`);
    const seen = new Map();
    for (const article of family.children) {
      const child = byArticle.get(article);
      const own = child.modifications.map(mod => String(mod.code).toLowerCase()).sort();
      assert.deepEqual((codes[article] || []).map(code => String(code).toLowerCase()).sort(), own,
        `${article}: codes не совпадают с исполнениями стороны`);
      for (const code of own) {
        assert.ok(!seen.has(code),
          `${family.article}: код ${code} есть и у ${seen.get(code)}, и у ${article}`);
        seen.set(code, article);
      }
    }
  }

  // прежние артикулы семейств не остались отдельными позициями
  for (const family of families) {
    assert.ok(!byArticle.has(family.article), `${family.article}: остался отдельной позицией`);
  }

  // Л/П и подключение не делим: .006 и .007 не тронуты
  for (const article of ['А.3731.006', 'А.3731.007', 'А.3731.002.1', 'А.3731.005']) {
    assert.ok(byArticle.has(article), `${article}: не должен был делиться`);
    assert.ok(!byArticle.get(article).split_from, `${article}: разделён по ошибке`);
  }
});

test('каталог: у А.3731.018 стороны — печатные -21 и -23, база осталась исполнением', () => {
  const { readConfig } = require('../src/db/catalog');
  const byArticle = new Map(readConfig().components.map(c => [c.article, c]));

  const front = byArticle.get('А.3731.018-21');
  const side = byArticle.get('А.3731.018-23');
  assert.ok(front && side, 'нет сторон А.3731.018');
  assert.equal(front.modifications.length, 6, 'передних исполнений');
  assert.equal(side.modifications.length, 8, 'боковых исполнений');

  // базовый вариант стороны остаётся строкой: его артикул — печатный
  assert.equal(front.modifications[0].full_article, 'А.3731.018-21');
  assert.equal(side.modifications[0].full_article, 'А.3731.018-23');
  // серия с кабелем относится к своей стороне
  assert.ok(front.modifications.some(m => m.full_article === 'А.3731.018-41.03'));
  assert.ok(side.modifications.some(m => m.full_article === 'А.3731.018-43.03-О'));
  assert.ok(!front.modifications.some(m => /-43\./.test(m.full_article || '')));
});
