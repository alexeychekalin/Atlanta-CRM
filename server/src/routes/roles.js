const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/role');

const router = express.Router();

// GET /api/roles — список всех ролей с количеством пользователей
router.get('/', auth, async (req, res) => {
  try {
    const query = `
      SELECT 
        r.*,
        COUNT(u.id)::int as users_count
      FROM roles r
      LEFT JOIN users u ON u.role_id = r.id OR u.role = r.name
      GROUP BY r.id
      ORDER BY r.is_system DESC, r.id ASC
    `;
    const result = await db.query(query);
    res.json({ data: result.rows });
  } catch (err) {
    console.error('Ошибка получения списка ролей:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/roles/:id — получить данные роли
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM roles WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Роль не найдена' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка получения роли:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/roles — создать новую роль
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { name, display_name, description, permissions } = req.body;

    if (!display_name || !display_name.trim()) {
      return res.status(400).json({ error: 'Укажите название роли' });
    }

    // Генерация системного имени роли если не передано
    const sysName = (name && name.trim()) 
      ? name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
      : 'role_' + Date.now();

    // Проверка уникальности
    const existing = await db.query('SELECT id FROM roles WHERE name = $1', [sysName]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Роль с таким системным идентификатором уже существует' });
    }

    const perms = permissions && typeof permissions === 'object' ? permissions : {};

    const result = await db.query(`
      INSERT INTO roles (name, display_name, description, is_system, permissions)
      VALUES ($1, $2, $3, false, $4)
      RETURNING *
    `, [sysName, display_name.trim(), description ? description.trim() : null, JSON.stringify(perms)]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка создания роли:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/roles/:id — обновить роль и права
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { display_name, description, permissions } = req.body;

    const check = await db.query('SELECT * FROM roles WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Роль не найдена' });
    }

    const currentRole = check.rows[0];

    if (!display_name || !display_name.trim()) {
      return res.status(400).json({ error: 'Укажите название роли' });
    }

    const perms = permissions && typeof permissions === 'object' ? permissions : currentRole.permissions;

    const result = await db.query(`
      UPDATE roles
      SET 
        display_name = $1,
        description = $2,
        permissions = $3
      WHERE id = $4
      RETURNING *
    `, [
      display_name.trim(),
      description !== undefined ? (description ? description.trim() : null) : currentRole.description,
      JSON.stringify(perms),
      req.params.id,
    ]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка обновления роли:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// DELETE /api/roles/:id — удалить роль
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    const check = await db.query('SELECT * FROM roles WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Роль не найдена' });
    }

    const role = check.rows[0];

    if (role.is_system) {
      return res.status(400).json({ error: 'Системную роль нельзя удалить' });
    }

    // Проверка, есть ли пользователи с этой ролью
    const usersWithRole = await db.query(
      'SELECT id FROM users WHERE role_id = $1 OR role = $2 LIMIT 1',
      [role.id, role.name]
    );

    if (usersWithRole.rows.length > 0) {
      return res.status(400).json({ 
        error: 'Нельзя удалить роль, назначенную пользователям. Сначала переназначьте их на другую роль.' 
      });
    }

    await db.query('DELETE FROM roles WHERE id = $1', [req.params.id]);
    res.json({ message: 'Роль успешно удалена' });
  } catch (err) {
    console.error('Ошибка удаления роли:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
