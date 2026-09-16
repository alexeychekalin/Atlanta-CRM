const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/role');

const router = express.Router();

// GET /api/users — список пользователей с информацией о роли
router.get('/', auth, adminOnly, async (req, res) => {
  try {
    const query = `
      SELECT 
        u.id,
        u.username,
        u.full_name,
        u.role,
        u.role_id,
        u.created_at,
        r.name as role_name,
        r.display_name as role_display_name,
        r.description as role_description,
        r.is_system as role_is_system,
        r.permissions as role_permissions
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id OR u.role = r.name
      ORDER BY u.id ASC
    `;
    const result = await db.query(query);
    res.json({ data: result.rows });
  } catch (err) {
    console.error('Ошибка получения списка пользователей:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/users/:id — получить данные пользователя
router.get('/:id', auth, adminOnly, async (req, res) => {
  try {
    const query = `
      SELECT 
        u.id,
        u.username,
        u.full_name,
        u.role,
        u.role_id,
        u.created_at,
        r.name as role_name,
        r.display_name as role_display_name,
        r.permissions as role_permissions
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id OR u.role = r.name
      WHERE u.id = $1
    `;
    const result = await db.query(query, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка получения пользователя:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/users — создать нового пользователя
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { username, password, full_name, role_id, role } = req.body;

    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'Укажите логин' });
    }
    if (!password || password.length < 4) {
      return res.status(400).json({ error: 'Пароль должен содержать минимум 4 символа' });
    }
    if (!full_name || !full_name.trim()) {
      return res.status(400).json({ error: 'Укажите ФИО пользователя' });
    }

    // Проверка уникальности логина
    const existing = await db.query('SELECT id FROM users WHERE username = $1', [username.trim()]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Пользователь с таким логином уже существует' });
    }

    // Определяем role_id и role name
    let assignedRoleId = null;
    let assignedRoleName = 'viewer';

    if (role_id) {
      const rRes = await db.query('SELECT id, name FROM roles WHERE id = $1', [role_id]);
      if (rRes.rows.length > 0) {
        assignedRoleId = rRes.rows[0].id;
        assignedRoleName = rRes.rows[0].name;
      }
    } else if (role) {
      const rRes = await db.query('SELECT id, name FROM roles WHERE name = $1', [role]);
      if (rRes.rows.length > 0) {
        assignedRoleId = rRes.rows[0].id;
        assignedRoleName = rRes.rows[0].name;
      } else {
        assignedRoleName = role;
      }
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await db.query(`
      INSERT INTO users (username, password_hash, full_name, role, role_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, username, full_name, role, role_id, created_at
    `, [username.trim(), passwordHash, full_name.trim(), assignedRoleName, assignedRoleId]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка создания пользователя:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/users/:id — обновить пользователя
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { full_name, role_id, role, password } = req.body;

    const check = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const currentUser = check.rows[0];

    // Запрет смены роли у единственного админа (себя) на не-админа
    if (parseInt(req.params.id) === req.user.id && req.user.role === 'admin') {
      if (role && role !== 'admin') {
        return res.status(400).json({ error: 'Вы не можете снять с себя права администратора' });
      }
    }

    let assignedRoleId = currentUser.role_id;
    let assignedRoleName = currentUser.role;

    if (role_id !== undefined) {
      const rRes = await db.query('SELECT id, name FROM roles WHERE id = $1', [role_id]);
      if (rRes.rows.length > 0) {
        assignedRoleId = rRes.rows[0].id;
        assignedRoleName = rRes.rows[0].name;
      }
    } else if (role !== undefined) {
      const rRes = await db.query('SELECT id, name FROM roles WHERE name = $1', [role]);
      if (rRes.rows.length > 0) {
        assignedRoleId = rRes.rows[0].id;
        assignedRoleName = rRes.rows[0].name;
      } else {
        assignedRoleName = role;
      }
    }

    const updatedName = full_name !== undefined ? full_name.trim() : currentUser.full_name;

    if (password && password.trim().length >= 4) {
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password.trim(), salt);

      const result = await db.query(`
        UPDATE users
        SET full_name = $1, role = $2, role_id = $3, password_hash = $4
        WHERE id = $5
        RETURNING id, username, full_name, role, role_id, created_at
      `, [updatedName, assignedRoleName, assignedRoleId, passwordHash, req.params.id]);
      return res.json(result.rows[0]);
    } else {
      const result = await db.query(`
        UPDATE users
        SET full_name = $1, role = $2, role_id = $3
        WHERE id = $4
        RETURNING id, username, full_name, role, role_id, created_at
      `, [updatedName, assignedRoleName, assignedRoleId, req.params.id]);
      return res.json(result.rows[0]);
    }
  } catch (err) {
    console.error('Ошибка обновления пользователя:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// DELETE /api/users/:id — удалить пользователя
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);

    if (targetId === req.user.id) {
      return res.status(400).json({ error: 'Вы не можете удалить свою собственную учётную запись' });
    }

    const check = await db.query('SELECT * FROM users WHERE id = $1', [targetId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    await db.query('DELETE FROM users WHERE id = $1', [targetId]);
    res.json({ message: 'Пользователь успешно удален' });
  } catch (err) {
    console.error('Ошибка удаления пользователя:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
