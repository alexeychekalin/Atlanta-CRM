/* Client Profile Page — Карточка клиента */
const ClientProfilePage = {
  clientId: null,
  client: null,
  stats: null,
  workStatuses: [],

  eventTypes: {
    call: { icon: '📞', label: 'Звонок', color: '#3b82f6' },
    negotiation: { icon: '💬', label: 'Переговоры', color: '#8b5cf6' },
    price_change: { icon: '💰', label: 'Изменение цены', color: '#f59e0b' },
    deferral: { icon: '⏳', label: 'Отсрочка', color: '#f97316' },
    order: { icon: '📋', label: 'Заказ', color: '#14b8a6' },
    document: { icon: '📎', label: 'Документ', color: '#6366f1' },
    payment: { icon: '✅', label: 'Оплата', color: '#22c55e' },
    issue: { icon: '⚠️', label: 'Проблема', color: '#ef4444' },
    note: { icon: '📝', label: 'Заметка', color: '#64748b' },
  },

  async render(clientId) {
    this.clientId = clientId;
    const content = document.getElementById('content-area');
    content.innerHTML = Table.loading();

    try {
      const [clientRes, statsRes, statusesRes] = await Promise.all([
        API.get(`/clients/${clientId}`),
        API.get(`/clients/${clientId}/documents/stats`),
        API.get('/client-statuses'),
      ]);
      this.client = clientRes;
      this.stats = statsRes;
      this.workStatuses = statusesRes.data;
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state-text">Ошибка: ${err.message}</div></div>`;
      return;
    }

    const c = this.client;
    const s = this.stats;
    const canEdit = API.can('clients', 'edit');

    const avatarContent = c.avatar_path 
      ? `<img src="${c.avatar_path}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : (c.name || '?').charAt(0).toUpperCase();

    const statusBadge = c.status_name 
      ? `<span class="badge" style="background:${c.status_color}20;color:${c.status_color};border:1px solid ${c.status_color}40;font-size:0.8rem;padding:4px 12px;border-radius:20px">${c.status_name}</span>`
      : '<span style="color:var(--text-muted);font-size:0.85rem">Статус не задан</span>';

    const pricingBadge = c.pricing_level_name
      ? `<span class="badge" style="background:var(--accent-teal)15;color:var(--accent-teal);border:1px solid var(--accent-teal)40;font-size:0.8rem;padding:4px 12px;border-radius:20px">💰 ${c.pricing_level_name} (${c.pricing_markup_pct > 0 ? '+' : ''}${c.pricing_markup_pct}%)</span>`
      : '<span class="badge" style="background:var(--accent-red)15;color:var(--accent-red);border:1px solid var(--accent-red)40;font-size:0.8rem;padding:4px 12px;border-radius:20px">⚠️ Уровень цен не задан</span>';

    content.innerHTML = `
      <!-- Кнопка назад -->
      <button class="btn btn-secondary btn-sm mb-2" onclick="App.navigateTo('clients')" style="gap:6px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="15 18 9 12 15 6"/></svg>
        К списку клиентов
      </button>

      <!-- Профиль-хедер -->
      <div class="profile-header">
        <div class="profile-avatar" ${canEdit ? 'style="cursor:pointer;position:relative" onclick="ClientProfilePage.uploadAvatar()" title="Нажмите чтобы загрузить фото"' : ''}>
          ${avatarContent}
          ${canEdit ? '<div style="position:absolute;bottom:-2px;right:-2px;background:var(--accent-teal);color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:0.7rem;border:2px solid var(--bg-card)">📷</div>' : ''}
        </div>
        <div class="profile-info">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <h2 class="profile-name" style="margin:0">${c.name}</h2>
            <div id="client-status-badge" style="cursor:${canEdit ? 'pointer' : 'default'}" ${canEdit ? 'onclick="ClientProfilePage.openStatusPicker()"' : ''}>
              ${statusBadge}
            </div>
            <div>${pricingBadge}</div>
          </div>
          <div class="profile-contacts" style="margin-top:6px">
            ${c.phone ? `<span class="profile-contact-item">📞 ${c.phone}</span>` : ''}
            ${c.email ? `<span class="profile-contact-item">✉️ ${c.email}</span>` : ''}
            ${c.address ? `<span class="profile-contact-item">📍 ${c.address}</span>` : ''}
          </div>
          ${(c.delivery_address || c.delivery_contact_name || c.delivery_contact_phone) ? `
            <div style="margin-top:10px;padding:10px 14px;background:var(--bg-main);border-radius:8px;border:1px solid var(--border)">
              <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:4px;font-weight:600">📦 Данные доставки</div>
              <div class="profile-contacts" style="margin-top:2px">
                ${c.delivery_address ? `<span class="profile-contact-item">🏢 ${c.delivery_address}</span>` : ''}
                ${c.delivery_contact_name ? `<span class="profile-contact-item">👤 ${c.delivery_contact_name}</span>` : ''}
                ${c.delivery_contact_phone ? `<span class="profile-contact-item">📱 ${c.delivery_contact_phone}</span>` : ''}
              </div>
            </div>
          ` : ''}
          ${(c.inn || c.kpp || c.legal_address || c.bank_details || c.ogrnip) ? `
            <div style="margin-top:10px;padding:10px 14px;background:var(--bg-main);border-radius:8px;border:1px solid var(--border)">
              <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:4px;font-weight:600">🏛️ Реквизиты</div>
              <div class="profile-contacts" style="margin-top:2px">
                ${c.inn ? `<span class="profile-contact-item">ИНН ${c.inn}${c.kpp ? ' / КПП ' + c.kpp : ''}</span>` : ''}
                ${c.ogrnip ? `<span class="profile-contact-item">ОГРНИП ${c.ogrnip}</span>` : ''}
                ${c.legal_address ? `<span class="profile-contact-item">📍 ${c.legal_address}</span>` : ''}
                ${c.bank_details ? `<span class="profile-contact-item">🏦 ${c.bank_details}</span>` : ''}
              </div>
            </div>
          ` : ''}
        </div>
        ${canEdit ? `<button class="btn btn-secondary btn-sm" onclick="ClientProfilePage.editClient()">✏️ Редактировать</button>` : ''}
      </div>

      <!-- KPI -->
      <div class="profile-kpi">
        <div class="kpi-card">
          <div class="kpi-value">${s.total_orders}</div>
          <div class="kpi-label">Заказов</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${Table.formatMoney(s.total_amount)}</div>
          <div class="kpi-label">Общая сумма</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${Table.formatMoney(s.total_commission)}</div>
          <div class="kpi-label">Комиссия</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${s.drawings_count}</div>
          <div class="kpi-label">Чертежей</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${s.timeline_count}</div>
          <div class="kpi-label">Событий</div>
        </div>
      </div>

      <!-- Табы -->
      <div class="tabs-header" style="margin-top:24px">
        <button class="tab-btn active" data-tab="orders" onclick="ClientProfilePage.switchTab('orders')">Заказы</button>
        <button class="tab-btn" data-tab="proposals" onclick="ClientProfilePage.switchTab('proposals')">КП</button>
        <button class="tab-btn" data-tab="invoices" onclick="ClientProfilePage.switchTab('invoices')">Счета</button>
        <button class="tab-btn" data-tab="contacts" onclick="ClientProfilePage.switchTab('contacts')">Контакты</button>
        <button class="tab-btn" data-tab="drawings" onclick="ClientProfilePage.switchTab('drawings')">Чертежи</button>
        <button class="tab-btn" data-tab="calculations" onclick="ClientProfilePage.switchTab('calculations')">Расчёты</button>
        <button class="tab-btn" data-tab="timeline" onclick="ClientProfilePage.switchTab('timeline')">Таймлайн</button>
        <button class="tab-btn" data-tab="documents" onclick="ClientProfilePage.switchTab('documents')">Документы</button>
      </div>

      <div id="profile-tab-content"></div>

      <!-- Скрытый input для загрузки аватара -->
      <input type="file" id="avatar-upload-input" accept=".jpg,.jpeg,.png,.webp" style="display:none">
    `;

    // Привязка загрузки аватара
    document.getElementById('avatar-upload-input').addEventListener('change', async (e) => {
      if (!e.target.files[0]) return;
      try {
        const formData = new FormData();
        formData.append('file', e.target.files[0]);
        const res = await API.upload('/upload/avatar', formData);
        await API.request('PATCH', `/clients/${this.clientId}/avatar`, { avatar_path: res.path });
        Toast.success('Фото обновлено');
        this.render(this.clientId);
      } catch (err) { Toast.error(err.message); }
    });

    this.switchTab('orders');
  },

  // === Загрузка аватара ===
  uploadAvatar() {
    document.getElementById('avatar-upload-input').click();
  },

  // === Выбор статуса ===
  openStatusPicker() {
    const activeStatuses = this.workStatuses.filter(s => s.is_active !== false);
    Modal.open({
      title: 'Изменить статус клиента',
      body: `
        <div style="display:flex;flex-direction:column;gap:6px">
          <div style="padding:10px 14px;border-radius:8px;cursor:pointer;border:1px solid var(--border);transition:background 0.15s"
               onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background=''"
               onclick="ClientProfilePage.setStatus(null)">
            <span style="color:var(--text-muted)">✕ Убрать статус</span>
          </div>
          ${activeStatuses.map(s => `
            <div style="padding:10px 14px;border-radius:8px;cursor:pointer;border:1px solid ${s.color}30;transition:background 0.15s;${this.client.status_id == s.id ? `background:${s.color}15` : ''}"
                 onmouseenter="this.style.background='${s.color}20'" onmouseleave="this.style.background='${this.client.status_id == s.id ? s.color + '15' : ''}'"
                 onclick="ClientProfilePage.setStatus(${s.id})">
              <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${s.color};margin-right:8px"></span>
              <span style="font-weight:${this.client.status_id == s.id ? '700' : '500'}">${s.name}</span>
              ${this.client.status_id == s.id ? ' <span style="color:var(--accent-teal);margin-left:8px">✓</span>' : ''}
            </div>
          `).join('')}
        </div>
      `,
      footer: '<button class="btn btn-secondary" onclick="Modal.close()">Закрыть</button>',
    });
  },

  async setStatus(statusId) {
    try {
      await API.request('PATCH', `/clients/${this.clientId}/status`, { status_id: statusId });
      Toast.success('Статус обновлён');
      Modal.close();
      this.render(this.clientId);
    } catch (err) { Toast.error(err.message); }
  },


  switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const container = document.getElementById('profile-tab-content');
    container.innerHTML = Table.loading();

    switch (tab) {
      case 'orders': this.loadOrders(container); break;
      case 'proposals': this.loadProposals(container); break;
      case 'invoices': this.loadInvoices(container); break;
      case 'contacts': this.loadContacts(container); break;
      case 'drawings': this.loadDrawings(container); break;
      case 'calculations': this.loadCalculations(container); break;
      case 'timeline': this.loadTimeline(container); break;
      case 'documents': this.loadDocuments(container); break;
    }
  },

  // =================== КОММЕРЧЕСКИЕ ПРЕДЛОЖЕНИЯ ===================
  async loadProposals(container) {
    try {
      const res = await API.get(`/proposals?client_id=${this.clientId}&limit=100`);
      const proposals = res.data;
      if (proposals.length === 0) {
        container.innerHTML = Table.emptyState('Нет коммерческих предложений');
        return;
      }

      const statusMap = { draft: 'Черновик', sent: 'Отправлено', accepted: 'Принято', rejected: 'Отклонено', converted: 'В заказе' };
      const statusColors = { draft: '#6b7280', sent: '#3b82f6', accepted: '#10b981', rejected: '#ef4444', converted: '#8b5cf6' };

      container.innerHTML = `
        <div class="table-wrapper">
          <table class="data-table">
            <thead><tr><th>Номер</th><th>Дата</th><th>Статус</th><th class="text-right">Сумма</th><th>Заказ</th><th style="width:120px">Действия</th></tr></thead>
            <tbody>
              ${proposals.map(p => {
                const statusLabel = statusMap[p.status] || p.status;
                const statusColor = statusColors[p.status] || '#6b7280';
                return `
                  <tr>
                    <td style="font-weight:600;color:var(--accent-teal)">${p.proposal_number}</td>
                    <td>${Table.formatDate(p.created_at)}</td>
                    <td><span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:0.78rem;font-weight:600;background:${statusColor}20;color:${statusColor}">${statusLabel}</span></td>
                    <td class="text-right" style="font-weight:600">${Table.formatMoney(p.total)}</td>
                    <td>${p.order_id ? `<span style="color:var(--accent-teal);cursor:pointer;font-weight:600" onclick="ClientProfilePage.viewOrder(${p.order_id})">${p.order_number || 'Заказ'}</span>` : '—'}</td>
                    <td>
                      <div style="display:flex;gap:4px">
                        <button class="action-btn" title="Просмотр" onclick="ProposalsPage.viewProposal(${p.id})">👁️</button>
                        <button class="action-btn" title="Скачать PDF" onclick="ProposalsPage.downloadPDF(${p.id})">📄</button>
                        ${p.status !== 'converted' ? `<button class="action-btn" title="Перевести в заказ" onclick="ProposalsPage.convertToOrder(${p.id})">📦</button>` : ''}
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
      container.innerHTML = `<div class="empty-state"><div class="empty-state-text">Ошибка загрузки КП</div></div>`;
    }
  },

  // =================== ЗАКАЗЫ ===================
  async loadOrders(container) {
    try {
      const res = await API.get(`/orders?client_id=${this.clientId}&limit=100`);
      const orders = res.data;
      if (orders.length === 0) { container.innerHTML = Table.emptyState('Нет заказов'); return; }

      container.innerHTML = `
        <div class="table-wrapper">
          <table class="data-table">
            <thead><tr><th>Номер</th><th>Дата</th><th>Статус</th><th class="text-right">Сумма</th><th class="text-right">в т.ч. комиссия</th></tr></thead>
            <tbody>
              ${orders.map(o => `
                <tr style="cursor:pointer" onclick="ClientProfilePage.viewOrder(${o.id})" title="Нажмите для просмотра">
                  <td><strong>${o.order_number}</strong></td>
                  <td>${new Date(o.order_date).toLocaleDateString('ru-RU')}</td>
                  <td>${Table.statusBadge(o.status)}</td>
                  <td class="text-right" style="font-weight:600">${Table.formatMoney(o.total)}</td>
                  <td class="text-right" style="color:var(--text-secondary);font-size:0.85rem">${Table.formatMoney(o.commission_amount)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) { container.innerHTML = `<div class="empty-state"><div class="empty-state-text">${err.message}</div></div>`; }
  },

  // =================== СЧЕТА ===================
  async loadInvoices(container) {
    try {
      const res = await API.get(`/orders?client_id=${this.clientId}&limit=200`);
      const orders = res.data;
      // Фильтруем заказы с любыми данными по счетам
      const invoiceOrders = orders.filter(o => o.invoice_number || o.invoice_path || o.payment_date);
      
      if (invoiceOrders.length === 0) {
        container.innerHTML = Table.emptyState('Нет выставленных счетов');
        return;
      }

      container.innerHTML = `
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>№ заказа</th>
                <th>№ счёта</th>
                <th class="text-right">Сумма</th>
                <th>Дата заказа</th>
                <th>Дата оплаты</th>
                <th>Трек-номер</th>
                <th>Статус</th>
                <th class="text-right">Файл</th>
              </tr>
            </thead>
            <tbody>
              ${invoiceOrders.map(o => {
                const isPaid = !!o.payment_date;
                return `
                  <tr style="cursor:pointer" onclick="ClientProfilePage.viewOrder(${o.id})" title="Нажмите для просмотра">
                    <td><strong>${o.order_number}</strong></td>
                    <td>${o.invoice_number || '<span class="text-muted">—</span>'}</td>
                    <td class="text-right" style="font-weight:600">${Table.formatMoney(o.total)}</td>
                    <td>${new Date(o.order_date).toLocaleDateString('ru-RU')}</td>
                    <td>${o.payment_date ? `<span style="color:var(--accent-green,#22c55e);font-weight:500">${new Date(o.payment_date).toLocaleDateString('ru-RU')}</span>` : '<span class="text-muted">—</span>'}</td>
                    <td>${o.tracking_number ? `<span style="font-family:var(--font-mono,monospace);font-size:0.83rem">${o.tracking_number}</span>` : '<span class="text-muted">—</span>'}</td>
                    <td>
                      ${isPaid 
                        ? '<span class="badge" style="background:#22c55e20;color:#22c55e;border:1px solid #22c55e40">✅ Оплачен</span>'
                        : '<span class="badge" style="background:#f59e0b20;color:#f59e0b;border:1px solid #f59e0b40">⏳ Не оплачен</span>'
                      }
                    </td>
                    <td class="text-right" onclick="event.stopPropagation()">
                      ${o.invoice_path 
                        ? `<a href="${o.invoice_path}" target="_blank" class="btn btn-secondary btn-sm">📄 Открыть</a>`
                        : '<span class="text-muted" style="font-size:0.8rem">—</span>'
                      }
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) { container.innerHTML = `<div class="empty-state"><div class="empty-state-text">${err.message}</div></div>`; }
  },

  // === Просмотр деталей заказа ===
  async viewOrder(orderId) {
    try {
      const order = await API.get(`/orders/${orderId}`);
      const items = order.items || [];

      const statusLabels = {
        new: 'Новый', in_progress: 'В работе', paid: 'Оплачен',
        completed: 'Выполнен', cancelled: 'Отменён',
      };

      // Блок счёта/оплаты/трека
      const invoiceBlock = (order.invoice_number || order.invoice_path || order.payment_date || order.tracking_number) ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          ${order.invoice_number ? `
            <div style="padding:12px;background:var(--bg-main);border-radius:8px;border:1px solid var(--border)">
              <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:4px">📄 Номер счёта</div>
              <div style="font-weight:600">${order.invoice_number}
                ${order.invoice_path ? `<a href="${order.invoice_path}" target="_blank" style="margin-left:8px;color:var(--accent-teal);font-size:0.8rem">Открыть ↗</a>` : ''}
              </div>
            </div>
          ` : ''}
          ${order.payment_date ? `
            <div style="padding:12px;background:var(--bg-main);border-radius:8px;border:1px solid var(--border)">
              <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:4px">💳 Дата оплаты</div>
              <div style="font-weight:600;color:var(--accent-green,#22c55e)">${new Date(order.payment_date).toLocaleDateString('ru-RU')}</div>
            </div>
          ` : ''}
          ${order.tracking_number ? `
            <div style="padding:12px;background:var(--bg-main);border-radius:8px;border:1px solid var(--border)">
              <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:4px">🚚 Трек-номер</div>
              <div style="font-weight:600;font-family:var(--font-mono,monospace)">${order.tracking_number}</div>
            </div>
          ` : ''}
          ${!order.invoice_number && order.invoice_path ? `
            <div style="padding:12px;background:var(--bg-main);border-radius:8px;border:1px solid var(--border)">
              <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:4px">📄 Файл счёта</div>
              <div><a href="${order.invoice_path}" target="_blank" style="color:var(--accent-teal)">Открыть файл ↗</a></div>
            </div>
          ` : ''}
        </div>
      ` : '';

      Modal.open({
        title: `Заказ ${order.order_number}`,
        wide: true,
        body: `
          <!-- Информация о заказе -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
            <div style="padding:12px;background:var(--bg-main);border-radius:8px;border:1px solid var(--border)">
              <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:4px">Дата заказа</div>
              <div style="font-weight:600">${new Date(order.order_date).toLocaleDateString('ru-RU')}</div>
            </div>
            <div style="padding:12px;background:var(--bg-main);border-radius:8px;border:1px solid var(--border)">
              <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:4px">Статус</div>
              <div>${Table.statusBadge(order.status)}</div>
            </div>
            <div style="padding:12px;background:var(--bg-main);border-radius:8px;border:1px solid var(--border)">
              <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:4px">Принципал</div>
              <div style="font-weight:600">${order.principal_name || '—'}</div>
              <div style="font-size:0.78rem;color:var(--accent-teal)">Комиссия: ${order.commission_pct}%</div>
            </div>
            <div style="padding:12px;background:var(--bg-main);border-radius:8px;border:1px solid var(--border)">
              <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:4px">Создал</div>
              <div style="font-weight:600">${order.created_by_name || '—'}</div>
            </div>
          </div>

          ${invoiceBlock}

          ${order.comment ? `
            <div style="padding:10px 14px;background:var(--bg-main);border-radius:8px;border:1px solid var(--border);margin-bottom:16px;font-size:0.88rem">
              <span style="color:var(--text-muted)">💬</span> ${order.comment}
            </div>
          ` : ''}

          <!-- Позиции -->
          <div style="font-weight:600;font-size:0.92rem;margin-bottom:8px">Позиции заказа</div>
          ${items.length > 0 ? `
            <div class="table-wrapper">
              <table class="data-table">
                <thead>
                  <tr>
                    <th style="width:30px">#</th>
                    <th>Наименование</th>
                    <th class="text-right" style="width:100px">Цена</th>
                    <th class="text-center" style="width:70px">Кол-во</th>
                    <th class="text-right" style="width:110px">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  ${items.map((item, i) => `
                    <tr>
                      <td style="color:var(--text-muted)">${i + 1}</td>
                      <td style="font-weight:500">${item.product_name} ${item.metadata?.type === 'calculator_drawing' ? '📐' : ''}</td>
                      <td class="text-right">${Table.formatMoney(item.unit_price)}</td>
                      <td class="text-center">${item.quantity}</td>
                      <td class="text-right" style="font-weight:600">${Table.formatMoney(item.line_total)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : '<div style="color:var(--text-muted);text-align:center;padding:16px">Нет позиций</div>'}

          ${Table.renderDrawingMetadata(items)}

          <!-- Итоги -->
          <div style="margin-top:16px;padding:16px;background:var(--bg-card);border-radius:10px;border:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;padding-bottom:10px;border-bottom:2px solid var(--accent-teal);margin-bottom:10px">
              <span style="font-weight:700;font-size:1.05rem">ИТОГО</span>
              <span style="font-weight:700;font-size:1.15rem;color:var(--accent-teal)">${Table.formatMoney(order.total)}</span>
            </div>
            <div style="display:flex;justify-content:space-between">
              <span style="color:var(--text-muted);font-size:0.88rem">в т.ч. комиссия агента (${order.commission_pct}%)</span>
              <span style="font-weight:500;font-size:0.88rem;color:var(--text-secondary)">${Table.formatMoney(order.commission_amount)}</span>
            </div>
          </div>
        `,
        footer: `
          <button class="btn btn-secondary" onclick="Modal.close()">Закрыть</button>
          ${API.isAdmin() ? `<button class="btn btn-primary" onclick="Modal.close(); App.navigateTo('orders');">📋 Перейти к заказам</button>` : ''}
        `,
      });
    } catch (err) { Toast.error(err.message); }
  },

  // =================== ЧЕРТЕЖИ ===================
  async loadDrawings(container) {
    const isAdmin = API.isAdmin();
    try {
      const res = await API.get(`/clients/${this.clientId}/documents/drawings`);
      const drawings = res.data;

      container.innerHTML = `
        ${isAdmin ? `
          <div class="toolbar">
            <div></div>
            <button class="btn btn-primary btn-sm" onclick="ClientProfilePage.uploadDrawing()">📎 Загрузить чертёж</button>
          </div>
        ` : ''}
        ${drawings.length === 0 ? Table.emptyState('Нет чертежей') : `
          <div class="file-grid">
            ${drawings.map(d => `
              <div class="file-card">
                <div class="file-icon">${this.getFileIcon(d.file_type)}</div>
                <div class="file-info">
                  <div class="file-name">${d.name}</div>
                  ${d.description ? `<div class="file-desc">${d.description}</div>` : ''}
                  <div class="file-meta">${new Date(d.created_at).toLocaleDateString('ru-RU')} · ${d.uploaded_by_name || ''}</div>
                </div>
                <div class="file-actions">
                  <a href="${d.file_path}" target="_blank" class="btn btn-secondary btn-sm">Открыть</a>
                  ${isAdmin ? `<button class="btn btn-icon btn-sm btn-danger" onclick="ClientProfilePage.deleteDrawing(${d.id})">✕</button>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        `}
      `;
    } catch (err) { container.innerHTML = `<div class="empty-state"><div class="empty-state-text">${err.message}</div></div>`; }
  },

  // =================== РАСЧЁТЫ ===================
  async loadCalculations(container) {
    try {
      const res = await API.get(`/clients/${this.clientId}/documents/calculations`);
      const calcs = res.data;
      if (calcs.length === 0) { container.innerHTML = Table.emptyState('Нет расчётов из калькулятора'); return; }

      container.innerHTML = `
        <div class="table-wrapper">
          <table class="data-table">
            <thead><tr><th>Шаблон</th><th class="text-center">Компонентов</th><th class="text-right">Базовая стоимость</th><th>Дата</th><th>Автор</th><th class="text-right"></th></tr></thead>
            <tbody>
              ${calcs.map(c => `
                <tr style="cursor:pointer" onclick="ClientProfilePage.viewCalculation(${c.id})" title="Нажмите для просмотра чертежа">
                  <td>
                    <strong>${c.name}</strong>
                    ${c.file_path ? `<a href="${c.file_path}" target="_blank" onclick="event.stopPropagation()" style="font-size:0.8rem;color:var(--accent-teal);margin-left:8px">📎</a>` : ''}
                  </td>
                  <td class="text-center"><span class="badge" style="background:var(--bg-tertiary);color:var(--text-secondary)">${c.components_count || 0} шт.</span></td>
                  <td class="text-right" style="font-weight:600">${Table.formatMoney(c.base_cost)}</td>
                  <td>${new Date(c.created_at).toLocaleDateString('ru-RU')}</td>
                  <td>${c.author_name || '—'}</td>
                  <td class="text-right" onclick="event.stopPropagation()">
                    <button class="btn btn-secondary btn-sm" onclick="ClientProfilePage.viewCalculation(${c.id})">👁 Просмотр</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) { container.innerHTML = `<div class="empty-state"><div class="empty-state-text">${err.message}</div></div>`; }
  },

  // Просмотр расчёта (шаблона) с полной детализацией
  async viewCalculation(drawingId) {
    try {
      const drawing = await API.get(`/drawings/${drawingId}`);
      const components = drawing.components || [];

      let baseTotal = 0;
      let markupTotal = 0;

      const rows = components.map(c => {
        const price = parseFloat(c.price);
        const qty = parseFloat(c.quantity);
        const base = price * qty;
        const mPct = base * (parseFloat(c.item_markup_pct) || 0) / 100;
        const mRub = parseFloat(c.item_markup_rub) || 0;
        const lineTotal = base + mPct + mRub;
        baseTotal += base;
        markupTotal += mPct + mRub;

        return `
          <tr>
            <td>
              ${c.image_path ? `<img src="${c.image_path}" style="width:28px;height:28px;object-fit:cover;border-radius:4px">` : '📦'}
            </td>
            <td>
              <div style="font-weight:600;font-size:0.85rem">${c.component_name}</div>
              <div style="font-size:0.75rem;color:var(--accent-teal)" class="font-mono">${c.article}</div>
              ${c.category_name ? `<div style="font-size:0.7rem;color:var(--text-muted)">${c.category_name}</div>` : ''}
            </td>
            <td class="text-right">${Table.formatMoney(price)}</td>
            <td class="text-center">${qty}</td>
            <td class="text-right">${parseFloat(c.item_markup_pct) ? c.item_markup_pct + '%' : '—'}</td>
            <td class="text-right">${parseFloat(c.item_markup_rub) ? Table.formatMoney(c.item_markup_rub) : '—'}</td>
            <td class="text-right" style="font-weight:600">${Table.formatMoney(lineTotal)}</td>
          </tr>`;
      });

      const grandTotal = baseTotal + markupTotal;

      Modal.open({
        title: `📐 Расчёт: ${drawing.name}`,
        wide: true,
        body: `
          ${drawing.file_path ? `
            <div style="margin-bottom:16px;padding:12px;background:var(--bg-card);border-radius:8px;border:1px solid var(--border)">
              ${['jpg','jpeg','png','webp'].includes(drawing.file_type) 
                ? `<img src="${drawing.file_path}" style="max-height:180px;border-radius:6px;display:block;margin:0 auto">`
                : `<div style="text-align:center"><span style="font-size:1.5rem">📄</span> <a href="${drawing.file_path}" target="_blank" style="color:var(--accent-teal)">Открыть чертёж →</a></div>`
              }
            </div>
          ` : ''}
          
          <div style="margin-bottom:12px;color:var(--text-secondary);font-size:0.85rem">
            ${drawing.author_name ? `Автор: <strong>${drawing.author_name}</strong> · ` : ''}
            Дата: <strong>${new Date(drawing.created_at).toLocaleDateString('ru-RU')}</strong> · 
            Компонентов: <strong>${components.length}</strong>
          </div>

          ${components.length > 0 ? `
            <div class="table-wrapper" style="max-height:350px;overflow-y:auto">
              <table class="data-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Компонент</th>
                    <th class="text-right">Цена</th>
                    <th class="text-center">Кол-во</th>
                    <th class="text-right">+%</th>
                    <th class="text-right">+₽</th>
                    <th class="text-right">Итого</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.join('')}
                </tbody>
              </table>
            </div>

            <div style="margin-top:16px;padding:16px;background:var(--bg-card);border-radius:10px;border:1px solid var(--border)">
              <div style="display:flex;justify-content:space-between;margin-bottom:8px">
                <span style="color:var(--text-secondary)">Сумма компонентов</span>
                <span style="font-weight:500">${Table.formatMoney(baseTotal)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;margin-bottom:8px">
                <span style="color:var(--text-secondary)">Наценки позиций</span>
                <span style="font-weight:500;color:var(--accent-teal)">+${Table.formatMoney(markupTotal)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;padding-top:10px;border-top:2px solid var(--accent-teal)">
                <span style="font-weight:700;font-size:1.05rem">ИТОГО</span>
                <span style="font-weight:700;font-size:1.15rem;color:var(--accent-teal)">${Table.formatMoney(grandTotal)}</span>
              </div>
            </div>
          ` : '<div class="empty-state"><div class="empty-state-text">Нет компонентов</div></div>'}
        `,
        footer: `
          <button class="btn btn-secondary" onclick="Modal.close()">Закрыть</button>
          ${API.isAdmin() ? `<button class="btn btn-primary" onclick="Modal.close(); App.navigateTo('calculator', ${drawingId});">📐 Открыть в калькуляторе</button>` : ''}
        `,
      });
    } catch (err) { Toast.error(err.message); }
  },

  // =================== ТАЙМЛАЙН ===================
  async loadTimeline(container) {
    const isAdmin = API.isAdmin();
    try {
      const res = await API.get(`/clients/${this.clientId}/timeline`);
      const events = res.data;

      container.innerHTML = `
        ${isAdmin ? `
          <div class="toolbar">
            <div></div>
            <button class="btn btn-primary btn-sm" onclick="ClientProfilePage.openTimelineModal()">+ Добавить событие</button>
          </div>
        ` : ''}
        ${events.length === 0 ? Table.emptyState('Нет событий') : `
          <div class="timeline">
            ${events.map(e => {
              const type = this.eventTypes[e.event_type] || this.eventTypes.note;
              return `
                <div class="timeline-item">
                  <div class="timeline-marker" style="background:${type.color}">${type.icon}</div>
                  <div class="timeline-content">
                    <div class="timeline-header">
                      <span class="timeline-title">${e.title}</span>
                      <span class="timeline-date">${new Date(e.event_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      ${isAdmin ? `
                        <div class="timeline-actions">
                          <button class="btn btn-icon btn-sm" onclick="ClientProfilePage.openTimelineModal(${e.id})" title="Ред.">✏️</button>
                          <button class="btn btn-icon btn-sm btn-danger" onclick="ClientProfilePage.deleteTimelineEvent(${e.id})" title="Удалить">✕</button>
                        </div>
                      ` : ''}
                    </div>
                    <div class="timeline-badge" style="background:${type.color}20;color:${type.color}">${type.label}</div>
                    ${e.description ? `<div class="timeline-desc">${e.description}</div>` : ''}
                    ${e.author_name ? `<div class="timeline-author">${e.author_name}</div>` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      `;
    } catch (err) { container.innerHTML = `<div class="empty-state"><div class="empty-state-text">${err.message}</div></div>`; }
  },

  // =================== КОНТАКТЫ (АДРЕСНАЯ КНИГА) ===================
  async loadContacts(container) {
    const canEdit = API.can('clients', 'edit');
    try {
      const res = await API.get(`/clients/${this.clientId}/contacts`);
      const contacts = res.data;

      container.innerHTML = `
        ${canEdit ? `
          <div class="toolbar">
            <div></div>
            <button class="btn btn-primary btn-sm" onclick="ClientProfilePage.openContactModal()">+ Добавить контакт</button>
          </div>
        ` : ''}
        ${contacts.length === 0 ? Table.emptyState('Нет контактов') : `
          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>ФИО</th>
                  <th>Должность</th>
                  <th>Телефон</th>
                  <th>Email</th>
                  <th>Заметка</th>
                  ${canEdit ? '<th class="text-right">Действия</th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${contacts.map(c => `
                  <tr>
                    <td style="font-weight:600">
                      <div style="display:flex;align-items:center;gap:8px">
                        <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:0.75rem;flex-shrink:0">${(c.full_name || '?').charAt(0).toUpperCase()}</div>
                        ${c.full_name}
                      </div>
                    </td>
                    <td>${c.position || '<span class="text-muted">—</span>'}</td>
                    <td>${c.phone ? `<a href="tel:${c.phone}" style="color:var(--accent-teal)" onclick="event.stopPropagation()">${c.phone}</a>` : '<span class="text-muted">—</span>'}</td>
                    <td>${c.email ? `<a href="mailto:${c.email}" style="color:var(--accent-teal)" onclick="event.stopPropagation()">${c.email}</a>` : '<span class="text-muted">—</span>'}</td>
                    <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary);font-size:0.85rem">${c.notes || ''}</td>
                    ${canEdit ? `
                      <td class="text-right">
                        <div class="table-actions" style="justify-content:flex-end">
                          ${Table.actionBtn(Table.editIcon, 'Редактировать', `ClientProfilePage.openContactModal(${c.id})`)}
                          ${Table.actionBtn(Table.deleteIcon, 'Удалить', `ClientProfilePage.deleteContact(${c.id})`, 'btn-danger')}
                        </div>
                      </td>
                    ` : ''}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      `;
    } catch (err) { container.innerHTML = `<div class="empty-state"><div class="empty-state-text">${err.message}</div></div>`; }
  },

  async openContactModal(contactId = null) {
    let contact = null;
    if (contactId) {
      try {
        const res = await API.get(`/clients/${this.clientId}/contacts`);
        contact = res.data.find(c => c.id === contactId);
      } catch (e) {}
    }
    const isEdit = !!contact;

    Modal.open({
      title: isEdit ? 'Редактировать контакт' : 'Новый контакт',
      body: `
        <div class="form-group"><label>ФИО *</label><input type="text" class="form-control" id="contact-name" value="${isEdit ? contact.full_name : ''}" required placeholder="Иванов Иван Иванович"></div>
        <div class="form-row">
          <div class="form-group"><label>Должность</label><input type="text" class="form-control" id="contact-position" value="${isEdit ? (contact.position || '') : ''}" placeholder="Менеджер по закупкам"></div>
          <div class="form-group"><label>Телефон</label><input type="text" class="form-control" id="contact-phone" value="${isEdit ? (contact.phone || '') : ''}" placeholder="+7 (999) 123-45-67"></div>
        </div>
        <div class="form-group"><label>Email</label><input type="email" class="form-control" id="contact-email" value="${isEdit ? (contact.email || '') : ''}" placeholder="email@example.com"></div>
        <div class="form-group"><label>Заметка</label><input type="text" class="form-control" id="contact-notes" value="${isEdit ? (contact.notes || '') : ''}" placeholder="Дополнительная информация"></div>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Отмена</button>
        <button class="btn btn-primary" onclick="ClientProfilePage.saveContact(${isEdit ? contact.id : 'null'})">${isEdit ? 'Сохранить' : 'Добавить'}</button>
      `,
    });
  },

  async saveContact(contactId) {
    const data = {
      full_name: document.getElementById('contact-name').value.trim(),
      position: document.getElementById('contact-position').value.trim(),
      phone: document.getElementById('contact-phone').value.trim(),
      email: document.getElementById('contact-email').value.trim(),
      notes: document.getElementById('contact-notes').value.trim(),
    };
    if (!data.full_name) { Toast.error('Укажите ФИО'); return; }
    try {
      if (contactId) {
        await API.put(`/clients/${this.clientId}/contacts/${contactId}`, data);
        Toast.success('Контакт обновлён');
      } else {
        await API.post(`/clients/${this.clientId}/contacts`, data);
        Toast.success('Контакт добавлен');
      }
      Modal.close();
      this.switchTab('contacts');
    } catch (err) { Toast.error(err.message); }
  },

  async deleteContact(contactId) {
    if (!confirm('Удалить контакт?')) return;
    try {
      await API.del(`/clients/${this.clientId}/contacts/${contactId}`);
      Toast.success('Контакт удалён');
      this.switchTab('contacts');
    } catch (err) { Toast.error(err.message); }
  },

  // =================== ДОКУМЕНТЫ ===================
  async loadDocuments(container) {
    const isAdmin = API.isAdmin();
    try {
      const res = await API.get(`/clients/${this.clientId}/documents`);
      const docs = res.data;

      container.innerHTML = `
        ${isAdmin ? `
          <div class="toolbar">
            <div></div>
            <button class="btn btn-primary btn-sm" onclick="ClientProfilePage.uploadDocument()">📎 Загрузить документ</button>
          </div>
        ` : ''}
        ${docs.length === 0 ? Table.emptyState('Нет документов') : `
          <div class="file-grid">
            ${docs.map(d => `
              <div class="file-card">
                <div class="file-icon">${this.getFileIcon(d.file_type)}</div>
                <div class="file-info">
                  <div class="file-name">${d.name}</div>
                  ${d.description ? `<div class="file-desc">${d.description}</div>` : ''}
                  <div class="file-meta">${new Date(d.created_at).toLocaleDateString('ru-RU')} · ${d.uploaded_by_name || ''}</div>
                </div>
                <div class="file-actions">
                  <a href="${d.file_path}" target="_blank" class="btn btn-secondary btn-sm">Открыть</a>
                  ${isAdmin ? `<button class="btn btn-icon btn-sm btn-danger" onclick="ClientProfilePage.deleteDocument(${d.id})">✕</button>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        `}
      `;
    } catch (err) { container.innerHTML = `<div class="empty-state"><div class="empty-state-text">${err.message}</div></div>`; }
  },

  // =================== МОДАЛКИ ===================

  // Редактирование клиента
  async editClient() {
    const c = this.client;
    const statusOptions = this.workStatuses
      .filter(s => s.is_active !== false)
      .map(s => `<option value="${s.id}" ${c.status_id == s.id ? 'selected' : ''}>${s.name}</option>`)
      .join('');

    // Загрузить уровни цен
    let pricingLevels = [];
    try {
      const res = await API.get('/pricing-levels');
      pricingLevels = res.data || [];
    } catch {}
    const pricingOptions = pricingLevels
      .map(l => `<option value="${l.id}" ${c.pricing_level_id == l.id ? 'selected' : ''}>${l.name} (${l.markup_pct > 0 ? '+' : ''}${l.markup_pct}%)</option>`)
      .join('');

    Modal.open({
      title: 'Редактировать клиента',
      body: `
        <div class="form-group"><label>Название *</label><input type="text" class="form-control" id="prof-name" value="${c.name}" required></div>
        <div class="form-row">
          <div class="form-group"><label>Телефон</label><input type="text" class="form-control" id="prof-phone" value="${c.phone || ''}"></div>
          <div class="form-group"><label>Email</label><input type="email" class="form-control" id="prof-email" value="${c.email || ''}"></div>
        </div>
        <div class="form-group"><label>Адрес</label><input type="text" class="form-control" id="prof-address" value="${c.address || ''}"></div>
        <div class="form-group">
          <label>Статус</label>
          <select class="form-control" id="prof-status">
            <option value="">Не задан</option>
            ${statusOptions}
          </select>
        </div>
        <div class="form-group">
          <label>💰 Уровень цен *</label>
          <select class="form-control" id="prof-pricing-level" required>
            <option value="">Выберите уровень</option>
            ${pricingOptions}
          </select>
        </div>
        <div class="form-group"><label>Примечание</label><textarea class="form-control" id="prof-notes" rows="2">${c.notes || ''}</textarea></div>

        <div style="margin-top:16px;padding:14px;background:var(--bg-main);border-radius:10px;border:1px solid var(--border)">
          <div style="font-weight:600;font-size:0.9rem;margin-bottom:10px;color:var(--text-secondary)">📦 Данные доставки</div>
          <div class="form-group"><label>Адрес доставки / терминал ТК</label><input type="text" class="form-control" id="prof-delivery-address" value="${c.delivery_address || ''}" placeholder="Адрес доставки или терминал транспортной компании"></div>
          <div class="form-row">
            <div class="form-group"><label>ФИО контактного лица</label><input type="text" class="form-control" id="prof-delivery-name" value="${c.delivery_contact_name || ''}" placeholder="Иванов Иван Иванович"></div>
            <div class="form-group"><label>Контактный телефон</label><input type="text" class="form-control" id="prof-delivery-phone" value="${c.delivery_contact_phone || ''}" placeholder="+7 (999) 123-45-67"></div>
          </div>
        </div>

        <div style="margin-top:16px;padding:14px;background:var(--bg-main);border-radius:10px;border:1px solid var(--border)">
          <div style="font-weight:600;font-size:0.9rem;margin-bottom:10px;color:var(--text-secondary)">🏦 Реквизиты</div>
          <div class="form-row">
            <div class="form-group"><label>ИНН</label><input type="text" class="form-control" id="prof-inn" value="${c.inn || ''}" placeholder="1234567890"></div>
            <div class="form-group"><label>КПП</label><input type="text" class="form-control" id="prof-kpp" value="${c.kpp || ''}" placeholder="123456789"></div>
          </div>
          <div class="form-group"><label>ОГРНИП</label><input type="text" class="form-control" id="prof-ogrnip" value="${c.ogrnip || ''}" placeholder="ОГРНИП (15 цифр)"></div>
          <div class="form-group"><label>Юридический адрес</label><input type="text" class="form-control" id="prof-legal-address" value="${c.legal_address || ''}" placeholder="Юридический адрес организации"></div>
          <div class="form-group"><label>Банковские реквизиты</label><input type="text" class="form-control" id="prof-bank-details" value="${c.bank_details || ''}" placeholder="Р/С, Банк, БИК, К/С"></div>
        </div>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Отмена</button>
        <button class="btn btn-primary" onclick="ClientProfilePage.saveClient()">Сохранить</button>
      `,
    });
  },

  async saveClient() {
    const data = {
      name: document.getElementById('prof-name').value.trim(),
      phone: document.getElementById('prof-phone').value.trim(),
      email: document.getElementById('prof-email').value.trim(),
      address: document.getElementById('prof-address').value.trim(),
      notes: document.getElementById('prof-notes').value.trim(),
      status_id: document.getElementById('prof-status').value || null,
      pricing_level_id: document.getElementById('prof-pricing-level').value || null,
      avatar_path: this.client.avatar_path || null,
      delivery_address: document.getElementById('prof-delivery-address').value.trim(),
      delivery_contact_name: document.getElementById('prof-delivery-name').value.trim(),
      delivery_contact_phone: document.getElementById('prof-delivery-phone').value.trim(),
      inn: document.getElementById('prof-inn').value.trim(),
      kpp: document.getElementById('prof-kpp').value.trim(),
      ogrnip: document.getElementById('prof-ogrnip').value.trim(),
      legal_address: document.getElementById('prof-legal-address').value.trim(),
      bank_details: document.getElementById('prof-bank-details').value.trim(),
    };
    if (!data.name) { Toast.error('Укажите название'); return; }
    try {
      await API.put(`/clients/${this.clientId}`, data);
      Toast.success('Клиент обновлён');
      Modal.close();
      this.render(this.clientId);
    } catch (err) { Toast.error(err.message); }
  },

  // Таймлайн — добавить/редактировать событие
  async openTimelineModal(eventId = null) {
    let event = null;
    if (eventId) {
      try {
        const res = await API.get(`/clients/${this.clientId}/timeline`);
        event = res.data.find(e => e.id === eventId);
      } catch (e) {}
    }
    const isEdit = !!event;

    const typeOptions = Object.entries(this.eventTypes).map(([key, val]) =>
      `<option value="${key}" ${isEdit && event.event_type === key ? 'selected' : ''}>${val.icon} ${val.label}</option>`
    ).join('');

    Modal.open({
      title: isEdit ? 'Редактировать событие' : 'Новое событие',
      body: `
        <div class="form-row">
          <div class="form-group">
            <label>Тип события</label>
            <select class="form-control" id="tl-type">${typeOptions}</select>
          </div>
          <div class="form-group">
            <label>Дата</label>
            <input type="date" class="form-control" id="tl-date" value="${isEdit ? new Date(event.event_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]}">
          </div>
        </div>
        <div class="form-group"><label>Заголовок *</label><input type="text" class="form-control" id="tl-title" value="${isEdit ? event.title : ''}" required></div>
        <div class="form-group"><label>Описание</label><textarea class="form-control" id="tl-desc" rows="3">${isEdit ? (event.description || '') : ''}</textarea></div>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Отмена</button>
        <button class="btn btn-primary" onclick="ClientProfilePage.saveTimelineEvent(${isEdit ? event.id : 'null'})">${isEdit ? 'Сохранить' : 'Добавить'}</button>
      `,
    });
  },

  async saveTimelineEvent(eventId) {
    const data = {
      event_type: document.getElementById('tl-type').value,
      title: document.getElementById('tl-title').value.trim(),
      description: document.getElementById('tl-desc').value.trim(),
      event_date: document.getElementById('tl-date').value,
    };
    if (!data.title) { Toast.error('Укажите заголовок'); return; }
    try {
      if (eventId) { await API.put(`/clients/${this.clientId}/timeline/${eventId}`, data); }
      else { await API.post(`/clients/${this.clientId}/timeline`, data); }
      Toast.success(eventId ? 'Событие обновлено' : 'Событие добавлено');
      Modal.close();
      this.switchTab('timeline');
    } catch (err) { Toast.error(err.message); }
  },

  async deleteTimelineEvent(eventId) {
    if (!confirm('Удалить событие?')) return;
    try {
      await API.del(`/clients/${this.clientId}/timeline/${eventId}`);
      Toast.success('Удалено');
      this.switchTab('timeline');
    } catch (err) { Toast.error(err.message); }
  },

  // Загрузка чертежа
  uploadDrawing() {
    this._uploadFile('Загрузить чертёж', 'drawing', async (fileRes, name, desc) => {
      await API.post(`/clients/${this.clientId}/documents/drawings`, {
        name, file_path: fileRes.path, file_type: fileRes.file_type || fileRes.path.split('.').pop(), description: desc,
      });
      Toast.success('Чертёж загружен');
      Modal.close();
      this.switchTab('drawings');
    });
  },

  // Загрузка документа
  uploadDocument() {
    this._uploadFile('Загрузить документ', 'drawing', async (fileRes, name, desc) => {
      await API.post(`/clients/${this.clientId}/documents`, {
        name, file_path: fileRes.path, file_type: fileRes.file_type || fileRes.path.split('.').pop(), description: desc,
      });
      Toast.success('Документ загружен');
      Modal.close();
      this.switchTab('documents');
    });
  },

  _uploadFile(title, uploadType, onSave) {
    Modal.open({
      title,
      body: `
        <div class="form-group"><label>Название *</label><input type="text" class="form-control" id="upload-name"></div>
        <div class="form-group"><label>Описание</label><input type="text" class="form-control" id="upload-desc"></div>
        <div class="form-group">
          <label>Файл *</label>
          <div class="upload-zone" id="upload-file-zone" style="padding:20px;text-align:center">
            <div id="upload-file-status" style="color:var(--text-muted)">📎 Нажмите для выбора файла</div>
            <input type="file" id="upload-file-input" style="display:none">
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Отмена</button>
        <button class="btn btn-primary" id="upload-save-btn" disabled>Загрузить</button>
      `,
    });

    let uploadedFile = null;
    const zone = document.getElementById('upload-file-zone');
    const input = document.getElementById('upload-file-input');
    const status = document.getElementById('upload-file-status');

    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', async (e) => {
      if (!e.target.files[0]) return;
      status.textContent = '⏳ Загрузка...';
      try {
        const formData = new FormData();
        formData.append('file', e.target.files[0]);
        uploadedFile = await API.upload(`/upload/${uploadType}`, formData);
        status.textContent = `✅ ${uploadedFile.originalname}`;
        document.getElementById('upload-save-btn').disabled = false;
        if (!document.getElementById('upload-name').value) {
          document.getElementById('upload-name').value = e.target.files[0].name.replace(/\.[^.]+$/, '');
        }
      } catch (err) {
        status.textContent = '❌ Ошибка загрузки';
        Toast.error(err.message);
      }
    });

    document.getElementById('upload-save-btn').addEventListener('click', async () => {
      const name = document.getElementById('upload-name').value.trim();
      if (!name) { Toast.error('Укажите название'); return; }
      if (!uploadedFile) { Toast.error('Выберите файл'); return; }
      try { await onSave(uploadedFile, name, document.getElementById('upload-desc').value.trim()); }
      catch (err) { Toast.error(err.message); }
    });
  },

  async deleteDrawing(id) {
    if (!confirm('Удалить чертёж?')) return;
    try { await API.del(`/clients/${this.clientId}/documents/drawings/${id}`); Toast.success('Удалено'); this.switchTab('drawings'); }
    catch (err) { Toast.error(err.message); }
  },

  async deleteDocument(id) {
    if (!confirm('Удалить документ?')) return;
    try { await API.del(`/clients/${this.clientId}/documents/${id}`); Toast.success('Удалено'); this.switchTab('documents'); }
    catch (err) { Toast.error(err.message); }
  },

  getFileIcon(type) {
    const icons = { pdf: '📄', jpg: '🖼️', jpeg: '🖼️', png: '🖼️', webp: '🖼️', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊' };
    return icons[type] || '📁';
  },
};
