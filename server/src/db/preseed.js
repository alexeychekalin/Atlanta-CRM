/**
 * Предзаполнение системы клиентами, с которыми CRM запускается в эксплуатацию.
 *
 * Источник данных — src/db/preseed/clients.json и файлы из src/db/preseed/files/.
 * Скрипт идемпотентен: клиент ищется по ИНН (без ИНН — по названию), файлы —
 * по имени файла внутри карточки. Повторный деплой ничего не дублирует
 * и не перезаписывает правки, сделанные в интерфейсе.
 *
 * Запуск:
 *   npm run db:preseed               # обычная база (DATABASE_URL)
 *   npm run demo:preseed             # демо на PGlite (PGLITE_DIR)
 *   npm run db:preseed -- --refresh  # обновить реквизиты уже заведённых карточек
 *   npm run db:preseed -- --refresh --dry-run
 *
 * Без флага --refresh существующие карточки не трогаются: правки из интерфейса
 * важнее файла. С флагом файл считается эталоном: непустые значения из него
 * перезаписывают поля карточки, пустые — никогда (не стираем то, чего нет в файле).
 *
 * Запускается автоматически в deploy.sh и demo:init.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PRESEED_DIR = path.join(__dirname, 'preseed');
const FILES_DIR = path.join(PRESEED_DIR, 'files');
const CLIENTS_JSON = path.join(PRESEED_DIR, 'clients.json');

// Куда складываются вложения: тот же каталог, что и у админской вкладки «Файлы»
const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');
const CLIENT_FILES_DIR = path.join(UPLOADS_DIR, 'files');

function readConfig() {
  if (!fs.existsSync(CLIENTS_JSON)) {
    return { clients: [] };
  }
  const raw = fs.readFileSync(CLIENTS_JSON, 'utf8');
  const config = JSON.parse(raw);
  return { clients: Array.isArray(config.clients) ? config.clients : [] };
}

/**
 * Поля карточки, которые предзаполнение переносит из файла в базу.
 * Порядок — как в форме клиента; используется и вставкой, и режимом --refresh.
 */
const CLIENT_FIELDS = [
  'name', 'full_name', 'name_en', 'full_name_en',
  'phone', 'email', 'site', 'address', 'legal_address', 'postal_address',
  'inn', 'kpp', 'ogrn', 'ogrnip', 'okpo', 'okved',
  'bank_account', 'bank_name', 'bik', 'corr_account',
  'director', 'director_position', 'director_basis', 'client_type',
];

/** Примечание клиента: полное наименование, коды, телефоны и источник данных. */
function buildNotes(entry) {
  const lines = [];
  if (entry.full_name) lines.push(`Полное наименование: ${entry.full_name}.`);

  const extra = Object.entries(entry.extra || {})
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([key, value]) => `${key} ${value}`);
  if (extra.length > 0) lines.push(`${extra.join(', ')}.`);

  (entry.extra_notes || []).forEach(note => lines.push(`${note}.`));
  if (entry.notes) lines.push(entry.notes);
  return lines.join('\n') || null;
}

/** Статус и уровень цен ищутся по названию — в базе они уже могут быть переименованы. */
async function lookupIdBy(runner, table, name) {
  if (!name) return null;
  const result = await runner.query(
    `SELECT id FROM ${table} WHERE lower(name) = lower($1) ORDER BY id LIMIT 1`, [name]);
  if (result.rows.length > 0) return result.rows[0].id;
  return null;
}

async function findClient(runner, entry) {
  const byInn = entry.inn
    ? await runner.query('SELECT id FROM clients WHERE inn = $1 ORDER BY id LIMIT 1', [entry.inn])
    : { rows: [] };
  if (byInn.rows.length > 0) return byInn.rows[0].id;

  const byName = await runner.query(
    'SELECT id FROM clients WHERE lower(name) = lower($1) ORDER BY id LIMIT 1', [entry.name]);
  return byName.rows.length > 0 ? byName.rows[0].id : null;
}

function insertClient(runner, entry, statusId, pricingLevelId) {
  const columns = [...CLIENT_FIELDS, 'notes', 'status_id', 'pricing_level_id'];
  const values = CLIENT_FIELDS.map(field => entry[field] || null);
  values[CLIENT_FIELDS.indexOf('client_type')] = entry.client_type || 'ooo';
  values.push(buildNotes(entry), statusId, pricingLevelId);

  const placeholders = columns.map((_, i) => `$${i + 1}`).join(',');
  return runner
    .query(`INSERT INTO clients (${columns.join(', ')})
            VALUES (${placeholders})
            RETURNING id`, values)
    .then(result => result.rows[0].id);
}

/**
 * Что в карточке расходится с файлом — для режима --refresh.
 * Сравниваем только непустые значения из файла: пустым полем не затираем.
 */
function diffClient(entry, row) {
  const changes = {};
  for (const field of CLIENT_FIELDS) {
    const want = entry[field] == null ? '' : String(entry[field]).trim();
    const have = row && row[field] != null ? String(row[field]).trim() : '';
    if (want && want !== have) changes[field] = { from: have || null, to: want };
  }
  return changes;
}

