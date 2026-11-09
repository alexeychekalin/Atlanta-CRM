/* Просмотр фотографий (Lightbox) в песочнице с минимальным DOM.
 *
 * Проверяем то, на что жаловались: фото листаются, а закрытие просмотра
 * не закрывает карточку компонента (Lightbox — отдельный слой, не Modal). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const lightboxSource = fs.readFileSync(
  path.join(__dirname, '../../client/js/components/lightbox.js'), 'utf8'
);

/** Минимальный DOM: хватает для построения разметки Lightbox. */
function fakeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    style: {},
    className: '',
    _text: '',
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name]; },
    removeAttribute(name) { delete this.attributes[name]; },
    appendChild(child) { this.children.push(child); return child; },
    append(...nodes) { nodes.forEach(node => this.children.push(node)); },
    addEventListener() {},
    querySelector() { return null; },
    focus() {},
    scrollIntoView() {},
    classList: {
      _set: new Set(),
      add(name) { this._set.add(name); },
      remove(name) { this._set.delete(name); },
      contains(name) { return this._set.has(name); },
      toggle(name, force) {
        if (force === undefined) {
          if (this._set.has(name)) this._set.delete(name); else this._set.add(name);
        } else if (force) {
          this._set.add(name);
        } else {
          this._set.delete(name);
        }
      },
    },
  };
  // как в браузере: установка textContent очищает вложенные узлы
  Object.defineProperty(el, 'textContent', {
    get() { return this._text; },
    set(value) {
      this._text = String(value);
      if (value === '') this.children = [];
    },
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._text; },
    set(value) { this._text = String(value); },
  });
  return el;
}

function loadLightbox() {
  const keyHandlers = [];
  const body = fakeElement('body');
  const sandbox = {
    window: {},
    console,
    document: {
      body,
      activeElement: null,
      createElement: tag => fakeElement(tag),
      addEventListener: (type, handler) => { if (type === 'keydown') keyHandlers.push(handler); },
    },
    Image: function Image() { this.src = ''; },
  };
  vm.createContext(sandbox);
  vm.runInContext(lightboxSource + '\n;globalThis.Lightbox = Lightbox;', sandbox);
  return { lightbox: sandbox.Lightbox, body, keyHandlers };
}

test('счётчик показывает позицию и общее число фото', () => {
  const { lightbox } = loadLightbox();
  lightbox.open({ images: ['/a.jpg', '/b.jpg', '/c.jpg'], index: 1, title: 'Фонарь' });

  assert.ok(lightbox.overlay.classList.contains('is-open'));
  assert.equal(lightbox.counterEl.textContent, '2 / 3');
  assert.equal(lightbox.imageEl.src, '/b.jpg');
  assert.equal(lightbox.titleEl.textContent, 'Фонарь');
});

test('листание идёт по кругу в обе стороны', () => {
  const { lightbox } = loadLightbox();
  lightbox.open({ images: ['/a.jpg', '/b.jpg', '/c.jpg'], index: 0 });

  lightbox.go(1);
  assert.equal(lightbox.index, 1);
  assert.equal(lightbox.imageEl.src, '/b.jpg');

  lightbox.go(-1);
  assert.equal(lightbox.index, 0);

  lightbox.go(-1);                     // с первого фото назад — на последнее
  assert.equal(lightbox.index, 2);
  assert.equal(lightbox.imageEl.src, '/c.jpg');
  assert.equal(lightbox.counterEl.textContent, '3 / 3');

  lightbox.go(1);                      // с последнего вперёд — на первое
  assert.equal(lightbox.index, 0);
});

test('закрытие прячет только просмотр: карточка остаётся открытой', () => {
  const { lightbox, body } = loadLightbox();
  lightbox.open({ images: ['/a.jpg', '/b.jpg'], index: 0 });

  assert.ok(body.classList.contains('lightbox-open'));
  lightbox.close();

  assert.equal(lightbox.overlay.classList.contains('is-open'), false);
  assert.equal(body.classList.contains('lightbox-open'), false);
  assert.equal(lightbox.isOpen, false);
  // слой остаётся в DOM переиспользуемым — второй показ не пересоздаёт разметку
  assert.ok(lightbox.imageEl);
});

test('одно фото — стрелки и миниатюры не показываются', () => {
  const { lightbox } = loadLightbox();
  lightbox.open({ images: ['/one.jpg'], index: 0 });

  assert.ok(lightbox.overlay.classList.contains('lightbox--single'));
  assert.equal(lightbox.counterEl.textContent, '1 / 1');

  lightbox.close();
  lightbox.open({ images: ['/one.jpg', '/two.jpg'], index: 0 });
  assert.equal(lightbox.overlay.classList.contains('lightbox--single'), false);
});

test('Esc закрывает просмотр и не даёт событию дойти до карточки', () => {
  const { lightbox, keyHandlers } = loadLightbox();
  lightbox.open({ images: ['/a.jpg', '/b.jpg'], index: 0 });

  assert.equal(keyHandlers.length, 1, 'обработчик клавиш вешается один раз');
  let stopped = false;
  keyHandlers[0]({
    key: 'Escape',
    preventDefault() {},
    stopPropagation() { stopped = true; },
  });

  assert.equal(stopped, true, 'Modal не должен получить Esc и закрыть карточку');
  assert.equal(lightbox.isOpen, false);
});

test('стрелки клавиатуры листают фото', () => {
  const { lightbox, keyHandlers } = loadLightbox();
  lightbox.open({ images: ['/a.jpg', '/b.jpg', '/c.jpg'], index: 0 });

  keyHandlers[0]({ key: 'ArrowRight', preventDefault() {}, stopPropagation() {} });
  assert.equal(lightbox.index, 1);

  keyHandlers[0]({ key: 'ArrowLeft', preventDefault() {}, stopPropagation() {} });
  assert.equal(lightbox.index, 0);

  keyHandlers[0]({ key: 'End', preventDefault() {}, stopPropagation() {} });
  assert.equal(lightbox.index, 2);
});

test('пустой список не открывает просмотр', () => {
  const { lightbox } = loadLightbox();
  lightbox.open({ images: [], index: 0 });
  assert.equal(lightbox.isOpen, false);
  assert.equal(lightbox.overlay, null);
});
