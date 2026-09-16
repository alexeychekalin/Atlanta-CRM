-- =============================================
-- Миграция: Каталог компонентов + Чертежи
-- =============================================

-- Категории компонентов
CREATE TABLE IF NOT EXISTS component_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Компоненты (детали)
CREATE TABLE IF NOT EXISTS components (
    id SERIAL PRIMARY KEY,
    category_id INTEGER REFERENCES component_categories(id) ON DELETE SET NULL,
    article VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(12,2) NOT NULL DEFAULT 0,
    image_path VARCHAR(500),
    description TEXT,
    comment TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Чертежи (шаблоны)
CREATE TABLE IF NOT EXISTS drawings (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500),
    file_type VARCHAR(20),
    description TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Связь чертёж ↔ компоненты (BOM-спецификация)
CREATE TABLE IF NOT EXISTS drawing_components (
    id SERIAL PRIMARY KEY,
    drawing_id INTEGER NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
    component_id INTEGER NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    quantity DECIMAL(12,3) NOT NULL DEFAULT 1,
    item_markup_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
    item_markup_rub DECIMAL(12,2) NOT NULL DEFAULT 0
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_components_category ON components(category_id);
CREATE INDEX IF NOT EXISTS idx_components_article ON components(article);
CREATE INDEX IF NOT EXISTS idx_drawing_components_drawing ON drawing_components(drawing_id);
CREATE INDEX IF NOT EXISTS idx_drawing_components_component ON drawing_components(component_id);

-- Начальные категории
INSERT INTO component_categories (name, sort_order) VALUES
    ('Блок коммутации', 1),
    ('Габаритный фонарь боковой', 2),
    ('Габаритный фонарь задний', 3),
    ('Фонарь освещения номерного знака', 4)
ON CONFLICT DO NOTHING;
