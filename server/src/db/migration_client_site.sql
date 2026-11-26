-- Сайт клиента: показывается ссылкой в шапке карточки и используется в печати.
-- Идемпотентна.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS site VARCHAR(500);
