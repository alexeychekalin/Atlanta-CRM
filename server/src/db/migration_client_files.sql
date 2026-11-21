-- Файлы клиента, которые загружает администратор (вкладка «Файлы» в карточке).
-- Отдельная таблица, чтобы админские вложения не смешивались с обычными
-- документами клиента (client_documents) и были доступны только администратору.
-- Идемпотентна.
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

CREATE INDEX IF NOT EXISTS idx_client_files_client ON client_files(client_id);
