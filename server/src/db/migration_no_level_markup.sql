-- Отключение наценки уровня клиента на отдельную позицию КП или заказа.
-- Наценка уровня задаётся в карточке клиента (client_pricing_levels.markup_pct)
-- и раньше применялась всегда. Менеджеру нужна возможность продать позицию
-- по базовой цене: флаг хранится рядом с самой позицией, поэтому документ
-- можно переоткрыть и увидеть, где наценка была отключена.
ALTER TABLE proposal_items ADD COLUMN IF NOT EXISTS no_level_markup BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE order_items    ADD COLUMN IF NOT EXISTS no_level_markup BOOLEAN NOT NULL DEFAULT false;
