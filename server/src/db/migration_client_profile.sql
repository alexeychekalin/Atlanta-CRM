-- =============================================
-- Миграция: Карточка клиента (таймлайн + документы)
-- =============================================

-- Таймлайн клиента
CREATE TABLE IF NOT EXISTS client_timeline (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    event_date TIMESTAMP DEFAULT NOW(),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Документы клиента
CREATE TABLE IF NOT EXISTS client_documents (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_type VARCHAR(20),
    description TEXT,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Чертежи клиента (отдельно от калькулятора)
CREATE TABLE IF NOT EXISTS client_drawings (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_type VARCHAR(20),
    description TEXT,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Связь drawings (шаблоны калькулятора) с клиентом
ALTER TABLE drawings ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL;

-- Индексы
CREATE INDEX IF NOT EXISTS idx_client_timeline_client ON client_timeline(client_id);
CREATE INDEX IF NOT EXISTS idx_client_timeline_date ON client_timeline(event_date DESC);
CREATE INDEX IF NOT EXISTS idx_client_documents_client ON client_documents(client_id);
CREATE INDEX IF NOT EXISTS idx_client_drawings_client ON client_drawings(client_id);
CREATE INDEX IF NOT EXISTS idx_drawings_client ON drawings(client_id);
