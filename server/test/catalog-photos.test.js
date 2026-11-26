/**
 * Фото каталога и правки в карточке позиции.
 *
 * Главный сценарий, ради которого всё это сделано: менеджер убирает снимок в
 * карточке, а следующее обновление (update.sh → src/db/data.js → импорт
 * каталога) прикладывает его заново. Здесь проверяется, что импорт уважает
 * удаление и не воскрешает убранные снимки, а вернуть фото можно только руками.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const catalog = require('../src/db/catalog');
const { coverSync, photosRemoved } = require('../src/services/component-photos');

/** Фейковая БД: держит таблицы в памяти и отвечает по шаблону запроса. */
function memoryDb({ existing = true, cover = '/u/a.jpg', removed = false } = {}) {
  const state = {
    component: { id: 1, article: 'А.1', image_path: cover },
    gallery: removed ? [] : [{ id: 11, image_path: '/u/a.jpg', sort_order: 0 }],
    removedPaths: removed ? ['/u/a.jpg'] : [],
    inserted: [],
  };

  const query = async (sql, params = []) => {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (/FROM components WHERE article = \$1 LIMIT 1/.test(text)) {
      return { rows: existing ? [state.component] : [] };
    }
    if (/FROM component_images WHERE component_id = \$1 AND image_path = \$2 LIMIT 1/.test(text)) {
      const [, imagePath] = params;
      if (state.removedPaths.includes(imagePath)) return { rows: [{ id: 1 }] };
      if (state.gallery.some(row => row.image_path === imagePath)) return { rows: [{ id: 1 }] };
      return { rows: [] };
    }
    if (/FROM component_images WHERE component_id = \$1 AND deleted_at IS NOT NULL LIMIT 1/.test(text)) {
      return { rows: state.removedPaths.length ? [{ id: 1 }] : [] };
    }
    if (/FROM component_images WHERE component_id = \$1 AND deleted_at IS NULL ORDER BY/.test(text)) {
      return { rows: state.gallery.map(row => ({ image_path: row.image_path })) };
    }
    if (/FROM component_images WHERE component_id = \$1 AND image_path = \$2 AND deleted_at IS NULL LIMIT 1/.test(text)) {
      const [, imagePath] = params;
      return { rows: state.gallery.some(row => row.image_path === imagePath) ? [{ id: 1 }] : [] };
    }
    if (/^INSERT INTO component_images/.test(text)) {
      state.inserted.push(params[1]);
      state.gallery.push({ id: 100 + state.inserted.length, image_path: params[1], sort_order: params[2] });
      return { rows: [], rowCount: 1 };
    }
    if (/^UPDATE components SET image_path = \$2 WHERE id = \$1/.test(text)) {
      state.component.image_path = params[1];
      return { rows: [], rowCount: 1 };
    }
    if (/^UPDATE components SET image_path = \$2 WHERE id = \$1 AND image_path IS NULL/.test(text)) {
      if (state.component.image_path === null) state.component.image_path = params[1];
      return { rows: [], rowCount: 1 };
    }
    if (/^UPDATE components SET image_path = \$2 WHERE id = \$1$/.test(text)) {
      state.component.image_path = params[1];
      return { rows: [], rowCount: 1 };
    }
    if (/FROM components WHERE id = \$1$/.test(text)) {
      return { rows: [{ image_path: state.component.image_path }] };
    }
    if (/count\(\*\)::int AS n FROM component_images/.test(text)) {
      return { rows: [{ n: state.removedPaths.length }] };
    }
    return { rows: [], rowCount: 0 };
  };

  return { db: { query }, state };
}

/**
 * Настоящий placeImage: файлы каталога уже разложены в uploads/images под
 * именем-хэшем, поэтому вызов ничего не копирует и тест не мусорит.
 */
function urlOf(fileName) {
  return catalog.placeImage(fileName).url;
}

/** Первая позиция каталога, у которой есть галерея. */
function sampleEntry() {
  return catalog.readConfig().components.find(entry => (entry.images || []).length > 0);
}

