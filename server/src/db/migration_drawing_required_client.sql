-- =============================================
-- Чертёж всегда принадлежит клиенту.
-- Владелец (drawings.client_id) и связь drawing_clients — обязательны,
-- фикс-цена живёт только на связи клиента.
-- Идемпотентна.
-- =============================================

-- Если владелец потерялся, но есть связи — берём первого клиента
UPDATE drawings d
   SET client_id = (SELECT dcl.client_id FROM drawing_clients dcl
                     WHERE dcl.drawing_id = d.id
                     ORDER BY dcl.id LIMIT 1)
 WHERE d.client_id IS NULL
   AND EXISTS (SELECT 1 FROM drawing_clients dcl WHERE dcl.drawing_id = d.id);

-- Каждому владельцу — связь (и фикс-цена, если она осталась на чертеже)
INSERT INTO drawing_clients (drawing_id, client_id, fixed_price)
SELECT d.id, d.client_id, d.fixed_price
  FROM drawings d
 WHERE d.client_id IS NOT NULL
ON CONFLICT (drawing_id, client_id) DO UPDATE
   SET fixed_price = COALESCE(drawing_clients.fixed_price, EXCLUDED.fixed_price);

-- Фикс-цена больше не хранится на чертеже: она принадлежит клиенту
UPDATE drawings SET fixed_price = NULL WHERE fixed_price IS NOT NULL;
