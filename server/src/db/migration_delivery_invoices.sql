-- =============================================
-- Миграция: Данные доставки клиента + Счета/Трек-номер заказов
-- =============================================

-- 1. Поля доставки в таблице clients
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS delivery_address TEXT,
  ADD COLUMN IF NOT EXISTS delivery_contact_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS delivery_contact_phone VARCHAR(50);

-- 2. Поля счёта, оплаты и трека в таблице orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS invoice_path VARCHAR(500),
  ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS payment_date DATE,
  ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(255);
