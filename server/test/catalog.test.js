const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readConfig, placeImage, expandArticles, fillEmptyFields, retireLegacyFlats, assertSchema,
  CATALOG_JSON, FILES_DIR } = require('../src/db/catalog');
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
    // у позиций, заведённых вне печатного каталога (фото и описание от завода),
    // страницы нет — source_page: null
    assert.ok(entry.source_page === null || Number.isInteger(entry.source_page),
      `${entry.article}: не указана страница каталога`);
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

    // полный артикул собирается в одном месте: самим артикулом или полем full_article.
    // У изделия-комплекта артикул печатается через слэш (А.3776.005/А.3731.007),
    // а исполнение встаёт между половинами: А.3776.005Л-01/А.3731.007.
    const [head, tail] = entry.article.split('/');
    for (const mod of entry.modifications || []) {
      const full = fullArticle(entry.article, mod.code, mod.full_article);
      const ok = tail
        ? full.startsWith(head) && full.endsWith(`/${tail}`)
        : full.startsWith(entry.article);
      assert.ok(ok, `${entry.article}: код ${mod.code} даёт ${full}`);
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

  // задние фонари: изделие без Л/П, сторона и число разъёмов — исполнения
  const rear = byArticle.get('А.3776.005');
  assert.deepEqual(rear.modifications.map(m => m.code), ['Л-01', 'Л-05', 'П-01', 'П-05']);
  assert.deepEqual(rear.supersedes, ['А.3776.005Л', 'А.3776.005П']);

  // комплект — отдельное изделие, внутри те же сторона и число разъёмов
  const kit = byArticle.get('А.3776.005/А.3731.007');
  assert.ok(kit, 'нет изделия-комплекта А.3776.005/А.3731.007');
  assert.deepEqual(kit.modifications.map(m => m.code), ['Л-01', 'Л-05', 'П-01', 'П-05']);
  assert.deepEqual(kit.modifications.map(m => m.full_article), [
    'А.3776.005Л-01/А.3731.007', 'А.3776.005Л-05/А.3731.007',
    'А.3776.005П-01/А.3731.007', 'А.3776.005П-05/А.3731.007',
  ]);
  assert.match(kit.name, /Комплект: А\.3776\.005 \+ А\.3731\.007/);
  assert.match(kit.description, /габаритный фонарь А\.3731\.007/);
  assert.ok(kit.images.length > 0, 'у комплекта нет фото');

  // второй комплект — с габаритным фонарём «рожок»
  const socket = byArticle.get('А.3776.005/А.3731.002.3');
  assert.ok(socket, 'нет изделия-комплекта А.3776.005/А.3731.002.3');
  assert.equal(socket.modifications.length, 4);

  // у фонарей 008 и 008.1 комплекты собраны по аналогии с 005:
  // те же «клюшка» и «рожок», свои коды — 01 и 03 разъёма
  for (const light of ['А.3776.008', 'А.3776.008.1']) {
    for (const extra of ['А.3731.007', 'А.3731.002.3']) {
      const kit = byArticle.get(`${light}/${extra}`);
      assert.ok(kit, `нет изделия-комплекта ${light}/${extra}`);
      assert.deepEqual(kit.modifications.map(m => m.code), ['Л-01', 'Л-03', 'П-01', 'П-03'],
        `${light}/${extra}: исполнения`);
      assert.deepEqual(kit.modifications.map(m => m.full_article), [
        `${light}Л-01/${extra}`, `${light}Л-03/${extra}`,
        `${light}П-01/${extra}`, `${light}П-03/${extra}`,
      ]);
      assert.ok(kit.images.length > 0, `${light}/${extra}: нет фото`);
      assert.deepEqual(kit.supersedes, [], `${light}/${extra}: прежних артикулов быть не должно`);
    }
    assert.match(byArticle.get(light).description, /по аналогии с фонарём 005/);
  }

  // прежние плоские артикулы погашены, в том числе старые комплекты
  assert.deepEqual(byArticle.get('А.3776.005Л'), undefined, 'остался прежний артикул А.3776.005Л');
  assert.deepEqual(byArticle.get('А.3776.005Л-01/А.3731.007'), undefined,
    'комплект остался отдельной позицией');
  for (const old of ['А.3776.005Л-01/А.3731.007', 'А.3776.005П-05/А.3731.002.3']) {
    assert.ok(kit.supersedes.includes(old) || socket.supersedes.includes(old),
      `прежний комплект ${old} не в supersedes`);
  }
});

