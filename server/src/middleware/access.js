const jwt = require('jsonwebtoken');
const db = require('../db');

const CACHE_TTL_MS = 30 * 1000;
const userCache = new Map(); // id -> { user, expires }
let guestCache = { permissions: null, expires: 0 };

function invalidateAccessCache(userId = null) {
  if (userId) userCache.delete(Number(userId));
  else userCache.clear();
  guestCache = { permissions: null, expires: 0 };
}

function parseCookies(header) {
  const result = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  }
  return result;
}

function tokenFromRequest(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies.atlanta_token || null;
}

async function loadUserById(id) {
  const result = await db.query(
    `SELECT u.id, u.username, u.full_name, u.role, u.token_version,
            r.name AS role_name, r.display_name AS role_display_name,
            r.permissions AS role_permissions
     FROM users u
     LEFT JOIN roles r ON u.role_id = r.id OR u.role = r.name
     WHERE u.id = $1`,
    [id]
  );
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    username: row.username,
    full_name: row.full_name,
    role: row.role_name || row.role || 'viewer',
    role_display_name: row.role_display_name || row.role || 'viewer',
    // Права берём из БД, а не из токена: изменение роли действует без перелогина.
    permissions: row.role_permissions || {},
    token_version: row.token_version || 0,
  };
}

async function resolveUserFromToken(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (!decoded || !decoded.id) return null;

  const cached = userCache.get(Number(decoded.id));
  if (cached && cached.expires > Date.now()) return cached.user;

  const user = await loadUserById(decoded.id);
  // Смена пароля увеличивает token_version — старые токены перестают работать
  if (!user || (decoded.tv || 0) !== (user.token_version || 0)) return null;
  if (user) {
    userCache.set(Number(decoded.id), { user, expires: Date.now() + CACHE_TTL_MS });
  }
  return user;
}

async function getGuestPermissions() {
  if (guestCache.expires > Date.now()) return guestCache.permissions;

  try {
    const result = await db.query("SELECT permissions FROM roles WHERE name = 'guest' LIMIT 1");
    const permissions = result.rows.length > 0 ? result.rows[0].permissions || {} : null;
    guestCache = { permissions, expires: Date.now() + CACHE_TTL_MS };
    return permissions;
  } catch {
    guestCache = { permissions: null, expires: Date.now() + CACHE_TTL_MS };
    return null;
  }
}

/**
 * Разбирает токен (Bearer или cookie) и подставляет актуального пользователя из БД.
 * Не бросает 401 для анонимных запросов — это делают requireAuth/requirePermission.
 */
async function attachUser(req, res, next) {
  if (req.user) return next();

  const token = tokenFromRequest(req);
  if (!token) return next();

  try {
    const user = await resolveUserFromToken(token);
    if (!user) {
      return res.status(401).json({ error: 'Пользователь не найден или сессия истекла' });
    }
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
}

function hasAnyViewPermission(permissions) {
  return Object.values(permissions || {}).some(section => section && section.view === true);
}

function sectionAllowed(user, section, action) {
  if (!user) return false;
  if (user.role === 'admin') return true;

  const sectionPerms = (user.permissions || {})[section];
  if (!sectionPerms) return false;
  if (action === 'view') return sectionPerms.view === true;
  return sectionPerms[action] === true;
}

function actionForMethod(method) {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return 'view';
  if (method === 'DELETE') return 'delete';
  return 'edit';
}

/**
 * Проверка прав на раздел. Для анонимных запросов допускается только view
 * и только если администратор включил этот раздел гостю.
 */
function requirePermission(section, action = null) {
  return async (req, res, next) => {
    try {
      const needed = action || actionForMethod(req.method);

      if (req.user) {
        if (sectionAllowed(req.user, section, needed)) return next();
        return res.status(403).json({
          error: `Недостаточно прав для действия «${needed}» в разделе «${section}»`,
        });
      }

      if (needed !== 'view') {
        return res.status(401).json({ error: 'Требуется авторизация' });
      }

      const guestPermissions = await getGuestPermissions();
      if (guestPermissions && guestPermissions[section] && guestPermissions[section].view === true) {
        req.user = {
          id: 0,
          username: 'guest',
          full_name: 'Гость',
          role: 'guest',
          role_display_name: 'Гость',
          permissions: guestPermissions,
        };
        return next();
      }

      return res.status(401).json({ error: 'Требуется авторизация' });
    } catch (err) {
      console.error('Ошибка проверки прав:', err);
      return res.status(500).json({ error: 'Ошибка проверки прав доступа' });
    }
  };
}

/**
 * Требуется вход, либо гость с доступом хотя бы к одному разделу.
 */
function requireAuthenticatedOrGuest(req, res, next) {
  if (req.user) return next();
  getGuestPermissions()
    .then(permissions => {
      if (!permissions || !hasAnyViewPermission(permissions)) {
        return res.status(401).json({ error: 'Требуется авторизация' });
      }
      req.user = {
        id: 0,
        username: 'guest',
        full_name: 'Гость',
        role: 'guest',
        role_display_name: 'Гость',
        permissions,
      };
      next();
    })
    .catch(() => res.status(401).json({ error: 'Требуется авторизация' }));
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  return res.status(401).json({ error: 'Требуется авторизация' });
}

function requireAnyPermission(pairs) {
  return async (req, res, next) => {
    try {
      const needed = actionForMethod(req.method);
      let user = req.user;

      if (!user && needed === 'view') {
        const guestPermissions = await getGuestPermissions();
        if (guestPermissions) {
          user = {
            id: 0,
            username: 'guest',
            full_name: 'Гость',
            role: 'guest',
            role_display_name: 'Гость',
            permissions: guestPermissions,
          };
        }
      }
      if (!user) return res.status(401).json({ error: 'Требуется авторизация' });

      const allowed = pairs.some(([section, action]) => sectionAllowed(user, section, action || needed));
      if (allowed) {
        req.user = user;
        return next();
      }
      return res.status(403).json({ error: 'Недостаточно прав для выполнения операции' });
    } catch (err) {
      console.error('Ошибка проверки прав:', err);
      return res.status(500).json({ error: 'Ошибка проверки прав доступа' });
    }
  };
}

module.exports = {
  attachUser,
  requireAuth,
  requirePermission,
  requireAnyPermission,
  requireAuthenticatedOrGuest,
  actionForMethod,
  sectionAllowed,
  invalidateAccessCache,
  parseCookies,
  tokenFromRequest,
  getGuestPermissions,
  hasAnyViewPermission,
};
