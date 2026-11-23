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
 *
 * Фотографии — отдельное правило (см. syncComponentPhotos):
 *   - снимок уже есть в базе (в том числе убранный) → импорт его не трогает;
 *   - позиция уже была в базе → новые снимки к ней не прикладываются:
 *     менеджер ведёт её сам, а поставщик мог добавить кадры к давней позиции;
 *   - убранный в карточке снимок помечен deleted_at и не возвращается;
 *   - обложку импорт заполняет, только если её ещё не выбирали в карточке.
 * Новые снимки к существующим позициям приносит отдельная команда
 * `npm run db:catalog -- --refresh-photos` (показывает список и ждёт --yes).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fullArticle } = require('../utils/article');
const { describeDbError } = require('../utils/db-error');
const { adoptSplitFamilies } = require('./side-families');

const CATALOG_DIR = path.join(__dirname, 'catalog');
const FILES_DIR = path.join(CATALOG_DIR, 'files');
const CATALOG_JSON = path.join(CATALOG_DIR, 'catalog.json');
// Архив документов поставщика: папка на изделие внутри папки раздела
const DOCS_DIR = path.join(CATALOG_DIR, 'docs');

const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');
const IMAGES_DIR = path.join(UPLOADS_DIR, 'images');
const DOCUMENTS_DIR = path.join(UPLOADS_DIR, 'files');

function readConfig() {
  if (!fs.existsSync(CATALOG_JSON)) {
    return { categories: [], components: [] };
  }
  const config = JSON.parse(fs.readFileSync(CATALOG_JSON, 'utf8'));
  return {
    categories: Array.isArray(config.categories) ? config.categories : [],
    components: Array.isArray(config.components) ? config.components : [],
    // семейства, разделённые на отдельные изделия (габаритные фонари по стороне)
    families: Array.isArray(config.families) ? config.families : [],
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

/**
 * Артикул для сравнения имён папок: «А» кириллическая и «A» латинская
 * в документах поставщика означают одно и то же, точки и пробелы не важны.
 */
const HOMOGLYPHS = {
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H',
  'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X',
};

function normalizeArticle(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[АВЕКМНОРСТУХ]/g, ch => HOMOGLYPHS[ch] || ch)
    .replace(/[\s.\-_]/g, '');
}

/** Все папки архива: «<раздел>/<артикул>» и вложенные в них ревизии. */
function walkDirs(dir, depth, visit) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  visit(dir, depth);
  if (depth >= 4) return;
  for (const entry of entries) {
    if (entry.isDirectory()) walkDirs(path.join(dir, entry.name), depth + 1, visit);
  }
}

/**
 * Документы изготовителя по артикулам: { 'A3776006': [пути к PDF] }.
 * Габаритные чертежи и паспорта лежат в архиве рядом с описаниями —
 * при импорте они попадают в карточку позиции, вкладка «Документы».
 *
 * Вложенная папка с номером — исполнение изделия: «А.3731.008/2» → А.3731.008.2.
 */
function indexDocuments(root = DOCS_DIR) {
  const index = new Map();
  walkDirs(root, 0, (dir) => {
    if (dir === root) return;
    const name = path.basename(dir);
    let key = normalizeArticle(name);
    if (!/^A\d{4}/.test(key)) {
      const parentName = path.basename(path.dirname(dir));
      const parentKey = normalizeArticle(parentName);
      if (!/^\d+$/.test(name) || !/^A\d{4}/.test(parentKey)) return;
      key = normalizeArticle(`${parentName}.${name}`);
    }
    const pdfs = fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === '.pdf')
      .map(entry => path.join(dir, entry.name));
    if (pdfs.length === 0) return;
    index.set(key, [...(index.get(key) || []), ...pdfs]);
  });

  // общий чертёж на несколько отдельных позиций — только по явной карте
  for (const [folder, articles] of Object.entries(readDocumentMap(root))) {
    if (folder.startsWith('$') || !Array.isArray(articles)) continue;
    const files = index.get(normalizeArticle(folder));
    if (!files || files.length === 0) continue;
    for (const article of articles) {
      const key = normalizeArticle(article);
      const merged = [...(index.get(key) || [])];
      for (const file of files) {
        if (!merged.includes(file)) merged.push(file);
      }
      index.set(key, merged);
    }
  }
  return index;
}

/** Явная карта «папка → артикулы»: общий документ на несколько позиций. */
function readDocumentMap(root = DOCS_DIR) {
  const file = path.join(root, '_map.json');
  if (!fs.existsSync(file)) return {};
  try {
    const map = JSON.parse(fs.readFileSync(file, 'utf8'));
    return map && typeof map === 'object' ? map : {};
  } catch {
    return {};
  }
}

