/**
 * Импорт каталога компонентов (АТЛАНТА-26).
 *
 * Отдельный шаг, а не схема-миграция: развёртывание может быть «пустым»
 * (только таблицы и справочники) или «полным» (с каталогом АТЛАНТА).
 * Поэтому скрипт не входит в migrate.js и запускается по требованию:
 *
 *   npm run db:catalog      # обычная база (DATABASE_URL)
 *   npm run demo:catalog    # демо на PGlite (PGLITE_DIR)
 *
 * В deploy.sh включается флагом WITH_CATALOG=1, в update.sh — наличием
 * маркера server/.catalog-enabled.
 *
 * Идемпотентность:
 *   - категории — по названию (lower(name));
 *   - компоненты — по артикулу (components.article UNIQUE);
 *   - модификации — по коду внутри компонента.
 * Существующие записи не перезаписываются: цены и правки из интерфейса
 * переживают повторный импорт. Дозаполняются только пустые поля
 * (картинка, описание) у уже существующего компонента.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fullArticle } = require('../utils/article');
const { describeDbError } = require('../utils/db-error');

const CATALOG_DIR = path.join(__dirname, 'catalog');
const FILES_DIR = path.join(CATALOG_DIR, 'files');
const CATALOG_JSON = path.join(CATALOG_DIR, 'catalog.json');

const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');
const IMAGES_DIR = path.join(UPLOADS_DIR, 'images');

function readConfig() {
  if (!fs.existsSync(CATALOG_JSON)) {
    return { categories: [], components: [] };
  }
  const config = JSON.parse(fs.readFileSync(CATALOG_JSON, 'utf8'));
  return {
    categories: Array.isArray(config.categories) ? config.categories : [],
    components: Array.isArray(config.components) ? config.components : [],
  };
}

/** Кладёт фото из репозитория в uploads/images под стабильным именем (хэш). */
function placeImage(fileName, targetDir = IMAGES_DIR) {
  const absolute = path.join(FILES_DIR, fileName);
  if (!fs.existsSync(absolute)) {
    throw new Error(`файл ${fileName} не найден в ${FILES_DIR}`);
  }
  const buffer = fs.readFileSync(absolute);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const ext = path.extname(fileName).toLowerCase();
  const storedName = `catalog_${hash}${ext}`;
  const target = path.join(targetDir, storedName);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, buffer);
  }

  return { url: `/uploads/images/${storedName}`, size: buffer.length };
}

async function ensureCategory(runner, category) {
  const existing = await runner.query(
    'SELECT id FROM component_categories WHERE lower(name) = lower($1) ORDER BY id LIMIT 1',
    [category.name]
  );
  if (existing.rows.length > 0) {
    return { id: existing.rows[0].id, created: false };
  }

  const inserted = await runner.query(
    'INSERT INTO component_categories (name, sort_order) VALUES ($1, $2) RETURNING id',
    [category.name, category.sort_order || 0]
  );
  return { id: inserted.rows[0].id, created: true };
}

async function findComponent(runner, article) {
  const result = await runner.query(
    'SELECT id, image_path, description FROM components WHERE article = $1 LIMIT 1', [article]);
  return result.rows[0] || null;
}

async function insertComponent(runner, entry, categoryId, imagePath) {
  const result = await runner.query(
    `INSERT INTO components (category_id, article, name, price, image_path, description, is_active)
     VALUES ($1, $2, $3, 0, $4, $5, true)
     RETURNING id`,
    [categoryId, entry.article, entry.name, imagePath, entry.description || null]
  );
  return result.rows[0].id;
}

/** Дозаполняем только пустые поля, чтобы не затереть правки из интерфейса. */
async function fillEmptyFields(runner, componentId, current, entry, imagePath) {
  const patch = {};
  if (!current.image_path && imagePath) patch.image_path = imagePath;
  if (entry.description) {
    const currentText = (current.description || '').trim();
    // пустое заполняем, а расширенный текст из каталога принимаем только если
    // он продолжает текущий — ручные правки в интерфейсе не затираются
    if (!currentText || entry.description.startsWith(currentText)) {
      if (current.description !== entry.description) patch.description = entry.description;
    }
  }

  const fields = Object.keys(patch);
  if (fields.length === 0) return false;

  const assignments = fields.map((field, i) => `${field} = $${i + 2}`).join(', ');
  await runner.query(
    `UPDATE components SET ${assignments} WHERE id = $1`,
    [componentId, ...fields.map(field => patch[field])]
  );
  return true;
}

