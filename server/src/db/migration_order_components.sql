-- =============================================
-- Миграция: позиции заказа из Компонентов
-- Раньше order_items.product_id ссылался на products(id).
-- Теперь позиции берутся из каталога компонентов (components),
-- поэтому FK на products нужно снять. Идентификатор источника
-- по-прежнему хранится в product_id, наименование — в product_name.
-- =============================================
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_product_id_fkey;
