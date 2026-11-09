const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const auth = require('../middleware/auth');
const { rateLimit } = require('express-rate-limit');

const router = express.Router();

// Защита от подбора паролей: 10 неудачных попыток за 15 минут с одного IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Слишком много попыток входа. Повторите через 15 минут.' },
});

const TOKEN_TTL = '12h';
const COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function setAuthCookie(res, token) {
  res.cookie('atlanta_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
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
        tv: user.token_version || 0,
      },
      process.env.JWT_SECRET,
      { expiresIn: TOKEN_TTL }
    );

    setAuthCookie(res, token);

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

// POST /api/auth/logout — очищает httpOnly-cookie
router.post('/logout', (req, res) => {
  res.clearCookie('atlanta_token', { path: '/' });
  res.json({ ok: true });
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
        u.token_version,
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

    // Освежаем cookie и продлеваем сессию: ссылки на PDF/ZIP используют cookie
    const freshToken = jwt.sign(
      {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role_name || user.role,
        tv: user.token_version || 0,
      },
      process.env.JWT_SECRET,
      { expiresIn: TOKEN_TTL }
    );
    setAuthCookie(res, freshToken);

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

// GET /api/auth/guest-permissions — гостевые права (без авторизации)
router.get('/guest-permissions', async (req, res) => {
  try {
    const result = await db.query(
      "SELECT permissions FROM roles WHERE name = 'guest' LIMIT 1"
    );
    if (result.rows.length === 0) {
      return res.json({ enabled: false, permissions: {} });
    }
    const perms = result.rows[0].permissions || {};
    // Проверяем, есть ли хотя бы одна секция с view=true
    const hasAnyView = Object.values(perms).some(s => s && s.view);
    res.json({ enabled: hasAnyView, permissions: perms });
  } catch (err) {
    console.error('Ошибка получения гостевых прав:', err);
    res.json({ enabled: false, permissions: {} });
  }
});

module.exports = router;
