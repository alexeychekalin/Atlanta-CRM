-- =============================================
-- Фиксированная цена для конкретного клиента.
-- Один и тот же чертёж может стоить по-разному: у каждого клиента
-- своя фикс-цена (drawing_clients.fixed_price).
-- Идемпотентна.
-- =============================================

ALTER TABLE drawing_clients ADD COLUMN IF NOT EXISTS fixed_price NUMERIC(14,2);

-- Переносим исторические фикс-цены чертежа на связь с владельцем:
-- раньше fixed_price жил в drawings и действовал на всех клиентов сразу.
UPDATE drawing_clients dcl
   SET fixed_price = d.fixed_price
  FROM drawings d
 WHERE d.id = dcl.drawing_id
   AND d.fixed_price IS NOT NULL
   AND dcl.fixed_price IS NULL;

-- Защита от NaN (мог появиться при частичном обновлении наценки)
UPDATE drawing_clients SET markup_pct = NULL WHERE markup_pct::text = 'NaN';
UPDATE drawing_clients SET markup_rub = 0 WHERE markup_rub::text = 'NaN';
UPDATE drawing_clients SET fixed_price = NULL WHERE fixed_price::text = 'NaN';

UPDATE drawings d
   SET fixed_price = NULL
 WHERE d.fixed_price IS NOT NULL
   AND EXISTS (SELECT 1 FROM drawing_clients dcl WHERE dcl.drawing_id = d.id);