test('каталог: у позиций есть галерея, обложка берётся из неё', () => {
  const { components } = readConfig();
  const gallery = components.filter(entry => (entry.images || []).length > 0);

  assert.ok(gallery.length >= 50, `позиций с галереей: ${gallery.length}`);
  for (const entry of gallery) {
    // у семейства с несколькими исполнениями фото больше, чем у одной позиции
    assert.ok(entry.images.length <= 20, `${entry.article}: больше двадцати фото в галерее`);
    assert.equal(new Set(entry.images).size, entry.images.length,
      `${entry.article}: в галерее повторяются файлы`);
    assert.ok(entry.image, `${entry.article}: нет обложки при непустой галерее`);
    assert.ok(entry.images.includes(entry.image),
      `${entry.article}: обложка ${entry.image} не входит в галерею`);
  }
});

test('каталог: фото лежат в репозитории и открываются браузером', () => {
  const { components } = readConfig();
  const signatures = {
    jpg: Buffer.from([0xff, 0xd8, 0xff]),
    jpeg: Buffer.from([0xff, 0xd8, 0xff]),
    png: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    webp: Buffer.from('RIFF'),
  };

  const images = [];
  for (const entry of components) {
    if (entry.image) images.push([entry.article, entry.image]);
    for (const image of entry.images || []) images.push([entry.article, image]);
    for (const mod of entry.modifications || []) {
      for (const image of mod.images || []) images.push([`${entry.article}-${mod.code}`, image]);
    }
  }

  for (const [article, name] of images) {
    const file = path.join(FILES_DIR, name);
    assert.ok(fs.existsSync(file), `${article}: нет файла ${name}`);

    const ext = path.extname(name).slice(1).toLowerCase();
    const signature = signatures[ext];
    assert.ok(signature, `${article}: неподдерживаемый формат ${ext}`);

    const head = fs.readFileSync(file).subarray(0, signature.length);
    assert.ok(head.equals(signature), `${article}: ${name} не похож на ${ext.toUpperCase()}`);
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

test('каталог: у жгутов базовый артикул семейства, исполнения — модификации', () => {
  const { components } = readConfig();
  const harness = components.filter(c => c.category === 'harness');
  assert.ok(harness.length >= 120, `семейств жгутов: ${harness.length}`);

  let executions = 0;
  for (const entry of harness) {
    // А.3724.304 — семейство, А.3724.304-03.01 — исполнение внутри него
    assert.match(entry.article, /^А\.3724\.(МД-\d{3}\.\d{5}-\d{2}-\d{2}|\d{3})$/,
      `${entry.article}: база семейства должна быть без кода исполнения`);

    for (const mod of entry.modifications) {
      assert.ok(mod.name && mod.name.length > 3,
        `${entry.article}-${mod.code}: пустое описание исполнения`);
    }
    executions += entry.modifications.length;
  }

  assert.ok(executions >= 580, `исполнений жгутов: ${executions}`);
});

test('каталог: прежние плоские артикулы жгутов стали исполнениями', () => {
  const { components } = readConfig();
  const legacy = [
    'А.3724.106-03', 'А.3724.209-03', 'А.3724.217-02', 'А.3724.304-03.01',
    'А.3724.401-04', 'А.3724.401-12.01', 'А.3724.502-02.01', 'А.3724.504-01',
    'А.3724.504-02', 'А.3724.602-02',
  ];

  const texts = [];
  for (const entry of components.filter(c => c.category === 'harness')) {
    texts.push(entry.article);
    for (const mod of entry.modifications) {
      texts.push(fullArticle(entry.article, mod.code));
      texts.push(mod.name);
    }
  }

  for (const article of legacy) {
    assert.ok(texts.some(text => text.includes(article)),
      `${article}: потерян при разбиении на семейства`);
  }
});

test('каталог: изделие с цветными исполнениями — одна позиция, прежние артикулы в supersedes', () => {
  const { components } = readConfig();
  const byArticle = new Map(components.map(c => [c.article, c]));

  // А.3731.027 — изделие, А.3731.027-01/-02/-03 — его исполнения по цвету
  const family = byArticle.get('А.3731.027');
  assert.ok(family, 'нет изделия А.3731.027');
  assert.deepEqual(family.supersedes, ['А.3731.027-01', 'А.3731.027-02', 'А.3731.027-03']);
  assert.equal(family.modifications.length, 78, 'исполнений А.3731.027');
  for (const code of ['01.01', '02.45', '03.85']) {
    assert.ok(family.modifications.some(m => m.code === code), `А.3731.027: нет исполнения ${code}`);
  }

  for (const article of family.supersedes) {
    assert.ok(!byArticle.has(article), `${article}: остался отдельной позицией`);
  }

  // печатный артикул не всегда собирается как «изделие-код»: он в full_article
  const arm = byArticle.get('А.3731.023');
  assert.ok(arm, 'нет изделия А.3731.023');
  const printed = arm.modifications.find(m => m.full_article === 'А.3731.023.3-03.06-150');
  assert.ok(printed, 'А.3731.023.3-03.06-150: исполнение потерялось');
  assert.equal(fullArticle(arm.article, printed.code, printed.full_article), 'А.3731.023.3-03.06-150');
  assert.ok(expandArticles(arm).includes('А.3731.023.3-03.06-150'),
    'поиск по печатному артикулу не находит изделие');

  for (const entry of components) {
    const [head, tail] = entry.article.split('/');
    for (const mod of entry.modifications || []) {
      const full = fullArticle(entry.article, mod.code, mod.full_article);
      assert.ok(full.includes(tail ? head : entry.article), `${entry.article}: ${mod.code} даёт ${full}`);
      if (tail) assert.ok(full.endsWith(`/${tail}`), `${entry.article}: ${mod.code} даёт ${full}`);
    }
  }
});

test('каталог: supersedes гасит прежние плоские артикулы, не трогая изделие', async () => {
  const statements = [];
  const runner = {
    query: async (sql, params) => {
      statements.push({ sql, params });
      if (/SELECT id, article FROM components/.test(sql)) {
        return { rows: [
          { id: 1, article: 'А.3731.027-01' },   // свободен — удаляем
          { id: 2, article: 'А.3731.027-03' },   // стоит в чертеже — выключаем
          { id: 3, article: 'А.3731.027' },      // само изделие — не трогаем
        ] };
      }
      if (/SELECT 1 FROM/.test(sql)) {
        return { rows: params[0] === 2 ? [{ exists: 1 }] : [] };
      }
      return { rows: [], rowCount: 1 };
    },
  };

  const entries = [{
    article: 'А.3731.027',
    supersedes: ['А.3731.027-01', 'А.3731.027-03'],
    modifications: [{ code: '01.01' }],
  }];
  assert.deepEqual(await retireLegacyFlats(runner, entries), { removed: 1, disabled: 1 });

  const deleted = statements.filter(s => /^DELETE FROM components/.test(s.sql)).map(s => s.params[0]);
  const disabled = statements.filter(s => /is_active = false/.test(s.sql)).map(s => s.params[0]);
  assert.deepEqual(deleted, [1]);
  assert.deepEqual(disabled, [2], 'позиция из чертежа остаётся в базе, но выключенной');
  assert.ok(!statements.some(s => s.params && s.params[0] === 3),
    'базовый артикул изделия трогать нельзя');
});

test('каталог: без миграции импорт говорит, что делать, а не падает по позициям', async () => {
  const stale = {
    query: async () => {
      throw new Error('column "full_article" of relation "component_modifications" does not exist');
    },
  };
  await assert.rejects(() => assertSchema(stale), /npm run db:migrate/);

  // схема на месте — проверка молчит
  const fresh = { query: async () => ({ rows: [] }) };
  await assertSchema(fresh);
});

test('каталог: описание расширяется, ручная правка не затирается', async () => {
  const queries = [];
  const runner = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [], rowCount: 1 };
    },
  };

  const base = 'Фонарь габаритный. Функции: габаритный огонь.';
  const extended = `${base}\nОсобенности: Биполярный; Европейский сертификат E28.`;

  // пустое описание — заполняем
  await fillEmptyFields(runner, 1, { description: null, image_path: null }, { description: base }, null);
  assert.ok(queries.at(-1).sql.includes('description'), 'описание не заполнено');
  assert.match(queries.at(-1).sql, /UPDATE components SET/);

  // каталожное описание продолжает текущее — обновляем
  assert.equal(
    await fillEmptyFields(runner, 1, { description: base, image_path: null },
      { description: extended }, null),
    true
  );

  // пользователь дописал своё — каталожная версия не затирает правку
  assert.equal(
    await fillEmptyFields(runner, 1, { description: `${base} Наш комментарий.`, image_path: null },
      { description: extended }, null),
    false
  );
});