test('фото: убранный снимок импорт не возвращает', async () => {
  const entry = sampleEntry();
  const image = urlOf(entry.images[0]);
  const { db, state } = memoryDb({ removed: true, cover: null });
  state.removedPaths = [image];

  await catalog.syncComponentImages(db, 1, { images: [entry.images[0]] }, null, 'refresh');

  assert.ok(!state.inserted.includes(image), 'убранный снимок не вернулся');
  assert.equal(state.component.image_path, null,
    'обложка не берётся: живой галереи нет, а импорт её не создаёт');
});

test('фото: если позиция уже была, обложка из каталога не подставляется', async () => {
  const entry = sampleEntry();
  const image = urlOf(entry.images[0]);
  const { db, state } = memoryDb({ removed: true, cover: null });
  state.removedPaths = [image];

  await catalog.fillEmptyFields(db, 1, { image_path: null, description: null, gisp_url: null }, entry, image);

  assert.equal(state.component.image_path, null,
    'пустая обложка при убранных фото — решение менеджера, а не «ещё не заполнили»');
});

test('фото: существующая позиция без явной команды не пополняется', async () => {
  const entry = sampleEntry();
  const { db, state } = memoryDb({ removed: false });
  const created = await catalog.syncComponentImages(db, 1, entry, null, 'existing');
  assert.equal(created, 0);
  assert.deepEqual(state.inserted, [], 'галерею существующей позиции импорт не трогает');
});

test('фото: явный добор добавляет новое, но не трогает убранное', async () => {
  const names = sampleEntry().images.slice(0, 2);
  const [kept, fresh] = names.map(urlOf);
  const { db, state } = memoryDb({ removed: false });
  state.gallery = [{ id: 11, image_path: kept, sort_order: 0 }];

  const created = await catalog.syncComponentImages(db, 1, { images: names }, null, 'refresh');

  assert.equal(created, names.length - 1, 'добавлен только новый снимок');
  assert.deepEqual(state.inserted, [fresh]);
});

test('фото: новая позиция получает галерею и обложку из каталога', async () => {
  const names = sampleEntry().images.slice(0, 2);
  const { db, state } = memoryDb({ existing: false, cover: null, removed: false });
  state.gallery = [];

  const created = await catalog.syncComponentImages(db, 1, { images: names }, null, 'new');

  assert.equal(created, names.length);
  assert.equal(state.component.image_path, state.gallery[0].image_path, 'обложка — первое фото');
});

test('обложка: после удаления последнего фото остаётся пустой и не восстанавливается', async () => {
  const { db, state } = memoryDb({ removed: true, cover: '/u/a.jpg' });
  state.removedPaths = ['/u/a.jpg'];

  const cover = await coverSync(db, 1, { onlyPath: '/u/a.jpg' });
  assert.equal(cover, null, 'обложка снята вместе с фото');
  assert.equal(state.component.image_path, null);
});

test('обложка: когда фото убрали не последним — встаёт первое живое', async () => {
  const { db, state } = memoryDb({ cover: '/u/a.jpg' });
  state.gallery = [{ id: 12, image_path: '/u/b.jpg', sort_order: 1 }];

  const cover = await coverSync(db, 1, { onlyPath: '/u/a.jpg' });
  assert.equal(cover, '/u/b.jpg');
  assert.equal(state.component.image_path, '/u/b.jpg');
});

test('обложка: смена обложки в карточке не сбрасывается', async () => {
  const { db, state } = memoryDb({ cover: '/u/b.jpg' });
  state.gallery = [
    { id: 11, image_path: '/u/a.jpg', sort_order: 0 },
    { id: 12, image_path: '/u/b.jpg', sort_order: 1 },
  ];
  const cover = await coverSync(db, 1, { onlyPath: '/u/a.jpg' });
  assert.equal(cover, '/u/b.jpg', 'выбранная обложка не заменена первым фото');
});

test('убранные фото: счётчик для плашки', async () => {
  const { db, state } = memoryDb({ removed: true });
  state.removedPaths = ['/u/a.jpg', '/u/b.jpg'];
  assert.equal(await photosRemoved(db, 1), 2);
});

