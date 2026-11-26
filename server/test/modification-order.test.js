const test = require('node:test');
const assert = require('node:assert');

const { usageColumn, usageOrder, usageExpr } = require('../src/services/modification-order');
const { readConfig } = require('../src/db/catalog');

/**
 * Порядок исполнений: ходовые — выше.
 *
 * Частоту не держим счётчиком, а считаем по фактическому применению — в чертежах
 * клиентов и изделиях изготовителя. Здесь проверяем сам SQL-заказ и данные
 * каталога, по которым он применяется.
 */

test('порядок исполнений: частота идёт первой, ручной sort_order — вторая', () => {
  const order = usageOrder('cm');

  // Частота должна стоять раньше sort_order: иначе импортированный подряд
  // sort_order (0, 1, 2, …) перекрыл бы её целиком.
  const usage = order.indexOf('drawing_components');
  const manual = order.indexOf('cm.sort_order');
  assert.ok(usage > -1, 'в сортировке нет применения в чертежах');
  assert.ok(manual > -1, 'в сортировке нет ручного порядка');
  assert.ok(usage < manual, 'частота применения должна идти первой');
  assert.ok(order.endsWith('cm.code'), 'при равной частоте список должен быть устойчивым');
  assert.ok(/DESC/.test(order), 'чаще применяемые — выше');
});

test('порядок исполнений: считаются и чертежи, и изделия', () => {
  const expr = usageExpr('cm');

  assert.ok(/drawing_components dc/.test(expr), 'нет применения в чертежах');
  assert.ok(/manufacturer_product_components mpc/.test(expr), 'нет применения в изделиях');
  assert.ok(/COALESCE\(SUM/.test(expr), 'без применения агрегат должен давать 0, а не NULL');
  // подзапросы привязаны к конкретному исполнению и меняются вместе с алиасом
  assert.equal((expr.match(/cm\.id/g) || []).length, 2, 'оба подзапроса про одно исполнение');
  assert.ok(!/cm\.id/.test(usageExpr('m2')), 'алиас таблицы должен подставляться');
});

test('порядок исполнений: колонка usage_count отдаётся тем же выражением', () => {
  assert.equal(usageColumn('cm'), `${usageExpr('cm')} AS usage_count`);
});

test('каталог: у А.3731.010 исполнения заведены по чертежу и идут его порядком', () => {
  const byArticle = new Map(readConfig().components.map(c => [c.article, c]));

  for (const article of ['А.3731.010-01', 'А.3731.010-02', 'А.3731.010-03']) {
    const comp = byArticle.get(article);
    assert.ok(comp, `${article}: нет позиции`);

    // 69 исполнений чертежа: 8 длин без разъёма + 2 на корпусе + 2 по 200 мм
    // + 1 с двумя проводами + 16 А.3723.001 + 12 А.3723.002 + 14 А.3723.006
    // + 14 А.3723.007 = 69. У боковой стороны сверх чертежа 4 варианта кронштейна.
    const fromDrawing = comp.modifications.filter(m => !/-[ОТ]$/.test(m.code));
    assert.equal(fromDrawing.length, 69, `${article}: исполнений по чертежу`);

    // порядок строки таблицы чертежа: сначала провода 50 и 500 мм (с кронштейном
    // и без), затем — по мере усложнения подключения
    const side = article.split('-')[1];
    assert.deepEqual(
      comp.modifications.slice(0, 4).map(m => m.code),
      [`${side}.01`, `${side}.02`, `${side}.03`, `${side}.04`],
      `${article}: первые строки — провода 50 и 500 мм`);

    // sort_order идёт подряд без повторов: при нулевой частоте порядок решает он
    const orders = comp.modifications.map(m => m.sort_order);
    assert.deepEqual(orders, orders.map((_, i) => i), `${article}: sort_order должен идти подряд`);

    // имена исполнений одного вида читаются одинаково
    const wire = comp.modifications.find(m => m.code.endsWith('.03'));
    assert.ok(/провод без разъёма, кабель 500 мм$/.test(wire.name), `${article}: название провода`);
  }
});

test('каталог: у А.3731.010 новые исполнения не потеряли прежние названия', () => {
  const byArticle = new Map(readConfig().components.map(c => [c.article, c]));
  const comp = byArticle.get('А.3731.010-01');

  // прежнее название остаётся в rename_from: импорт заменит его только в базе,
  // где ещё стоит ровно эта строка, и не тронет правку из интерфейса
  const renamed = comp.modifications.filter(m => Array.isArray(m.rename_from));
  assert.equal(renamed.length, 8, 'у передней стороны переименованы все прежние исполнения');
  const three = renamed.find(m => m.code === '01.03');
  assert.deepEqual(three.rename_from,
    ['Передний габарит с отражателем с кронштейном, с кабелем 0,5 м с открытым концом']);

  // артикулы собираются из артикула изделия и кода
  const mod = comp.modifications.find(m => m.code === '01.94');
  assert.equal(mod.full_article, 'А.3731.010-01.94');
});