test('ошибки БД: пустой message от pg превращается в понятную причину', () => {
  const { describeDbError } = require('../src/utils/db-error');

  const refused = Object.assign(new Error(''), { code: 'ECONNREFUSED' });
  assert.match(describeDbError(refused), /PostgreSQL не отвечает/);
  assert.match(describeDbError({ code: '28P01' }), /пароль/);
  assert.equal(describeDbError(new Error('column "x" does not exist')), 'column "x" does not exist');
  assert.equal(describeDbError(null), 'неизвестная ошибка');
});

test('ГИСП: ссылки из базы переносятся в catalog.json, пустая не стирает', () => {
  const { apply } = require('../scripts/catalog/export_gisp');

  const components = [
    { article: 'А.1', name: 'без ссылки' },
    { article: 'А.2', name: 'ссылка та же', gisp_url: 'https://gisp.gov.ru/2' },
    { article: 'А.3', name: 'ссылка устарела', gisp_url: 'https://gisp.gov.ru/old' },
    { article: 'А.4', name: 'снятая', gisp_url: 'https://gisp.gov.ru/4' },
  ];
  const gisp = new Map([
    ['А.1', 'https://gisp.gov.ru/1'],
    ['А.2', 'https://gisp.gov.ru/2'],
    ['А.3', 'https://gisp.gov.ru/new'],
    ['А.9', 'https://gisp.gov.ru/9'],
  ]);

  const changes = apply(components, gisp);
  assert.deepEqual(changes.added, ['А.1']);
  assert.deepEqual(changes.updated, ['А.3']);
  assert.deepEqual(changes.removed, []);
  assert.deepEqual(changes.missing, ['А.9']);
  assert.equal(components[0].gisp_url, 'https://gisp.gov.ru/1');
  assert.equal(components[2].gisp_url, 'https://gisp.gov.ru/new');
  // ссылки нет в базе — значение из catalog.json остаётся
  assert.equal(components[3].gisp_url, 'https://gisp.gov.ru/4');

  // --prune снимает отметку, если её убрали в CRM
  const pruned = apply(components, gisp, { prune: true });
  assert.deepEqual(pruned.removed, ['А.4']);
  assert.equal(components[3].gisp_url, undefined);
});

