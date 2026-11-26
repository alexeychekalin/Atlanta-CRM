-- Галерея позиции каталога: несколько фото изделия (снимки поставщика),
-- первое из них — обложка (components.image_path).
CREATE TABLE IF NOT EXISTS component_images (
  id SERIAL PRIMARY KEY,
  component_id INT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  image_path VARCHAR(500) NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_component_images_component ON component_images(component_id);
