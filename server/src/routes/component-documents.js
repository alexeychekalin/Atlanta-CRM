const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const fs = require('fs');
const archiver = require('archiver');
const { safeUploadPath, normalizeUploadPath, safeArchiveName } = require('../utils/files');

const router = express.Router({ mergeParams: true });

const DOC_TYPES = new Set(['certificate', 'info']);

// GET /api/components/:id/documents
router.get('/', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT * FROM component_documents WHERE component_id = $1 ORDER BY doc_type, created_at DESC`,
      [id]
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/components/:id/documents
router.post('/', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { doc_type, file_path, original_name, file_type, file_size, comment } = req.body;

    if (!doc_type || !file_path || !original_name) {
      return res.status(400).json({ error: 'doc_type, file_path и original_name обязательны' });
    }
    if (!DOC_TYPES.has(doc_type)) {
      return res.status(400).json({ error: 'doc_type должен быть certificate или info' });
    }

    // Принимаем только файлы, реально загруженные в /uploads
    const normalizedPath = normalizeUploadPath(file_path);
    if (!normalizedPath) {
      return res.status(400).json({ error: 'Недопустимый путь к файлу' });
    }
    if (!fs.existsSync(safeUploadPath(normalizedPath))) {
      return res.status(400).json({ error: 'Файл не найден в хранилище' });
    }

    const component = await db.query('SELECT id FROM components WHERE id = $1', [id]);
    if (component.rows.length === 0) {
      return res.status(404).json({ error: 'Компонент не найден' });
    }

    const result = await db.query(
      `INSERT INTO component_documents (component_id, doc_type, file_path, original_name, file_type, file_size, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, doc_type, normalizedPath, safeArchiveName(original_name, 'document'), file_type || null, file_size || null, comment || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/components/:id/documents/:docId
router.delete('/:docId', auth, async (req, res) => {
  try {
    const { id, docId } = req.params;

    const doc = await db.query(
      'SELECT file_path FROM component_documents WHERE id = $1 AND component_id = $2',
      [docId, id]
    );
    if (doc.rows.length === 0) {
      return res.status(404).json({ error: 'Документ не найден' });
    }

    await db.query('DELETE FROM component_documents WHERE id = $1 AND component_id = $2', [docId, id]);

    const filePath = safeUploadPath(doc.rows[0].file_path);
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkErr) {
        console.error('Не удалось удалить файл документа:', unlinkErr.message);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/components/:id/documents/download-all — ZIP-архив всех документов компонента
router.get('/download-all', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT * FROM component_documents WHERE component_id = $1 ORDER BY doc_type, original_name`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Нет документов' });
    }

    const files = result.rows
      .map(doc => ({ doc, filePath: safeUploadPath(doc.file_path) }))
      .filter(item => item.filePath && fs.existsSync(item.filePath));

    if (files.length === 0) {
      return res.status(404).json({ error: 'Файлы документов не найдены' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="docs_component_${Number(id) || 0}.zip"`);

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.on('error', (err) => {
      console.error('Ошибка архивации документов компонента:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Не удалось сформировать архив' });
      else res.destroy(err);
    });
    archive.pipe(res);

    for (const { doc, filePath } of files) {
      const folder = doc.doc_type === 'certificate' ? 'Сертификаты' : 'Информация';
      archive.file(filePath, { name: `${folder}/${safeArchiveName(doc.original_name)}` });
    }

    await archive.finalize();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = router;
