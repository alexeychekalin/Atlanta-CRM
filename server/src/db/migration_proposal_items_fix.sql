-- Убрать FK на products из proposal_items (позиции могут быть компонентами)
ALTER TABLE proposal_items DROP CONSTRAINT IF EXISTS proposal_items_product_id_fkey;
