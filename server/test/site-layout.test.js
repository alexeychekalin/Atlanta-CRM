/**
 * Проверки вёрстки сайта по таблице стилей.
 *
 * Отдельного браузера в тестах нет, поэтому ловим причины «мобильных» поломок
 * статически — те, что уже случались:
 *
 *   • сокращённый padding в модификаторе .wrap («padding: 24px 0 40px»)
 *     затирает боковые отступы, и текст на телефоне прилипает к краю экрана;
 *   • grid-элемент без min-width: 0 растягивается по min-content содержимого
 *     (полоса миниатюр, таблица), и фотографии уезжают за правый край.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const CSS = fs.readFileSync(path.join(ROOT, 'site/static/css/site.css'), 'utf8');
const BUILD = fs.readFileSync(path.join(ROOT, 'site/build.py'), 'utf8');

/** Тело правила по точному селектору: `.wrap { … }` → «…». */
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = CSS.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `в site.css нет правила ${selector}`);
  return match[1];
}

/** Классы, которые в разметке стоят рядом с .wrap — у них общий боковой отступ. */
function wrapCompanions() {
  const found = new Set();
  const re = /class="([^"]*\bwrap\b[^"]*)"/g;
  let match;
  while ((match = re.exec(BUILD)) !== null) {
    match[1].split(/\s+/).forEach((cls) => {
      if (cls && cls !== 'wrap') found.add(cls);
    });
  }
  return [...found].sort();
}

test('вёрстка: .wrap задаёт боковые отступы, модификаторы их не затирают', () => {
  const wrap = rule('.wrap');
  assert.match(wrap, /padding:\s*0\s+clamp\(/, '.wrap должен задавать боковой отступ через clamp()');

  const problems = [];
  for (const cls of wrapCompanions()) {
    const re = new RegExp(`\\.${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])[^{]*\\{([^}]*)\\}`, 'g');
    let match;
    while ((match = re.exec(CSS)) !== null) {
      for (const declaration of match[1].split(';')) {
        const value = declaration.trim();
        if (!/^padding\s*:/.test(value)) continue;
        const parts = value.replace(/^padding\s*:\s*/, '').split(/\s+/);
        // padding: <1 значение> боковые не трогает; 2+ значения — трогает
        if (parts.length >= 2 && parts.slice(1).some(part => /^0([a-z%]*)$/.test(part))) {
          problems.push(`.${cls} { ${value} }`);
        }
      }
    }
  }

  assert.deepEqual(problems, [],
    'сокращённый padding обнуляет боковые отступы — используйте padding-block');
});

test('вёрстка: карточка товара не растягивает страницу', () => {
  const product = rule('.product');
  assert.match(product, /grid-template-columns:\s*minmax\(0,\s*[\d.]+fr\)\s+minmax\(0,\s*[\d.]+fr\)/,
    'колонки .product должны быть minmax(0, …fr), иначе их распирает содержимое');

  assert.match(CSS, /\.product > \*\s*\{[^}]*min-width:\s*0/,
    'у вложенных блоков карточки нужен min-width: 0');
  assert.match(rule('.gallery'), /min-width:\s*0/, 'галерея не должна расширяться по содержимому');
  assert.match(CSS, /\.product img,[^{]*\{[^}]*max-width:\s*100%/,
    'картинки карточки должны ограничиваться шириной колонки');
});

test('вёрстка: полосы прокрутки на телефоне не тянут за собой страницу', () => {
  const thumbs = rule('.gallery__thumbs');
  assert.match(thumbs, /overflow-x:\s*auto/, 'миниатюры листаются по горизонтали');
  assert.match(thumbs, /max-width:\s*100%/, 'полоса миниатюр не шире карточки');
  assert.match(thumbs, /min-width:\s*0/, 'полоса миниатюр не должна расширяться по содержимому');

  const mods = rule('.mods__scroll');
  assert.match(mods, /overflow-x:\s*auto/, 'таблица исполнений листается по горизонтали');
  assert.match(mods, /min-width:\s*0/);
});
