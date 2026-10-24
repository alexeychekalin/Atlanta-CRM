-- =============================================
-- P0/P1: фиксация наценок и НДС, связь позиций с чертежами
-- Идемпотентна, безопасна для повторного запуска
-- =============================================

-- Заказы: снимок наценки уровня и НДС на момент оформления
ALTER TABLE orders ADD COLUMN IF NOT EXISTS level_markup_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(14,2);

-- Позиции заказов: базовая цена, ручная наценка, признак чертежа
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS base_price NUMERIC(14,2);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS markup_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS markup_rub NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS level_markup_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS is_drawing BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS drawing_id INT;

-- КП: суммы и НДС
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS subtotal NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,2);
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(14,2);

-- Позиции КП: базовая цена и наценки
ALTER TABLE proposal_items ADD COLUMN IF NOT EXISTS base_price NUMERIC(14,2);
ALTER TABLE proposal_items ADD COLUMN IF NOT EXISTS markup_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE proposal_items ADD COLUMN IF NOT EXISTS markup_rub NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE proposal_items ADD COLUMN IF NOT EXISTS level_markup_pct NUMERIC(5,2) NOT NULL DEFAULT 0;

-- Чертёж: параметры расчёта, которые раньше жили только в браузере
ALTER TABLE drawings ADD COLUMN IF NOT EXISTS level_markup_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE drawings ADD COLUMN IF NOT EXISTS global_markup_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE drawings ADD COLUMN IF NOT EXISTS global_markup_rub NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Индексы под типовые выборки
CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_status_date ON orders(status, order_date);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_proposals_client ON proposals(client_id);
CREATE INDEX IF NOT EXISTS idx_proposal_items_proposal ON proposal_items(proposal_id);
CREATE INDEX IF NOT EXISTS idx_client_timeline_client_date ON client_timeline(client_id, event_date);
CREATE INDEX IF NOT EXISTS idx_client_documents_client ON client_documents(client_id);
CREATE INDEX IF NOT EXISTS idx_component_documents_component ON component_documents(component_id);
