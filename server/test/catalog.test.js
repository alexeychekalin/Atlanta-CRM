const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readConfig, placeImage, expandArticles, CATALOG_JSON, FILES_DIR } =
  require('../src/db/catalog');
const { fullArticle } = require('../src/utils/article');

test('артикул: код модификации приклеивается через дефис', () => {
  assert.equal(fullArticle('А.3776.001', '01'), 'А.3776.001-01');
  assert.equal(fullArticle('А.3776.001', '02.02'), 'А.3776.001-02.02');
  assert.equal(fullArticle('А.3776.001.1-Б', '01'), 'А.3776.001.1-Б-01');
  assert.equal(fullArticle('А.3776.001.1-БЖ', '02.02'), 'А.3776.001.1-БЖ-02.02');

  // комплект — готовый артикул, кода нет
  assert.equal(fullArticle('А.3776.005Л-01/А.3731.007', null), 'А.3776.005Л-01/А.3731.007');
  // базы нет — возвращаем код как есть, чтобы не получить «-01»
  assert.equal(fullArticle('', '01'), '01');
  assert.equal(fullArticle(null, null), '');
});

test('каталог: файл данных есть и корректно разбирается', () => {
  assert.ok(fs.existsSync(CATALOG_JSON), 'нет src/db/catalog/catalog.json');

  const { categories, components } = readConfig();
  assert.ok(categories.length > 0, 'нет категорий');
  assert.ok(components.length > 0, 'нет позиций каталога');

  const keys = new Set(categories.map(c => c.key));
  for (const entry of components) {
    assert.ok(entry.article, 'позиция без артикула');
    assert.ok(entry.name, `${entry.article}: без названия`);
    assert.ok(keys.has(entry.category), `${entry.article}: неизвестная категория «${entry.category}»`);
    assert.ok(Number.isInteger(entry.source_page), `${entry.article}: не указана страница каталога`);
    assert.ok(entry.description && entry.description.length > 20, `${entry.article}: пустое описание`);
  }
});

test('каталог: артикулы уникальны, коды модификаций не повторяются', () => {
  const { components } = readConfig();

  const articles = components.map(c => c.article);
  const duplicates = articles.filter((a, i) => articles.indexOf(a) !== i);
  assert.deepEqual(duplicates, [], 'в каталоге повторяются артикулы');

  for (const entry of components) {
    const codes = (entry.modifications || []).map(m => m.code.toLowerCase());
    assert.equal(new Set(codes).size, codes.length, `${entry.article}: повторяются коды модификаций`);

    // код не должен дублировать базу: полный артикул собирается в одном месте
    for (const code of codes) {
      const full = fullArticle(entry.article, code);
      assert.ok(full.startsWith(entry.article + '-'), `${entry.article}: код ${code} даёт ${full}`);
    }
  }
});

test('каталог: полные артикулы совпадают с печатными в каталоге', () => {
  const { components } = readConfig();
  const byArticle = new Map(components.map(c => [c.article, c]));

  // А.3776.001 (01) и (02.02) → А.3776.001-01 и А.3776.001-02.02
  assert.deepEqual(
    expandArticles(byArticle.get('А.3776.001')),
    ['А.3776.001', 'А.3776.001-01', 'А.3776.001-02.02']
  );

  // цвет рассеивателя остаётся в базе
  assert.deepEqual(
    expandArticles(byArticle.get('А.3776.001.1-Б')),
    ['А.3776.001.1-Б', 'А.3776.001.1-Б-01', 'А.3776.001.1-Б-02.02']
  );

  // комплект — один артикул со слэшем, без модификаций
  const set = byArticle.get('А.3776.005Л-01/А.3731.007');
  assert.ok(set, 'нет комплекта А.3776.005Л-01/А.3731.007');
  assert.deepEqual(set.modifications, []);
  assert.equal(fullArticle(set.article, undefined), 'А.3776.005Л-01/А.3731.007');
});

test('каталог: фото лежат в репозитории и открываются браузером', () => {
  const { components } = readConfig();
  const signatures = {
    jpg: Buffer.from([0xff, 0xd8, 0xff]),
    jpeg: Buffer.from([0xff, 0xd8, 0xff]),
    png: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    webp: Buffer.from('RIFF'),
  };

  for (const entry of components) {
    if (!entry.image) continue;
    const file = path.join(FILES_DIR, entry.image);
    assert.ok(fs.existsSync(file), `${entry.article}: нет файла ${entry.image}`);

    const ext = path.extname(entry.image).slice(1).toLowerCase();
    const signature = signatures[ext];
    assert.ok(signature, `${entry.article}: неподдерживаемый формат ${ext}`);

    const head = fs.readFileSync(file).subarray(0, signature.length);
    assert.ok(head.equals(signature), `${entry.article}: ${entry.image} не похож на ${ext.toUpperCase()}`);
  }
});

test('каталог: фото копируется под стабильным именем и не дублируется', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'atlanta-catalog-'));
  const { components } = readConfig();
  const entry = components.find(c => c.image);

  const first = placeImage(entry.image, target);
  const second = placeImage(entry.image, target);

  assert.equal(first.url, second.url, 'имя файла должно зависеть от содержимого');
  assert.match(first.url, /^\/uploads\/images\/catalog_[0-9a-f]{16}\.(jpg|jpeg|png|webp)$/);
  assert.equal(first.size, fs.statSync(path.join(FILES_DIR, entry.image)).size);
  assert.deepEqual(fs.readdirSync(target), [path.basename(first.url)]);

  fs.rmSync(target, { recursive: true, force: true });
});
