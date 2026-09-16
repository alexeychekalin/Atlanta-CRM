const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/role');

const router = express.Router();

// GET /api/settings/vat — получить настройки НДС (доступно всем авторизованным)
router.get('/vat', auth, async (req, res) => {
  try {
    const result = await db.query("SELECT value FROM system_settings WHERE key = 'vat'");
    if (result.rows.length === 0) {
      return res.json({ enabled: true, rate: 22 });
    }
    res.json(result.rows[0].value);
  } catch (err) {
    console.error('Ошибка получения настроек НДС:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/settings/vat — обновить настройки НДС (только админ)
router.put('/vat', auth, adminOnly, async (req, res) => {
  try {
    const { enabled, rate } = req.body;
    const value = {
      enabled: enabled !== undefined ? !!enabled : true,
      rate: rate !== undefined ? (parseFloat(rate) || 0) : 22,
    };
    await db.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ('vat', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(value)]
    );
    res.json(value);
  } catch (err) {
    console.error('Ошибка сохранения настроек НДС:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
