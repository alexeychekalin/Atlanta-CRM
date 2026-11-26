/* Кнопка быстрой очистки в полях поиска.
 *
 * Сама находит поля (у id есть «search» или стоит data-search-clear) и
 * дорисовывает справа «×». Клик очищает поле и посылает input/change —
 * страницы перерисовываются своим же обработчиком, отдельный код не нужен.
 *
 * Работает и после перерисовки страниц: MutationObserver подхватывает новые
 * поля. Esc в непустом поле чистит его и не даёт событию дойти до модалки.
 */
const SearchClear = {
  SELECTOR: 'input[type="text"][id*="search"], input[type="search"], input[data-search-clear]',

  init() {
    if (this._inited) return;
    this._inited = true;

    this.decorateAll();

    // любое действие пользователя в поле обновляет видимость «×»
    document.addEventListener('input', (event) => {
      if (this._isSearchField(event.target)) this.sync(event.target);
    }, true);
    // очистка программная: esc() в других местах тоже обновит вид
    document.addEventListener('change', (event) => {
      if (this._isSearchField(event.target)) this.sync(event.target);
    }, true);

    document.addEventListener('click', (event) => {
      const button = event.target.closest ? event.target.closest('.search-clear') : null;
      if (button) this.clear(button, event);
    }, true);

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this._isSearchField(event.target)) return;
      if (!event.target.value) return;
      // поле не пустое: Esc чистит его, а не закрывает окно
      event.preventDefault();
      event.stopPropagation();
      this.clearField(event.target);
    }, true);

    if (typeof MutationObserver !== 'undefined' && document.body) {
      this._observer = new MutationObserver(() => this.decorateAll());
      this._observer.observe(document.body, { childList: true, subtree: true });
    }
  },

  /** Все поля поиска на странице получают кнопку очистки. */
  decorateAll() {
    const fields = document.querySelectorAll(this.SELECTOR);
    fields.forEach((field) => this.decorate(field));
  },

  _isSearchField(element) {
    return Boolean(element && element.tagName === 'INPUT' && element.dataset.searchClearReady);
  },

  /** Дорисовывает «×»: внутрь готовой обёртки или в свою — если поле голое. */
  decorate(input) {
    if (!input || input.dataset.searchClearReady) return;
    input.dataset.searchClearReady = '1';
    input.classList.add('search-clear-host');

    let host = input.parentElement;
    const hasWrapper = host && (host.classList.contains('search-input')
      || host.classList.contains('global-search-input-wrap')
      || host.classList.contains('search-clear-wrap'));

    if (!hasWrapper) {
      // поле стоит само по себе (в модалке, в строке фильтров) — оборачиваем,
      // сохраняя его inline-стили (flex: 1, width и т. п.)
      const wrap = document.createElement('span');
      wrap.className = 'search-clear-wrap';
      const inline = input.getAttribute('style');
      if (inline) {
        wrap.setAttribute('style', inline);
        input.setAttribute('style', 'width:100%');
      }
      host.insertBefore(wrap, input);
      wrap.appendChild(input);
      host = wrap;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'search-clear';
    button.title = 'Очистить';
    button.setAttribute('aria-label', 'Очистить поле поиска');
    button.tabIndex = -1;
    button.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
    button.hidden = true;

    input.__searchClearButton = button;
    input.__searchClearHost = host;
    host.appendChild(button);
    this.sync(input);
  },

  /** Показываем «×» только когда есть что чистить. */
  sync(input) {
    const button = input.__searchClearButton;
    if (!button) return;
    const filled = String(input.value || '').length > 0;
    button.hidden = !filled;
    const host = input.__searchClearHost || input.parentElement;
    if (host && host.classList) host.classList.toggle('has-search-value', filled);
  },

  clear(button, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const input = button.parentElement && button.parentElement.querySelector('input');
    if (input) this.clearField(input);
  },

  clearField(input) {
    if (!input) return;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    this.sync(input);
    if (typeof input.focus === 'function') input.focus();
  },
};

SearchClear.init();