test('фото из CRM: новые снимки добавляются, старые не пропадают', () => {
  const { applyImages, uploadName } = require('../scripts/catalog/export_images');

  assert.equal(uploadName('/uploads/images/catalog_ab12.jpg'), 'catalog_ab12.jpg');
  assert.equal(uploadName('https://example.org/x.jpg'), null);

  const components = [
    {
      article: 'А.1',
      image: 'cover-old.jpeg',
      images: ['cover-old.jpeg', 'old-2.jpeg'],
      modifications: [
        { code: '01', images: ['mod-old.jpeg'] },
        { code: '02', images: [] },
      ],
    },
    { article: 'А.2', modifications: [] },
  ];
  const fromDb = new Map([
    ['А.1', {
      image: '/uploads/images/new-cover.jpg',
      images: ['/uploads/images/old-2.jpg', '/uploads/images/new-3.jpg'],
      mods: new Map([['01', ['/uploads/images/mod-new.jpg']], ['02', ['/uploads/images/mod-2.jpg']]]),
    }],
  ]);

  const names = {
    '/uploads/images/new-cover.jpg': 'a-1_newcover.jpg',
    '/uploads/images/old-2.jpg': 'old-2.jpeg',
    '/uploads/images/new-3.jpg': 'a-1_new3.jpg',
    '/uploads/images/mod-new.jpg': 'a-1_modnew.jpg',
    '/uploads/images/mod-2.jpg': 'a-1_mod2.jpg',
  };
  const report = applyImages(components, fromDb, { place: url => names[url] || null });

  assert.equal(report.components, 1);
  assert.equal(components[0].image, 'a-1_newcover.jpg');
  // порядок каталога сохраняется, новые снимки — в конец
  assert.deepEqual(components[0].images, ['cover-old.jpeg', 'old-2.jpeg', 'a-1_new3.jpg']);
  assert.deepEqual(components[0].modifications[0].images, ['mod-old.jpeg', 'a-1_modnew.jpg']);
  assert.deepEqual(components[0].modifications[1].images, ['a-1_mod2.jpg']);

  // без --prune пустой ответ базы галерею не стирает
  const empty = applyImages(components, new Map([['А.1', { image: null, images: [], mods: new Map() }]]),
    { place: () => null });
  assert.equal(empty.components, 0);
  assert.equal(components[0].images.length, 3);

  // --prune приводит галерею к тому, что в CRM
  applyImages(components, fromDb, { place: url => names[url] || null, prune: true });
  assert.deepEqual(components[0].images, ['old-2.jpeg', 'a-1_new3.jpg']);
});

