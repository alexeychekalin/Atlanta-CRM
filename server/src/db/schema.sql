-- =============================================
-- CRM «Атланта» — Полная схема БД
-- PostgreSQL 17
-- Версия: все миграции включены
-- =============================================

-- Роли пользователей и матрица прав (RBAC)
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT false,
  permissions JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP DEFAULT now()
);

-- Пользователи
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role VARCHAR(100) NOT NULL DEFAULT 'viewer',
  role_id INT REFERENCES roles(id) ON DELETE SET NULL,
  token_version INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);

-- Принципалы (поставщики)
CREATE TABLE IF NOT EXISTS principals (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  agent_commission_pct NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  phone VARCHAR(50),
  email VARCHAR(255),
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now()
);

-- Уровни клиентов (ценообразование)
CREATE TABLE IF NOT EXISTS client_pricing_levels (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  markup_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  sort_order INT DEFAULT 0,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now()
);

-- Статусы работы с клиентами
CREATE TABLE IF NOT EXISTS client_work_statuses (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(20) DEFAULT '#6b7280',
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now()
);

-- Клиенты
CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  email VARCHAR(255),
  address TEXT,
  notes TEXT,
  avatar_path VARCHAR(500),
  status_id INT REFERENCES client_work_statuses(id) ON DELETE SET NULL,
  pricing_level_id INT REFERENCES client_pricing_levels(id) ON DELETE SET NULL,
  delivery_address TEXT,
  delivery_contact_name VARCHAR(255),
  delivery_contact_phone VARCHAR(50),
  inn VARCHAR(20),
  kpp VARCHAR(20),
  legal_address TEXT,
  bank_details TEXT,
  ogrnip VARCHAR(20),
  client_type VARCHAR(10) DEFAULT 'ooo',
  ogrn VARCHAR(20),
  postal_address TEXT,
  bank_account VARCHAR(30),
  bank_name VARCHAR(255),
  bik VARCHAR(15),
  corr_account VARCHAR(30),
  director VARCHAR(255),
  telegram VARCHAR(100),
  max_messenger VARCHAR(500),
  -- Сайт клиента: ссылка в карточке и в списках
  site VARCHAR(500),
  created_at TIMESTAMP DEFAULT now()
);

-- Товары/услуги
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  base_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit VARCHAR(20) DEFAULT 'шт.',
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now()
);

-- Заказы
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_number VARCHAR(50) UNIQUE NOT NULL,
  client_id INT REFERENCES clients(id) ON DELETE SET NULL,
  principal_id INT REFERENCES principals(id) ON DELETE SET NULL,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'new',
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  commission_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  commission_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  level_markup_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  vat_rate NUMERIC(5,2),
  vat_amount NUMERIC(14,2),
  comment TEXT,
  invoice_path VARCHAR(500),
  invoice_number VARCHAR(100),
  payment_date DATE,
  tracking_number VARCHAR(255),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Позиции заказа
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INT,
  product_name VARCHAR(255) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  base_price NUMERIC(14,2),
  markup_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  markup_rub NUMERIC(14,2) NOT NULL DEFAULT 0,
  level_markup_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_drawing BOOLEAN NOT NULL DEFAULT false,
  drawing_id INT,
  metadata JSONB
);

-- Категории компонентов
CREATE TABLE IF NOT EXISTS component_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);

-- Компоненты
CREATE TABLE IF NOT EXISTS components (
  id SERIAL PRIMARY KEY,
  category_id INT REFERENCES component_categories(id) ON DELETE SET NULL,
  article VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  price NUMERIC(14,2) NOT NULL DEFAULT 0,
  image_path VARCHAR(500),
  description TEXT,
  comment TEXT,
  is_active BOOLEAN DEFAULT true,
  gisp_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT now()
);

-- Модификации компонентов
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

-- Фото модификаций
CREATE TABLE IF NOT EXISTS component_modification_images (
  id SERIAL PRIMARY KEY,
  modification_id INT NOT NULL REFERENCES component_modifications(id) ON DELETE CASCADE,
  image_path VARCHAR(500) NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);

-- Документы компонентов (сертификаты и информационные сообщения)
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

-- Чертежи (BOM + файл). Удаление — только в архив (archived_at).
CREATE TABLE IF NOT EXISTS drawings (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500),
  file_type VARCHAR(20),
  description TEXT,
  -- Клиент-владелец: API не даёт создать чертёж без него, PUT владельца не меняет.
  -- NULL допускается только у исторических записей (миграция заполняет их из связей).
  client_id INT REFERENCES clients(id) ON DELETE SET NULL,
  -- Устарело: фикс-цена хранится на связи drawing_clients.fixed_price.
  -- Колонка оставлена для чтения старых данных, новые значения сюда не пишутся.
  fixed_price NUMERIC(14,2),
  level_markup_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  global_markup_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  global_markup_rub NUMERIC(14,2) NOT NULL DEFAULT 0,
  approval_id INT,
  file_hash VARCHAR(64),
  archived_at TIMESTAMP,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- Привязка чертежа к клиентам: один BOM — много клиентов.
