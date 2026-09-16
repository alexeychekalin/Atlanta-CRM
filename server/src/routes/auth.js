const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Введите логин и пароль' });
    }

    const query = `
      SELECT 
        u.*,
        r.name as role_name,
        r.display_name as role_display_name,
        r.permissions as role_permissions
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id OR u.role = r.name
      WHERE u.username = $1
    `;
    const result = await db.query(query, [username.trim()]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const effectiveRole = user.role_name || user.role || 'viewer';
    const effectivePermissions = user.role_permissions || {};

    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        full_name: user.full_name, 
        role: effectiveRole,
        permissions: effectivePermissions,
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: effectiveRole,
        role_display_name: user.role_display_name || effectiveRole,
        permissions: effectivePermissions,
      },
    });
  } catch (err) {
    console.error('Ошибка авторизации:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
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
    const result = await db.query(query, [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    const user = result.rows[0];
    res.json({
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role_name || user.role,
      role_display_name: user.role_display_name || user.role,
      permissions: user.role_permissions || {},
      created_at: user.created_at,
    });
  } catch (err) {
    console.error('Ошибка получения пользователя:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
