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
    Modal.init();
    LoginPage.init();

    // Проверяем авторизацию
    if (API.getToken()) {
      this.showApp();
    } else {
      this.showLogin();
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

  showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-error').style.display = 'none';
  },

  showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';

    // Обновить инфо о пользователе
    const user = API.getUser();
    if (user) {
      document.getElementById('user-name').textContent = user.full_name;
      document.getElementById('user-role').textContent = API.getRoleDisplayName();
      document.getElementById('user-avatar').textContent = (user.full_name || '?').charAt(0).toUpperCase();
    }

    // Загрузить системные настройки НДС
    Table.loadVATSettings();

    this.updateNavPermissions();
    const startPage = this.getFirstAllowedPage();
    this.navigateTo(startPage);
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
    const pages = ['dashboard', 'orders', 'clients', 'drawings', 'components', 'calculator', 'reports', 'settings'];
    for (const p of pages) {
      if (API.can(p, 'view')) return p;
    }
    return 'dashboard';
  },

  navigateTo(page, param) {
    const pageConfig = this.pageMap[page];
    if (!pageConfig) return;

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
};

// Запуск
document.addEventListener('DOMContentLoaded', () => App.init());
