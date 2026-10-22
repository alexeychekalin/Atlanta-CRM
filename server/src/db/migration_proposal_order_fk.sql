-- =============================================
-- Удаление заказа, созданного из КП, больше не падает на внешнем ключе.
-- Ссылка proposals.order_id обнуляется, КП возвращается в работу
-- (статус «В заказе» снимается в DELETE /api/orders/:id).
-- Идемпотентна: можно применять повторно.
-- =============================================

ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_order_id_fkey;

ALTER TABLE proposals ADD CONSTRAINT proposals_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
