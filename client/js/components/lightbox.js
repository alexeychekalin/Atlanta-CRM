/* Lightbox — просмотр фотографий поверх карточки.
 *
 * Отдельный слой выше модального окна (z-index 1500 против 1000), поэтому:
 *   • «Закрыть» возвращает к карточке компонента, а не закрывает её;
 *   • карточка остаётся как была — ничего не перерисовывается.
 *
 * Листать можно стрелками на экране, клавишами ←/→, свайпом на телефоне
 * и кликом по миниатюре. Esc и клик по фону закрывают только просмотр.
 *
 * Использование:
 *   Lightbox.open({ images: ['/uploads/a.jpg', '/uploads/b.jpg'], index: 1, title: 'Фонарь' });
 */
const Lightbox = {
  overlay: null,
  imageEl: null,
  titleEl: null,
  counterEl: null,
  thumbsEl: null,
  stageEl: null,
  prevBtn: null,
  nextBtn: null,

  images: [],
  index: 0,
  title: '',
  isOpen: false,
  lastFocus: null,
  _touchStart: null,

  /** Зацикленный индекс: -1 у первого фото — последнее, и наоборот. */
  wrap(index, length) {
    if (!length) return 0;
    return ((index % length) + length) % length;
  },

  /** Создаёт разметку один раз и вешает обработчики. */
  ensure() {
    if (this.overlay) return;

    const overlay = document.createElement('div');
    overlay.className = 'lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Просмотр фотографий');

    const top = document.createElement('div');
    top.className = 'lightbox__top';

    const titleEl = document.createElement('div');
    titleEl.className = 'lightbox__title';

    const tools = document.createElement('div');
    tools.className = 'lightbox__tools';

    const counterEl = document.createElement('span');
    counterEl.className = 'lightbox__counter';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'lightbox__close';
    closeBtn.setAttribute('aria-label', 'Закрыть просмотр');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => this.close());

    tools.append(counterEl, closeBtn);
    top.append(titleEl, tools);

    const stage = document.createElement('div');
    stage.className = 'lightbox__stage';

    const imageEl = document.createElement('img');
    imageEl.className = 'lightbox__image';
    imageEl.alt = '';
    imageEl.addEventListener('click', (event) => event.stopPropagation());
    stage.appendChild(imageEl);

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'lightbox__nav lightbox__nav--prev';
    prevBtn.setAttribute('aria-label', 'Предыдущее фото');
    prevBtn.innerHTML = '&#8249;';
    prevBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.go(-1);
    });

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'lightbox__nav lightbox__nav--next';
    nextBtn.setAttribute('aria-label', 'Следующее фото');
    nextBtn.innerHTML = '&#8250;';
    nextBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.go(1);
    });

    const thumbs = document.createElement('div');
    thumbs.className = 'lightbox__thumbs';

    overlay.append(top, prevBtn, stage, nextBtn, thumbs);

    // клик мимо снимка — закрыть просмотр, карточка остаётся
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target === stage) this.close();
    });

    this._bindSwipe(stage);

    // capture: перехватываем раньше остальных, иначе Esc закроет и карточку
    document.addEventListener('keydown', (event) => {
      if (!this.isOpen) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        this.close();
      } else if (event.key === 'ArrowLeft') {
        event.stopPropagation();
        event.preventDefault();
        this.go(-1);
      } else if (event.key === 'ArrowRight') {
        event.stopPropagation();
        event.preventDefault();
        this.go(1);
      } else if (event.key === 'Home') {
        event.stopPropagation();
        event.preventDefault();
        this.show(0);
      } else if (event.key === 'End') {
        event.stopPropagation();
        event.preventDefault();
        this.show(this.images.length - 1);
      }
    }, true);

    document.body.appendChild(overlay);

    this.overlay = overlay;
    this.imageEl = imageEl;
    this.titleEl = titleEl;
    this.counterEl = counterEl;
    this.thumbsEl = thumbs;
    this.stageEl = stage;
    this.prevBtn = prevBtn;
    this.nextBtn = nextBtn;
  },

  _bindSwipe(stage) {
    stage.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1) return;
      this._touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }, { passive: true });

    stage.addEventListener('touchend', (event) => {
      if (!this._touchStart) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - this._touchStart.x;
      const dy = touch.clientY - this._touchStart.y;
      this._touchStart = null;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
      this.go(dx < 0 ? 1 : -1);
    }, { passive: true });
  },

  /** images — массив путей или объектов { src, caption }. */
  open({ images = [], index = 0, title = '' } = {}) {
    const list = images
      .map((item) => (typeof item === 'string' ? { src: item, caption: '' } : item))
      .filter((item) => item && item.src);
    if (!list.length) return;

    this.ensure();
    this.images = list;
    this.title = title || '';
    this.index = this.wrap(Number(index) || 0, list.length);
    this.lastFocus = document.activeElement;
    this.isOpen = true;

    this.overlay.classList.toggle('lightbox--single', list.length < 2);
    this.titleEl.textContent = this.title;
    this.titleEl.style.display = this.title ? '' : 'none';

    this._renderThumbs();
    this.show(this.index);

    this.overlay.classList.add('is-open');
    document.body.classList.add('lightbox-open');

    const closeBtn = this.overlay.querySelector('.lightbox__close');
    if (closeBtn) closeBtn.focus();
  },

  _renderThumbs() {
    this.thumbsEl.textContent = '';
    if (this.images.length < 2) return;

    this.images.forEach((item, position) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lightbox__thumb';
      button.setAttribute('aria-label', `Фото ${position + 1}`);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.show(position);
      });

      const thumb = document.createElement('img');
      thumb.src = item.src;
      thumb.loading = 'lazy';
      thumb.alt = '';
      button.appendChild(thumb);

      this.thumbsEl.appendChild(button);
    });
  },

  show(position) {
    const total = this.images.length;
    if (!total) return;

    this.index = this.wrap(position, total);
    const item = this.images[this.index];

    this.imageEl.src = item.src;
    this.imageEl.alt = item.caption || (this.title ? `${this.title} — фото ${this.index + 1}` : `Фото ${this.index + 1}`);
    this.counterEl.textContent = `${this.index + 1} / ${total}`;

    Array.from(this.thumbsEl.children).forEach((thumb, position) => {
      thumb.classList.toggle('is-active', position === this.index);
      thumb.setAttribute('aria-current', String(position === this.index));
    });

    const activeThumb = this.thumbsEl.children[this.index];
    if (activeThumb && activeThumb.scrollIntoView) {
      activeThumb.scrollIntoView({ block: 'nearest', inline: 'center' });
    }

    // соседние фото уже в памяти — листание без мигания
    if (total > 1) {
      [this.index + 1, this.index - 1].forEach((neighbour) => {
        const item2 = this.images[this.wrap(neighbour, total)];
        if (item2 && item2.src) {
          const preload = document.createElement('img');
          preload.src = item2.src;
        }
      });
    }
  },

  go(delta) {
    this.show(this.index + delta);
  },

  close() {
    if (!this.overlay) return;
    this.isOpen = false;
    this.overlay.classList.remove('is-open');
    document.body.classList.remove('lightbox-open');
    this.imageEl.removeAttribute('src');
    if (this.lastFocus && this.lastFocus.focus) {
      this.lastFocus.focus();
    }
    this.lastFocus = null;
  },
};
