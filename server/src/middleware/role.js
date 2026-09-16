const db = require('../db');

function adminOnly(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'Доступ запрещён. Требуется роль администратора.' });
}

function hasPermission(section, action = 'view') {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Необходима авторизация' });
    }
    if (req.user.role === 'admin') {
      return next();
    }

    try {
      let permissions = req.user.permissions;
      if (!permissions) {
        const result = await db.query(`
          SELECT r.permissions 
          FROM users u
          LEFT JOIN roles r ON u.role_id = r.id OR u.role = r.name
          WHERE u.id = $1
        `, [req.user.id]);
        permissions = result.rows[0]?.permissions || {};
      }

      const sectionPerms = permissions[section];
      if (!sectionPerms) {
        return res.status(403).json({ error: `Доступ к разделу «${section}» ограничен для вашей роли` });
      }

      if (sectionPerms[action] === true || (action === 'view' && sectionPerms.view !== false)) {
        return next();
      }

      return res.status(403).json({ error: `Недостаточно прав для действия «${action}» в разделе «${section}»` });
    } catch (err) {
      console.error('Ошибка проверки прав:', err);
      return res.status(500).json({ error: 'Ошибка проверки прав доступа' });
    }
  };
}

adminOnly.adminOnly = adminOnly;
adminOnly.hasPermission = hasPermission;

module.exports = adminOnly;
