-- Добавить ссылку на ГИСП к компонентам
ALTER TABLE components ADD COLUMN IF NOT EXISTS gisp_url VARCHAR(500);