async function ensureModifications(runner, componentId, entry) {
  const mods = Array.isArray(entry.modifications) ? entry.modifications : [];
  const items = [];
  let created = 0;

  for (let i = 0; i < mods.length; i += 1) {
    const mod = mods[i];
    const existing = await runner.query(
      'SELECT id FROM component_modifications WHERE component_id = $1 AND lower(code) = lower($2) LIMIT 1',
      [componentId, mod.code]
    );
    if (existing.rows.length > 0) {
      const id = existing.rows[0].id;
      // артикул исполнения мог появиться в каталоге позже — дозаполняем пустой
      if (mod.full_article) {
        await runner.query(
          `UPDATE component_modifications SET full_article = $2
           WHERE id = $1 AND (full_article IS NULL OR full_article = '')`,
          [id, mod.full_article]
        );
      }
      items.push({ id, mod });
      continue;
    }

    const inserted = await runner.query(
      `INSERT INTO component_modifications (component_id, code, name, full_article, sort_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [componentId, mod.code, mod.name || null, mod.full_article || null, i]
    );
    items.push({ id: inserted.rows[0].id, mod });
    created += 1;
  }

  return { created, items };
}

/** Фото исполнений кладутся рядом с фото компонентов и привязываются к коду. */
async function ensureModificationImages(runner, item) {
  const files = Array.isArray(item.mod.images) ? item.mod.images : [];
  let created = 0;

  for (let i = 0; i < files.length; i += 1) {
    const image = placeImage(files[i]);
    const existing = await runner.query(
      'SELECT id FROM component_modification_images WHERE modification_id = $1 AND image_path = $2 LIMIT 1',
      [item.id, image.url]
    );
    if (existing.rows.length > 0) continue;

    await runner.query(
      `INSERT INTO component_modification_images (modification_id, image_path, sort_order)
       VALUES ($1, $2, $3)`,
      [item.id, image.url, i]
    );
    created += 1;
  }

  return created;
}

/** Галерея позиции: несколько фото изделия, первое — обложка. */
async function ensureComponentImages(runner, componentId, entry, imagePath) {
  const files = Array.isArray(entry.images) ? entry.images : [];
  let created = 0;

  for (let i = 0; i < files.length; i += 1) {
    const image = placeImage(files[i]);
    const existing = await runner.query(
      'SELECT id FROM component_images WHERE component_id = $1 AND image_path = $2 LIMIT 1',
      [componentId, image.url]
    );
    if (existing.rows.length > 0) continue;

    await runner.query(
      `INSERT INTO component_images (component_id, image_path, sort_order)
       VALUES ($1, $2, $3)`,
      [componentId, image.url, i]
    );
    created += 1;
  }

  // обложки нет, а галерея появилась — берём первое фото
  if (imagePath === null && files.length > 0) {
    await runner.query(
      'UPDATE components SET image_path = $2 WHERE id = $1 AND image_path IS NULL',
      [componentId, placeImage(files[0]).url]
    );
  }

  return created;
}

/**
 * Старые плоские артикулы жгутов (А.3724.304-03.01 как отдельный компонент)
 * после перехода на модель «семейство + исполнение» становятся исполнением
 * семьи. Дубль убираем: удаляем, если на него нигде не ссылаются, иначе
 * гасим (is_active = false), чтобы не порвать чертежи и документы.
 */
const REFERENCE_TABLES = ['drawing_components', 'component_documents', 'manufacturer_product_components'];

async function isReferenced(runner, componentId) {
  for (const table of REFERENCE_TABLES) {
    const result = await runner.query(
      `SELECT 1 FROM ${table} WHERE component_id = $1 LIMIT 1`, [componentId]);
    if (result.rows.length > 0) return true;
  }
  return false;
}

/** Импорт пишет full_article: без миграции лучше остановиться сразу и понятно. */
async function assertSchema(runner) {
  try {
    await runner.query('SELECT full_article FROM component_modifications WHERE false');
  } catch (err) {
    if (/full_article/i.test(err.message || '')) {
      throw new Error(
        'в таблице component_modifications нет колонки full_article — сначала примените миграции ' +
        '(npm run db:migrate), затем повторите импорт каталога'
      );
    }
    throw err;
  }
}

async function retireLegacyFlats(runner, entries) {
  const families = new Map();
  for (const entry of entries) {
    for (const mod of entry.modifications || []) {
      if (!mod.code) continue;
      families.set(fullArticle(entry.article, mod.code), entry.article);
      // артикул из прежнего каталога, если код исполнения записан иначе
      if (mod.legacy_article) families.set(mod.legacy_article, entry.article);
      if (mod.full_article) families.set(mod.full_article, entry.article);
    }
    // артикулы, которые каталог прямо объявляет частью этого изделия:
    // «А.3731.027-01» → «А.3731.027» (поле supersedes в catalog.json)
    for (const old of entry.supersedes || []) {
      families.set(old, entry.article);
    }
  }
  if (families.size === 0) return { removed: 0, disabled: 0 };

  const bases = new Set(entries.map(entry => entry.article));
  // плоские артикулы жгутов и артикулы, объявленные в supersedes
  const oldArticles = [...families.keys()];
  const rows = await runner.query(
    'SELECT id, article FROM components WHERE article LIKE $1 OR article = ANY($2::text[])',
    ['А.3724.%', oldArticles]
  );

  let removed = 0;
  let disabled = 0;
  for (const row of rows.rows) {
    if (bases.has(row.article) || !families.has(row.article)) continue;

    if (await isReferenced(runner, row.id)) {
      await runner.query(
        'UPDATE components SET is_active = false, name = left(name, 200) || $2 WHERE id = $1',
        [row.id, ` (исполнение ${families.get(row.article)})`]
      );
      disabled += 1;
    } else {
      await runner.query('DELETE FROM components WHERE id = $1', [row.id]);
      removed += 1;
    }
  }
  return { removed, disabled };
}

/** Артикулы, которые появятся в системе: базовые и полные (для лога и тестов). */
function expandArticles(entry) {
  const mods = Array.isArray(entry.modifications) ? entry.modifications : [];
  return [entry.article, ...mods.map(mod => fullArticle(entry.article, mod.code, mod.full_article))];
}

async function run(db = require('../db')) {
  const { categories, components } = readConfig();
  if (components.length === 0) {
    console.log('ℹ️  Каталог: нет данных в src/db/catalog/catalog.json');
    return;
  }

  await assertSchema(db);

  console.log(`\n📦 Импорт каталога: ${categories.length} категорий, ${components.length} позиций`);

  const categoryIds = new Map();
  let createdCategories = 0;
  for (const category of categories) {
    const { id, created } = await ensureCategory(db, category);
    categoryIds.set(category.key, id);
    if (created) {
      createdCategories += 1;
      console.log(`+ категория «${category.name}»`);
    }
  }

  let createdComponents = 0;
  let updatedComponents = 0;
  let skippedComponents = 0;
  let createdModifications = 0;
  let createdModificationImages = 0;
  let createdComponentImages = 0;
  const errors = [];

  for (const entry of components) {
    if (!entry || !entry.article || !entry.name) {
      errors.push('позиция без article или name');
      continue;
    }

    try {
      const categoryId = categoryIds.get(entry.category) || null;
      const image = entry.image ? placeImage(entry.image) : null;
      const imagePath = image ? image.url : null;

      const current = await findComponent(db, entry.article);
      let componentId;

      if (current) {
        componentId = current.id;
        const filled = await fillEmptyFields(db, componentId, current, entry, imagePath);
        if (filled) updatedComponents += 1;
        else skippedComponents += 1;
      } else {
        componentId = await insertComponent(db, entry, categoryId, imagePath);
        createdComponents += 1;
      }

      createdComponentImages += await ensureComponentImages(db, componentId, entry, imagePath);

      const mods = await ensureModifications(db, componentId, entry);
      createdModifications += mods.created;
      for (const item of mods.items) {
        createdModificationImages += await ensureModificationImages(db, item);
      }
    } catch (err) {
      errors.push(`${entry.article}: ${err.message}`);
      console.error(`✗ ${entry.article}: ${err.message}`);
    }
  }

  const legacy = await retireLegacyFlats(db, components);

  console.log(
    `✅ Каталог: категорий создано ${createdCategories}, ` +
    `позиций создано ${createdComponents}, дополнено ${updatedComponents}, ` +
    `без изменений ${skippedComponents}, модификаций создано ${createdModifications}, ` +
    `фото в галерею ${createdComponentImages}, фото исполнений ${createdModificationImages}`
  );
  if (legacy.removed > 0 || legacy.disabled > 0) {
    console.log(
      `↪️  Прежние артикулы (жгуты, семейства фонарей): удалено ${legacy.removed}, ` +
      `погашено (есть ссылки) ${legacy.disabled}`
    );
  }

  if (errors.length > 0) {
    console.error(`⚠️  Ошибки: ${errors.join('; ')}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  const db = require('../db');
  run(db)
    .catch((err) => {
      console.error('❌ Ошибка импорта каталога:', describeDbError(err));
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        await db.close();
      } catch {
        /* соединение могло не открыться */
      }
    });
}

module.exports = {
  run,
  readConfig,
  placeImage,
  expandArticles,
  ensureModifications,
  ensureComponentImages,
  assertSchema,
  retireLegacyFlats,
  fillEmptyFields,
  CATALOG_JSON,
  FILES_DIR,
};
