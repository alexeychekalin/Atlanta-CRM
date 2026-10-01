-- =============================================
-- Миграция: Согласование чертежей
-- =============================================

-- Задания на согласование
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

-- Версии файлов
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

-- Комментарии
CREATE TABLE IF NOT EXISTS drawing_approval_comments (
  id SERIAL PRIMARY KEY,
  approval_id INT NOT NULL REFERENCES drawing_approvals(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_drawing_approvals_client ON drawing_approvals(client_id);
CREATE INDEX IF NOT EXISTS idx_drawing_approvals_status ON drawing_approvals(status);
CREATE INDEX IF NOT EXISTS idx_drawing_approval_versions_approval ON drawing_approval_versions(approval_id);
CREATE INDEX IF NOT EXISTS idx_drawing_approval_comments_approval ON drawing_approval_comments(approval_id);
