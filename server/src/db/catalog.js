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
  if (!current.description && entry.description) patch.description = entry.description;

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
  let created = 0;

  for (let i = 0; i < mods.length; i += 1) {
    const mod = mods[i];
    const existing = await runner.query(
      'SELECT id FROM component_modifications WHERE component_id = $1 AND lower(code) = lower($2) LIMIT 1',
      [componentId, mod.code]
    );
    if (existing.rows.length > 0) continue;

    await runner.query(
      `INSERT INTO component_modifications (component_id, code, name, sort_order)
       VALUES ($1, $2, $3, $4)`,
      [componentId, mod.code, mod.name || null, i]
    );
    created += 1;
  }

  return created;
}

/** Артикулы, которые появятся в системе: базовые и полные (для лога и тестов). */
function expandArticles(entry) {
  const mods = Array.isArray(entry.modifications) ? entry.modifications : [];
  return [entry.article, ...mods.map(mod => fullArticle(entry.article, mod.code))];
}

async function run(db = require('../db')) {
  const { categories, components } = readConfig();
  if (components.length === 0) {
    console.log('ℹ️  Каталог: нет данных в src/db/catalog/catalog.json');
    return;
  }

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

      const mods = await ensureModifications(db, componentId, entry);
      createdModifications += mods;
    } catch (err) {
      errors.push(`${entry.article}: ${err.message}`);
      console.error(`✗ ${entry.article}: ${err.message}`);
    }
  }

  console.log(
    `✅ Каталог: категорий создано ${createdCategories}, ` +
    `позиций создано ${createdComponents}, дополнено ${updatedComponents}, ` +
    `без изменений ${skippedComponents}, модификаций создано ${createdModifications}`
  );

  if (errors.length > 0) {
    console.error(`⚠️  Ошибки: ${errors.join('; ')}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  const db = require('../db');
  run(db)
    .catch((err) => {
      console.error('❌ Ошибка импорта каталога:', err.message);
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
  CATALOG_JSON,
  FILES_DIR,
};
