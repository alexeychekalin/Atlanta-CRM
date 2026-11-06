/* Быстрое копирование артикулов и кодов.
 *
 * Разметка: <span class="copyable" data-copy="А.3776.001">А.3776.001</span>
 * Клик копирует значение в буфер и показывает уведомление. Обработчик один на
 * документ (capture), поэтому работает и в только что отрисованных списках.
 *
 * navigator.clipboard есть только на https/localhost; на http://IP работает
 * запасной путь через скрытое поле и execCommand('copy').
 */
const Clipboard = {
  DEFAULT_LABEL: 'Артикул',

  init() {
    if (this._inited) return;
    this._inited = true;

    document.addEventListener('click', (event) => {
      const element = event.target && event.target.closest
        ? event.target.closest('[data-copy]')
        : null;
      if (!element) return;
      // не открываем карточку/строку под кликом
      event.preventDefault();
      event.stopPropagation();
      this.copy(
        element.getAttribute('data-copy'),
        element.getAttribute('data-copy-label') || this.DEFAULT_LABEL,
        element
      );
    }, true);
  },

  /** Запись в буфер: современный API, затем запасной путь. */
  async write(text) {
    const value = String(text === null || text === undefined ? '' : text).trim();
    if (!value) return false;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (error) {
      /* нет разрешения или не https — пробуем ниже */
    }
    return this._fallback(value);
  },

  _fallback(value) {
    try {
      const field = document.createElement('textarea');
      field.value = value;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.top = '-1000px';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      if (field.setSelectionRange) field.setSelectionRange(0, value.length);
      const done = document.execCommand && document.execCommand('copy');
      document.body.removeChild(field);
      return Boolean(done);
    } catch (error) {
      return false;
    }
  },

  /** Копирование с уведомлением и подсветкой элемента. */
  async copy(text, label = this.DEFAULT_LABEL, element = null) {
    const ok = await this.write(text);
    if (element && element.classList) {
      element.classList.add(ok ? 'is-copied' : 'is-copy-failed');
      setTimeout(() => {
        element.classList.remove('is-copied', 'is-copy-failed');
      }, 900);
    }

    if (typeof Toast !== 'undefined') {
      if (ok) Toast.success(`${label} ${String(text).trim()} скопирован`);
      else Toast.error('Не удалось скопировать — выделите артикул и нажмите Ctrl+C');
    }
    return ok;
  },
};

Clipboard.init();
