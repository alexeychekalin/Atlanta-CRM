/* Settings Page — Настройки, Роли, Пользователи, Принципалы, Статусы и НДС */
const SettingsPage = {
  roles: [],
  users: [],

  async render() {
    const content = document.getElementById('content-area');
    const isAdmin = API.isAdmin();

    if (!isAdmin && !API.can('settings', 'view')) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔒</div><div class="empty-state-text">Доступ ограничен для вашей роли</div></div>`;
      return;
    }

    // Загрузить актуальные настройки НДС с сервера
    await Table.loadVATSettings();
    const vatSettings = Table.getVATSettings();

    content.innerHTML = `
      <div class="settings-grid">

        <!-- Роли и права -->
        <div class="card">
          <div class="settings-card-header" onclick="SettingsPage.toggleCard(this)">
            <div style="display:flex;align-items:center;gap:10px">
              <div class="card-title" style="margin:0">🛡️ Роли и матрица прав доступа</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();SettingsPage.openRoleModal()">+ Создать роль</button>
              <span class="settings-card-toggle">▼</span>
            </div>
          </div>
          <div class="settings-card-body">
            <div id="roles-list" style="padding:0 20px 16px">${Table.loading()}</div>
          </div>
        </div>

        <!-- Пользователи -->
        <div class="card">
          <div class="settings-card-header" onclick="SettingsPage.toggleCard(this)">
            <div style="display:flex;align-items:center;gap:10px">
              <div class="card-title" style="margin:0">👥 Пользователи системы</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();SettingsPage.openUserModal()">+ Добавить пользователя</button>
              <span class="settings-card-toggle">▼</span>
            </div>
          </div>
          <div class="settings-card-body">
            <div id="users-list" style="padding:0 20px 16px">${Table.loading()}</div>
          </div>
        </div>

        <!-- Принципалы -->
        <div class="card">
          <div class="settings-card-header" onclick="SettingsPage.toggleCard(this)">
            <div style="display:flex;align-items:center;gap:10px">
              <div class="card-title" style="margin:0">🏢 Принципалы (поставщики)</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();SettingsPage.openPrincipalModal()">+ Добавить</button>
              <span class="settings-card-toggle">▼</span>
            </div>
          </div>
          <div class="settings-card-body">
            <div id="principals-list" style="padding:0 20px 16px">${Table.loading()}</div>
          </div>
        </div>

        <!-- Статусы клиентов -->
        <div class="card">
          <div class="settings-card-header" onclick="SettingsPage.toggleCard(this)">
            <div style="display:flex;align-items:center;gap:10px">
              <div class="card-title" style="margin:0">🏷️ Статусы работы с клиентами</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();SettingsPage.openStatusModal()">+ Добавить</button>
              <span class="settings-card-toggle">▼</span>
            </div>
          </div>
          <div class="settings-card-body">
            <div id="statuses-list" style="padding:0 20px 16px">${Table.loading()}</div>
          </div>
        </div>

        <!-- Уровни клиентов (ценообразование) -->
        <div class="card">
          <div class="settings-card-header" onclick="SettingsPage.toggleCard(this)">
            <div style="display:flex;align-items:center;gap:10px">
              <div class="card-title" style="margin:0">💰 Уровни клиентов (ценообразование)</div>
            </div>
            <span class="settings-card-toggle">▼</span>
          </div>
          <div class="settings-card-body">
            <div id="pricing-levels-list" style="padding:0 20px 16px">
              <div class="loading">Загрузка...</div>
            </div>
          </div>
        </div>

        <!-- НДС -->
        <div class="card">
          <div class="settings-card-header" onclick="SettingsPage.toggleCard(this)">
            <div style="display:flex;align-items:center;gap:10px">
              <div class="card-title" style="margin:0">🧾 Отображение цен и НДС</div>
            </div>
            <span class="settings-card-toggle">▼</span>
          </div>
          <div class="settings-card-body">
            <div style="padding:4px 20px 16px">
              <div class="form-group mb-2">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600">
                  <input type="checkbox" id="vat-enabled" ${vatSettings.enabled ? 'checked' : ''} onchange="SettingsPage.updateVatPreview()">
                  <span>Показывать цену с НДС в скобках</span>
                </label>
                <div class="form-hint" style="margin-top:4px">Отображать дополнительно сумму с НДС мелким шрифтом рядом с базовой ценой по всей системе</div>
              </div>
              <div class="form-group mb-2">
                <label for="vat-rate" style="font-weight:600">Ставка НДС (%)</label>
                <div style="display:flex;align-items:center;gap:10px">
                  <input type="number" class="form-control" id="vat-rate" value="${vatSettings.rate}" min="0" max="100" step="0.5" style="max-width:140px" oninput="SettingsPage.updateVatPreview()">
                  <span style="color:var(--text-muted);font-weight:600">%</span>
                </div>
              </div>
              <div style="padding:10px 14px;border-radius:8px;background:var(--bg-tertiary);border:1px solid var(--border);margin-bottom:14px">
                <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:4px">Предварительный просмотр цены:</div>
                <div id="vat-preview" style="font-size:1.05rem;font-weight:600"></div>
              </div>
              <button class="btn btn-primary btn-sm" onclick="SettingsPage.saveVatSettings()">💾 Сохранить настройки НДС</button>
            </div>
          </div>
        </div>

        <!-- Типы техники -->
        <div class="card">
          <div class="settings-card-header" onclick="SettingsPage.toggleCard(this)">
            <div style="display:flex;align-items:center;gap:10px">
              <div class="card-title" style="margin:0">🚛 Типы техники</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();SettingsPage.showEquipTypeForm()">+ Добавить</button>
              <span class="settings-card-toggle">▼</span>
            </div>
          </div>
          <div class="settings-card-body">
            <div id="equip-types-list" style="padding:0 20px 16px">
              <div class="loading">Загрузка...</div>
            </div>
          </div>
        </div>

        <!-- Тема оформления -->
        <div class="card">
          <div class="settings-card-header" onclick="SettingsPage.toggleCard(this)">
            <div style="display:flex;align-items:center;gap:10px">
              <div class="card-title" style="margin:0">🎨 Тема оформления</div>
            </div>
            <span class="settings-card-toggle">▼</span>
          </div>
          <div class="settings-card-body">
            <div style="padding:4px 20px 16px">
              <p style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:12px;">Выберите цветовую схему интерфейса:</p>
              <div style="display:flex;gap:10px;">
                <button class="btn ${App.currentTheme === 'dark' ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="App.setTheme('dark');SettingsPage.render();" style="flex:1">
                  🌙 Тёмная тема
                </button>
                <button class="btn ${App.currentTheme === 'light' ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="App.setTheme('light');SettingsPage.render();" style="flex:1">
                  ☀️ Светлая тема
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    `;

    this.updateVatPreview();
    this.loadRoles();
    this.loadUsers();
    this.loadPrincipals();
    this.loadStatuses();
    this.loadEquipmentTypes();
    this.loadPricingLevels();
  },

  toggleCard(headerEl) {
    const body = headerEl.nextElementSibling;
    const toggle = headerEl.querySelector('.settings-card-toggle');
    if (body.classList.contains('open')) {
      body.classList.remove('open');
      if (toggle) toggle.classList.remove('open');
    } else {
      body.classList.add('open');
      if (toggle) toggle.classList.add('open');
    }
  },

  updateVatPreview() {
    const previewEl = document.getElementById('vat-preview');
    if (!previewEl) return;
    const enabled = document.getElementById('vat-enabled')?.checked;
    const rate = parseFloat(document.getElementById('vat-rate')?.value) || 0;
    const base = 10000;
    const raw = Table.formatMoneyRaw(base);
    if (!enabled) {
      previewEl.innerHTML = raw;
    } else {
      const withVat = base * (1 + rate / 100);
      const vatFormatted = Table.formatMoneyRaw(withVat);
      previewEl.innerHTML = `${raw} <span class="vat-info">(${vatFormatted} с НДС)</span>`;
    }
  },

  async saveVatSettings() {
    const enabled = document.getElementById('vat-enabled')?.checked;
    const rate = parseFloat(document.getElementById('vat-rate')?.value) || 0;
    try {
      await Table.saveVATSettings({ enabled, rate });
      Toast.success(`Настройки НДС сохранены для всей системы: ${rate}% (${enabled ? 'включено' : 'отключено'})`);
      this.updateVatPreview();
    } catch (e) {
      Toast.error('Ошибка сохранения настроек НДС: ' + (e.message || 'неизвестная ошибка'));
    }
  },

  // =================== РОЛИ И ПРАВА ДОСТУПА ===================
  async loadRoles() {
    const container = document.getElementById('roles-list');
    if (!container) return;

    try {
      const res = await API.get('/roles');
      this.roles = res.data || [];

      if (this.roles.length === 0) {
        container.innerHTML = Table.emptyState('Роли не настроены');
        return;
      }

      container.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px;padding:8px">
          ${this.roles.map(r => {
            const perms = r.permissions || {};
            const activeSections = [];
            if (perms.dashboard?.view) activeSections.push('Дашборд');
            if (perms.orders?.view) activeSections.push('Заказы');
            if (perms.clients?.view) activeSections.push('Клиенты');
            if (perms.drawings?.view) activeSections.push('Чертежи');
            if (perms.components?.view) activeSections.push('Компоненты');
            if (perms.calculator?.view) activeSections.push('Калькулятор');
            if (perms.reports?.view) activeSections.push('Отчёты');
            if (perms.settings?.view) activeSections.push('Настройки');

            const isSys = r.is_system;
            const userCount = r.users_count || 0;

            return `
              <div style="border:1px solid var(--border);border-radius:10px;padding:12px 14px;background:var(--bg-card);transition:all var(--transition-fast);cursor:pointer" onclick="SettingsPage.openRoleModal(${r.id})" onmouseover="this.style.borderColor='var(--accent-teal)'" onmouseout="this.style.borderColor='var(--border)'" title="Настроить права роли">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                  <div>
                    <div style="display:flex;align-items:center;gap:8px">
                      <strong style="font-size:0.95rem;color:var(--text-primary)">${r.display_name}</strong>
                      <span class="badge" style="background:${isSys ? 'rgba(239,68,68,0.15);color:#ef4444' : 'rgba(20,184,166,0.15);color:var(--accent-teal)'}">
                        ${r.name}
                      </span>
                      ${isSys ? '<span class="badge" style="background:var(--bg-tertiary);color:var(--text-muted);font-size:0.7rem">системная</span>' : ''}
                    </div>
                    ${r.description ? `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:4px">${r.description}</div>` : ''}
                  </div>
                  <div style="display:flex;align-items:center;gap:6px" onclick="event.stopPropagation()">
                    <span class="badge" style="background:var(--bg-tertiary);color:var(--text-secondary);font-size:0.75rem" title="Количество пользователей с этой ролью">
                      👥 ${userCount}
                    </span>
                    <button class="btn btn-icon btn-sm" onclick="SettingsPage.openRoleModal(${r.id})" title="Настроить права">✏️</button>
                    ${!isSys && userCount === 0 ? `
                      <button class="btn btn-icon btn-sm btn-danger" onclick="SettingsPage.deleteRole(${r.id})" title="Удалить роль">✕</button>
                    ` : ''}
                  </div>
                </div>

                <!-- Теги разрешённых разделов -->
                <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:8px">
                  ${activeSections.length > 0 ? activeSections.map(s => `
                    <span style="font-size:0.72rem;padding:2px 8px;border-radius:12px;background:var(--bg-tertiary);color:var(--text-secondary);border:1px solid var(--border)">
                      ✓ ${s}
                    </span>
                  `).join('') : '<span style="font-size:0.72rem;color:var(--text-muted)">Нет доступных разделов</span>'}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-text">${err.message}</div></div>`;
    }
  },

  async openRoleModal(id = null) {
    let role = null;
    if (id) {
      try {
        role = await API.get(`/roles/${id}`);
      } catch (err) {
        Toast.error(err.message);
        return;
      }
    }

    const isEdit = !!role;
    const perms = isEdit ? (role.permissions || {}) : {
      dashboard: { view: true },
      orders: { view: true, edit: true, delete: false },
      clients: { view: true, edit: true, delete: false },
      calculator: { view: true, edit: true },
      drawings: { view: true, edit: true, delete: false },
      components: { view: true, edit: false, delete: false },
      equipment: { view: true, edit: false, delete: false },
      reports: { view: true, export: true },
      settings: { view: false, edit: false },
    };

    Modal.open({
      title: isEdit ? `Настройка роли: ${role.display_name}` : 'Создать новую роль',
      wide: true,
      body: `
        <form id="role-form">
          <div class="form-row">
            <div class="form-group">
              <label>Название роли *</label>
              <input type="text" class="form-control" id="role-display-name" value="${isEdit ? role.display_name : ''}" placeholder="например, Менеджер по логистике" required>
            </div>
            <div class="form-group">
              <label>Системный код (латиница) *</label>
              <input type="text" class="form-control font-mono" id="role-name" value="${isEdit ? role.name : ''}" ${isEdit ? 'disabled' : ''} placeholder="например, logistic_manager" required>
            </div>
          </div>
          <div class="form-group">
            <label>Описание назначения роли</label>
            <input type="text" class="form-control" id="role-description" value="${isEdit ? (role.description || '') : ''}" placeholder="Краткое описание обязанностей и прав">
          </div>

          <!-- Быстрые пресеты -->
          <div style="margin:16px 0 10px">
            <div style="font-size:0.8rem;font-weight:700;color:var(--text-secondary);text-transform:uppercase;margin-bottom:8px">Быстрые шаблоны прав (Пресеты):</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button type="button" class="btn btn-secondary btn-sm" onclick="SettingsPage.applyRolePreset('all')">👑 Полный доступ</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="SettingsPage.applyRolePreset('manager')">💼 Менеджер продаж</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="SettingsPage.applyRolePreset('technologist')">📐 Технолог/Конструктор</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="SettingsPage.applyRolePreset('viewer')">👁️ Только чтение</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="SettingsPage.applyRolePreset('none')">🔄 Очистить всё</button>
            </div>
          </div>

          <!-- Матрица прав -->
          <div style="margin-top:12px;border:1px solid var(--border);border-radius:8px;overflow:hidden">
            <table class="data-table" style="font-size:0.85rem">
              <thead>
                <tr>
                  <th>Раздел системы</th>
                  <th class="text-center" style="width:120px">Просмотр (View)</th>
                  <th class="text-center" style="width:160px">Создание / Изменение (Edit)</th>
                  <th class="text-center" style="width:120px">Удаление (Delete)</th>
                </tr>
              </thead>
              <tbody>
                <!-- Дашборд -->
                <tr>
                  <td><div style="font-weight:600">📊 Дашборд и аналитика</div></td>
                  <td class="text-center"><input type="checkbox" id="perm-dashboard-view" ${perms.dashboard?.view !== false ? 'checked' : ''}></td>
                  <td class="text-center"><span class="text-muted">—</span></td>
                  <td class="text-center"><span class="text-muted">—</span></td>
                </tr>
                <!-- Заказы -->
                <tr>
                  <td><div style="font-weight:600">📦 Заказы</div></td>
                  <td class="text-center"><input type="checkbox" id="perm-orders-view" ${perms.orders?.view !== false ? 'checked' : ''}></td>
                  <td class="text-center"><input type="checkbox" id="perm-orders-edit" ${perms.orders?.edit ? 'checked' : ''}></td>
                  <td class="text-center"><input type="checkbox" id="perm-orders-delete" ${perms.orders?.delete ? 'checked' : ''}></td>
                </tr>
                <!-- Клиенты -->
                <tr>
                  <td><div style="font-weight:600">👥 Клиенты</div></td>
                  <td class="text-center"><input type="checkbox" id="perm-clients-view" ${perms.clients?.view !== false ? 'checked' : ''}></td>
                  <td class="text-center"><input type="checkbox" id="perm-clients-edit" ${perms.clients?.edit ? 'checked' : ''}></td>
                  <td class="text-center"><input type="checkbox" id="perm-clients-delete" ${perms.clients?.delete ? 'checked' : ''}></td>
                </tr>
                <!-- Калькулятор -->
                <tr>
                  <td><div style="font-weight:600">🧮 Калькулятор чертежей</div></td>
                  <td class="text-center"><input type="checkbox" id="perm-calculator-view" ${perms.calculator?.view !== false ? 'checked' : ''}></td>
                  <td class="text-center"><input type="checkbox" id="perm-calculator-edit" ${perms.calculator?.edit ? 'checked' : ''}></td>
                  <td class="text-center"><span class="text-muted">—</span></td>
                </tr>
                <!-- Рассчитанные чертежи -->
                <tr>
                  <td><div style="font-weight:600">📐 Каталог чертежей</div></td>
                  <td class="text-center"><input type="checkbox" id="perm-drawings-view" ${perms.drawings?.view !== false ? 'checked' : ''}></td>
                  <td class="text-center"><input type="checkbox" id="perm-drawings-edit" ${perms.drawings?.edit ? 'checked' : ''}></td>
                  <td class="text-center"><input type="checkbox" id="perm-drawings-delete" ${perms.drawings?.delete ? 'checked' : ''}></td>
                </tr>
                <!-- Каталог компонентов -->
                <tr>
                  <td><div style="font-weight:600">🔩 Каталог компонентов</div></td>
                  <td class="text-center"><input type="checkbox" id="perm-components-view" ${perms.components?.view !== false ? 'checked' : ''}></td>
                  <td class="text-center"><input type="checkbox" id="perm-components-edit" ${perms.components?.edit ? 'checked' : ''}></td>
                  <td class="text-center"><input type="checkbox" id="perm-components-delete" ${perms.components?.delete ? 'checked' : ''}></td>
                </tr>
                <!-- Подбор компонентов -->
                <tr>
                  <td><div style="font-weight:600">🚛 Подбор компонентов</div></td>
                  <td class="text-center"><input type="checkbox" id="perm-equipment-view" ${perms.equipment?.view !== false ? 'checked' : ''}></td>
                  <td class="text-center"><input type="checkbox" id="perm-equipment-edit" ${perms.equipment?.edit ? 'checked' : ''}></td>
                  <td class="text-center"><input type="checkbox" id="perm-equipment-delete" ${perms.equipment?.delete ? 'checked' : ''}></td>
                </tr>
                <!-- Отчёты -->
                <tr>
                  <td><div style="font-weight:600">📈 Отчёты и статистика</div></td>
                  <td class="text-center"><input type="checkbox" id="perm-reports-view" ${perms.reports?.view !== false ? 'checked' : ''}></td>
                  <td class="text-center"><label style="font-size:0.78rem;cursor:pointer"><input type="checkbox" id="perm-reports-export" ${perms.reports?.export ? 'checked' : ''}> Экспорт</label></td>
                  <td class="text-center"><span class="text-muted">—</span></td>
                </tr>
                <!-- Настройки -->
                <tr>
                  <td><div style="font-weight:600">⚙️ Настройки системы</div></td>
                  <td class="text-center"><input type="checkbox" id="perm-settings-view" ${perms.settings?.view ? 'checked' : ''}></td>
                  <td class="text-center"><input type="checkbox" id="perm-settings-edit" ${perms.settings?.edit ? 'checked' : ''}></td>
                  <td class="text-center"><span class="text-muted">—</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </form>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Отмена</button>
        <button class="btn btn-primary" onclick="SettingsPage.saveRole(${isEdit ? role.id : 'null'})">
          ${isEdit ? 'Сохранить роль' : 'Создать роль'}
        </button>
      `,
    });
  },

  applyRolePreset(preset) {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.checked = val;
    };

    if (preset === 'all') {
      ['dashboard-view', 'orders-view', 'orders-edit', 'orders-delete',
       'clients-view', 'clients-edit', 'clients-delete',
       'calculator-view', 'calculator-edit',
       'drawings-view', 'drawings-edit', 'drawings-delete',
       'components-view', 'components-edit', 'components-delete',
       'equipment-view', 'equipment-edit', 'equipment-delete',
       'reports-view', 'reports-export',
       'settings-view', 'settings-edit'].forEach(k => set(`perm-${k}`, true));
    } else if (preset === 'manager') {
      ['dashboard-view', 'orders-view', 'orders-edit',
       'clients-view', 'clients-edit',
       'calculator-view', 'calculator-edit',
       'drawings-view', 'drawings-edit',
       'components-view', 'equipment-view',
       'reports-view', 'reports-export'].forEach(k => set(`perm-${k}`, true));
      ['orders-delete', 'clients-delete', 'drawings-delete', 'components-edit', 'components-delete', 'equipment-edit', 'equipment-delete', 'settings-view', 'settings-edit'].forEach(k => set(`perm-${k}`, false));
    } else if (preset === 'technologist') {
      ['dashboard-view', 'clients-view',
       'calculator-view', 'calculator-edit',
       'drawings-view', 'drawings-edit', 'drawings-delete',
       'components-view', 'components-edit', 'components-delete',
       'equipment-view', 'equipment-edit', 'equipment-delete'].forEach(k => set(`perm-${k}`, true));
      ['orders-view', 'orders-edit', 'orders-delete', 'clients-edit', 'clients-delete', 'reports-view', 'reports-export', 'settings-view', 'settings-edit'].forEach(k => set(`perm-${k}`, false));
    } else if (preset === 'viewer') {
      ['dashboard-view', 'orders-view', 'clients-view', 'calculator-view', 'drawings-view', 'components-view', 'equipment-view', 'reports-view', 'reports-export'].forEach(k => set(`perm-${k}`, true));
      ['orders-edit', 'orders-delete', 'clients-edit', 'clients-delete', 'calculator-edit', 'drawings-edit', 'drawings-delete', 'components-edit', 'components-delete', 'equipment-edit', 'equipment-delete', 'settings-view', 'settings-edit'].forEach(k => set(`perm-${k}`, false));
    } else if (preset === 'none') {
      ['dashboard-view', 'orders-view', 'orders-edit', 'orders-delete',
       'clients-view', 'clients-edit', 'clients-delete',
       'calculator-view', 'calculator-edit',
       'drawings-view', 'drawings-edit', 'drawings-delete',
       'components-view', 'components-edit', 'components-delete',
       'equipment-view', 'equipment-edit', 'equipment-delete',
       'reports-view', 'reports-export',
       'settings-view', 'settings-edit'].forEach(k => set(`perm-${k}`, false));
    }
  },

  async saveRole(id) {
    const isChecked = (permId) => !!document.getElementById(`perm-${permId}`)?.checked;

    const permissions = {
      dashboard: { view: isChecked('dashboard-view') },
      orders: { 
        view: isChecked('orders-view'), 
        edit: isChecked('orders-edit'), 
        delete: isChecked('orders-delete') 
      },
      clients: { 
        view: isChecked('clients-view'), 
        edit: isChecked('clients-edit'), 
        delete: isChecked('clients-delete') 
      },
      calculator: { 
        view: isChecked('calculator-view'), 
        edit: isChecked('calculator-edit') 
      },
      drawings: { 
        view: isChecked('drawings-view'), 
        edit: isChecked('drawings-edit'), 
        delete: isChecked('drawings-delete') 
      },
      components: { 
        view: isChecked('components-view'), 
        edit: isChecked('components-edit'), 
        delete: isChecked('components-delete') 
      },
      equipment: { 
        view: isChecked('equipment-view'), 
        edit: isChecked('equipment-edit'), 
        delete: isChecked('equipment-delete') 
      },
      reports: { 
        view: isChecked('reports-view'), 
        export: isChecked('reports-export') 
      },
      settings: { 
        view: isChecked('settings-view'), 
        edit: isChecked('settings-edit') 
      },
    };

    const data = {
      display_name: document.getElementById('role-display-name').value.trim(),
      name: document.getElementById('role-name').value.trim(),
      description: document.getElementById('role-description').value.trim(),
      permissions,
    };

    if (!data.display_name) {
      Toast.error('Укажите название роли');
      return;
    }

    try {
      if (id) {
        await API.put(`/roles/${id}`, data);
        Toast.success('Роль и права обновлены');
      } else {
        await API.post('/roles', data);
        Toast.success('Роль успешно создана');
      }
      Modal.close();
      this.loadRoles();
      this.loadUsers();

      // Обновить права текущего пользователя если он сейчас авторизован под этой ролью
      const meRes = await API.get('/auth/me');
      if (meRes) {
        API.setUser(meRes);
        App.updateNavPermissions();
      }
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async deleteRole(id) {
    if (!confirm('Вы уверены, что хотите удалить эту роль?')) return;
    try {
      await API.del(`/roles/${id}`);
      Toast.success('Роль удалена');
      this.loadRoles();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  // =================== УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ ===================
  async loadUsers() {
    const container = document.getElementById('users-list');
    if (!container) return;

    try {
      const res = await API.get('/users');
      this.users = res.data || [];

      if (this.users.length === 0) {
        container.innerHTML = Table.emptyState('Пользователи не найдены');
        return;
      }

      const currentUser = API.getUser();

      container.innerHTML = `
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Пользователь</th>
                <th>Роль</th>
                <th>Создан</th>
                <th class="text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              ${this.users.map(u => {
                const isSelf = currentUser && currentUser.id === u.id;
                const roleBadge = u.role_display_name || u.role || 'Пользователь';
                const isSysAdmin = u.role === 'admin';
                return `
                  <tr style="cursor:pointer" onclick="SettingsPage.openUserModal(${u.id})" title="Редактировать пользователя">
                    <td>
                      <div style="display:flex;align-items:center;gap:10px">
                        <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#14b8a6,#3b82f6);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:0.8rem">
                          ${(u.full_name || '?').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style="font-weight:600">${u.full_name} ${isSelf ? '<span style="font-size:0.75rem;color:var(--accent-teal)">(Вы)</span>' : ''}</div>
                          <div style="font-size:0.75rem;color:var(--text-muted)">@${u.username}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span class="badge" style="background:${isSysAdmin ? 'rgba(239,68,68,0.12);color:#ef4444' : 'rgba(20,184,166,0.12);color:var(--accent-teal)'}">
                        ${roleBadge}
                      </span>
                    </td>
                    <td class="text-muted" style="font-size:0.8rem">
                      ${u.created_at ? new Date(u.created_at).toLocaleDateString('ru-RU') : '—'}
                    </td>
                    <td class="text-right" onclick="event.stopPropagation()">
                      <div class="table-actions" style="justify-content:flex-end">
                        <button class="btn btn-icon btn-sm" onclick="SettingsPage.openUserModal(${u.id})" title="Редактировать">✏️</button>
                        ${!isSelf ? `
                          <button class="btn btn-icon btn-sm btn-danger" onclick="SettingsPage.deleteUser(${u.id})" title="Удалить">✕</button>
                        ` : ''}
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-text">${err.message}</div></div>`;
    }
  },

  async openUserModal(id = null) {
    let user = null;
    if (id) {
      try {
        user = await API.get(`/users/${id}`);
      } catch (err) {
        Toast.error(err.message);
        return;
      }
    }

    // Загрузить роли для селектора
    let roles = this.roles;
    if (!roles || roles.length === 0) {
      try {
        const res = await API.get('/roles');
        roles = res.data || [];
        this.roles = roles;
      } catch (e) {
        roles = [];
      }
    }

    const isEdit = !!user;

    Modal.open({
      title: isEdit ? `Редактировать пользователя: ${user.full_name}` : 'Новый пользователь',
      body: `
        <form id="user-form">
          <div class="form-group">
            <label>ФИО пользователя *</label>
            <input type="text" class="form-control" id="user-fullname" value="${isEdit ? user.full_name : ''}" placeholder="например, Иванов Иван Иванович" required>
          </div>
          <div class="form-group">
            <label>Логин для входа *</label>
            <input type="text" class="form-control" id="user-login" value="${isEdit ? user.username : ''}" ${isEdit ? 'disabled' : ''} placeholder="например, ivanov" required>
          </div>
          <div class="form-group">
            <label>Роль доступа *</label>
            <select class="form-control" id="user-role-id" required>
              ${roles.map(r => `
                <option value="${r.id}" ${isEdit && (user.role_id === r.id || user.role === r.name) ? 'selected' : (!isEdit && r.name === 'manager' ? 'selected' : '')}>
                  ${r.display_name} (${r.description || r.name})
                </option>
              `).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>${isEdit ? 'Новый пароль (оставьте пустым, чтобы не менять)' : 'Пароль *'}</label>
            <input type="password" class="form-control" id="user-password" placeholder="${isEdit ? '••••••••' : 'Минимум 4 символа'}" ${isEdit ? '' : 'required'}>
          </div>
        </form>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Отмена</button>
        <button class="btn btn-primary" onclick="SettingsPage.saveUser(${isEdit ? user.id : 'null'})">
          ${isEdit ? 'Сохранить' : 'Создать'}
        </button>
      `,
    });
  },

  async saveUser(id) {
    const data = {
      full_name: document.getElementById('user-fullname').value.trim(),
      role_id: parseInt(document.getElementById('user-role-id').value) || null,
      password: document.getElementById('user-password').value,
    };

    if (!id) {
      data.username = document.getElementById('user-login').value.trim();
      if (!data.username) {
        Toast.error('Укажите логин');
        return;
      }
      if (!data.password || data.password.length < 4) {
        Toast.error('Пароль должен быть не менее 4 символов');
        return;
      }
    }

    if (!data.full_name) {
      Toast.error('Укажите ФИО пользователя');
      return;
    }

    try {
      if (id) {
        await API.put(`/users/${id}`, data);
        Toast.success('Пользователь обновлён');
      } else {
        await API.post('/users', data);
        Toast.success('Пользователь создан');
      }
      Modal.close();
      this.loadUsers();
      this.loadRoles();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async deleteUser(id) {
    if (!confirm('Вы уверены, что хотите удалить этого пользователя?')) return;
    try {
      await API.del(`/users/${id}`);
      Toast.success('Пользователь удалён');
      this.loadUsers();
      this.loadRoles();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  // =================== ПРИНЦИПАЛЫ ===================
  async loadPrincipals() {
    const container = document.getElementById('principals-list');
    if (!container) return;

    try {
      const res = await API.get('/principals');
      const principals = res.data;

      if (principals.length === 0) {
        container.innerHTML = Table.emptyState('Нет принципалов');
        return;
      }

      container.innerHTML = `
        <div class="table-wrapper">
          <table class="data-table">
            <thead><tr><th>Название</th><th class="text-right">Комиссия</th><th class="text-right">Действия</th></tr></thead>
            <tbody>
              ${principals.map(p => `
                <tr style="cursor:pointer" onclick="SettingsPage.openPrincipalModal(${p.id})" title="Редактировать принципала">
                  <td><strong>${p.name}</strong></td>
                  <td class="text-right text-accent">${p.agent_commission_pct}%</td>
                  <td class="text-right" onclick="event.stopPropagation()">
                    <div class="table-actions" style="justify-content:flex-end">
                      ${Table.actionBtn(Table.editIcon, 'Редактировать', `SettingsPage.openPrincipalModal(${p.id})`)}
                      ${Table.actionBtn(Table.deleteIcon, 'Удалить', `SettingsPage.deletePrincipal(${p.id})`, 'btn-danger')}
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-text">${err.message}</div></div>`;
    }
  },

  async openPrincipalModal(id = null) {
    let principal = null;
    if (id) {
      try {
        principal = await API.get(`/principals/${id}`);
      } catch (err) {
        Toast.error(err.message);
        return;
      }
    }

    const isEdit = !!principal;
    Modal.open({
      title: isEdit ? 'Редактировать принципала' : 'Новый принципал',
      body: `
        <form>
          <div class="form-group">
            <label>Название *</label>
            <input type="text" class="form-control" id="principal-name" value="${isEdit ? principal.name : ''}" required>
          </div>
          <div class="form-group">
            <label>Комиссия агента (%)</label>
            <input type="number" class="form-control" id="principal-comm" value="${isEdit ? principal.agent_commission_pct : 10}" min="0" max="100" step="0.1">
            <div class="form-hint">Процент, который получает агент от суммы заказа</div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Телефон</label>
              <input type="text" class="form-control" id="principal-phone" value="${isEdit ? (principal.phone || '') : ''}">
            </div>
            <div class="form-group">
              <label>Email</label>
              <input type="email" class="form-control" id="principal-email" value="${isEdit ? (principal.email || '') : ''}">
            </div>
          </div>
          <div class="form-group">
            <label>Примечание</label>
            <textarea class="form-control" id="principal-notes" rows="2">${isEdit ? (principal.notes || '') : ''}</textarea>
          </div>
        </form>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Отмена</button>
        <button class="btn btn-primary" onclick="SettingsPage.savePrincipal(${isEdit ? principal.id : 'null'})">${isEdit ? 'Сохранить' : 'Создать'}</button>
      `,
    });
  },

  async savePrincipal(id) {
    const data = {
      name: document.getElementById('principal-name').value.trim(),
      agent_commission_pct: parseFloat(document.getElementById('principal-comm').value) || 10,
      phone: document.getElementById('principal-phone').value.trim(),
      email: document.getElementById('principal-email').value.trim(),
      notes: document.getElementById('principal-notes').value.trim(),
    };

    if (!data.name) {
      Toast.error('Введите название принципала');
      return;
    }

    try {
      if (id) {
        await API.put(`/principals/${id}`, data);
        Toast.success('Принципал обновлён');
      } else {
        await API.post('/principals', data);
        Toast.success('Принципал создан');
      }
      Modal.close();
      this.loadPrincipals();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async deletePrincipal(id) {
    if (!confirm('Удалить принципала?')) return;
    try {
      await API.del(`/principals/${id}`);
      Toast.success('Принципал удалён');
      this.loadPrincipals();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  // =================== СТАТУСЫ КЛИЕНТОВ ===================
  async loadStatuses() {
    const container = document.getElementById('statuses-list');
    if (!container) return;

    try {
      const res = await API.get('/client-statuses');
      const statuses = res.data;

      if (statuses.length === 0) {
        container.innerHTML = Table.emptyState('Нет статусов');
        return;
      }

      container.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:4px">
          ${statuses.map(s => `
            <div style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:8px;border:1px solid var(--border);transition:all var(--transition-fast)" onclick="SettingsPage.openStatusModal(${s.id})" title="Редактировать статус" onmouseover="this.style.borderColor='var(--accent-teal)'" onmouseout="this.style.borderColor='var(--border)'">
              <div style="display:flex;align-items:center;gap:10px">
                <span style="width:14px;height:14px;border-radius:50%;background:${s.color};flex-shrink:0"></span>
                <span style="font-weight:500;font-size:0.9rem">${s.name}</span>
                ${!s.is_active ? '<span style="font-size:0.7rem;color:var(--text-muted);margin-left:4px">(скрыт)</span>' : ''}
              </div>
              <div style="display:flex;gap:4px" onclick="event.stopPropagation()">
                <button class="btn btn-icon btn-sm" onclick="SettingsPage.openStatusModal(${s.id})" title="Редактировать">✏️</button>
                <button class="btn btn-icon btn-sm btn-danger" onclick="SettingsPage.deleteStatus(${s.id})" title="Удалить">✕</button>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-text">${err.message}</div></div>`;
    }
  },

  async openStatusModal(id = null) {
    let status = null;
    if (id) {
      try {
        const res = await API.get('/client-statuses');
        status = res.data.find(s => s.id === id);
      } catch (err) { Toast.error(err.message); return; }
    }

    const isEdit = !!status;
    const defaultColors = ['#3b82f6', '#8b5cf6', '#f59e0b', '#14b8a6', '#22c55e', '#06b6d4', '#f97316', '#ef4444', '#64748b', '#ec4899'];

    Modal.open({
      title: isEdit ? 'Редактировать статус' : 'Новый статус',
      body: `
        <div class="form-group">
          <label>Название *</label>
          <input type="text" class="form-control" id="status-name" value="${isEdit ? status.name : ''}" required>
        </div>
        <div class="form-group">
          <label>Цвет</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
            ${defaultColors.map(c => `
              <div style="width:28px;height:28px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${isEdit && status.color === c ? '#fff' : 'transparent'};box-shadow:${isEdit && status.color === c ? '0 0 0 2px var(--accent-teal)' : 'none'}" 
                   onclick="document.getElementById('status-color').value='${c}';this.parentElement.querySelectorAll('div').forEach(d=>{d.style.border='2px solid transparent';d.style.boxShadow='none'});this.style.border='2px solid #fff';this.style.boxShadow='0 0 0 2px var(--accent-teal)'"></div>
            `).join('')}
          </div>
          <input type="color" class="form-control" id="status-color" value="${isEdit ? status.color : '#3b82f6'}" style="width:60px;height:36px;padding:2px">
        </div>
        <div class="form-group">
          <label>Порядок сортировки</label>
          <input type="number" class="form-control" id="status-order" value="${isEdit ? status.sort_order : 0}" min="0" step="1">
        </div>
        ${isEdit ? `
          <div class="form-group">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="status-active" ${status.is_active ? 'checked' : ''}>
              <span>Активен (виден при выборе)</span>
            </label>
          </div>
        ` : ''}
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Отмена</button>
        <button class="btn btn-primary" onclick="SettingsPage.saveStatus(${isEdit ? status.id : 'null'})">${isEdit ? 'Сохранить' : 'Создать'}</button>
      `,
    });
  },

  async saveStatus(id) {
    const data = {
      name: document.getElementById('status-name').value.trim(),
      color: document.getElementById('status-color').value,
      sort_order: parseInt(document.getElementById('status-order').value) || 0,
    };

    if (id) {
      const activeEl = document.getElementById('status-active');
      if (activeEl) data.is_active = activeEl.checked;
    }

    if (!data.name) { Toast.error('Укажите название'); return; }

    try {
      if (id) {
        await API.put(`/client-statuses/${id}`, data);
        Toast.success('Статус обновлён');
      } else {
        await API.post('/client-statuses', data);
        Toast.success('Статус создан');
      }
      Modal.close();
      this.loadStatuses();
    } catch (err) { Toast.error(err.message); }
  },

  async deleteStatus(id) {
    if (!confirm('Удалить статус? У клиентов с этим статусом он будет сброшен.')) return;
    try {
      await API.del(`/client-statuses/${id}`);
      Toast.success('Статус удалён');
      this.loadStatuses();
    } catch (err) { Toast.error(err.message); }
  },

  // ===== ТИПЫ ТЕХНИКИ =====
  async loadEquipmentTypes() {
    try {
      const res = await API.get('/equipment-types');
      const types = res.data || [];
      const container = document.getElementById('equip-types-list');
      if (!container) return;

      if (types.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.85rem">Типы не добавлены</div>';
        return;
      }

      container.innerHTML = `
        <table class="data-table" style="font-size:0.85rem">
          <thead><tr><th style="width:40px">Иконка</th><th>Название</th><th style="width:60px">Порядок</th><th style="width:100px"></th></tr></thead>
          <tbody>
            ${types.map(t => `
              <tr>
                <td style="font-size:1.2rem;text-align:center">${t.icon || '—'}</td>
                <td style="font-weight:600">${t.name}</td>
                <td class="text-center">${t.sort_order}</td>
                <td class="text-right">
                  <button class="btn btn-secondary btn-sm" onclick="SettingsPage.showEquipTypeForm(${t.id}, '${t.name.replace(/'/g, "\\'")}', '${(t.icon || '').replace(/'/g, "\\'")}', ${t.sort_order})">✏️</button>
                  <button class="btn btn-danger btn-sm" onclick="SettingsPage.deleteEquipType(${t.id})">🗑️</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      const container = document.getElementById('equip-types-list');
      if (container) container.innerHTML = `<div style="color:var(--accent-red);padding:12px">${err.message}</div>`;
    }
  },

  showEquipTypeForm(id, name, icon, sortOrder) {
    Modal.open({
      title: id ? 'Редактировать тип техники' : 'Новый тип техники',
      size: 'small',
      body: `
        <form id="equip-type-form">
          <div class="form-group">
            <label>Название *</label>
            <input type="text" class="form-control" id="et-name" value="${name || ''}">
          </div>
          <div class="form-row">
            <div class="form-group" style="flex:1">
              <label>Иконка (emoji)</label>
              <input type="text" class="form-control" id="et-icon" value="${icon || ''}" placeholder="🚛">
            </div>
            <div class="form-group" style="flex:1">
              <label>Порядок сортировки</label>
              <input type="number" class="form-control" id="et-sort" value="${sortOrder || 0}">
            </div>
          </div>
        </form>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Отмена</button>
        <button class="btn btn-primary" onclick="SettingsPage.saveEquipType(${id || 'null'})">${id ? 'Сохранить' : 'Создать'}</button>
      `,
    });
  },

  async saveEquipType(id) {
    const data = {
      name: document.getElementById('et-name').value,
      icon: document.getElementById('et-icon').value,
      sort_order: parseInt(document.getElementById('et-sort').value) || 0,
    };
    if (!data.name) { Toast.error('Укажите название'); return; }
    try {
      if (id) {
        await API.put(`/equipment-types/${id}`, data);
        Toast.success('Тип обновлён');
      } else {
        await API.post('/equipment-types', data);
        Toast.success('Тип создан');
      }
      Modal.close();
      this.loadEquipmentTypes();
    } catch (err) { Toast.error(err.message); }
  },

  async deleteEquipType(id) {
    if (!confirm('Удалить тип техники?')) return;
    try {
      await API.del(`/equipment-types/${id}`);
      Toast.success('Тип удалён');
      this.loadEquipmentTypes();
    } catch (err) { Toast.error(err.message); }
  },

  // ===== УРОВНИ КЛИЕНТОВ (ЦЕНООБРАЗОВАНИЕ) =====
  async loadPricingLevels() {
    try {
      const res = await API.get('/pricing-levels');
      const levels = res.data || [];
      const container = document.getElementById('pricing-levels-list');
      if (!container) return;

      if (levels.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem">Уровни не настроены</div>';
        return;
      }

      container.innerHTML = `
        <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:10px">
          Цена компонента = базовая цена × (1 + наценка%). Отрицательная наценка = скидка.
        </div>
        <table class="data-table" style="margin:0">
          <thead><tr>
            <th>Название</th>
            <th>Код</th>
            <th class="text-right" style="width:120px">Наценка %</th>
            <th style="width:60px"></th>
          </tr></thead>
          <tbody>
            ${levels.map(l => `
              <tr>
                <td style="font-weight:600">${l.name}</td>
                <td><code style="font-size:0.8rem;color:var(--accent-teal)">${l.code}</code></td>
                <td class="text-right">
                  <input type="number" value="${l.markup_pct}" step="0.5" 
                         style="width:80px;text-align:right;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-main);color:var(--text-primary);font-size:0.85rem;font-weight:600"
                         onchange="SettingsPage.savePricingLevel(${l.id}, this.value)"
                         id="pricing-level-${l.id}">
                  <span style="font-size:0.8rem;color:var(--text-muted)">%</span>
                </td>
                <td class="text-right">
                  <button class="btn btn-primary btn-sm" onclick="SettingsPage.savePricingLevel(${l.id}, document.getElementById('pricing-level-${l.id}').value)" title="Сохранить">✓</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:8px">
          Пример: базовая цена 1000₽, наценка 30% → клиент видит 1300₽
        </div>
      `;
    } catch (err) { Toast.error(err.message); }
  },

  async savePricingLevel(id, markupPct) {
    try {
      await API.put(`/pricing-levels/${id}`, { markup_pct: parseFloat(markupPct) });
      Toast.success('Наценка обновлена');
    } catch (err) { Toast.error(err.message); }
  },
};