/**
 * Документы для позиции. Обычно это своя папка артикула, но изготовитель
 * кладёт один чертёж на семейство: в ГЧ А.3731.008 таблица описывает и
 * А.3731.008.2 (2 огня), и А.3731.008.3 (3 огня) — позиции разные, чертёж
 * общий, и его выдаёт карта docs/_map.json. Своя папка артикула идёт первой.
 */
function documentsFor(index, article) {
  const files = index.get(normalizeArticle(article)) || [];
  const seen = new Set();
  return files.filter(file => {
    if (seen.has(file)) return false;
    seen.add(file);
    return true;
  });
}

/** Кладёт документ из репозитория в uploads/files под стабильным именем (хэш). */
function placeDocument(absolutePath, targetDir = DOCUMENTS_DIR) {
  const buffer = fs.readFileSync(absolutePath);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const ext = path.extname(absolutePath).toLowerCase();
  const storedName = `catalog_${hash}${ext}`;
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const target = path.join(targetDir, storedName);
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, buffer);
  }
  return { url: `/uploads/files/${storedName}`, size: buffer.length };
}

function documentComment(fileName) {
  if (/ГЧ|габарит/i.test(fileName)) return 'Габаритный чертёж изготовителя';
  if (/паспорт/i.test(fileName)) return 'Паспорт изделия';
  return 'Документ изготовителя';
}

/**
 * Тип документа изготовителя. Габаритные чертежи (ГЧ) — это чертежи, их
 * место в группе «Чертежи» карточки, а паспорта и прочее — информационные
 * документы. Раньше все шли одним типом 'info'.
 */
function documentType(fileName) {
  if (/ГЧ|габарит/i.test(fileName)) return 'drawing';
  return 'info';
}

