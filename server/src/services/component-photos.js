/**
 * Обложка позиции и убранные фото.
 *
 * Фото в карточке позиции не удаляются, а помечаются `deleted_at`: иначе
 * импорт каталога (src/db/catalog.js) при следующем обновлении приложил бы
 * снимок из catalog.json заново. Живые фото — те, у которых отметки нет.
 *
 * Обложка (`components.image_path`) обязана указывать на живое фото:
 *   - убрали обложку → берём первое оставшееся;
 *   - вернули фото или добавили новое, а обложки нет → ставим его;
 *   - последнее фото убрали → обложка пустая (и импорт её не восстановит:
 *     см. photoWasRemoved в catalog.js).
 */

/** Первое живое фото галереи. */
async function firstLivePhoto(runner, componentId) {
  const result = await runner.query(
    `SELECT image_path FROM component_images
      WHERE component_id = $1 AND deleted_at IS NULL
      ORDER BY sort_order, id LIMIT 1`,
    [componentId]
  );
  return result.rows.length ? result.rows[0].image_path : null;
}

/**
 * Привести обложку в порядок после изменения галереи.
 *
 * options.onlyPath — снимок, который только что убрали: обложку меняем,
 *   только если она указывала именно на него (остальные не трогаем);
 * options.fallback — снимок, который только что вернули или добавили:
 *   он становится обложкой, если обложки нет.
 */
async function coverSync(runner, componentId, options = {}) {
  const current = await runner.query(
    'SELECT image_path FROM components WHERE id = $1',
    [componentId]
  );
  if (current.rows.length === 0) return null;
  const cover = current.rows[0].image_path || null;

  // Обложка указывает на убранный снимок или её нет — ставим первое живое
  const coverIsLive = cover
    ? (await runner.query(
      'SELECT 1 FROM component_images WHERE component_id = $1 AND image_path = $2 AND deleted_at IS NULL LIMIT 1',
      [componentId, cover]
    )).rows.length > 0
    : false;

  if (cover && coverIsLive) return cover;
  if (cover && options.onlyPath && cover !== options.onlyPath) return cover;

  const next = await firstLivePhoto(runner, componentId);
  const target = next || (options.fallback && await isLive(runner, componentId, options.fallback)
    ? options.fallback
    : null);

  if (target === cover) return cover;
  await runner.query('UPDATE components SET image_path = $2 WHERE id = $1', [componentId, target]);
  return target;
}

async function isLive(runner, componentId, imagePath) {
  const result = await runner.query(
    'SELECT 1 FROM component_images WHERE component_id = $1 AND image_path = $2 AND deleted_at IS NULL LIMIT 1',
    [componentId, imagePath]
  );
  return result.rows.length > 0;
}

/** Сколько снимков убрано в карточке — для плашки «вернуть». */
async function photosRemoved(runner, componentId) {
  const result = await runner.query(
    'SELECT count(*)::int AS n FROM component_images WHERE component_id = $1 AND deleted_at IS NOT NULL',
    [componentId]
  );
  return result.rows[0].n;
}

module.exports = { firstLivePhoto, coverSync, photosRemoved };
