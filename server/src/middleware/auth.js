const { attachUser, getGuestPermissions } = require('./access');

/**
 * Требует авторизации. Токен принимается из заголовка Authorization
 * или из httpOnly-cookie atlanta_token (для ссылок на файлы/ZIP/PDF).
 */
function authMiddleware(req, res, next) {
  attachUser(req, res, (err) => {
    if (err) return next(err);
    if (!req.user) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }
    return next();
  });
}

/**
 * Пропускает без токена только по правилам гостевого доступа.
 * Оставлен для совместимости: гостевые права проверяются в access.js.
 */
function optionalAuth(req, res, next) {
  if (req.user) return next();

  attachUser(req, res, (err) => {
    if (err) return next(err);
    if (req.user) return next();
    if (req.method !== 'GET') {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }

    getGuestPermissions()
      .then(permissions => {
        if (!permissions) {
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
  });
}

module.exports = authMiddleware;
module.exports.optionalAuth = optionalAuth;