test('каталог: новые снимки к существующим позициям не прикладываются при обычном импорте', async () => {
  const { db, state } = memoryDb();
  // импорт делает ещё категории, исполнения и документы — для этого теста
  // достаточно, чтобы они не падали
  const query = async (sql, params = []) => {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (/FROM component_categories WHERE lower\(name\)/.test(text)) return { rows: [{ id: 1 }] };
    if (/FROM component_modifications WHERE component_id = \$1 AND lower\(code\)/.test(text)) return { rows: [] };
    if (/^INSERT INTO component_modifications/.test(text)) return { rows: [{ id: 500 }] };
    if (/^SELECT id FROM component_images/.test(text)) return { rows: [] };
    return db.query(sql, params);
  };

  await catalog.run({ query }, {});
  assert.deepEqual(state.inserted, [], 'обычный импорт фото существующей позиции не трогает');
});

test('каталог: убранные снимки не копируются при разделении по стороне', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/db/side-families.js'), 'utf8');
  assert.match(source, /WHERE i\.component_id = \$2 AND i\.deleted_at IS NULL/);
  assert.match(source, /WHERE i\.modification_id = \$2 AND i\.deleted_at IS NULL/);
});

test('выгрузка на сайт: убранные снимки не уезжают', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/catalog/export_images.js'), 'utf8');
  assert.match(source, /FROM component_images\s+WHERE deleted_at IS NULL/);
  assert.match(source, /WHERE i\.deleted_at IS NULL/);
});

test('миграция: отметка удаления есть в схеме и в миграции', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
  const migration = fs.readFileSync(
    path.join(__dirname, '../src/db/migration_component_photo_state.sql'), 'utf8');

  assert.match(schema, /CREATE TABLE IF NOT EXISTS component_images \([\s\S]*?deleted_at TIMESTAMP/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS component_modification_images \([\s\S]*?deleted_at TIMESTAMP/);
  assert.match(migration, /ALTER TABLE component_images\s+ADD COLUMN IF NOT EXISTS deleted_at/);
  assert.match(migration, /ALTER TABLE component_modification_images\s+ADD COLUMN IF NOT EXISTS deleted_at/);
});

test('добор фото: скрипт показывает список и не меняет данные без --apply', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/catalog_photos.js'), 'utf8');
  assert.match(source, /--apply/);
  assert.match(source, /refreshPhotos: true/);
  // адрес считается по содержимому, файлы при просмотре не копируются
  assert.match(source, /createHash\('sha256'\)/);
  assert.ok(!/placeImage\(/.test(source), 'просмотр списка не должен ничего записывать в uploads');
});

test('update.sh: фото из карточек выгружаются в каталог сайта с --prune', () => {
  const script = fs.readFileSync(path.join(__dirname, '../../update.sh'), 'utf8');
  assert.match(script, /export_images\.js --prune/);
  assert.match(script, /Фото из карточек перенесены в каталог сайта/);
});

test('фото: файлы каталога на месте (проверка самого каталога)', () => {
  // placeImage настоящий — убеждаемся, что любое фото из catalog.json найдётся
  const config = catalog.readConfig();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlanta-cat-'));
  try {
    for (const entry of config.components.slice(0, 15)) {
      for (const file of entry.images || []) {
        const { url } = catalog.placeImage(file, tmp);
        assert.match(url, /^\/uploads\/images\/catalog_[0-9a-f]{16}\.\w+$/);
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('DEPLOY.md: описано, как правки фото переживают обновление', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../../DEPLOY.md'), 'utf8');
  assert.match(doc, /db:catalog-photos/, 'нет команды добора новых снимков');
  assert.match(doc, /db:catalog-photos -- --apply/);
  assert.match(doc, /Убранные фото/, 'не сказано, как вернуть удалённое');
  assert.match(doc, /migration_component_photo_state\.sql/);
});

test('в пакете есть команды добора фото и выгрузки на сайт', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.equal(pkg.scripts['db:catalog-photos'], 'node scripts/catalog_photos.js');
  assert.match(pkg.scripts['db:export-site'], /export_images\.js && node scripts\/catalog\/export_gisp\.js/);
  assert.match(pkg.scripts['demo:export-site'], /dev\/run\.js scripts\/catalog\/export_images\.js/);
});
