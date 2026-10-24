const { sectionAllowed } = require('./access');

function adminOnly(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'Доступ запрещён. Требуется роль администратора.' });
}

/**
 * Проверка права на действие в разделе по актуальным правам пользователя.
 * Используется точечно там, где метод запроса не отражает действие
 * (например, экспорт отчётов).
 */
function hasPermission(section, action = 'view') {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Необходима авторизация' });
    }
    if (sectionAllowed(req.user, section, action)) {
      return next();
    }
    return res.status(403).json({
      error: `Недостаточно прав для действия «${action}» в разделе «${section}»`,
    });
  };
}

adminOnly.adminOnly = adminOnly;
adminOnly.hasPermission = hasPermission;

module.exports = adminOnly;