-- markup_pct/markup_rub — ручная наценка поверх уровня цен клиента.
CREATE TABLE IF NOT EXISTS drawing_clients (
  id SERIAL PRIMARY KEY,
  drawing_id INT NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  markup_pct NUMERIC(5,2),
  markup_rub NUMERIC(14,2) NOT NULL DEFAULT 0,
  fixed_price NUMERIC(14,2),
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE (drawing_id, client_id)
);

-- Журнал расчётов (снимок цен на момент расчёта)
CREATE TABLE IF NOT EXISTS drawing_calculations (
  id SERIAL PRIMARY KEY,
  drawing_id INT REFERENCES drawings(id) ON DELETE SET NULL,
  client_id INT REFERENCES clients(id) ON DELETE SET NULL,
  principal_id INT REFERENCES principals(id) ON DELETE SET NULL,
  drawing_name VARCHAR(255) NOT NULL DEFAULT '',
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  level_markup_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  global_markup_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  global_markup_rub NUMERIC(14,2) NOT NULL DEFAULT 0,
  fixed_price NUMERIC(14,2),
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  lines JSONB,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- Компоненты чертежей
CREATE TABLE IF NOT EXISTS drawing_components (
  id SERIAL PRIMARY KEY,
  drawing_id INT NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  component_id INT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  modification_id INT REFERENCES component_modifications(id) ON DELETE SET NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  item_markup_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  item_markup_rub NUMERIC(14,2) NOT NULL DEFAULT 0
);

-- Чертежи клиентов (привязка)
CREATE TABLE IF NOT EXISTS client_drawings (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_type VARCHAR(20),
  description TEXT,
  uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- Согласование чертежей
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

-- Связь чертежа с заданием согласования (таблица drawings создана выше,
-- drawing_approvals — только что). Один согласованный файл = один чертёж.
ALTER TABLE drawings DROP CONSTRAINT IF EXISTS drawings_approval_id_fkey;
ALTER TABLE drawings ADD CONSTRAINT drawings_approval_id_fkey
  FOREIGN KEY (approval_id) REFERENCES drawing_approvals(id) ON DELETE SET NULL;

-- Хронология клиента
CREATE TABLE IF NOT EXISTS client_timeline (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  event_date TIMESTAMP DEFAULT now(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- Документы клиента
CREATE TABLE IF NOT EXISTS client_documents (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_type VARCHAR(20),
  description TEXT,
  uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- Файлы клиента, загружаемые администратором (раздел «Файлы» в карточке клиента).
-- Отдельно от client_documents: расширенный список форматов и доступ только админу.
CREATE TABLE IF NOT EXISTS client_files (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_type VARCHAR(20),
  file_size INT,
  comment TEXT,
  uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- Контакты сотрудников клиента (адресная книга)
CREATE TABLE IF NOT EXISTS client_contacts (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  full_name VARCHAR(255) NOT NULL,
  position VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  notes TEXT,
  telegram VARCHAR(100),
  max_messenger VARCHAR(500),
  created_at TIMESTAMP DEFAULT now()
);

-- Коммерческие предложения
CREATE TABLE IF NOT EXISTS proposals (
  id SERIAL PRIMARY KEY,
  proposal_number VARCHAR(50) UNIQUE NOT NULL,
  client_id INT NOT NULL REFERENCES clients(id),
  principal_id INT REFERENCES principals(id),
  status VARCHAR(20) DEFAULT 'draft',
  valid_until DATE,
  comment TEXT,
  order_id INT REFERENCES orders(id) ON DELETE SET NULL,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  vat_rate NUMERIC(5,2),
  vat_amount NUMERIC(14,2),
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Позиции КП
CREATE TABLE IF NOT EXISTS proposal_items (
  id SERIAL PRIMARY KEY,
  proposal_id INT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  product_id INT,
  product_name VARCHAR(255) NOT NULL,
  description TEXT,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  quantity INT NOT NULL DEFAULT 1,
  line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_drawing BOOLEAN DEFAULT false,
  drawing_id INT,
  image_path VARCHAR(500),
  base_price NUMERIC(14,2),
  markup_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  markup_rub NUMERIC(14,2) NOT NULL DEFAULT 0,
  level_markup_pct NUMERIC(5,2) NOT NULL DEFAULT 0
);

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

-- Системные настройки (НДС и пр.)
CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMP DEFAULT now()
);

-- =============================================
-- Индексы
-- =============================================
CREATE INDEX IF NOT EXISTS idx_components_category ON components(category_id);
CREATE INDEX IF NOT EXISTS idx_components_article ON components(article);
CREATE INDEX IF NOT EXISTS idx_component_modifications_component ON component_modifications(component_id);
CREATE INDEX IF NOT EXISTS idx_component_modification_images_mod ON component_modification_images(modification_id);
CREATE INDEX IF NOT EXISTS idx_component_documents_component ON component_documents(component_id);
CREATE INDEX IF NOT EXISTS idx_drawing_components_drawing ON drawing_components(drawing_id);
CREATE INDEX IF NOT EXISTS idx_drawings_archived ON drawings(archived_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_drawings_approval ON drawings(approval_id) WHERE approval_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drawings_file_hash ON drawings(file_hash) WHERE file_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drawing_clients_client ON drawing_clients(client_id);
CREATE INDEX IF NOT EXISTS idx_drawing_calculations_client ON drawing_calculations(client_id);
CREATE INDEX IF NOT EXISTS idx_drawing_calculations_drawing ON drawing_calculations(drawing_id);
CREATE INDEX IF NOT EXISTS idx_drawing_components_component ON drawing_components(component_id);
CREATE INDEX IF NOT EXISTS idx_drawing_approvals_client ON drawing_approvals(client_id);
CREATE INDEX IF NOT EXISTS idx_client_files_client ON client_files(client_id);
CREATE INDEX IF NOT EXISTS idx_drawing_approvals_status ON drawing_approvals(status);
CREATE INDEX IF NOT EXISTS idx_drawing_approval_versions_approval ON drawing_approval_versions(approval_id);
CREATE INDEX IF NOT EXISTS idx_drawing_approval_comments_approval ON drawing_approval_comments(approval_id);

-- =============================================
-- Начальные данные
-- =============================================

-- Админ (пароль: admin123)
INSERT INTO users (username, password_hash, full_name, role)
VALUES ('admin', '$2a$10$wr.oIZCvbDUhaHnS.ZBg6uOTJKKWbQ6sKtStEmT4EB2blefDO1d9m', 'Администратор', 'admin')
ON CONFLICT (username) DO NOTHING;

-- Статусы клиентов по умолчанию
-- Словари заполняются только отсутствующими записями: повторный db:init/deploy
-- не должен задваивать статусы, категории и типы техники.
INSERT INTO client_work_statuses (name, color, sort_order)
SELECT v.name, v.color, v.sort_order
  FROM (VALUES
    ('Новый', '#3b82f6', 1),
    ('Отправлен тестовый чертёж', '#8b5cf6', 2),
    ('Переговоры', '#f59e0b', 3),
    ('Согласование', '#06b6d4', 4),
    ('Покупки', '#22c55e', 5),
    ('Постоянный клиент', '#14b8a6', 6),
    ('Приостановлен', '#6b7280', 7),
    ('Отказ', '#ef4444', 8)
  ) AS v(name, color, sort_order)
 WHERE NOT EXISTS (
   SELECT 1 FROM client_work_statuses s WHERE lower(s.name) = lower(v.name)
 );

-- Уровни ценообразования
INSERT INTO client_pricing_levels (name, code, markup_pct, sort_order, is_default) VALUES
  ('Розница', 'retail', 30, 1, false),
  ('Опт', 'wholesale', 15, 2, false),
  ('Крупный опт', 'large_wholesale', 5, 3, false),
  ('Производство', 'production', 0, 4, false)
ON CONFLICT (code) DO NOTHING;

-- Категории компонентов
INSERT INTO component_categories (name, sort_order)
SELECT v.name, v.sort_order
  FROM (VALUES
    ('Блок коммутации', 1),
    ('Габаритный фонарь боковой', 2),
    ('Габаритный фонарь задний', 3),
    ('Фонарь освещения номерного знака', 4)
  ) AS v(name, sort_order)
 WHERE NOT EXISTS (
   SELECT 1 FROM component_categories c WHERE lower(c.name) = lower(v.name)
 );

-- Типы техники
INSERT INTO equipment_types (name, icon, sort_order)
SELECT v.name, v.icon, v.sort_order
  FROM (VALUES
    ('Полуприцепы', '🚛', 1),
    ('Легковые прицепы', '🚗', 2),
    ('Сельхозтехника', '🚜', 3)
  ) AS v(name, icon, sort_order)
 WHERE NOT EXISTS (
   SELECT 1 FROM equipment_types t WHERE lower(t.name) = lower(v.name)
 );
