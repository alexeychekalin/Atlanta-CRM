-- Ходовые исполнения — наверх списка в карточке компонента и в калькуляторе.
--
-- Частоту не храним отдельным счётчиком: она видна из фактического применения —
-- сколько раз исполнение стоит в чертежах клиентов и в изделиях изготовителя.
-- Живой подсчёт не расходится с данными после удаления чертежа или правки
-- состава, а индексы ниже делают его дешёвым: список модификаций считает
-- агрегат по одному компоненту, а не по всей таблице.

-- применение в чертежах клиентов: WHERE modification_id = cm.id
CREATE INDEX IF NOT EXISTS idx_drawing_components_modification
  ON drawing_components(modification_id) WHERE modification_id IS NOT NULL;

-- применение в изделиях изготовителя: WHERE modification_id = cm.id
CREATE INDEX IF NOT EXISTS idx_manufacturer_product_components_modification
  ON manufacturer_product_components(modification_id) WHERE modification_id IS NOT NULL;
