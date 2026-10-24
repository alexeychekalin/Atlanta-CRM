-- =============================================
-- Чистка дублей словарей и защита от повторного задвоения.
--
-- Причина: schema.sql и миграции вставляли статусы клиентов, категории
-- компонентов и типы техники через ON CONFLICT DO NOTHING, но уникального
-- ключа по названию не было — каждый db:init при деплое добавлял ещё один
-- комплект значений. Теперь вставки идут через WHERE NOT EXISTS, а здесь
-- мы убираем уже накопившиеся дубли и ставим уникальные индексы.
--
-- Идемпотентна: повторный запуск ничего не меняет.
-- =============================================

-- 1. Статусы клиентов: ссылки на дубли переводим на самую раннюю запись
UPDATE clients c
   SET status_id = keep.keep_id
  FROM client_work_statuses cur
  JOIN (
        SELECT lower(name) AS lname, MIN(id) AS keep_id
          FROM client_work_statuses
         GROUP BY lower(name)
       ) keep ON keep.lname = lower(cur.name)
 WHERE c.status_id = cur.id
   AND cur.id <> keep.keep_id;

DELETE FROM client_work_statuses s
 USING (
        SELECT lower(name) AS lname, MIN(id) AS keep_id
          FROM client_work_statuses
         GROUP BY lower(name)
       ) keep
 WHERE lower(s.name) = keep.lname
   AND s.id <> keep.keep_id;

-- 2. Категории компонентов
UPDATE components c
   SET category_id = keep.keep_id
  FROM component_categories cur
  JOIN (
        SELECT lower(name) AS lname, MIN(id) AS keep_id
          FROM component_categories
         GROUP BY lower(name)
       ) keep ON keep.lname = lower(cur.name)
 WHERE c.category_id = cur.id
   AND cur.id <> keep.keep_id;

DELETE FROM component_categories cat
 USING (
        SELECT lower(name) AS lname, MIN(id) AS keep_id
          FROM component_categories
         GROUP BY lower(name)
       ) keep
 WHERE lower(cat.name) = keep.lname
   AND cat.id <> keep.keep_id;

-- 3. Типы техники
UPDATE manufacturer_products p
   SET equipment_type_id = keep.keep_id
  FROM equipment_types cur
  JOIN (
        SELECT lower(name) AS lname, MIN(id) AS keep_id
          FROM equipment_types
         GROUP BY lower(name)
       ) keep ON keep.lname = lower(cur.name)
 WHERE p.equipment_type_id = cur.id
   AND cur.id <> keep.keep_id;

DELETE FROM equipment_types t
 USING (
        SELECT lower(name) AS lname, MIN(id) AS keep_id
          FROM equipment_types
         GROUP BY lower(name)
       ) keep
 WHERE lower(t.name) = keep.lname
   AND t.id <> keep.keep_id;

-- 4. Уникальные индексы по названию (без учёта регистра).
-- Теперь СУБД сама не даст создать второй «Новый» или «Полуприцепы».
CREATE UNIQUE INDEX IF NOT EXISTS ux_client_work_statuses_name
  ON client_work_statuses (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS ux_component_categories_name
  ON component_categories (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS ux_equipment_types_name
  ON equipment_types (lower(name));
