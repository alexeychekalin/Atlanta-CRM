#!/usr/bin/env node
/* Приведение уже загруженных фото изделий к одному виду.
 *
 *   cd server
 *   npm run db:normalize-photos -- --dry-run     # посмотреть, что изменится
 *   npm run db:normalize-photos                  # сделать (с бэкапом)
 *   npm run db:normalize-photos -- --all         # + файлы в uploads/images без ссылок в базе
 *   npm run db:normalize-photos -- --restore=server/.photo-backup/<папка>
 *
 * Что делает: прозрачность → белый, обрезает однотонные поля, вписывает
 * изделие в белый квадрат. Фото сохраняется как JPEG: PNG/WebP-оригиналы
 * получают расширение .jpg, ссылки в базе обновляются на новый путь.
 * Оригиналы складываются в .photo-backup/<дата>, оттуда их можно вернуть
 * флагом --restore.
 *
 * Повторный запуск безопасен: уже нормализованные файлы пропускаются,
 * поэтому скрипт можно смело гонять после массовой загрузки фото.
 */
const fs = require('fs');
const path = require('path');

const db = require('../src/db');
const { normalizeProductPhoto, isNormalizablePhoto } = require('../src/services/photo-normalize');
const { normalizeUploadPath, safeUploadPath } = require('../src/utils/files');

const UPLOADS_DIR = path.resolve(__dirname, '../uploads');
const BACKUP_ROOT = path.resolve(__dirname, '../.photo-backup');

const args = process.argv.slice(2);
const has = name => args.includes(`--${name}`);
const valueOf = name => {
  const entry = args.find(item => item.startsWith(`--${name}=`));
  return entry ? entry.slice(name.length + 3) : null;
};

const DRY_RUN = has('dry-run');
const NO_BACKUP = has('no-backup');
const INCLUDE_ORPHANS = has('all');
const RESTORE_DIR = valueOf('restore');

/** Таблицы, где лежат фото изделий. Старые базы могут не иметь части таблиц. */
const PHOTO_SOURCES = [
  ['components', 'image_path'],
  ['component_images', 'image_path'],
  ['component_modification_images', 'image_path'],
  ['manufacturer_products', 'image_path'],
  ['proposal_items', 'image_path'],
];

async function referencedPaths() {
  const found = new Set();
  for (const [table, column] of PHOTO_SOURCES) {
    try {
      const result = await db.query(
        `SELECT DISTINCT ${column} AS p FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <> ''`
      );
      result.rows.forEach(row => found.add(row.p));
    } catch (err) {
      // Нет таблицы/колонки в этой сборке — не повод падать
      if (!/does not exist/i.test(err.message)) throw err;
    }
  }
  return found;
}

function orphanPaths() {
  const dir = path.join(UPLOADS_DIR, 'images');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => !name.startsWith('.'))
    .map(name => `/uploads/images/${name}`);
}

/**
 * После переименования файла (PNG → JPEG) ссылки в базе нужно поправить,
 * иначе карточки останутся с битой картинкой.
 */
async function updateReferences(oldPath, newPath) {
  const updates = [];
  for (const [table, column] of PHOTO_SOURCES) {
    try {
      const result = await db.query(
        `UPDATE ${table} SET ${column} = $1 WHERE ${column} = $2`,
        [newPath, oldPath]
      );
      if (result.rowCount) updates.push(`${table}.${column}: ${result.rowCount}`);
    } catch (err) {
      if (!/does not exist/i.test(err.message)) throw err;
    }
  }
  return updates;
}

function countFiles(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? countFiles(full) : 1;
  }
  return total;
}

function stamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function backupTarget(urlPath, backupDir) {
  const absolute = safeUploadPath(urlPath);
  if (!absolute) return null;
  return path.join(backupDir, path.relative(UPLOADS_DIR, absolute));
}

// Копии, снятые в этом запуске. Удаляем только их: в копии от прошлого
// запуска может лежать настоящий оригинал, уже перезаписанного фото.
const backedUpNow = new Set();

async function backupFile(urlPath, backupDir) {
  if (NO_BACKUP || DRY_RUN) return;
  const absolute = safeUploadPath(urlPath);
  const target = backupTarget(urlPath, backupDir);
  if (!absolute || !target || !fs.existsSync(absolute)) return;
  backedUpNow.add(target);
  if (fs.existsSync(target)) return;
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.copyFile(absolute, target);
}

/** Файл не изменился — копия, снятая только что, не нужна. */
async function dropBackup(urlPath, backupDir) {
  if (NO_BACKUP || DRY_RUN) return;
  const target = backupTarget(urlPath, backupDir);
  if (target && backedUpNow.has(target)) await fs.promises.unlink(target).catch(() => {});
}

