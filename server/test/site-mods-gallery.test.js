/**
 * Галерея исполнений на сайте.
 *
 * Раньше клик по миниатюре в таблице исполнений подставлял фото в галерею
 * товара наверху страницы (data-gallery-jump) — на телефоне это выглядело как
 * «ничего не произошло». Теперь строка исполнения с фотографиями открывает
 * своё окно-галерею (photobox), а у исполнений без фото клика нет вовсе.
 *
 * Браузера в тестах нет, поэтому проверяем контракт: разметку, которую отдаёт
 * build.py (на реальном каталоге), стили и обработчики site.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const CSS = fs.readFileSync(path.join(ROOT, 'site/static/css/site.css'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'site/static/js/site.js'), 'utf8');
const BUILD = fs.readFileSync(path.join(ROOT, 'site/build.py'), 'utf8');

/** Отрендерить карточку с самым «смешанным» набором исполнений. */
function renderSample() {
  const script = `
import json, pathlib, sys
sys.path.insert(0, 'site')
import build

content = json.loads(pathlib.Path('site/content.json').read_text(encoding='utf-8'))
catalog = json.loads(pathlib.Path('server/src/db/catalog/catalog.json').read_text(encoding='utf-8'))
site = build.Site(content, catalog, pathlib.Path('/tmp/site-mods-gallery-check'))

def photos(mod):
    return len(mod.get('images') or [])

# позиция, где есть и исполнения с фото, и исполнения без них
best = max(site.components, key=lambda c: (
    sum(1 for m in (c.get('modifications') or []) if photos(m)),
    -sum(1 for m in (c.get('modifications') or []) if not photos(m)),
    len(c.get('modifications') or []),
))
mods = best.get('modifications') or []
html = site.product_page(best)
print(json.dumps({
    'article': best['article'],
    'mods': len(mods),
    'mods_with_photos': sum(1 for m in mods if photos(m)),
    'photos': sum(photos(m) for m in mods),
    'html': html,
}, ensure_ascii=False))
`;
  const result = spawnSync('python3', ['-c', script], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  if (result.error && result.error.code === 'ENOENT') return null;
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('сайт: галерея исполнения открывается только там, где есть фото', (t) => {
  const sample = renderSample();
  if (!sample) {
    t.skip('python3 не найден');
    return;
  }
  const { html } = sample;

  assert.ok(sample.mods_with_photos > 0, 'в каталоге должен быть хотя бы один исполнение с фото');

  const photoRows = html.match(/<tr class="mods__row mods__row--photo"/g) || [];
  assert.equal(photoRows.length, sample.mods_with_photos,
    'кликабельных строк ровно столько же, сколько исполнений с фотографиями');

  const photoButtons = html.match(/data-photo-src="/g) || [];
  assert.equal(photoButtons.length, sample.photos,
    'в галерею попадают все снимки исполнений, включая скрытые за «+N»');

  // у исполнений без фото строки остаются обычными и не кликаются
  const plainRows = (html.match(/<tr class="mods__row"(?!\s+mods__row--photo)/g) || []).length;
  assert.equal(plainRows, sample.mods - sample.mods_with_photos);

  const articles = html.match(/<button type="button" class="mods__article"/g) || [];
  assert.equal(articles.length, photoRows.length,
    'артикул — кнопка только внутри кликабельной строки');

  assert.match(html, /class="mods__hint"[^>]*>Нажмите на исполнение с фотографиями/,
    'под таблицей нужна подсказка, что исполнения кликаются');
  assert.ok(!/data-gallery-jump/.test(html), 'старый обработчик-переброс на галерею товара больше не нужен');
  assert.ok(!/data-gallery-jump/.test(JS) && !/data-gallery-jump/.test(BUILD),
    'ни разметка, ни скрипт не должны ссылаться на удалённый data-gallery-jump');
});

test('сайт: окно галереи исполнения — стили и клавиатура', () => {
  // лишние снимки в строке не растягивают таблицу
  assert.match(CSS, /\.mods__photo--extra\s*\{[^}]*display:\s*none/,
    'миниатюры сверх трёх скрываются классом .mods__photo--extra');

  // окно открывается и закрывается классом is-open, а не инлайновым стилем
  assert.match(CSS, /\.photobox\s*\{[^}]*position:\s*fixed/);
  assert.match(CSS, /\.photobox\s*\{[^}]*display:\s*none/);
  assert.match(CSS, /\.photobox\.is-open\s*\{[^}]*display:\s*flex/);

  // на телефоне окно занимает экран, а фото не выходит за края
  assert.match(CSS, /\.photobox__img\s*\{[^}]*max-width:\s*100%[^}]*max-height:/s);
  assert.match(CSS, /@media \(max-width: 640px\)[\s\S]{0,600}\.photobox__dialog\s*\{[^}]*width:\s*100%/);

  // листание: клик по миниатюре и по строке, стрелки, Esc, свайп
  assert.match(JS, /querySelectorAll\('\[data-mod-gallery\]'\)/);
  assert.match(JS, /event\.key === 'Escape'/);
  assert.match(JS, /event\.key === 'ArrowLeft'/);
  assert.match(JS, /event\.key === 'ArrowRight'/);
  assert.match(JS, /touchstart[\s\S]{0,600}touchend/, 'на телефоне фото листается свайпом');
  assert.match(JS, /document\.body\.style\.overflow = 'hidden'/, 'фон не должен прокручиваться под окном');
  assert.match(JS, /\.focus\(\)/, 'фокус уходит в окно и возвращается на строку');
});
