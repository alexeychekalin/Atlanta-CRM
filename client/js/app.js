/* =============================================
   App — Роутер и инициализация
   ============================================= */
const App = {
  currentPage: 'dashboard',

  pageMap: {
    dashboard: { title: 'Дашборд', render: () => DashboardPage.render() },
    orders: { title: 'Заказы', render: () => OrdersPage.render() },
    clients: { title: 'Клиенты', render: () => ClientsPage.render() },
    'client-profile': { title: 'Карточка клиента', render: (id) => ClientProfilePage.render(id), sidebarPage: 'clients' },
    drawings: { title: 'Рассчитанные чертежи', render: () => DrawingsPage.render() },
    products: { title: 'Рассчитанные чертежи', render: () => DrawingsPage.render() },
    components: { title: 'Каталог компонентов', render: () => ComponentsCatalogPage.render() },
    calculator: { title: 'Калькулятор чертежей', render: (param) => CalculatorPage.render(param) },
    reports: { title: 'Отчёты', render: () => ReportsPage.render() },
    proposals: { title: 'Коммерческие предложения', render: () => ProposalsPage.render() },
    equipment: { title: 'Подбор компонентов', render: () => EquipmentPage.render() },
    settings: { title: 'Настройки', render: () => SettingsPage.render() },
  },

  currentTheme: 'dark',

  // SVG иконки для переключения темы
  themeIcons: {
    sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
    moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  },

  initTheme() {
    const savedTheme = localStorage.getItem('atlanta_crm_theme') || 
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    this.setTheme(savedTheme, true);

    // Слушатели на все кнопки переключения темы
    ['theme-toggle-top', 'theme-toggle-sidebar', 'theme-toggle-login'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          this.toggleTheme();
        });
      }
    });

    // Слушатель системной смены темы
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
        if (!localStorage.getItem('atlanta_crm_theme')) {
          this.setTheme(e.matches ? 'light' : 'dark');
        }
      });
    }
  },

  setTheme(theme, skipRedraw = false) {
    this.currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('atlanta_crm_theme', theme);

    // Обновляем мета-тег цвета темы для браузеров/PWA
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', theme === 'light' ? '#f1f5f9' : '#0a0e1a');
    }

    // Иконка: если сейчас темная, показываем солнце (клик включит светлую), и наоборот
    const iconHtml = theme === 'light' ? this.themeIcons.moon : this.themeIcons.sun;
    const titleText = theme === 'light' ? 'Переключить на тёмную тему' : 'Переключить на светлую тему';

    ['theme-toggle-top', 'theme-toggle-sidebar', 'theme-toggle-login'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.innerHTML = iconHtml;
        btn.title = titleText;
      }
    });

    // Перерисовываем графики при смене темы, если открыты соответствующие страницы
    if (!skipRedraw) {
      if (this.currentPage === 'dashboard' && DashboardPage.data) {
        DashboardPage.renderCharts();
      } else if (this.currentPage === 'reports' && ReportsPage.summaryData) {
        ReportsPage.renderCharts();
      }
    }
  },

  toggleTheme() {
    const nextTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    this.setTheme(nextTheme);
    Toast.info(nextTheme === 'light' ? 'Светлая тема включена' : 'Тёмная тема включена');
  },

  init() {
    this.initTheme();
    this.initGlobalSearch();
    Modal.init();
    LoginPage.init();

    // Кнопка «назад»/«вперёд» и ручное изменение hash
    window.addEventListener('hashchange', () => {
      if (location.hash === this._expectedHash) return;
      if (!API.getToken() && !API.isGuest()) return;
      this._routeFromHash();
    });

    // Проверяем авторизацию
    if (API.getToken()) {
      // Обновляем профиль и права с сервера (роль могла измениться)
      API.get('/auth/me')
        .then(user => {
          API.setUser(user);
          this.updateNavPermissions();
        })
        .catch(() => {});
      this.showApp();
    } else if (API.isGuest()) {
      // Гостевой режим уже активирован ранее
      this.showApp();
    } else {
      // Проверяем, доступен ли гостевой режим
      this._checkGuestMode();
    }

    // Навигация
    document.getElementById('sidebar-nav').addEventListener('click', (e) => {
      const navItem = e.target.closest('.nav-item');
      if (navItem) {
        e.preventDefault();
        const page = navItem.dataset.page;
        if (page) this.navigateTo(page);
      }
    });

    // Выход
    document.getElementById('btn-logout').addEventListener('click', () => {
      API.logout();
      localStorage.removeItem('atlanta_user');
      this.showLogin();
    });

    // Toggle sidebar (mobile)
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });

    // Close sidebar on content click (mobile)
    document.querySelector('.main-content').addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
    });

    // Mobile bottom nav
    document.getElementById('mobile-nav').addEventListener('click', (e) => {
      const item = e.target.closest('.mobile-nav-item');
      if (item && item.dataset.page !== 'more') {
        e.preventDefault();
        this.navigateTo(item.dataset.page);
      }
    });
  },

  async _checkGuestMode() {
    const guest = await API.loadGuestPermissions();
    if (guest.enabled) {
      this._guestPermissions = guest.permissions;
    }
    this.showLogin();
  },

  showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-error').style.display = 'none';

    // Пояснение, если пользователя разлогинило из-за истёкшей сессии
    let expired = null;
    try { expired = sessionStorage.getItem('atlanta_session_expired'); } catch (e) { /* private mode */ }
    if (expired) {
      const errorEl = document.getElementById('login-error');
      if (errorEl) {
        errorEl.textContent = 'Сессия истекла — войдите снова. Открытая страница сохранится.';
        errorEl.style.display = 'block';
      }
      try { sessionStorage.removeItem('atlanta_session_expired'); } catch (e) { /* private mode */ }
    }

    // Кнопка «Продолжить как гость»
    let guestBtn = document.getElementById('guest-mode-btn');
    if (this._guestPermissions) {
      if (!guestBtn) {
        guestBtn = document.createElement('button');
        guestBtn.id = 'guest-mode-btn';
        guestBtn.className = 'btn btn-secondary';
        guestBtn.style.cssText = 'width:100%;margin-top:12px;padding:10px;font-size:0.9rem';
        guestBtn.textContent = '👁 Продолжить без авторизации';
        guestBtn.addEventListener('click', () => {
          API.enterGuestMode(this._guestPermissions);
          this.showApp();
        });
        const loginForm = document.getElementById('login-form') || document.querySelector('.login-card');
        if (loginForm) loginForm.appendChild(guestBtn);
      }
      guestBtn.style.display = '';
    } else if (guestBtn) {
      guestBtn.style.display = 'none';
    }
  },

  showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';

    const isGuest = API.isGuest();

    // Обновить инфо о пользователе
    const user = API.getUser();
    if (user) {
      document.getElementById('user-name').textContent = isGuest ? 'Гость' : user.full_name;
      document.getElementById('user-role').textContent = API.getRoleDisplayName();
      document.getElementById('user-avatar').textContent = isGuest ? '👁' : (user.full_name || '?').charAt(0).toUpperCase();
    }

    // Кнопка выхода / входа
    const logoutBtn = document.getElementById('btn-logout');
    if (isGuest) {
      logoutBtn.textContent = '🔑 Войти';
      logoutBtn.title = 'Войти в систему';
    } else {
      logoutBtn.textContent = '🚪 Выход';
      logoutBtn.title = 'Выйти из системы';
    }

    // Загрузить системные настройки НДС
    Table.loadVATSettings();

    this.updateNavPermissions();

    // Восстанавливаем страницу из URL (F5, ссылка, кнопка «назад»)
    if (location.hash && location.hash.length > 1) {
      this._routeFromHash();
    } else {
      const startPage = this.getFirstAllowedPage();
      this.navigateTo(startPage, null, { skipHash: true });
      history.replaceState(null, '', '#' + startPage);
    }
  },

  updateNavPermissions() {
    const sectionMap = {
      dashboard: 'dashboard',
      orders: 'orders',
      clients: 'clients',
      drawings: 'drawings',
      products: 'drawings',
      components: 'components',
      calculator: 'calculator',
      reports: 'reports',
      proposals: 'proposals',
      equipment: 'equipment',
      settings: 'settings',
    };

    document.querySelectorAll('.nav-item').forEach(item => {
      const page = item.dataset.page;
      const section = sectionMap[page] || page;
      const allowed = API.can(section, 'view');
      item.style.display = allowed ? '' : 'none';
    });

    document.querySelectorAll('.mobile-nav-item').forEach(item => {
      const page = item.dataset.page;
      if (page && page !== 'more') {
        const section = sectionMap[page] || page;
        const allowed = API.can(section, 'view');
        item.style.display = allowed ? '' : 'none';
      }
    });
  },

  getFirstAllowedPage() {
    const pages = ['dashboard', 'orders', 'proposals', 'clients', 'drawings', 'calculator', 'components', 'equipment', 'reports', 'settings'];
    for (const p of pages) {
      if (API.can(p, 'view')) return p;
    }
    return 'dashboard';
  },

  _skipHashUpdate: false,

  // Разбор строки маршрута: 'client-profile/5', 'calculator?drawing=3'
  _parseRoute(route) {
    let rest = String(route || '').replace(/^#/, '');
    let param = null;
    if (rest.includes('?')) {
      const [base, qs] = rest.split('?');
      rest = base;
      param = {};
      new URLSearchParams(qs).forEach((v, k) => { param[k] = v; });
    }
    const slash = rest.indexOf('/');
    if (slash !== -1) {
      const id = decodeURIComponent(rest.slice(slash + 1));
      rest = rest.slice(0, slash);
      if (param) param.id = id; else param = id;
    }
    return { page: rest, param };
  },

  _buildHash(page, param) {
    if (param === null || param === undefined || param === '') return page;
    if (typeof param === 'object') {
      const qs = new URLSearchParams();
      Object.entries(param).forEach(([k, v]) => {
        if (v !== null && v !== undefined && v !== '') qs.set(k, v);
      });
      const str = qs.toString();
      return str ? `${page}?${str}` : page;
    }
    return `${page}/${encodeURIComponent(param)}`;
  },

  _routeFromHash() {
    if (!location.hash || location.hash === '#') {
      this.navigateTo(this.getFirstAllowedPage(), null, { skipHash: true });
      return;
    }
    const { page, param } = this._parseRoute(location.hash);
    this.navigateTo(page, param, { skipHash: true });
  },

  navigateTo(page, param, opts = {}) {
    // Разбираем query-параметры из строки вида 'calculator?drawing=5&client=3'
    if (typeof page === 'string' && (page.includes('?') || page.includes('/'))) {
      const parsed = this._parseRoute(page);
      page = parsed.page;
      if (!param) param = parsed.param;
    }

    const pageConfig = this.pageMap[page];
    if (!pageConfig) return;

    // Синхронизируем адресную строку: F5 и «назад» сохраняют страницу
    if (!opts.skipHash) {
      const hash = '#' + this._buildHash(page, param);
      if (location.hash !== hash) {
        this._expectedHash = hash;
        location.hash = hash.slice(1);
      }
    }

    const sectionMap = {
      dashboard: 'dashboard',
      orders: 'orders',
      clients: 'clients',
      'client-profile': 'clients',
      drawings: 'drawings',
      products: 'drawings',
      components: 'components',
      equipment: 'equipment',
      calculator: 'calculator',
      reports: 'reports',
      proposals: 'proposals',
      settings: 'settings',
    };

    const section = sectionMap[page] || page;

    // Обновить заголовок
    document.getElementById('page-title').textContent = pageConfig.title;

    // Обновить активный пункт меню (sidebarPage для sub-pages)
    const sidebarPage = pageConfig.sidebarPage || page;
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === sidebarPage);
    });

    // Обновить мобильную навигацию
    document.querySelectorAll('.mobile-nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === sidebarPage);
    });

    // Проверка прав доступа к разделу
    if (!API.can(section, 'view')) {
      const contentArea = document.getElementById('content-area');
      contentArea.innerHTML = `
        <div class="empty-state" style="padding:60px 20px">
          <div class="empty-state-icon" style="font-size:3rem">🔒</div>
          <div class="empty-state-text" style="font-size:1.2rem;font-weight:700;margin-top:10px">Доступ ограничен</div>
          <div style="color:var(--text-muted);font-size:0.9rem;margin-top:6px">У вашей роли («${API.getRoleDisplayName()}») нет прав на просмотр раздела «${pageConfig.title}»</div>
          <button class="btn btn-primary btn-sm" style="margin-top:16px" onclick="App.navigateTo('${this.getFirstAllowedPage()}')">Перейти на доступную страницу</button>
        </div>
      `;
      return;
    }

    this.currentPage = page;

    // Анимация контента
    const contentArea = document.getElementById('content-area');
    contentArea.style.animation = 'none';
    contentArea.offsetHeight; // reflow
    contentArea.style.animation = 'fadeIn 0.3s ease';

    // Рендер страницы
    pageConfig.render(param);
  },

  // === Глобальный поиск ===
  _searchTimer: null,
  _searchActiveIdx: -1,

  initGlobalSearch() {
    const input = document.getElementById('global-search-input');
    const results = document.getElementById('global-search-results');
    if (!input || !results) return;

    // Ctrl+K / Cmd+K — фокус на поиск
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        input.focus();
        input.select();
      }
    });

    // Ввод с debounce
    input.addEventListener('input', () => {
      clearTimeout(this._searchTimer);
      const q = input.value.trim();
      if (q.length < 2) { results.style.display = 'none'; return; }
      this._searchTimer = setTimeout(() => this._doSearch(q), 300);
    });

    // Клавиатурная навигация
    input.addEventListener('keydown', (e) => {
      const items = results.querySelectorAll('.search-result-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._searchActiveIdx = Math.min(this._searchActiveIdx + 1, items.length - 1);
        this._highlightSearchItem(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._searchActiveIdx = Math.max(this._searchActiveIdx - 1, 0);
        this._highlightSearchItem(items);
      } else if (e.key === 'Enter' && this._searchActiveIdx >= 0 && items[this._searchActiveIdx]) {
        e.preventDefault();
        items[this._searchActiveIdx].click();
      } else if (e.key === 'Escape') {
        results.style.display = 'none';
        input.blur();
      }
    });

    // Закрыть при клике вне
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.global-search-wrap')) {
        results.style.display = 'none';
      }
    });
  },

  _highlightSearchItem(items) {
    items.forEach((el, i) => {
      el.classList.toggle('active', i === this._searchActiveIdx);
      if (i === this._searchActiveIdx) el.scrollIntoView({ block: 'nearest' });
    });
  },

  async _doSearch(q) {
    const results = document.getElementById('global-search-results');
    try {
      const res = await API.get(`/search?q=${encodeURIComponent(q)}`);
      const data = res.data || [];
      this._searchActiveIdx = -1;

      if (data.length === 0) {
        results.innerHTML = '<div class="search-no-results">Ничего не найдено</div>';
        results.style.display = '';
        return;
      }

      // Группировка по типу
      const typeLabels = {
        client: 'Клиенты', order: 'Заказы', component: 'Компоненты',
        drawing: 'Чертежи', proposal: 'КП', manufacturer: 'Производители',
      };
      const groups = {};
      data.forEach(item => {
        if (!groups[item.type]) groups[item.type] = [];
        groups[item.type].push(item);
      });

      let html = '';
      for (const [type, items] of Object.entries(groups)) {
        html += `<div class="search-result-group">`;
        html += `<div class="search-result-group-label">${typeLabels[type] || type}</div>`;
        items.forEach((item, idx) => {
          html += `<div class="search-result-item" data-url="${esc(item.url)}">
            <div class="search-result-icon">${esc(item.icon)}</div>
            <div class="search-result-info">
              <div class="search-result-title">${this._highlightMatch(item.title, q)}</div>
              <div class="search-result-subtitle">${esc(item.subtitle)}</div>
            </div>
          </div>`;
        });
        html += `</div>`;
      }

      results.innerHTML = html;
      results.querySelectorAll('.search-result-item').forEach(el => {
        el.addEventListener('click', () => this._onSearchSelect(el.dataset.url));
      });
      results.style.display = '';
    } catch (err) {
      results.innerHTML = '<div class="search-no-results">Ошибка поиска</div>';
      results.style.display = '';
    }
  },

  _highlightMatch(text, q) {
    if (!text) return '';
    const safeText = esc(text);
    if (!q) return safeText;
    const escaped = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safeText.replace(new RegExp(`(${escaped})`, 'gi'), '<mark style="background:var(--accent-teal);color:#fff;border-radius:2px;padding:0 2px">$1</mark>');
  },

  _onSearchSelect(url) {
    document.getElementById('global-search-results').style.display = 'none';
    document.getElementById('global-search-input').value = '';
    this.navigateTo(url);
  },
};

// Запуск
document.addEventListener('DOMContentLoaded', () => App.init());
