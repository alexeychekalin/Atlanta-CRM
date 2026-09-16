-- =============================================
-- Миграция: Фото/логотип клиента + Статусы работы
-- =============================================

-- Справочник статусов клиента (изменяемый)
CREATE TABLE IF NOT EXISTS client_work_statuses (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    color VARCHAR(7) NOT NULL DEFAULT '#64748b',
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Добавить колонки к clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS avatar_path VARCHAR(500);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS status_id INTEGER REFERENCES client_work_statuses(id) ON DELETE SET NULL;

-- Индекс
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status_id);

-- Начальные статусы
INSERT INTO client_work_statuses (name, color, sort_order) VALUES
    ('Новый', '#3b82f6', 1),
    ('Отправлен тестовый чертёж', '#f59e0b', 2),
    ('Переговоры', '#8b5cf6', 3),
    ('Согласование', '#14b8a6', 4),
    ('Покупки', '#22c55e', 5),
    ('Постоянный клиент', '#06b6d4', 6),
    ('Приостановлен', '#f97316', 7),
    ('Отказ', '#ef4444', 8)
ON CONFLICT DO NOTHING;
