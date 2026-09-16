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

-- Колонка уровня цен в clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS pricing_level_id INT
  REFERENCES client_pricing_levels(id) ON DELETE SET NULL;

-- Начальные данные
INSERT INTO client_pricing_levels (name, code, markup_pct, sort_order, is_default) VALUES
  ('Розница', 'retail', 30, 1, false),
  ('Опт', 'wholesale', 15, 2, false),
  ('Крупный опт', 'large_wholesale', 5, 3, false),
  ('Производство', 'production', 0, 4, false)
ON CONFLICT (code) DO NOTHING;
