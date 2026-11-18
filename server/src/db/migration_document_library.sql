-- Библиотека документов: вложенные папки и файлы (PDF, DOC/DOCX, изображения,
-- таблицы, архивы, чертежи). Отдельный раздел CRM: смотреть и скачивать могут
-- все сотрудники с правом «Документы → Просмотр», создавать папки и загружать
-- файлы по умолчанию может только администратор.
--
-- Файлы хранятся в uploads/library, в таблице — путь и исходное имя.
-- Миграция идемпотентна.

CREATE TABLE IF NOT EXISTS document_folders (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  parent_id INT REFERENCES document_folders(id) ON DELETE CASCADE,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- В одной папке не может быть двух папок с одинаковым именем (без учёта регистра)
CREATE UNIQUE INDEX IF NOT EXISTS ux_document_folders_name
  ON document_folders (COALESCE(parent_id, 0), lower(name));

CREATE INDEX IF NOT EXISTS idx_document_folders_parent ON document_folders(parent_id);

CREATE TABLE IF NOT EXISTS document_files (
  id SERIAL PRIMARY KEY,
  folder_id INT REFERENCES document_folders(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_type VARCHAR(20),
  file_size INT,
  comment TEXT,
  uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_files_folder ON document_files(folder_id);
CREATE INDEX IF NOT EXISTS idx_document_files_name ON document_files(lower(name));
