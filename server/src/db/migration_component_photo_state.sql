-- Фото изделий: помнить, что менеджер удалил снимок в карточке позиции.
--
-- Импорт каталога (src/db/catalog.js) при каждом обновлении заново прикладывает
-- фото из catalog.json. Удалённую строку он не видел и создавал снова — правки
-- в карточке откатывались. Теперь удаление фото ставит отметку deleted_at:
-- импорт такие снимки пропускает, а менеджер видит их в списке «убранные» и
-- может вернуть. Строку при этом не стираем: иначе нечего было бы пропускать.

ALTER TABLE component_images
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

ALTER TABLE component_modification_images
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- Импорт ищет «нет ли такого снимка у позиции», включая убранные, —
-- без учёта deleted_at пары «позиция + путь» должно хватать индекса.
CREATE INDEX IF NOT EXISTS idx_component_images_live
  ON component_images(component_id, image_path) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_component_modification_images_live
  ON component_modification_images(modification_id, image_path) WHERE deleted_at IS NULL;

-- Обложка (components.image_path) всегда указывает на живое фото: импорт
-- заполняет её только из неубранных снимков и не восстанавливает удалённые.
