-- Карточка организации: наименования полностью и по-английски, коды
-- статистики, должность и основание полномочий руководителя.
-- Идемпотентна: повторное применение ничего не ломает.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS full_name TEXT;               -- полное наименование на русском
ALTER TABLE clients ADD COLUMN IF NOT EXISTS name_en VARCHAR(255);         -- сокращённое на английском
ALTER TABLE clients ADD COLUMN IF NOT EXISTS full_name_en TEXT;            -- полное на английском
ALTER TABLE clients ADD COLUMN IF NOT EXISTS okpo VARCHAR(20);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS okved VARCHAR(100);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS director_position VARCHAR(255); -- «Генеральный директор»
ALTER TABLE clients ADD COLUMN IF NOT EXISTS director_basis VARCHAR(255);    -- «Устав»
