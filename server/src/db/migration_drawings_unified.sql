-- =============================================
-- Единая модель чертежей:
--   * чертёж (BOM) может быть общим для нескольких клиентов (M2M);
--   * цена для клиента считается от его уровня цен (+ ручная наценка связи);
--   * чертежи не удаляются, а уходят в архив;
--   * согласованный чертёж связан с заданием согласования (approval_id);
--   * появился журнал расчётов.
-- Идемпотентна: можно применять повторно.
-- =============================================

-- 1. Архив и связь с согласованием
ALTER TABLE drawings ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
ALTER TABLE drawings ADD COLUMN IF NOT EXISTS approval_id INT REFERENCES drawing_approvals(id) ON DELETE SET NULL;
ALTER TABLE drawings ADD COLUMN IF NOT EXISTS file_hash VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_drawings_approval ON drawings(approval_id) WHERE approval_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drawings_archived ON drawings(archived_at);
CREATE INDEX IF NOT EXISTS idx_drawings_file_hash ON drawings(file_hash) WHERE file_hash IS NOT NULL;

-- 2. Привязка чертежа к клиентам (один BOM — много клиентов)
CREATE TABLE IF NOT EXISTS drawing_clients (
  id SERIAL PRIMARY KEY,
  drawing_id INT NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  markup_pct NUMERIC(5,2),
  markup_rub NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE (drawing_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_drawing_clients_client ON drawing_clients(client_id);

-- Владелец чертежа (drawings.client_id) — тоже связь
INSERT INTO drawing_clients (drawing_id, client_id)
SELECT d.id, d.client_id FROM drawings d
WHERE d.client_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 3. Журнал расчётов
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
CREATE INDEX IF NOT EXISTS idx_drawing_calculations_client ON drawing_calculations(client_id);
CREATE INDEX IF NOT EXISTS idx_drawing_calculations_drawing ON drawing_calculations(drawing_id);
CREATE INDEX IF NOT EXISTS idx_drawing_calculations_created ON drawing_calculations(created_at DESC);
