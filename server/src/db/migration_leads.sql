-- Заявки с сайта: таблицы лида, позиций, файлов и журнала уведомлений.
-- Идемпотентно: на новой базе таблицы уже есть из schema.sql, на существующей
-- создаются здесь. Раздел «Заявки» появляется в правах ролей отдельно
-- (migrate_roles.js), здесь — только данные.

CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  email VARCHAR(200),
  company VARCHAR(255),
  inn VARCHAR(20),
  address TEXT,
  message TEXT,
  page VARCHAR(500),
  source VARCHAR(50) DEFAULT 'site',
  article VARCHAR(100),
  item_count INT DEFAULT 0,
  file_count INT DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'new',
  manager_note TEXT,
  client_id INT REFERENCES clients(id) ON DELETE SET NULL,
  utm_source VARCHAR(100),
  utm_medium VARCHAR(100),
  utm_campaign VARCHAR(150),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_items (
  id SERIAL PRIMARY KEY,
  lead_id INT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  article VARCHAR(100),
  name VARCHAR(255),
  quantity INT NOT NULL DEFAULT 1,
  sort_order INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lead_files (
  id SERIAL PRIMARY KEY,
  lead_id INT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  file_path VARCHAR(500) NOT NULL,
  name VARCHAR(255),
  file_size INT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_notifications (
  id SERIAL PRIMARY KEY,
  lead_id INT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL,
  ok BOOLEAN NOT NULL DEFAULT false,
  detail TEXT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_lead_items_lead ON lead_items(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_files_lead ON lead_files(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_notifications_lead ON lead_notifications(lead_id);
