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

CREATE INDEX IF NOT EXISTS idx_component_documents_component ON component_documents(component_id);
