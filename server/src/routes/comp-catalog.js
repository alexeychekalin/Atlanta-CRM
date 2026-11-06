const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const { normalizeUploadPath } = require('../utils/files');

const router = express.Router();

// «Без разделителей»: «а3776001» и «0201» должны находить «А.3776.001» и «02.01».
// Запрос с буквами — с двух символов, чисто числовой — с четырёх:
// иначе «15» совпадёт почти с любым артикулом.
function bareTerm(value) {
  const bare = String(value || '').toLowerCase().replace(/[\s.\-_/]+/g, '');
  if (bare.length < 2) return null;
  if (bare.length < 4 && !/[^\d]/.test(bare)) return null;
  return `%${bare}%`;
}

// GET /api/components
router.get('/', auth, async (req, res) => {
  try {
    const { category_id, search, active } = req.query;
    let sql = `
      SELECT c.*, cc.name AS category_name,
        (SELECT COUNT(*) FROM component_modifications cm WHERE cm.component_id = c.id) AS modifications_count,
        (SELECT COUNT(*) FROM component_images ci WHERE ci.component_id = c.id) AS images_count,
        (SELECT COUNT(*) FROM component_documents cd WHERE cd.component_id = c.id) AS doc_count,
        COALESCE((
          SELECT json_agg(json_build_object('id', cm.id, 'code', cm.code, 'name', cm.name,
                                            'full_article', cm.full_article)
                          ORDER BY cm.sort_order, cm.code)
          FROM component_modifications cm WHERE cm.component_id = c.id
        ), '[]'::json) AS modifications
      FROM components c
      LEFT JOIN component_categories cc ON c.category_id = cc.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (category_id) {
      sql += ` AND c.category_id = $${idx++}`;
      params.push(category_id);
    }
    if (search) {
      // ищем и по модификациям: код, название и полный артикул «А.3776.001-02.02»;
      // точки и дефисы можно не ставить — сравниваем ещё и без разделителей
      const like = idx;
      const bare = idx + 1;
      sql += ` AND (c.article ILIKE $${like} OR c.name ILIKE $${like}
        OR ($${bare}::text IS NOT NULL AND translate(lower(c.article), ' .-/_', '') LIKE $${bare})
        OR EXISTS (
          SELECT 1 FROM component_modifications cm
          WHERE cm.component_id = c.id
            AND (cm.code ILIKE $${like} OR cm.name ILIKE $${like}
                 OR COALESCE(cm.full_article, c.article || '-' || cm.code) ILIKE $${like}
                 OR ($${bare}::text IS NOT NULL
                     AND translate(lower(COALESCE(cm.full_article, c.article || '-' || cm.code)), ' .-/_', '') LIKE $${bare}))
        ))`;
      params.push(`%${search}%`, bareTerm(search));
      idx += 2;
    }
    if (active === 'true') {
      sql += ` AND c.is_active = true`;
    }

    sql += ' ORDER BY cc.sort_order, cc.name, c.name';

    const result = await db.query(sql, params);
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/components/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, cc.name AS category_name
       FROM components c
       LEFT JOIN component_categories cc ON c.category_id = cc.id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Компонент не найден' });

    const comp = result.rows[0];

    // Загрузить модификации с фото
    const modsRes = await db.query(
      `SELECT cm.*,
        COALESCE(
          (SELECT json_agg(json_build_object('id', cmi.id, 'image_path', cmi.image_path, 'sort_order', cmi.sort_order) ORDER BY cmi.sort_order, cmi.id)
           FROM component_modification_images cmi WHERE cmi.modification_id = cm.id
          ), '[]'::json
        ) as images
       FROM component_modifications cm
       WHERE cm.component_id = $1
       ORDER BY cm.sort_order, cm.code`,
      [req.params.id]
    );
    comp.modifications = modsRes.rows;

    const imagesRes = await db.query(
      'SELECT id, image_path, sort_order FROM component_images WHERE component_id = $1 ORDER BY sort_order, id',
      [req.params.id]
    );
    comp.images = imagesRes.rows;

    res.json(comp);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/components
router.post('/', auth, async (req, res) => {
  try {
    const { category_id, article, name, price, image_path, description, comment, is_active, gisp_url } = req.body;
    if (!article || !name) return res.status(400).json({ error: 'Укажите артикул и название' });

    const normalizedImage = image_path ? normalizeUploadPath(image_path) : null;
    if (image_path && !normalizedImage) {
      return res.status(400).json({ error: 'Недопустимый путь к изображению' });
    }

    const result = await db.query(
      `INSERT INTO components (category_id, article, name, price, image_path, description, comment, is_active, gisp_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [category_id || null, article, name, price || 0, normalizedImage, description || null, comment || null, is_active !== false, gisp_url || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Артикул уже существует' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/components/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const { category_id, article, name, price, image_path, description, comment, is_active, gisp_url } = req.body;

    let normalizedImage = image_path;
    if (image_path !== undefined && image_path !== null) {
      normalizedImage = normalizeUploadPath(image_path);
      if (!normalizedImage) {
        return res.status(400).json({ error: 'Недопустимый путь к изображению' });
      }
    }

    const result = await db.query(
      `UPDATE components SET
        category_id = COALESCE($1, category_id),
        article = COALESCE($2, article),
        name = COALESCE($3, name),
        price = COALESCE($4, price),
        image_path = COALESCE($5, image_path),
        description = $6,
        comment = $7,
        is_active = COALESCE($8, is_active),
        gisp_url = $9
       WHERE id = $10
       RETURNING *`,
      [category_id, article, name, price, normalizedImage, description, comment, is_active, gisp_url || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Компонент не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Артикул уже существует' });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/components/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM components WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
