/**
 * Библиотека документов — раздел «Документы»: вложенные папки с PDF, DOC/DOCX,
 * изображениями, таблицами и архивами.
 *
 * Права проверяет requirePermission('documents') в src/index.js:
 *   • view   — все роли, которым в матрице прав разрешён просмотр;
 *   • edit   — загрузка файлов, папки;
 *   • delete — удаление.
 * По умолчанию изменять может только администратор: остальным ролям
 * в migrate_roles.js выдан только просмотр.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const db = require('../db');
const { safeUploadPath, normalizeUploadPath, safeArchiveName } = require('../utils/files');
const {
  MAX_FILE_SIZE,
  isAllowedFile,
  normalizeFolderName,
  normalizeFileName,
  fileKind,
  isPreviewable,
  isImage,
  mimeType,
  breadcrumbs,
  archiveEntries,
  contentDisposition,
  archiveName,
} = require('../services/document-library');

const router = express.Router();

/** id из адреса: только положительное целое, иначе null. */
function parseId(value) {
  const text = String(value === null || value === undefined ? '' : value);
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return number > 0 ? number : null;
}

async function loadFolders() {
  const result = await db.query(
    'SELECT id, name, parent_id, created_at FROM document_folders ORDER BY lower(name), id'
  );
  return result.rows;
}

async function loadFiles(folderId) {
  // Два варианта запроса вместо IS NOT DISTINCT FROM $1: у null-параметра
  // PostgreSQL не может вывести тип, и запрос падает на пустом корне.
  const sql = folderId
    ? `SELECT f.*, u.full_name AS uploaded_by_name
         FROM document_files f
         LEFT JOIN users u ON u.id = f.uploaded_by
        WHERE f.folder_id = $1
        ORDER BY lower(f.name), f.id`
    : `SELECT f.*, u.full_name AS uploaded_by_name
         FROM document_files f
         LEFT JOIN users u ON u.id = f.uploaded_by
        WHERE f.folder_id IS NULL
        ORDER BY lower(f.name), f.id`;
  const result = await db.query(sql, folderId ? [folderId] : []);
  return result.rows;
}

/** Сколько файлов лежит непосредственно в каждой папке. */
async function fileCounts() {
  const result = await db.query(
    'SELECT folder_id, COUNT(*)::int AS files_count FROM document_files GROUP BY folder_id'
  );
  const counts = new Map();
  for (const row of result.rows) counts.set(Number(row.folder_id), Number(row.files_count) || 0);
  return counts;
}

async function folderExists(folderId) {
  const result = await db.query('SELECT 1 FROM document_folders WHERE id = $1', [folderId]);
  return result.rows.length > 0;
}

function decorateFile(file) {
  const kind = fileKind(file.name);
  return {
    ...file,
    file_size: file.file_size === null || file.file_size === undefined ? null : Number(file.file_size),
    icon: kind.icon,
    kind: kind.label,
    previewable: isPreviewable(file.name),
    image: isImage(file.name),
  };
}

