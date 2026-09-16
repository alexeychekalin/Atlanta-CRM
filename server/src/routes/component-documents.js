const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const router = express.Router({ mergeParams: true });

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
    const result = await db.query(
      `INSERT INTO component_documents (component_id, doc_type, file_path, original_name, file_type, file_size, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, doc_type, file_path, original_name, file_type || null, file_size || null, comment || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/components/:id/documents/:docId
router.delete('/:docId', auth, async (req, res) => {
  try {
    const { docId } = req.params;
    // Получить путь файла для удаления с диска
    const doc = await db.query('SELECT file_path FROM component_documents WHERE id = $1', [docId]);
    if (doc.rows.length > 0) {
      const filePath = path.join(__dirname, '../../', doc.rows[0].file_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await db.query('DELETE FROM component_documents WHERE id = $1', [docId]);
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

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="docs_component_${id}.zip"`);

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);

    for (const doc of result.rows) {
      const filePath = path.join(__dirname, '../../', doc.file_path);
      if (fs.existsSync(filePath)) {
        const folder = doc.doc_type === 'certificate' ? 'Сертификаты' : 'Информация';
        archive.file(filePath, { name: `${folder}/${doc.original_name}` });
      }
    }

    await archive.finalize();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
