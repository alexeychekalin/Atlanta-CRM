-- =============================================
-- Миграция: синхронизация схемы (v2)
-- Запускать на сервере после обновления файлов
-- =============================================

-- 1. Ссылка на ГИСП в компонентах
ALTER TABLE components ADD COLUMN IF NOT EXISTS gisp_url VARCHAR(500);

-- 2. Реквизиты клиентов (ИП/ООО)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_type VARCHAR(10) DEFAULT 'ooo';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ogrn VARCHAR(20);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS postal_address TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS bank_account VARCHAR(30);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS bik VARCHAR(15);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS corr_account VARCHAR(30);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS director VARCHAR(255);

-- 3. Уровни ценообразования
CREATE TABLE IF NOT EXISTS client_pricing_levels (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  markup_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  sort_order INT DEFAULT 0,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now()
);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS pricing_level_id INT
  REFERENCES client_pricing_levels(id) ON DELETE SET NULL;
INSERT INTO client_pricing_levels (name, code, markup_pct, sort_order, is_default) VALUES
  ('Розница', 'retail', 30, 1, false),
  ('Опт', 'wholesale', 15, 2, false),
  ('Крупный опт', 'large_wholesale', 5, 3, false),
  ('Производство', 'production', 0, 4, false)
ON CONFLICT (code) DO NOTHING;

-- 4. Хронология — event_date
ALTER TABLE client_timeline ADD COLUMN IF NOT EXISTS event_date TIMESTAMP DEFAULT now();

-- 5. Документы клиента — переименовать file_name → name (если старая колонка)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'client_documents' AND column_name = 'file_name') THEN
    ALTER TABLE client_documents RENAME COLUMN file_name TO name;
  END IF;
END $$;

-- 6. Модификации компонентов
CREATE TABLE IF NOT EXISTS component_modifications (
  id SERIAL PRIMARY KEY,
  component_id INT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  code VARCHAR(100) NOT NULL,
  name VARCHAR(255),
  price_override NUMERIC(12,2),
  description TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_component_modifications_component ON component_modifications(component_id);

CREATE TABLE IF NOT EXISTS component_modification_images (
  id SERIAL PRIMARY KEY,
  modification_id INT NOT NULL REFERENCES component_modifications(id) ON DELETE CASCADE,
  image_path VARCHAR(500) NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_component_modification_images_mod ON component_modification_images(modification_id);

-- 7. Документы компонентов
CREATE TABLE IF NOT EXISTS component_documents (
  id SERIAL PRIMARY KEY,
  component_id INT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  doc_type VARCHAR(20) NOT NULL CHECK (doc_type IN ('certificate', 'info')),
  file_path VARCHAR(500) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(10),
  file_size INT,
  comment TEXT,
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_component_documents_component ON component_documents(component_id);

-- 8. Modification_id в drawing_components
ALTER TABLE drawing_components ADD COLUMN IF NOT EXISTS modification_id INT
  REFERENCES component_modifications(id) ON DELETE SET NULL;

-- 9. Подбор компонентов: типы техники, производители
CREATE TABLE IF NOT EXISTS equipment_types (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  icon VARCHAR(50),
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now()
);
INSERT INTO equipment_types (name, icon, sort_order) VALUES
  ('Полуприцепы', '🚛', 1),
  ('Легковые прицепы', '🚗', 2),
  ('Сельхозтехника', '🚜', 3)
ON CONFLICT DO NOTHING;

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

CREATE TABLE IF NOT EXISTS manufacturer_product_components (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES manufacturer_products(id) ON DELETE CASCADE,
  component_id INT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  modification_id INT REFERENCES component_modifications(id) ON DELETE SET NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  notes TEXT,
  UNIQUE(product_id, component_id, modification_id)
);

-- 10. Согласование чертежей
CREATE TABLE IF NOT EXISTS drawing_approvals (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'waiting',
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);
CREATE TABLE IF NOT EXISTS drawing_approval_versions (
  id SERIAL PRIMARY KEY,
  approval_id INT NOT NULL REFERENCES drawing_approvals(id) ON DELETE CASCADE,
  version_number INT NOT NULL DEFAULT 1,
  file_path VARCHAR(500) NOT NULL,
  file_type VARCHAR(20),
  source VARCHAR(20) NOT NULL DEFAULT 'client',
  comment TEXT,
  uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT now()
);
CREATE TABLE IF NOT EXISTS drawing_approval_comments (
  id SERIAL PRIMARY KEY,
  approval_id INT NOT NULL REFERENCES drawing_approvals(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_drawing_approvals_client ON drawing_approvals(client_id);
CREATE INDEX IF NOT EXISTS idx_drawing_approvals_status ON drawing_approvals(status);
CREATE INDEX IF NOT EXISTS idx_drawing_approval_versions_approval ON drawing_approval_versions(approval_id);
CREATE INDEX IF NOT EXISTS idx_drawing_approval_comments_approval ON drawing_approval_comments(approval_id);

-- 11. Снять FK с order_items и proposal_items
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_product_id_fkey;
ALTER TABLE proposal_items DROP CONSTRAINT IF EXISTS proposal_items_product_id_fkey;

-- 12. metadata в order_items
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Готово!
