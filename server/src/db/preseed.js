/**
 * Предзаполнение системы клиентами, с которыми CRM запускается в эксплуатацию.
 *
 * Источник данных — src/db/preseed/clients.json и файлы из src/db/preseed/files/.
 * Скрипт идемпотентен: клиент ищется по ИНН (без ИНН — по названию), файлы —
 * по имени файла внутри карточки. Повторный деплой ничего не дублирует
 * и не перезаписывает правки, сделанные в интерфейсе.
 *
 * Запуск:
 *   npm run db:preseed      # обычная база (DATABASE_URL)
 *   npm run demo:preseed    # демо на PGlite (PGLITE_DIR)
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

async function insertClient(runner, entry, statusId, pricingLevelId) {
  const result = await runner.query(
    `INSERT INTO clients (name, phone, email, site, address, notes, status_id, pricing_level_id,
       inn, kpp, legal_address, ogrn, postal_address, bank_account, bank_name, bik, corr_account,
       director, client_type, ogrnip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING id`,
    [
      entry.name,
      entry.phone || null,
      entry.email || null,
      entry.site || null,
      entry.address || null,
      buildNotes(entry),
      statusId,
      pricingLevelId,
      entry.inn || null,
      entry.kpp || null,
      entry.legal_address || null,
      entry.ogrn || null,
      entry.postal_address || null,
      entry.bank_account || null,
      entry.bank_name || null,
      entry.bik || null,
      entry.corr_account || null,
      entry.director || null,
      entry.client_type || 'ooo',
      entry.ogrnip || null,
    ]
  );
  return result.rows[0].id;
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

async function run(db = require('../db')) {
  const { clients } = readConfig();
  if (clients.length === 0) {
    console.log('ℹ️  Предзаполнение: нет данных в src/db/preseed/clients.json');
    return;
  }

  console.log(`\n📥 Предзаполнение клиентами: ${clients.length} в источнике`);

  let created = 0;
  let skipped = 0;
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
        console.log(`↷  ${entry.name} — уже есть (id ${clientId})`);
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

  console.log(`✅ Предзаполнение: создано ${created}, уже было ${skipped}, вложений ${files}`);
  if (errors.length > 0) {
    console.error(`⚠️  Ошибки: ${errors.join('; ')}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  const db = require('../db');
  run(db)
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

module.exports = { buildNotes, placeDocument, readConfig, run, CLIENTS_JSON, FILES_DIR };
