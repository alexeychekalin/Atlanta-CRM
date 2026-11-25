/**
 * Тексты сайта: слоган, ключевые цифры, условия доставки и слайдер на главной.
 *
 * Проверки двух видов:
 *   • статические — какие значения лежат в content.json,
 *   • сборка — реальный build.py на настоящем каталоге: в HTML не должно
 *     остаться старых цифр, а в ленте «Популярное» должны стоять позиции
 *     из разных разделов каталога.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const CONTENT = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/content.json'), 'utf8'));
const CSS = fs.readFileSync(path.join(ROOT, 'site/static/css/site.css'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'site/static/js/site.js'), 'utf8');
const OUT = path.join(require('os').tmpdir(), 'atlanta-site-content-test');

test('сайт: слоган не сводит всю продукцию к прицепам', () => {
  const slogan = CONTENT.site.tagline;
  assert.match(slogan, /собственное производство/i, 'слоган — про собственное производство');
  assert.doesNotMatch(slogan.toLowerCase(), /для прицепов/i,
    'слоган не должен читаться как «делаем только для прицепов»');
  assert.equal(CONTENT.hero.title, slogan, 'H1 на главной совпадает со слоганом');
  assert.doesNotMatch(CONTENT.hero.eyebrow.toLowerCase(), /собственное производство/,
    'надзаголовок не дублирует H1');
  // в подзаголовке прицепы остаются, но в общем перечне
  assert.match(CONTENT.hero.lead, /для грузовиков, автобусов, прицепов/);
});

test('сайт: цифры на главной — специалисты и площади вместо разделов и исполнений', () => {
  const stats = CONTENT.stats.map((item) => `${item.value} ${item.label}`);
  assert.deepEqual(stats, [
    '2000 год основания',
    '100+ квалифицированных специалистов',
    '5000 м² производственных площадей',
    'Липецкая обл. производственная площадка',
  ]);
  const facts = CONTENT.about.facts.map((item) => `${item.value} ${item.label}`);
  assert.deepEqual(facts, stats, 'плитки «О компании» повторяют цифры с главной');

  const texts = JSON.stringify(CONTENT, null, 1);
  assert.doesNotMatch(texts, /\d+\s+исполнени[яей] в каталоге/, 'нет «N исполнений в каталоге»');
  assert.match(CONTENT.advantages[3].text, /5000 м² производственных площадей/);
  assert.match(CONTENT.about.paragraphs[2], /Более 100 квалифицированных специалистов/);
});

test('сайт: доставка до терминала в Липецке за счёт завода', () => {
  const delivery = CONTENT.terms.find((item) => item.title === 'Доставка');
  assert.ok(delivery, 'в условиях работы есть блок «Доставка»');
  assert.match(delivery.text, /до терминала в г\. Липецк за наш счёт/);
  assert.doesNotMatch(delivery.text, /Москве и Санкт-Петербурге/);
});

test('сайт: лента «Популярное» — слайдер с позициями из разных разделов', (t) => {
  const script = `
import json, pathlib, re, sys
sys.path.insert(0, 'site')
import build

content = json.loads(pathlib.Path('site/content.json').read_text(encoding='utf-8'))
catalog = json.loads(pathlib.Path('server/src/db/catalog/catalog.json').read_text(encoding='utf-8'))
site = build.Site(content, catalog, pathlib.Path(sys.argv[1]))
html = site.index()
picked = site.featured_components()
categories = [item['category'] for item in picked]
print(json.dumps({
    'categories': categories,
    'articles': [item['article'] for item in picked],
    'has_slider': 'data-slider' in html,
    'has_grid': 'class="product-grid"' in html,
    'track': re.search(r'class="slider__track">(.*?)</div>\\s*</div>', html, re.S) is not None,
    'html': html,
}, ensure_ascii=False))
`;
  const result = spawnSync('python3', ['-c', script, OUT], { cwd: ROOT, encoding: 'utf8' });
  if (result.error && result.error.code === 'ENOENT') {
    t.skip('python3 не найден');
    return;
  }
  assert.equal(result.status, 0, result.stderr);
  const sample = JSON.parse(result.stdout);

  assert.equal(sample.categories.length, 8, 'в ленте восемь позиций');
  assert.equal(new Set(sample.categories).size, sample.categories.length,
    'все позиции ленты — из разных разделов каталога');
  assert.ok(!sample.categories.includes('accessory'), 'крепёж и чехлы в витрину не попадают');

  assert.ok(sample.has_slider, 'на главной есть разметка слайдера');
  assert.ok(!sample.has_grid, 'старая сетка «Популярного» заменена лентой');
  assert.match(sample.html, /data-slider-prev/, 'у слайдера есть кнопка «назад»');
  assert.match(sample.html, /data-slider-next/, 'у слайдера есть кнопка «вперёд»');
});

test('сайт: слайдер листается без библиотек и остаётся доступным', () => {
  assert.match(CSS, /\.slider__viewport\s*\{[^}]*overflow-x:\s*auto/,
    'лента прокручивается нативно — работает и без JS');
  assert.match(CSS, /\.slider__track\s*\{[^}]*grid-auto-flow:\s*column/);
  assert.match(JS, /data-slider-prev/, 'кнопки слайдера подключены в site.js');
  assert.match(JS, /scrollTo\(/, 'прокрутка к карточке');
  assert.doesNotMatch(JS, /swiper|slick|carousel/i, 'без внешних библиотек слайдера');
});

test('сайт: в собранных страницах нет старых цифр и адресов доставки', () => {
  const build = spawnSync('python3', ['site/build.py', '--skip-images', '--out', OUT],
    { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  if (build.error && build.error.code === 'ENOENT') return;

  assert.equal(build.status, 0, build.stderr);

  const home = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  const all = ['index.html', 'about/index.html', 'catalog/index.html', 'delivery/index.html']
    .map((page) => fs.readFileSync(path.join(OUT, page), 'utf8')).join('\n');

  assert.match(home, /100\+<\/div><div class="stat__label">квалифицированных специалистов/);
  assert.match(home, /5000<\/div><div class="stat__label">м² производственных площадей/);
  assert.doesNotMatch(all, /980 исполнени/, 'старое число исполнений со страниц ушло');
  assert.doesNotMatch(all, /191 позици/, 'старое число позиций со страниц ушло');
  assert.doesNotMatch(all, /\d+\s+раздел/, 'числовые «11 разделов» заменены нейтральной формулировкой');
  assert.match(home, /Широкий ассортимент: от габаритного огня до жгута/);
  assert.doesNotMatch(all, /до терминала в Москве/);
  assert.doesNotMatch(all, /для прицепов — грузовых и легковых/);
});

test('сайт: один телефон и две почты, без разбивки по городам', () => {
  const contacts = CONTENT.contacts;
  assert.equal(contacts.phone, '+7 985 964-11-23');
  assert.equal(contacts.phone_href, '+79859641123');
  assert.deepEqual(contacts.emails, ['alexey.chekalin@gmail.com', 'atlanta-shop@bk.ru']);
  assert.equal(contacts.email, contacts.emails[0], 'основная почта — первая в списке');
  assert.equal(contacts.offices, undefined, 'офисов по городам больше нет');

  // старые телефоны и почты не должны остаться нигде в текстах сайта
  const texts = JSON.stringify(CONTENT);
  assert.doesNotMatch(texts, /spb\.atlas|regions\.atlas/, 'почты СПб и регионов убраны');
  assert.doesNotMatch(texts, /993 364-10-78|79933641078/, 'телефон СПб убран');
});

test('сайт: страница контактов — карта Яндекса и без регионов', () => {
  const BUILD = fs.readFileSync(path.join(ROOT, 'site/build.py'), 'utf8');
  const map = CONTENT.contacts.map;
  assert.equal(map.constructor, 'a8d08a63a123d9f4c185b078f16346fecf535c1601c3cf87b6a2bd434e44e2c7');
  assert.match(BUILD, /api-maps\.yandex\.ru\/services\/constructor\/1\.0\/js\//,
    'карта подключается конструктором Яндекса');
  assert.match(BUILD, /id="yandex-map"/, 'у карты есть свой контейнер');
  // скрипт карты ставится в конце body, после site.js — иначе он тормозит вёрстку
  assert.match(BUILD, /def footer\(self, scripts=''\)/);
  assert.match(BUILD, /def page\([^)]*extra_scripts=None/s);
  assert.doesNotMatch(BUILD, /'Москва, Санкт-Петербург, регионы\.'/,
    'описание страницы контактов больше не перечисляет регионы');
});

test('сайт: после сборки телефон и почты одинаковы на всех страницах', () => {
  const build = spawnSync('python3', ['site/build.py', '--skip-images', '--out', OUT],
    { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  assert.equal(build.status, 0, build.stderr);

  const pages = ['index.html', 'contacts/index.html', 'catalog/index.html',
    'about/index.html', 'delivery/index.html', 'privacy/index.html'];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(OUT, page), 'utf8');
    assert.doesNotMatch(html, /spb\.atlas|regions\.atlas|993 364-10-78|79933641078/,
      `${page}: старые контакты остались`);
    assert.match(html, /\+7 985 964-11-23/, `${page}: нет рабочего телефона`);
    if (page !== 'privacy/index.html') {
      assert.match(html, /alexey\.chekalin@gmail\.com/, `${page}: нет первой почты`);
      assert.match(html, /atlanta-shop@bk\.ru/, `${page}: нет второй почты`);
    }
  }

  // на карте — ссылка конструктора, а не голый iframe с чужими размерами
  const contacts = fs.readFileSync(path.join(OUT, 'contacts/index.html'), 'utf8');
  assert.match(contacts, /api-maps\.yandex\.ru\/services\/constructor/);
  assert.match(contacts, /um=constructor%3Aa8d08a63a123d9f4c185b078f16346fecf535c1601c3cf87b6a2bd434e44e2c7/);
});
