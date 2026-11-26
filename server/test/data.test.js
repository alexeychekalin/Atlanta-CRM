const test = require('node:test');
const assert = require('node:assert');

const { resolvePlan } = require('../src/db/data');

test('наполнение: без флагов грузятся и контрагенты, и каталог', () => {
  assert.deepEqual(resolvePlan({}), { preseed: true, catalog: true });
});

test('наполнение: WITH_CATALOG=0 оставляет только контрагентов', () => {
  assert.deepEqual(resolvePlan({ WITH_CATALOG: '0' }), { preseed: true, catalog: false });
});

test('наполнение: WITH_CATALOG=1 включает каталог', () => {
  assert.deepEqual(resolvePlan({ WITH_CATALOG: '1' }), { preseed: true, catalog: true });
});

test('наполнение: SKIP_PRESEED=1 оставляет только каталог', () => {
  assert.deepEqual(resolvePlan({ SKIP_PRESEED: '1' }), { preseed: false, catalog: true });
});

test('наполнение: SKIP_CATALOG=1 отключает каталог', () => {
  assert.deepEqual(resolvePlan({ SKIP_CATALOG: '1' }), { preseed: true, catalog: false });
});

test('наполнение: SKIP_CATALOG сильнее WITH_CATALOG=1', () => {
  assert.deepEqual(
    resolvePlan({ WITH_CATALOG: '1', SKIP_CATALOG: '1' }),
    { preseed: true, catalog: false }
  );
});

test('наполнение: нечисловые значения флага не включают каталог', () => {
  assert.deepEqual(resolvePlan({ WITH_CATALOG: 'true' }), { preseed: true, catalog: false });
});
