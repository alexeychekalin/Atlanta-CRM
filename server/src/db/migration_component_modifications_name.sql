-- Описание исполнения (длина, потребитель) не влезает в VARCHAR(255):
-- в спецификации жгутов встречаются описания до 400+ символов.
ALTER TABLE component_modifications ALTER COLUMN name TYPE TEXT;