/** Прикладывает документы изготовителя к карточке; повторный импорт не дублирует. */
async function ensureComponentDocuments(runner, componentId, files) {
  let created = 0;
  for (const source of files) {
    // имя из архива может быть в разложенном виде («и» + бревис вместо «й»)
    const originalName = path.basename(source).normalize('NFC');
    // одинаковые чертежи лежат и в папке семейства, и в папке исполнения:
    // имя файла-хэша у них одно, поэтому дубль видно и по пути
    const placed = placeDocument(source);
    const existing = await runner.query(
      `SELECT id FROM component_documents
        WHERE component_id = $1 AND (original_name = $2 OR file_path = $3) LIMIT 1`,
      [componentId, originalName, placed.url]
    );
    if (existing.rows.length > 0) continue;

    await runner.query(
      `INSERT INTO component_documents
         (component_id, doc_type, file_path, original_name, file_type, file_size, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [componentId, documentType(originalName), placed.url, originalName,
        path.extname(originalName).slice(1).toLowerCase(),
        placed.size, documentComment(originalName)]
    );
    created += 1;
  }
  return created;
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
    'SELECT id, image_path, description, gisp_url FROM components WHERE article = $1 LIMIT 1',
    [article]);
  return result.rows[0] || null;
}

async function insertComponent(runner, entry, categoryId, imagePath) {
  const result = await runner.query(
    `INSERT INTO components (category_id, article, name, price, image_path, description, is_active, gisp_url)
     VALUES ($1, $2, $3, 0, $4, $5, true, $6)
     RETURNING id`,
    [categoryId, entry.article, entry.name, imagePath, entry.description || null,
      entry.gisp_url || null]
  );
  return result.rows[0].id;
}

/** Дозаполняем только пустые поля, чтобы не затереть правки из интерфейса. */
/**
 * У позиции есть убранные снимки — значит фото ведёт менеджер, и импорт не
 * должен возвращать обложку из каталога. Пустая обложка в этом случае —
 * осознанное решение, а не «ещё не заполнили».
 */
async function photoWasRemoved(runner, componentId) {
  try {
    const result = await runner.query(
      'SELECT 1 FROM component_images WHERE component_id = $1 AND deleted_at IS NOT NULL LIMIT 1',
      [componentId]
    );
    return result.rows.length > 0;
  } catch (err) {
    if (!/deleted_at/i.test(err.message || '')) throw err;
    return false;
  }
}

async function fillEmptyFields(runner, componentId, current, entry, imagePath) {
  const patch = {};
  // Обложку существующей позиции не трогаем: если она пустая, значит менеджер
  // убрал фото в карточке. Новую позицию обложкой из каталога заполняем.
  if (!current.image_path && imagePath && !(await photoWasRemoved(runner, componentId))) {
    patch.image_path = imagePath;
  }
  // ссылку на реестр ГИСП заполняем только если её ещё нет: правки из CRM важнее
  if (!current.gisp_url && entry.gisp_url) patch.gisp_url = entry.gisp_url;
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
      'SELECT id, name FROM component_modifications WHERE component_id = $1 AND lower(code) = lower($2) LIMIT 1',
      [componentId, mod.code]
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      const id = row.id;
      // артикул исполнения мог появиться в каталоге позже — дозаполняем пустой
      if (mod.full_article) {
        await runner.query(
          `UPDATE component_modifications SET full_article = $2
           WHERE id = $1 AND (full_article IS NULL OR full_article = '')`,
          [id, mod.full_article]
        );
      }
      // Переименование только по явному списку rename_from: если в базе всё ещё
      // стоит прежнее каталожное название, меняем на новое из документа. Правку,
      // сделанную в интерфейсе, не трогаем — она не совпадёт со списком.
      if (mod.name && Array.isArray(mod.rename_from)
          && mod.rename_from.includes(String(row.name || '').trim())
          && String(row.name || '').trim() !== mod.name) {
        await runner.query('UPDATE component_modifications SET name = $2 WHERE id = $1',
          [id, mod.name]);
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

/**
 * Снимок уже есть у позиции/исполнения — в том числе убранный.
 *
 * Ищем и среди помеченных deleted_at: именно это и не даёт импорту вернуть
 * фото, которое менеджер удалил в карточке. Если строка убрана, повторно
 * её не добавляем и не «оживляем» — вернуть может только человек.
 */
async function photoKnown(runner, table, foreignKey, ownerId, imagePath) {
  const existing = await runner.query(
    `SELECT 1 FROM ${table} WHERE ${foreignKey} = $1 AND image_path = $2 LIMIT 1`,
    [ownerId, imagePath]
  );
  return existing.rows.length > 0;
}

/** Ставит снимок позиции, если такого ещё не было. Возвращает true при вставке. */
async function insertPhotoIfNew(runner, table, foreignKey, ownerId, imagePath, sortOrder = 0) {
  if (await photoKnown(runner, table, foreignKey, ownerId, imagePath)) return false;
  await runner.query(
    `INSERT INTO ${table} (${foreignKey}, image_path, sort_order) VALUES ($1, $2, $3)`,
    [ownerId, imagePath, sortOrder]
  );
  return true;
}

/**
 * Фото исполнений кладутся рядом с фото компонентов и привязываются к коду.
 *
 * `mode`:
 *   'new'      — позиция только что создана импортом: добавляем все снимки;
 *   'existing' — позиция уже была в базе: не трогаем (её ведёт менеджер);
 *   'refresh'  — явная команда «добрать новое из каталога»: добавляем
 *                недостающие, убранные остаются убранными.
 */
async function syncModificationImages(runner, item, mode = 'new') {
  if (mode === 'existing') return 0;
  const files = Array.isArray(item.mod.images) ? item.mod.images : [];
  let created = 0;

  for (let i = 0; i < files.length; i += 1) {
    const image = placeImage(files[i]);
    if (await insertPhotoIfNew(runner, 'component_modification_images', 'modification_id', item.id, image.url, i)) {
      created += 1;
    }
  }

  return created;
}

/** Первое неубранное фото галереи — из него берётся обложка. */
async function firstLivePhoto(runner, componentId) {
  try {
    const result = await runner.query(
      `SELECT image_path FROM component_images
        WHERE component_id = $1 AND deleted_at IS NULL
        ORDER BY sort_order, id LIMIT 1`,
      [componentId]
    );
    return result.rows.length ? result.rows[0].image_path : null;
  } catch (err) {
    // Старая база без deleted_at — ведём себя как раньше
    if (!/deleted_at/i.test(err.message || '')) throw err;
    const result = await runner.query(
      'SELECT image_path FROM component_images WHERE component_id = $1 ORDER BY sort_order, id LIMIT 1',
      [componentId]
    );
    return result.rows.length ? result.rows[0].image_path : null;
  }
}

/** Галерея позиции: несколько фото изделия, первое — обложка. */
async function syncComponentImages(runner, componentId, entry, imagePath, mode = 'new') {
  if (mode === 'existing') return 0;
  const files = Array.isArray(entry.images) ? entry.images : [];
  let created = 0;

  for (let i = 0; i < files.length; i += 1) {
    const image = placeImage(files[i]);
    if (await insertPhotoIfNew(runner, 'component_images', 'component_id', componentId, image.url, i)) {
      created += 1;
    }
  }

  // Обложки нет — берём первое живое фото галереи. Убранные снимки обложкой
  // не становятся: именно из-за этого удаление последнего фото откатывалось.
  if (imagePath === null && mode !== 'existing') {
    const first = await firstLivePhoto(runner, componentId);
    if (first) {
      await runner.query(
        'UPDATE components SET image_path = $2 WHERE id = $1 AND image_path IS NULL',
        [componentId, first]
      );
    }
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

async function run(db = require('../db'), options = {}) {
  const { categories, components, families } = readConfig();
  // 'auto' — обычное обновление: фото трогаем только у новых позиций;
  // 'refresh' — явная команда «добрать новые снимки из каталога».
  const photoMode = options.refreshPhotos === true ? 'refresh' : 'auto';
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
  let createdDocuments = 0;
  const documents = indexDocuments();
  const usedDocuments = new Set();
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
      // фото позиции, которой ещё не было, — из каталога; у существующей —
      // только по явной команде «добрать новое»
      let photoAction = 'new';

      if (current) {
        componentId = current.id;
        photoAction = photoMode === 'refresh' ? 'refresh' : 'existing';
        const filled = await fillEmptyFields(db, componentId, current, entry, imagePath);
        if (filled) updatedComponents += 1;
        else skippedComponents += 1;
      } else {
        componentId = await insertComponent(db, entry, categoryId, imagePath);
        createdComponents += 1;
      }

      createdComponentImages += await syncComponentImages(
        db, componentId, entry, imagePath, photoAction);

      const mods = await ensureModifications(db, componentId, entry);
      createdModifications += mods.created;
      for (const item of mods.items) {
        createdModificationImages += await syncModificationImages(db, item, photoAction);
      }

      // чертежи и паспорта изготовителя из архива — в карточку позиции
      const files = documentsFor(documents, entry.article);
      if (files.length > 0) {
        files.forEach(file => usedDocuments.add(file));
        createdDocuments += await ensureComponentDocuments(db, componentId, files);
      }
    } catch (err) {
      errors.push(`${entry.article}: ${err.message}`);
      console.error(`✗ ${entry.article}: ${err.message}`);
    }
  }

  // семейство, разделённое на изделия по стороне: цены, правки интерфейса,
  // фото и документы прежнего изделия переносим до того, как retireLegacyFlats
  // его удалит
  const split = await adoptSplitFamilies(db, families, { log: console.log });

  const legacy = await retireLegacyFlats(db, components);

  console.log(
    `✅ Каталог: категорий создано ${createdCategories}, ` +
    `позиций создано ${createdComponents}, дополнено ${updatedComponents}, ` +
    `без изменений ${skippedComponents}, модификаций создано ${createdModifications}, ` +
    `фото в галерею ${createdComponentImages}, фото исполнений ${createdModificationImages}` +
    (split.families > 0 ? `, разделено по стороне семейств ${split.families}` : '') +
    (createdDocuments > 0 ? `, документов приложено ${createdDocuments}` : '')
  );
  if (legacy.removed > 0 || legacy.disabled > 0) {
    console.log(
      `↪️  Прежние артикулы (жгуты, семейства фонарей): удалено ${legacy.removed}, ` +
      `погашено (есть ссылки) ${legacy.disabled}`
    );
  }

  // документы, для которых в каталоге нет позиции: не теряем их молча
  const unmatched = [...documents.entries()]
    .filter(([, list]) => !list.some(file => usedDocuments.has(file)))
    .map(([key]) => key);
  if (unmatched.length > 0) {
    const names = unmatched.map((key) => {
      // папка изделия — та, чьё имя совпало с артикулом, а не вложенная «ревизия»
      const folder = [...documents.get(key)]
        .map(file => path.dirname(file).split(path.sep).reverse()
          .find(part => normalizeArticle(part) === key))
        .find(Boolean);
      return folder || key;
    });
    console.warn(`⚠️  Документы без позиции в каталоге: ${names.join('; ')}`);
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
  indexDocuments,
  documentsFor,
  readDocumentMap,
  normalizeArticle,
  placeDocument,
  ensureComponentDocuments,
  ensureModifications,
  ensureComponentImages: syncComponentImages,
  syncComponentImages,
  syncModificationImages,
  photoKnown,
  adoptSplitFamilies,
  assertSchema,
  retireLegacyFlats,
  fillEmptyFields,
  CATALOG_JSON,
  FILES_DIR,
  DOCS_DIR,
};
