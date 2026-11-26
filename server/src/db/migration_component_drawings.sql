-- Чертежи в карточке компонента.
--
-- У компонента уже есть документы двух типов: сертификаты (certificate) и
-- информационные сообщения (info). Чертежи завода — отдельный тип: их ищут
-- и скачивают иначе, чем сертификаты, и в архиве они должны лежать в своей
-- папке. Ограничение CHECK в разных базах создано с разными именами
-- (таблица создавалась и в schema.sql, и в migration_sync_v2), поэтому
-- перебираем все CHECK-ограничения таблицы и пересоздаём только те, что
-- действительно ограничивают doc_type.
--
-- Миграция идемпотентна: повторный запуск ничего не меняет.

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE rel.relname = 'component_documents'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) LIKE '%doc_type%'
  LOOP
    EXECUTE format('ALTER TABLE component_documents DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  ALTER TABLE component_documents
    ADD CONSTRAINT component_documents_doc_type_check
    CHECK (doc_type IN ('certificate', 'info', 'drawing'));
END $$;