async function restore(fromDir) {
  const source = path.resolve(fromDir);
  if (!fs.existsSync(source)) {
    throw new Error(`Папка бэкапа не найдена: ${source}`);
  }
  let restored = 0;
  const walk = async dir => {
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const relative = path.relative(source, full);
      const target = path.join(UPLOADS_DIR, relative);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.copyFile(full, target);
      restored += 1;
    }
  };
  await walk(source);
  return restored;
}

async function main() {
  if (RESTORE_DIR) {
    const restored = await restore(RESTORE_DIR);
    console.log(`♻️  Возвращено файлов из бэкапа: ${restored}`);
    return;
  }

  const paths = await referencedPaths();
  const orphans = INCLUDE_ORPHANS ? orphanPaths().filter(p => !paths.has(p)) : [];

  const candidates = [...paths, ...orphans]
    .map(p => normalizeUploadPath(p))
    .filter(Boolean)
    .filter(p => isNormalizablePhoto(p))
    .sort();

  console.log(`🖼  Фото к обработке: ${candidates.length}` +
    (orphans.length ? ` (в том числе ${orphans.length} без ссылок в базе)` : ''));
  if (DRY_RUN) console.log('ℹ️  Режим проверки: файлы не меняются');

  const backupDir = NO_BACKUP ? null : path.join(BACKUP_ROOT, stamp());
  if (backupDir && !DRY_RUN) {
    await fs.promises.mkdir(backupDir, { recursive: true });
    console.log(`📦 Бэкап оригиналов: ${backupDir}`);
  }

  const stats = { changed: 0, skipped: 0, tooSmall: 0, failed: 0, missing: 0, renamed: 0, savedBytes: 0 };
  let processed = 0;

  for (const urlPath of candidates) {
    const absolute = safeUploadPath(urlPath);
    if (!absolute || !fs.existsSync(absolute)) {
      stats.missing += 1;
      continue;
    }
    try {
      const before = fs.statSync(absolute).size;
      // Бэкап — до перезаписи: после неё оригинал уже не вернуть
      await backupFile(urlPath, backupDir);
      const result = await normalizeProductPhoto(absolute, { dryRun: DRY_RUN });
      if (result.changed) {
        stats.changed += 1;
        stats.savedBytes += before - result.size;
        if (result.path !== absolute) {
          stats.renamed += 1;
          // тот же каталог, новое имя файла
          if (!DRY_RUN) await updateReferences(urlPath, urlPath.replace(/[^/]+$/, path.basename(result.path)));
        }
      } else if (result.reason === 'too-small') {
        stats.tooSmall += 1;
      } else {
        stats.skipped += 1;
      }
      if (!result.changed) await dropBackup(urlPath, backupDir);
    } catch (err) {
      stats.failed += 1;
      console.warn(`  ! ${urlPath}: ${err.message}`);
    }

    processed += 1;
    if (processed % 50 === 0) {
      console.log(`  … ${processed}/${candidates.length}`);
    }
  }

  console.log('');
  console.log(`${DRY_RUN ? '📋 Изменилось бы' : '✅ Обработано'}: ${stats.changed}` +
    ` | уже в порядке: ${stats.skipped}` +
    ` | мелких (не растягиваем): ${stats.tooSmall}` +
    ` | переименовано в .jpg: ${stats.renamed}` +
    ` | нет файла: ${stats.missing}` +
    ` | ошибок: ${stats.failed}`);
  if (stats.savedBytes !== 0) {
    const size = `${(Math.abs(stats.savedBytes) / 1024 / 1024).toFixed(1)} МБ`;
    console.log(stats.savedBytes > 0 ? `💾 Освободилось: ${size}` : `📦 Стало больше: ${size}`);
  }
  if (backupDir && !DRY_RUN && fs.existsSync(backupDir)) {
    if (countFiles(backupDir) === 0) {
      // Всё уже было в порядке — пустой бэкап не нужен
      await fs.promises.rm(backupDir, { recursive: true, force: true });
      console.log('📦 Бэкап не понадобился: менять было нечего');
    } else {
      console.log(`↩️  Вернуть оригиналы: npm run db:normalize-photos -- --restore=${backupDir}`);
    }
  }
}

main()
  .then(async () => {
    if (typeof db.close === 'function') await db.close();
    process.exit(0);
  })
  .catch(async err => {
    console.error('❌ Ошибка нормализации фото:', err.message);
    if (typeof db.close === 'function') await db.close();
    process.exit(1);
  });
