-- =============================================
-- CRM «Атланта» — Полная схема БД
-- PostgreSQL 17
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
  delivery_address TEXT,
  delivery_contact_name VARCHAR(255),
  delivery_contact_phone VARCHAR(50),
  inn VARCHAR(20),
  kpp VARCHAR(20),
  legal_address TEXT,
  bank_details TEXT,
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
  status VARCHAR(30) NOT NULL DEFAULT 'new',
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  commission_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  commission_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
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
  product_id INT REFERENCES products(id) ON DELETE SET NULL,
  product_name VARCHAR(255) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0,
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
  created_at TIMESTAMP DEFAULT now()
);

-- Чертежи (шаблоны расчётов)
CREATE TABLE IF NOT EXISTS drawings (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500),
  file_type VARCHAR(50),
  description TEXT,
  client_id INT REFERENCES clients(id) ON DELETE SET NULL,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- Компоненты чертежей
CREATE TABLE IF NOT EXISTS drawing_components (
  id SERIAL PRIMARY KEY,
  drawing_id INT NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  component_id INT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  item_markup_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  item_markup_rub NUMERIC(14,2) NOT NULL DEFAULT 0
);

-- Чертежи клиентов (привязка)
CREATE TABLE IF NOT EXISTS client_drawings (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  drawing_id INT NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT now()
);

-- Хронология клиента
CREATE TABLE IF NOT EXISTS client_timeline (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- Документы клиента
CREATE TABLE IF NOT EXISTS client_documents (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_type VARCHAR(50),
  file_size INT DEFAULT 0,
  description TEXT,
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
  order_id INT REFERENCES orders(id),
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Позиции КП
CREATE TABLE IF NOT EXISTS proposal_items (
  id SERIAL PRIMARY KEY,
  proposal_id INT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id),
  product_name VARCHAR(255) NOT NULL,
  description TEXT,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  quantity INT NOT NULL DEFAULT 1,
  line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_drawing BOOLEAN DEFAULT false,
  drawing_id INT,
  image_path VARCHAR(500)
);

-- =============================================
-- Начальные данные
-- =============================================

-- Админ (пароль: admin123)
INSERT INTO users (username, password_hash, full_name, role)
VALUES ('admin', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Администратор', 'admin')
ON CONFLICT (username) DO NOTHING;

-- Статусы по умолчанию
INSERT INTO client_work_statuses (name, color, sort_order) VALUES
  ('Новый', '#3b82f6', 1),
  ('Отправлен тестовый чертёж', '#8b5cf6', 2),
  ('Переговоры', '#f59e0b', 3),
  ('Согласование', '#06b6d4', 4),
  ('Покупки', '#22c55e', 5),
  ('Постоянный клиент', '#14b8a6', 6),
  ('Приостановлен', '#6b7280', 7),
  ('Отказ', '#ef4444', 8)
ON CONFLICT DO NOTHING;