test('ГИСП: список ссылок — точный артикул и целое семейство', () => {
  const { applyLinks } = require('../scripts/catalog/apply_gisp');

  const components = [
    { article: 'А.3724.050' },
    { article: 'А.3724.051' },
    { article: 'А.3724.МД-002.01495-00-09' },
    { article: 'А.3717.001' },
    { article: 'А.3717.001-Б' },
    { article: 'А.3714.001', gisp_url: 'https://gisp.gov.ru/goods/#/product/old' },
  ];
  const links = [
    { match: 'prefix', article: 'А.3724', url: 'https://gisp.gov.ru/goods/#/product/1942091' },
    { article: 'А.3717.001', url: 'https://gisp.gov.ru/goods/#/product/4668729' },
    { article: 'А.3714.001', url: 'https://gisp.gov.ru/goods/#/product/4710066' },
    { article: 'А.3714.020', url: 'https://gisp.gov.ru/goods/#/product/0000000' },
  ];

  const report = applyLinks(components, links);
  const byArticle = Object.fromEntries(components.map(item => [item.article, item.gisp_url]));

  // семейство: все артикулы с этого начала, включая буквенный
  assert.deepEqual(report.rules[0].hits, 3);
  assert.equal(byArticle['А.3724.051'], 'https://gisp.gov.ru/goods/#/product/1942091');
  assert.equal(byArticle['А.3724.МД-002.01495-00-09'], 'https://gisp.gov.ru/goods/#/product/1942091');

  // точный артикул не задевает соседние исполнения с буквой
  assert.equal(byArticle['А.3717.001'], 'https://gisp.gov.ru/goods/#/product/4668729');
  assert.equal(byArticle['А.3717.001-Б'], undefined);

  // ссылка перезаписывается, если в списке новее
  assert.equal(byArticle['А.3714.001'], 'https://gisp.gov.ru/goods/#/product/4710066');

  // позиции нет в каталоге — попадает в отчёт, а не молча теряется
  assert.deepEqual(report.unmatched.map(item => item.article), ['А.3714.020']);
  assert.equal(report.matched, 5);
  assert.equal(report.changed, 5);

  // повторный прогон ничего не меняет
  const again = applyLinks(components, links);
  assert.equal(again.changed, 0);
});