async function updateClient(runner, clientId, changes) {
  const fields = Object.keys(changes);
  if (fields.length === 0) return 0;
  const sets = fields.map((field, i) => `${field} = $${i + 1}`).join(', ');
  await runner.query(
    `UPDATE clients SET ${sets} WHERE id = $${fields.length + 1}`,
    [...fields.map(field => changes[field].to), clientId]
  );
  return fields.length;
}

/**
 * Кладёт PDF/документ из репозитория в uploads под стабильным именем
 * (хэш содержимого) — повторный запуск не создаёт копий на диске.
 */
function placeDocument(sourceFile, targetDir = CLIENT_FILES_DIR) {
  const absolute = path.join(FILES_DIR, sourceFile);
  if (!fs.existsSync(absolute)) {
    throw new Error(`файл ${sourceFile} не найден в ${FILES_DIR}`);
  }
  const buffer = fs.readFileSync(absolute);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const ext = path.extname(sourceFile).toLowerCase();
  const storedName = `preseed_${hash}${ext}`;
  const target = path.join(targetDir, storedName);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, buffer);
  }

  return {
    url: `/uploads/files/${storedName}`,
    type: ext.replace('.', ''),
    size: buffer.length,
  };
}

async function attachDocuments(runner, clientId, entry) {
  const documents = Array.isArray(entry.documents) ? entry.documents : [];
  let attached = 0;

  for (const doc of documents) {
    const stored = placeDocument(doc.file);
    const existing = await runner.query(
      'SELECT id FROM client_files WHERE client_id = $1 AND file_path = $2 LIMIT 1',
      [clientId, stored.url]
    );
    if (existing.rows.length > 0) continue;

    await runner.query(
      `INSERT INTO client_files (client_id, name, file_path, file_type, file_size, comment)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [clientId, doc.name || doc.file, stored.url, stored.type, stored.size, doc.comment || null]
    );
    attached += 1;
  }

  return attached;
}

/** Флаги командной строки: --refresh (файл — эталон) и --dry-run (только показать). */
function parseArgs(argv = []) {
  return {
    refresh: argv.includes('--refresh'),
    dryRun: argv.includes('--dry-run'),
  };
}

async function run(db = require('../db'), options = {}) {
  const { refresh, dryRun } = { refresh: false, dryRun: false, ...options };
  const { clients } = readConfig();
  if (clients.length === 0) {
    console.log('ℹ️  Предзаполнение: нет данных в src/db/preseed/clients.json');
    return;
  }

  console.log(`\n📥 Предзаполнение клиентами: ${clients.length} в источнике`
    + (refresh ? ' (режим --refresh: реквизиты обновляются из файла)' : '')
    + (dryRun ? ' [--dry-run: база не меняется]' : ''));

  let created = 0;
  let skipped = 0;
  let updated = 0;
  let files = 0;
  const errors = [];

  for (const entry of clients) {
    if (!entry || !entry.name) {
      errors.push('запись без name');
      continue;
    }

    try {
      const statusId = await lookupIdBy(db, 'client_work_statuses', entry.status);
      const pricingLevelId = await lookupIdBy(db, 'client_pricing_levels', entry.pricing_level);

      const existingId = await findClient(db, entry);
      let clientId = existingId;

      if (clientId) {
        skipped += 1;
        if (refresh) {
          const current = await db.query('SELECT * FROM clients WHERE id = $1', [clientId]);
          const changes = diffClient(entry, current.rows[0]);
          const fields = Object.keys(changes);
          if (fields.length === 0) {
            console.log(`↷  ${entry.name} — уже есть, реквизиты совпадают`);
          } else if (dryRun) {
            const shown = fields.map(field => `${field}: ${changes[field].from ?? '—'} → ${changes[field].to}`);
            console.log(`~  ${entry.name} — изменилось бы (${fields.length}): ${shown.join('; ')}`);
          } else {
            await updateClient(db, clientId, changes);
            updated += 1;
            console.log(`↻  ${entry.name} — обновлено полей: ${fields.length} (${fields.join(', ')})`);
          }
        } else {
          console.log(`↷  ${entry.name} — уже есть (id ${clientId})`);
        }
      } else {
        clientId = await insertClient(db, entry, statusId, pricingLevelId);
        created += 1;
        console.log(`+ ${entry.name} — создан (id ${clientId})`);
      }

      const attached = await attachDocuments(db, clientId, entry);
      files += attached;
      if (attached > 0) {
        console.log(`    📎 вложений добавлено: ${attached}`);
      }
    } catch (err) {
      errors.push(`${entry.name}: ${err.message}`);
      console.error(`✗ ${entry.name}: ${err.message}`);
    }
  }

  console.log(`✅ Предзаполнение: создано ${created}, уже было ${skipped}, `
    + `обновлено ${updated}, вложений ${files}`);
  if (errors.length > 0) {
    console.error(`⚠️  Ошибки: ${errors.join('; ')}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  const db = require('../db');
  run(db, parseArgs(process.argv.slice(2)))
    .catch((err) => {
      console.error('❌ Ошибка предзаполнения:', err.message);
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
  buildNotes, diffClient, updateClient, insertClient, parseArgs, placeDocument, readConfig, run,
  CLIENT_FIELDS, CLIENTS_JSON, FILES_DIR,
};