// GET /api/documents/browse?folder=5 — содержимое папки (без folder — корень)
router.get('/browse', async (req, res) => {
  try {
    const raw = req.query.folder;
    const folderId = raw === undefined || raw === '' ? null : parseId(raw);
    if (raw !== undefined && raw !== '' && !folderId) {
      return res.status(400).json({ error: 'Некорректная папка' });
    }

    const folders = await loadFolders();
    const current = folderId ? folders.find(folder => Number(folder.id) === folderId) : null;
    if (folderId && !current) return res.status(404).json({ error: 'Папка не найдена' });

    const counts = await fileCounts();
    const childrenOf = new Map();
    for (const folder of folders) {
      const parent = folder.parent_id === null ? null : Number(folder.parent_id);
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent).push(folder);
    }
    // «2 файла» на карточке папки — с учётом вложенных: иначе «Сертификаты»
    // с двумя документами внутри подпапки выглядели бы пустыми
    const totals = new Map();
    const totalFiles = (id, guard = 0) => {
      if (totals.has(id)) return totals.get(id);
      if (guard > 100) return 0;
      let total = counts.get(id) || 0;
      for (const child of childrenOf.get(id) || []) total += totalFiles(Number(child.id), guard + 1);
      totals.set(id, total);
      return total;
    };

    const children = (childrenOf.get(folderId) || []).map(folder => ({
      id: Number(folder.id),
      name: folder.name,
      parent_id: folder.parent_id === null ? null : Number(folder.parent_id),
      files_count: counts.get(Number(folder.id)) || 0,
      total_files: totalFiles(Number(folder.id)),
      folders_count: (childrenOf.get(Number(folder.id)) || []).length,
    }));

    const files = (await loadFiles(folderId)).map(decorateFile);

    res.json({
      folder: current
        ? { id: Number(current.id), name: current.name, parent_id: current.parent_id === null ? null : Number(current.parent_id) }
        : null,
      breadcrumbs: current ? breadcrumbs(folders, current.id) : [],
      folders: children,
      files,
      limits: { max_file_size: MAX_FILE_SIZE },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/documents/folders — создать папку
router.post('/folders', async (req, res) => {
  const name = normalizeFolderName(req.body && req.body.name);
  if (!name) return res.status(400).json({ error: 'Укажите название папки' });

  const rawParent = req.body ? req.body.parent_id : null;
  const parentId = rawParent === undefined || rawParent === null || rawParent === '' ? null : parseId(rawParent);
  if (rawParent !== undefined && rawParent !== null && rawParent !== '' && !parentId) {
    return res.status(400).json({ error: 'Некорректная родительская папка' });
  }

  try {
    if (parentId && !await folderExists(parentId)) {
      return res.status(404).json({ error: 'Родительская папка не найдена' });
    }

    const duplicate = await db.query(
      `SELECT 1 FROM document_folders
        WHERE COALESCE(parent_id, 0) = COALESCE($1::int, 0) AND lower(name) = lower($2)`,
      [parentId, name]
    );
    if (duplicate.rows.length > 0) {
      return res.status(409).json({ error: 'Папка с таким названием уже есть' });
    }

    const result = await db.query(
      `INSERT INTO document_folders (name, parent_id, created_by)
       VALUES ($1, $2, $3) RETURNING id, name, parent_id, created_at`,
      [name, parentId, req.user && req.user.id ? req.user.id : null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Папка с таким названием уже есть' });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/documents/folders/:id — переименовать папку
router.patch('/folders/:id', async (req, res) => {
  const folderId = parseId(req.params.id);
  if (!folderId) return res.status(404).json({ error: 'Папка не найдена' });

  const name = normalizeFolderName(req.body && req.body.name);
  if (!name) return res.status(400).json({ error: 'Укажите название папки' });

  try {
    const current = await db.query('SELECT id, parent_id FROM document_folders WHERE id = $1', [folderId]);
    if (current.rows.length === 0) return res.status(404).json({ error: 'Папка не найдена' });

    const parentId = current.rows[0].parent_id === null ? null : Number(current.rows[0].parent_id);
    const duplicate = await db.query(
      `SELECT 1 FROM document_folders
        WHERE COALESCE(parent_id, 0) = COALESCE($1::int, 0)
          AND lower(name) = lower($2) AND id <> $3`,
      [parentId, name, folderId]
    );
    if (duplicate.rows.length > 0) {
      return res.status(409).json({ error: 'Папка с таким названием уже есть' });
    }

    const result = await db.query(
      'UPDATE document_folders SET name = $1 WHERE id = $2 RETURNING id, name, parent_id',
      [name, folderId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Папка с таким названием уже есть' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/documents/folders/:id — удалить папку со всем содержимым
router.delete('/folders/:id', async (req, res) => {
  const folderId = parseId(req.params.id);
  if (!folderId) return res.status(404).json({ error: 'Папка не найдена' });

  try {
    const folders = await loadFolders();
    if (!folders.some(folder => Number(folder.id) === folderId)) {
      return res.status(404).json({ error: 'Папка не найдена' });
    }

    // Собираем папку и всех потомков: удаляем и файлы с диска, а не только строки
    const ids = new Set([folderId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of folders) {
        const parent = folder.parent_id === null ? null : Number(folder.parent_id);
        if (parent && ids.has(parent) && !ids.has(Number(folder.id))) {
          ids.add(Number(folder.id));
          changed = true;
        }
      }
    }

    const fileRows = await db.query(
      `SELECT id, file_path FROM document_files WHERE folder_id = ANY($1::int[])`,
      [[...ids]]
    );

    await db.query('DELETE FROM document_folders WHERE id = $1', [folderId]);

    let removed = 0;
    for (const row of fileRows.rows) {
      if (await removeStoredFile(row.file_path)) removed += 1;
    }

    res.json({ success: true, folders: ids.size, files: fileRows.rows.length, removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Удаляет физический файл, если на него больше не ссылается ни один документ.
 * Один и тот же путь теоретически может встретиться в двух записях.
 */
async function removeStoredFile(filePath) {
  const absolute = safeUploadPath(filePath);
  if (!absolute) return false;
  try {
    const used = await db.query('SELECT 1 FROM document_files WHERE file_path = $1 LIMIT 1', [filePath]);
    if (used.rows.length > 0) return false;
    if (!fs.existsSync(absolute)) return false;
    fs.unlinkSync(absolute);
    return true;
  } catch {
    return false;
  }
}

// POST /api/documents/files — зарегистрировать уже загруженный файл в папке
router.post('/files', async (req, res) => {
  const body = req.body || {};
  const rawFolder = body.folder_id;
  const folderId = rawFolder === undefined || rawFolder === null || rawFolder === '' ? null : parseId(rawFolder);
  if (rawFolder !== undefined && rawFolder !== null && rawFolder !== '' && !folderId) {
    return res.status(400).json({ error: 'Некорректная папка' });
  }

  const filePath = normalizeUploadPath(body.file_path);
  if (!filePath) return res.status(400).json({ error: 'Недопустимый путь к файлу' });
  // Файлы библиотеки лежат только в uploads/library — чужие загрузки не принимаем
  if (!filePath.startsWith('/uploads/library/')) {
    return res.status(400).json({ error: 'Файл загружен не в библиотеку документов' });
  }

  const absolute = safeUploadPath(filePath);
  if (!absolute || !fs.existsSync(absolute)) {
    return res.status(400).json({ error: 'Файл не найден в хранилище' });
  }

  const original = body.original_name || path.basename(filePath);
  const fallback = path.basename(filePath, path.extname(filePath)) || 'Документ';
  const name = normalizeFileName(body.name || original, fallback);
  if (!isAllowedFile(name)) {
    return res.status(400).json({ error: 'Недопустимый формат файла' });
  }

  let size = null;
  try {
    size = fs.statSync(absolute).size;
  } catch {
    size = Number(body.file_size) > 0 ? Number(body.file_size) : null;
  }

  try {
    if (folderId && !await folderExists(folderId)) {
      return res.status(404).json({ error: 'Папка не найдена' });
    }

    const result = await db.query(
      `INSERT INTO document_files (folder_id, name, file_path, file_type, file_size, comment, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        folderId,
        name,
        filePath,
        path.extname(name).replace('.', '').toLowerCase() || null,
        size,
        body.comment ? String(body.comment).slice(0, 2000) : null,
        req.user && req.user.id ? req.user.id : null,
      ]
    );
    res.status(201).json(decorateFile(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/documents/files/:id — переименовать / изменить комментарий
router.patch('/files/:id', async (req, res) => {
  const fileId = parseId(req.params.id);
  if (!fileId) return res.status(404).json({ error: 'Файл не найден' });

  const body = req.body || {};
  const has = key => Object.prototype.hasOwnProperty.call(body, key);

  try {
    const current = await db.query('SELECT * FROM document_files WHERE id = $1', [fileId]);
    if (current.rows.length === 0) return res.status(404).json({ error: 'Файл не найден' });
    const file = current.rows[0];

    let name = file.name;
    if (has('name')) {
      const proposed = normalizeFileName(body.name, path.basename(file.name, path.extname(file.name)) || 'Документ');
      if (!proposed) return res.status(400).json({ error: 'Укажите название файла' });
      // Расширение — часть формата: не даём «потерять» его при переименовании
      const oldExt = path.extname(file.name);
      name = path.extname(proposed) ? proposed : `${proposed}${oldExt}`;
      if (!isAllowedFile(name)) return res.status(400).json({ error: 'Недопустимый формат файла' });
    }

    const result = await db.query(
      `UPDATE document_files
          SET name = $1,
              comment = CASE WHEN $2 THEN $3 ELSE comment END
        WHERE id = $4 RETURNING *`,
      [name, has('comment'), has('comment') ? String(body.comment || '').slice(0, 2000) : null, fileId]
    );
    res.json(decorateFile(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/documents/files/:id
router.delete('/files/:id', async (req, res) => {
  const fileId = parseId(req.params.id);
  if (!fileId) return res.status(404).json({ error: 'Файл не найден' });

  try {
    const result = await db.query(
      'DELETE FROM document_files WHERE id = $1 RETURNING file_path',
      [fileId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Файл не найден' });

    await removeStoredFile(result.rows[0].file_path);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Отдаёт файл: inline — для фото и PDF, attachment — для всего остального. */
function sendDocument(res, file, inline) {
  const absolute = safeUploadPath(file.file_path);
  if (!absolute || !fs.existsSync(absolute)) {
    return res.status(404).json({ error: 'Файл не найден в хранилище' });
  }

  const disposition = inline && isPreviewable(file.name) ? 'inline' : 'attachment';
  res.setHeader('Content-Type', mimeType(file.name));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', contentDisposition(disposition, file.name));
  return res.sendFile(absolute);
}

// GET /api/documents/files/:id/view — открыть в браузере (фото, PDF)
router.get('/files/:id/view', async (req, res) => {
  const fileId = parseId(req.params.id);
  if (!fileId) return res.status(404).json({ error: 'Файл не найден' });
  try {
    const result = await db.query('SELECT * FROM document_files WHERE id = $1', [fileId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Файл не найден' });
    return sendDocument(res, result.rows[0], true);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/files/:id/download
router.get('/files/:id/download', async (req, res) => {
  const fileId = parseId(req.params.id);
  if (!fileId) return res.status(404).json({ error: 'Файл не найден' });
  try {
    const result = await db.query('SELECT * FROM document_files WHERE id = $1', [fileId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Файл не найден' });
    return sendDocument(res, result.rows[0], false);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Собирает ZIP: папку со всеми подпапками или всю библиотеку.
 * Сжатие умеренное, файлы уже сжаты (PDF, JPEG, DOCX).
 */
async function streamArchive(res, folderId, zipName) {
  const folders = await loadFolders();
  const target = folderId ? folders.find(folder => Number(folder.id) === folderId) : null;
  if (folderId && !target) return res.status(404).json({ error: 'Папка не найдена' });

  // Папка + все потомки
  let scopedFolders = folders;
  if (folderId) {
    const ids = new Set([folderId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of folders) {
        const parent = folder.parent_id === null ? null : Number(folder.parent_id);
        if (parent && ids.has(parent) && !ids.has(Number(folder.id))) {
          ids.add(Number(folder.id));
          changed = true;
        }
      }
    }
    scopedFolders = folders.filter(folder => ids.has(Number(folder.id)));
  }

  let files;
  if (folderId) {
    files = await db.query(
      `SELECT * FROM document_files WHERE folder_id = ANY($1::int[]) ORDER BY folder_id, lower(name)`,
      [scopedFolders.map(folder => Number(folder.id))]
    );
  } else {
    files = await db.query('SELECT * FROM document_files ORDER BY folder_id, lower(name)');
  }

  if (files.rows.length === 0) {
    return res.status(404).json({ error: 'В папке нет файлов для архива' });
  }

  // Каждый сегмент пути проверяем отдельно: safeArchiveName отбрасывает папки,
  // если передать ему путь целиком.
  const entries = archiveEntries(scopedFolders, files.rows, folderId || null)
    .map(entry => ({
      ...entry,
      absolute: safeUploadPath(entry.file.file_path),
      name: entry.name.split('/').map(part => safeArchiveName(part, 'file')).join('/'),
    }))
    .filter(entry => entry.absolute && fs.existsSync(entry.absolute));

  if (entries.length === 0) {
    return res.status(404).json({ error: 'Файлы не найдены в хранилище' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', contentDisposition('attachment', zipName));

  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.on('warning', (err) => {
    if (err.code !== 'ENOENT') console.error('Предупреждение архива документов:', err);
  });
  archive.on('error', (err) => {
    console.error('Ошибка архивации документов:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Не удалось сформировать архив' });
    else res.destroy(err);
  });
  archive.on('end', () => {
    if (!res.writableEnded) res.end();
  });

  archive.pipe(res);
  for (const entry of entries) {
    archive.file(entry.absolute, { name: entry.name });
  }
  await archive.finalize();
  return undefined;
}

// GET /api/documents/archive — вся библиотека одним архивом
router.get('/archive', async (req, res) => {
  try {
    await streamArchive(res, null, archiveName('Документы'));
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/folders/:id/archive — папка со всеми подпапками
router.get('/folders/:id/archive', async (req, res) => {
  const folderId = parseId(req.params.id);
  if (!folderId) return res.status(404).json({ error: 'Папка не найдена' });
  try {
    const folder = await db.query('SELECT name FROM document_folders WHERE id = $1', [folderId]);
    if (folder.rows.length === 0) return res.status(404).json({ error: 'Папка не найдена' });
    await streamArchive(res, folderId, archiveName(folder.rows[0].name));
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = router;
