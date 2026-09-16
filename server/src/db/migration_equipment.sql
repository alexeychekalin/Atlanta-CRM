-- =============================================
-- Модуль «Подбор компонентов»
-- Типы техники, производители, продукция
-- =============================================

-- Типы техники (настраиваемый справочник)
CREATE TABLE IF NOT EXISTS equipment_types (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  icon VARCHAR(50),
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now()
);

-- Производители
CREATE TABLE IF NOT EXISTS manufacturers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  website VARCHAR(500),
  phone VARCHAR(50),
  email VARCHAR(255),
  logo_path VARCHAR(500),
  description TEXT,
  contact_person VARCHAR(255),
  country VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now()
);

-- Продукция производителя
CREATE TABLE IF NOT EXISTS manufacturer_products (
  id SERIAL PRIMARY KEY,
  manufacturer_id INT NOT NULL REFERENCES manufacturers(id) ON DELETE CASCADE,
  equipment_type_id INT REFERENCES equipment_types(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  model VARCHAR(255),
  description TEXT,
  image_path VARCHAR(500),
  drawing_id INT REFERENCES drawings(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);

-- Компоненты продукции (M2M)
CREATE TABLE IF NOT EXISTS manufacturer_product_components (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES manufacturer_products(id) ON DELETE CASCADE,
  component_id INT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  modification_id INT REFERENCES component_modifications(id) ON DELETE SET NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  notes TEXT,
  UNIQUE(product_id, component_id, modification_id)
);

-- Начальные типы техники
INSERT INTO equipment_types (name, icon, sort_order) VALUES
  ('Полуприцепы', '🚛', 1),
  ('Легковые прицепы', '🚗', 2),
  ('Сельхозтехника', '🚜', 3)
ON CONFLICT DO NOTHING;
