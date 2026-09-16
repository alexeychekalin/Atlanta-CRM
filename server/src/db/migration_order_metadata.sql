-- =============================================
-- Миграция: metadata для order_items (состав чертежа)
-- =============================================
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS metadata JSONB;
