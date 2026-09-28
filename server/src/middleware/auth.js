const jwt = require('jsonwebtoken');
const db = require('../db');

// Кэш гостевых прав (обновляется раз в 60с)
let guestPermsCache = null;
let guestPermsCacheTime = 0;

async function getGuestPermissions() {
  const now = Date.now();
  if (guestPermsCache && now - guestPermsCacheTime < 60000) {
    return guestPermsCache;
  }
  try {
    const result = await db.query("SELECT permissions FROM roles WHERE name = 'guest' LIMIT 1");
    guestPermsCache = result.rows.length > 0 ? (result.rows[0].permissions || {}) : null;
    guestPermsCacheTime = now;
  } catch (e) {
    guestPermsCache = null;
  }
  return guestPermsCache;
}

function authMiddleware(req, res, next) {
  // Если optionalAuth уже установил req.user (гость или JWT) — пропускаем
  if (req.user) {
    return next();
  }

  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
}

// optionalAuth — пропускает GET-запросы без токена если есть гостевая роль
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'Недействительный токен' });
    }
  }

  // Нет токена — разрешаем только GET если есть гостевая роль
  if (req.method !== 'GET') {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  getGuestPermissions().then(perms => {
    if (!perms) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }
    req.user = { id: 0, username: 'guest', full_name: 'Гость', role: 'guest', permissions: perms };
    next();
  }).catch(() => {
    res.status(401).json({ error: 'Требуется авторизация' });
  });
}

module.exports = authMiddleware;
module.exports.optionalAuth = optionalAuth;
