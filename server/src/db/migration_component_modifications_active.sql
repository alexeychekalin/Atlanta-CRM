-- Модификацию можно временно снять с продажи, не удаляя её:
-- в чертежах и документах прошлые ссылки остаются рабочими,
-- а в калькуляторе и выборе исполнения она больше не предлагается.
ALTER TABLE component_modifications
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Активные модификации компонента — самый частый запрос (калькулятор, карточка).
CREATE INDEX IF NOT EXISTS idx_component_modifications_active
  ON component_modifications(component_id) WHERE is_active;
