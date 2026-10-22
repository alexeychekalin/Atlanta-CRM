-- =============================================
-- Миграция: объединение client_drawings → drawings
-- =============================================

-- 1. Перенести данные из client_drawings в drawings (если есть)
INSERT INTO drawings (name, file_path, file_type, description, client_id, created_by, created_at)
SELECT name, file_path, file_type, description, client_id, uploaded_by, created_at
FROM client_drawings
WHERE NOT EXISTS (
  SELECT 1 FROM drawings d
  WHERE d.file_path = client_drawings.file_path
    AND d.client_id = client_drawings.client_id
)
ON CONFLICT DO NOTHING;

-- 2. Готово! Таблица client_drawings остаётся для обратной совместимости,
--    но больше не используется приложением.
