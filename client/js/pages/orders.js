/* Orders Page — расширенная версия */
const OrdersPage = {
  filters: { status: '', client_id: '', search: '', page: 1, groupBy: '' },
  clients: [],
  principals: [],
  components: [],
  searchTimeout: null,

  async render() {
    const content = document.getElementById('content-area');
    const canEdit = API.can('orders', 'edit');

    // Загрузить справочники
    const [clientsRes, principalsRes, componentsRes] = await Promise.all([
      API.get('/clients?limit=1000'),
      API.get('/principals'),
      API.get('/components?active=true'),
    ]);
    this.clients = clientsRes.data;
    this.principals = principalsRes.data;
    this.components = componentsRes.data;

    content.innerHTML = `
      <div class="toolbar">
        <div class="search-input">
          <input type="text" id="orders-search" placeholder="Поиск по номеру или клиенту..." value="${this.filters.search}">
        </div>
        <div class="filter-group">
          <select class="filter-select" id="orders-status-filter">
            <option value="">Все статусы</option>
            <option value="new" ${this.filters.status === 'new' ? 'selected' : ''}>Новый</option>
            <option value="in_progress" ${this.filters.status === 'in_progress' ? 'selected' : ''}>В работе</option>
            <option value="paid" ${this.filters.status === 'paid' ? 'selected' : ''}>Оплачен</option>
            <option value="completed" ${this.filters.status === 'completed' ? 'selected' : ''}>Выполнен</option>
            <option value="cancelled" ${this.filters.status === 'cancelled' ? 'selected' : ''}>Отменён</option>
          </select>
          <select class="filter-select" id="orders-client-filter">
            <option value="">Все клиенты</option>
            ${this.clients.map(c => `<option value="${c.id}" ${this.filters.client_id == c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
          </select>
          <select class="filter-select" id="orders-group-filter">
            <option value="">Без группировки</option>
            <option value="client" ${this.filters.groupBy === 'client' ? 'selected' : ''}>По клиенту</option>
          </select>
        </div>
        ${canEdit ? '<button class="btn btn-primary" onclick="OrdersPage.openCreateModal()">+ Новый заказ</button>' : ''}
      </div>
      <div id="orders-table-container">${Table.loading()}</div>
    `;

    document.getElementById('orders-search').addEventListener('input', (e) => {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => {
        this.filters.search = e.target.value;
        this.filters.page = 1;
        this.loadOrders();
      }, 300);
    });

    document.getElementById('orders-status-filter').addEventListener('change', (e) => {
      this.filters.status = e.target.value;
      this.filters.page = 1;
      this.loadOrders();
    });

    document.getElementById('orders-client-filter').addEventListener('change', (e) => {
      this.filters.client_id = e.target.value;
      this.filters.page = 1;
      this.loadOrders();
    });

    document.getElementById('orders-group-filter').addEventListener('change', (e) => {
      this.filters.groupBy = e.target.value;
      this.loadOrders();
    });

    this.loadOrders();
  },

  async loadOrders() {
    const container = document.getElementById('orders-table-container');
    const canEdit = API.can('orders', 'edit');
    const canDelete = API.can('orders', 'delete');

    try {
      const params = new URLSearchParams();
      if (this.filters.status) params.set('status', this.filters.status);
      if (this.filters.client_id) params.set('client_id', this.filters.client_id);
      if (this.filters.search) params.set('search', this.filters.search);
      params.set('page', this.filters.page);
      params.set('limit', 200);

      const res = await API.get('/orders?' + params.toString());
      const orders = res.data;

      if (orders.length === 0) {
        container.innerHTML = Table.emptyState('Нет заказов');
        return;
      }

      // Группировка
      if (this.filters.groupBy === 'client') {
        container.innerHTML = this._renderGroupedByClient(orders, canEdit);
      } else {
        container.innerHTML = this._renderFlatTable(orders, res.total, canEdit, canDelete);
      }
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-text">${err.message}</div></div>`;
    }
  },

  _renderFlatTable(orders, total, canEdit, canDelete) {
    return `
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>№ заказа</th>
              <th>Дата</th>
              <th>Клиент</th>
              <th>Принципал</th>
              <th>Статус</th>
              <th class="text-right">Сумма</th>
              <th class="text-right">в т.ч. комиссия</th>
              <th class="text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            ${orders.map(o => `
              <tr style="cursor:pointer" onclick="OrdersPage.viewOrder(${o.id})" title="Нажмите для просмотра заказа">
                <td class="font-mono">${o.order_number}${o.invoice_number || o.invoice_path ? ' <span title="Счёт" style="font-size:0.75rem">📄</span>' : ''}${o.tracking_number ? ' <span title="Трек" style="font-size:0.75rem">🚚</span>' : ''}</td>
                <td>${Table.formatDate(o.order_date)}</td>
                <td><a href="#" onclick="event.stopPropagation();App.navigateTo('client-profile',${o.client_id});return false" class="client-link">${o.client_name || '—'}</a></td>
                <td>${o.principal_name || '—'}</td>
                <td>${Table.statusBadge(o.status)}</td>
                <td class="text-right" style="font-weight:600">${Table.formatMoney(o.total)}</td>
                <td class="text-right" style="color:var(--text-secondary);font-size:0.85rem">${Table.formatMoney(o.commission_amount)}</td>
                <td class="text-right" onclick="event.stopPropagation()">
                  <div class="table-actions" style="justify-content:flex-end">
                    ${Table.actionBtn(Table.viewIcon, 'Просмотр', `OrdersPage.viewOrder(${o.id})`)}
                    ${canEdit ? Table.actionBtn(Table.editIcon, 'Редактировать', `OrdersPage.openEditModal(${o.id})`) : ''}
                    ${canDelete ? Table.actionBtn(Table.deleteIcon, 'Удалить', `OrdersPage.deleteOrder(${o.id})`, 'btn-danger') : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span class="pagination-info">Показано ${orders.length} из ${total}</span>
        <div class="pagination-buttons">
          <button class="pagination-btn" ${this.filters.page <= 1 ? 'disabled' : ''} onclick="OrdersPage.changePage(${this.filters.page - 1})">← Назад</button>
          <button class="pagination-btn active">${this.filters.page}</button>
          <button class="pagination-btn" ${orders.length < 200 ? 'disabled' : ''} onclick="OrdersPage.changePage(${this.filters.page + 1})">Вперёд →</button>
        </div>
      </div>
    `;
  },

  _renderGroupedByClient(orders, isAdmin) {
    // Группируем по клиенту
    const groups = {};
    orders.forEach(o => {
      const key = o.client_id || 0;
      if (!groups[key]) groups[key] = { name: o.client_name || 'Без клиента', client_id: o.client_id, orders: [], totalAmount: 0, totalCommission: 0 };
      groups[key].orders.push(o);
      groups[key].totalAmount += parseFloat(o.total) || 0;
      groups[key].totalCommission += parseFloat(o.commission_amount) || 0;
    });

    const sorted = Object.values(groups).sort((a, b) => b.totalAmount - a.totalAmount);

    return sorted.map(group => `
      <div class="card mb-2">
        <div class="flex items-center justify-between mb-1">
          <div>
            <a href="#" onclick="App.navigateTo('client-profile',${group.client_id});return false" class="client-link" style="font-size:1.1rem"><strong>${group.name}</strong></a>
            <span style="color:var(--text-muted);font-size:0.85rem;margin-left:8px">${group.orders.length} заказ(ов)</span>
          </div>
          <div style="text-align:right">
            <div style="font-size:0.8rem;color:var(--text-muted)">Итого</div>
            <div style="font-weight:700;color:var(--accent-teal)">${Table.formatMoney(group.totalAmount)}</div>
          </div>
        </div>
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>№ заказа</th>
                <th>Дата</th>
                <th>Статус</th>
                <th class="text-right">Сумма</th>
                <th class="text-right">в т.ч. комиссия</th>
                <th class="text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              ${group.orders.map(o => `
                <tr style="cursor:pointer" onclick="OrdersPage.viewOrder(${o.id})" title="Нажмите для просмотра заказа">
                  <td class="font-mono">${o.order_number}</td>
                  <td>${Table.formatDate(o.order_date)}</td>
                  <td>${Table.statusBadge(o.status)}</td>
                  <td class="text-right" style="font-weight:600">${Table.formatMoney(o.total)}</td>
                  <td class="text-right" style="color:var(--text-secondary);font-size:0.85rem">${Table.formatMoney(o.commission_amount)}</td>
                  <td class="text-right" onclick="event.stopPropagation()">
                    <div class="table-actions" style="justify-content:flex-end">
                      ${Table.actionBtn(Table.viewIcon, 'Просмотр', `OrdersPage.viewOrder(${o.id})`)}
                      ${isAdmin ? Table.actionBtn(Table.editIcon, 'Ред.', `OrdersPage.openEditModal(${o.id})`) : ''}
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `).join('');
  },

  changePage(page) {
    this.filters.page = page;
    this.loadOrders();
  },

  async viewOrder(id) {
    try {
      const order = await API.get(`/orders/${id}`);

      // Блок счёта/оплаты/трека
      const invoiceInfo = (order.invoice_number || order.invoice_path || order.payment_date || order.tracking_number) ? `
        <div class="grid-2 mb-2" style="margin-top:12px">
          ${order.invoice_number ? `<div><strong>📄 Счёт:</strong> ${order.invoice_number} ${order.invoice_path ? `<a href="${order.invoice_path}" target="_blank" style="color:var(--accent-teal);font-size:0.85rem">Открыть ↗</a>` : ''}</div>` : ''}
          ${!order.invoice_number && order.invoice_path ? `<div><strong>📄 Файл счёта:</strong> <a href="${order.invoice_path}" target="_blank" style="color:var(--accent-teal)">Открыть ↗</a></div>` : ''}
          ${order.payment_date ? `<div><strong>💳 Оплата:</strong> <span style="color:var(--accent-green,#22c55e);font-weight:600">${Table.formatDate(order.payment_date)}</span></div>` : ''}
          ${order.tracking_number ? `<div><strong>🚚 Трек:</strong> <span style="font-family:var(--font-mono,monospace)">${order.tracking_number}</span></div>` : ''}
        </div>
      ` : '';

      Modal.open({
        title: `Заказ ${order.order_number}`,
        wide: true,
        body: `
          <div class="grid-2 mb-2">
            <div><strong>Клиент:</strong> ${order.client_name || '—'}</div>
            <div><strong>Принципал:</strong> ${order.principal_name || '—'}</div>
            <div><strong>Дата:</strong> ${Table.formatDate(order.order_date)}</div>
            <div><strong>Статус:</strong> ${Table.statusBadge(order.status)}</div>
          </div>
          ${invoiceInfo}
          ${order.comment ? `<div class="mb-2"><strong>Комментарий:</strong> ${order.comment}</div>` : ''}
          <h4 class="mb-1" style="color:var(--text-secondary)">Позиции заказа</h4>
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>Артикул</th><th>Название</th><th class="text-right">Цена</th><th class="text-right">Кол-во</th><th class="text-right">Сумма</th></tr></thead>
              <tbody>
                ${(order.items || []).map(item => `
                  <tr>
                    <td><span class="font-mono" style="color:var(--accent-teal);font-size:0.82rem">${item.article || '—'}</span></td>
                    <td title="${(item.product_name || '').replace(/"/g, '&quot;')}"><span style="display:inline-block;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle">${item.product_name}${item.metadata?.type === 'calculator_drawing' ? ' 📐' : (item.is_drawing ? ' 📎' : '')}</span></td>
                    <td class="text-right">${Table.formatMoney(item.unit_price)}</td>
                    <td class="text-right">${item.quantity}</td>
                    <td class="text-right">${Table.formatMoney(item.line_total)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${Table.renderDrawingMetadata(order.items || [])}
          <div class="mt-2" style="text-align:right">
            <div style="font-size:1.15rem">Итого: <strong style="color:var(--accent-teal)">${Table.formatMoney(order.total)}</strong></div>
            <div style="font-size:0.88rem;color:var(--text-muted);margin-top:4px">в т.ч. комиссия агента (${order.commission_pct}%): ${Table.formatMoney(order.commission_amount)}</div>
          </div>
        `,
        footer: '<button class="btn btn-secondary" onclick="Modal.close()">Закрыть</button>',
      });
    } catch (err) {
      Toast.error(err.message);
    }
  },

  openCreateModal(prefillItems) {
    this._openOrderModal(null, prefillItems);
  },

  async openEditModal(id) {
    try {
      const order = await API.get(`/orders/${id}`);
      this._openOrderModal(order);
    } catch (err) {
      Toast.error(err.message);
    }
  },

  _clientDrawings: [],

  _openOrderModal(order, prefillItems) {
    const isEdit = !!order;
    const title = isEdit ? `Редактировать ${order.order_number}` : 'Новый заказ';
    const items = isEdit && order.items ? order.items : (prefillItems || []);

    // Принципал по умолчанию — Атланта (ищем по имени)
    const defaultPrincipal = this.principals.find(p => p.name.toLowerCase().includes('атланта'));
    const defaultPrincipalId = isEdit ? order.principal_id : (defaultPrincipal ? defaultPrincipal.id : '');

    this._clientDrawings = [];

    Modal.open({
      title,
      wide: true,
      body: `
        <form id="order-form">
          <div class="form-row">
            <div class="form-group">
              <label>Клиент *</label>
              <select class="form-control" id="order-client" required>
                <option value="">Выберите клиента</option>
                ${this.clients.map(c => `<option value="${c.id}" data-markup="${c.pricing_markup_pct || 0}" data-level="${c.pricing_level_name || ''}" ${isEdit && order.client_id == c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
              </select>
              <div id="order-client-level" style="margin-top:4px;font-size:0.78rem"></div>
            </div>
            <div class="form-group">
              <label>Принципал *</label>
              <select class="form-control" id="order-principal" required>
                <option value="">Выберите принципала</option>
                ${this.principals.map(p => `<option value="${p.id}" data-comm="${p.agent_commission_pct}" ${p.id == defaultPrincipalId ? 'selected' : ''}>${p.name} (${p.agent_commission_pct}%)</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Дата заказа</label>
              <input type="date" class="form-control" id="order-date" value="${isEdit ? order.order_date.split('T')[0] : new Date().toISOString().split('T')[0]}">
            </div>
            <div class="form-group">
              <label>Статус</label>
              <select class="form-control" id="order-status">
                <option value="new" ${isEdit && order.status === 'new' ? 'selected' : ''}>Новый</option>
                <option value="in_progress" ${isEdit && order.status === 'in_progress' ? 'selected' : ''}>В работе</option>
                <option value="paid" ${isEdit && order.status === 'paid' ? 'selected' : ''}>Оплачен</option>
                <option value="completed" ${isEdit && order.status === 'completed' ? 'selected' : ''}>Выполнен</option>
                <option value="cancelled" ${isEdit && order.status === 'cancelled' ? 'selected' : ''}>Отменён</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Комментарий</label>
            <textarea class="form-control" id="order-comment" rows="2">${isEdit ? (order.comment || '') : ''}</textarea>
          </div>

          <div style="margin-top:12px;padding:14px;background:var(--bg-main);border-radius:10px;border:1px solid var(--border)">
            <div style="font-weight:600;font-size:0.9rem;margin-bottom:10px;color:var(--text-secondary)">📄 Счёт, оплата и доставка</div>
            <div class="form-row">
              <div class="form-group">
                <label>Номер счёта</label>
                <input type="text" class="form-control" id="order-invoice-number" value="${isEdit ? (order.invoice_number || '') : ''}" placeholder="СЧ-001">
              </div>
              <div class="form-group">
                <label>Дата оплаты</label>
                <input type="date" class="form-control" id="order-payment-date" value="${isEdit && order.payment_date ? order.payment_date.split('T')[0] : ''}">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Трек-номер</label>
                <input type="text" class="form-control" id="order-tracking-number" value="${isEdit ? (order.tracking_number || '') : ''}" placeholder="Номер отслеживания">
              </div>
              <div class="form-group">
                <label>Файл счёта</label>
                <div style="display:flex;gap:8px;align-items:center">
                  <input type="hidden" id="order-invoice-path" value="${isEdit ? (order.invoice_path || '') : ''}">
                  <button type="button" class="btn btn-secondary btn-sm" id="order-invoice-upload-btn" onclick="OrdersPage._uploadInvoice()">
                    ${isEdit && order.invoice_path ? '✅ Загружен · Заменить' : '📎 Прикрепить'}
                  </button>
                  ${isEdit && order.invoice_path ? `<a href="${order.invoice_path}" target="_blank" style="font-size:0.8rem;color:var(--accent-teal)">Открыть ↗</a>` : ''}
                </div>
              </div>
            </div>
          </div>

          <h4 class="mb-1 mt-2" style="color:var(--text-secondary)">Позиции заказа</h4>
          <div id="order-items-list">
            ${items.map((item, i) => this._renderItemCard(item, i)).join('')}
          </div>

          <div class="flex gap-1 mt-1" style="flex-wrap:wrap">
            <button type="button" class="btn btn-primary btn-sm" onclick="OrdersPage.openComponentCatalog()">📦 Из каталога</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="OrdersPage.addCustomItem()">✏️ Произвольная позиция</button>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-add-drawing" style="display:none" onclick="OrdersPage.openDrawingPicker()">📎 Добавить чертёж</button>
          </div>

          <div class="mt-2" id="order-totals" style="text-align:right; font-size:0.95rem;"></div>
        </form>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Отмена</button>
        <button class="btn btn-primary" onclick="OrdersPage.saveOrder(${isEdit ? order.id : 'null'})">${isEdit ? 'Сохранить' : 'Создать'}</button>
      `,
    });

    // Bind events
    document.getElementById('order-principal').addEventListener('change', () => this.recalcTotals());
    document.getElementById('order-client').addEventListener('change', () => this._onClientChange());

    // Если клиент уже выбран (редактирование), загрузить чертежи
    if (isEdit && order.client_id) {
      this._onClientChange();
    }

    this.recalcTotals();
  },

  async _onClientChange() {
    const clientSelect = document.getElementById('order-client');
    const clientId = clientSelect.value;
    const drawingBtn = document.getElementById('btn-add-drawing');
    const levelEl = document.getElementById('order-client-level');

    if (!clientId) {
      this._clientDrawings = [];
      if (drawingBtn) drawingBtn.style.display = 'none';
      if (levelEl) levelEl.innerHTML = '';
      this.recalcTotals();
      return;
    }

    // Показать бейдж уровня цен
    const opt = clientSelect.selectedOptions[0];
    const levelName = opt?.dataset?.level || '';
    const markupPct = parseFloat(opt?.dataset?.markup) || 0;
    if (levelEl) {
      if (levelName) {
        const color = markupPct > 0 ? 'var(--accent-teal)' : markupPct < 0 ? 'var(--accent-blue)' : 'var(--text-muted)';
        levelEl.innerHTML = `<span style="padding:2px 10px;border-radius:12px;background:${color}15;color:${color};border:1px solid ${color}40;font-weight:600">💰 ${levelName} (${markupPct > 0 ? '+' : ''}${markupPct}%)</span>`;
      } else {
        levelEl.innerHTML = '<span style="color:var(--accent-red);font-weight:600">⚠️ Уровень цен не задан</span>';
      }
    }

    // Показать кнопку добавления чертежа если клиент выбран
    if (drawingBtn) drawingBtn.style.display = clientId ? '' : 'none';

    this.recalcTotals();
  },

  async openDrawingPicker() {
    const clientId = document.getElementById('order-client')?.value;
    try {
      let url = '/drawings?limit=500';
      if (clientId) url += `&client_id=${clientId}`;
      const res = await API.get(url);
      const drawings = res.data || [];
      if (drawings.length === 0) {
        Toast.info('Нет доступных чертежей' + (clientId ? ' для выбранного клиента' : ''));
        return;
      }
      this._loadedDrawings = drawings;

      const overlay = document.createElement('div');
      overlay.id = 'drawing-picker-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;padding:20px;';
      overlay.innerHTML = `
        <div style="background:var(--bg-card);border-radius:16px;padding:24px;width:500px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.4)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h3 style="margin:0;color:var(--text-primary)">Выберите чертёж</h3>
            <button onclick="document.getElementById('drawing-picker-overlay').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--text-muted);padding:4px 8px">✕</button>
          </div>
          <div style="overflow-y:auto;flex:1">
            ${drawings.map(d => `
              <div style="display:flex;align-items:center;gap:12px;padding:10px;border-bottom:1px solid var(--border);cursor:pointer;border-radius:8px"
                   onmouseover="this.style.background='var(--bg-main)'" onmouseout="this.style.background=''"
                   onclick="OrdersPage.addDrawingItem(${d.id})">
                <div style="width:48px;height:48px;background:var(--bg-main);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.2rem">📎</div>
                <div style="flex:1;min-width:0">
                  <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.title || d.name || 'Чертёж #' + d.id}</div>
                  <div style="font-size:0.8rem;color:var(--text-muted)">${d.client_name || ''} · <strong>${Table.formatMoneyRaw(d.total_cost || 0)}</strong></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
    } catch (err) {
      Toast.error(err.message);
    }
  },

  addDrawingItem(drawingId) {
    const drawing = (this._loadedDrawings || []).find(d => d.id === drawingId);
    if (!drawing) return;

    const overlay = document.getElementById('drawing-picker-overlay');
    if (overlay) overlay.remove();

    const container = document.getElementById('order-items-list');
    if (!container) return;
    const idx = container.querySelectorAll('[data-item-row]').length;
    const drawingName = drawing.title || drawing.name || `Чертёж #${drawingId}`;
    container.insertAdjacentHTML('beforeend', this._renderItemCard({
      product_name: `Чертёж: ${drawingName}`,
      unit_price: parseFloat(drawing.total_cost) || 0,
      quantity: 1,
      is_drawing: true,
      drawing_id: drawing.id,
    }, idx));
    this.recalcTotals();
    Toast.success(`Чертёж «${drawingName}» добавлен`);
  },

  _renderItemCard(item, index) {
    const idx = index !== undefined ? index : this._itemIndex++;
    const markupPct = item.markup_pct || 0;
    const isDrawing = item.is_drawing || false;
    const isCustom = item._custom || (!item.product_id && !isDrawing && item.product_name);
    const displayName = item.product_name || (isDrawing ? 'Чертёж' : 'Позиция');
    const icon = isDrawing ? '📎' : (isCustom ? '✏️' : '📦');
    const article = item.article || '';
    const price = item.unit_price || 0;
    const qty = item.quantity || 1;
    const sw = 'display:flex;align-items:stretch;border-radius:6px;border:1px solid var(--border);overflow:hidden;height:32px';
    const sb = 'width:26px;border:none;background:var(--bg-tertiary);color:var(--text-secondary);cursor:pointer;font-size:0.95rem;font-weight:700;display:flex;align-items:center;justify-content:center;transition:all 0.15s;flex-shrink:0';
    const hi = "this.style.background='var(--accent-teal)';this.style.color='#fff'";
    const ho = "this.style.background='var(--bg-tertiary)';this.style.color='var(--text-secondary)'";
    const si = 'flex:1;text-align:center;font-size:0.85rem;font-weight:600;border:none;border-left:1px solid var(--border);border-right:1px solid var(--border);border-radius:0;padding:0;-moz-appearance:textfield;min-width:0';
    return `
      <div data-item-row="${idx}" style="margin-bottom:6px;padding:8px 12px;background:var(--bg-main);border-radius:10px;border:1px solid var(--border);transition:border-color 0.15s" onmouseenter="this.style.borderColor='var(--accent-teal)'" onmouseleave="this.style.borderColor='var(--border)'">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:1rem;flex-shrink:0">${icon}</span>
          ${isCustom ? `<input type="text" class="form-control item-name" value="${displayName}" placeholder="Название позиции" style="flex:1;font-weight:600;font-size:0.82rem;min-width:80px;padding:4px 8px">` :
            `<div style="flex:1;min-width:80px;overflow:hidden">
              <div style="display:flex;align-items:baseline;gap:6px">
                ${article ? `<span class="font-mono" style="font-weight:700;font-size:0.82rem;color:var(--accent-teal);white-space:nowrap">${article}</span>` : ''}
                <span style="font-size:0.78rem;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${displayName.replace(/"/g, '&quot;')}">${displayName}</span>
                ${item.product_id && item.doc_count > 0 ? `<a href="/api/components/${item.product_id}/documents/download-all?token=${API.getToken()}" title="Скачать документы (${item.doc_count})" style="text-decoration:none;cursor:pointer;flex-shrink:0">📎<sup style="font-size:0.6rem;color:var(--accent-teal)">${item.doc_count}</sup></a>` : ''}
              </div>
            </div>
            <input type="hidden" class="item-name" value="${displayName}">`}
          <div style="flex-shrink:0;width:140px">
            <div style="font-size:0.6rem;color:var(--text-muted);margin-bottom:2px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px">Цена ₽</div>
            <div style="${sw}">
              <button type="button" onclick="var inp=this.nextElementSibling;inp.value=Math.max(0,(parseFloat(inp.value||0)-10)).toFixed(2);OrdersPage.recalcTotals()" style="${sb}" onmouseenter="${hi}" onmouseleave="${ho}">−</button>
              <input type="number" step="0.01" class="form-control item-price" value="${price}" min="0" style="${si}" onchange="OrdersPage.recalcTotals()">
              <button type="button" onclick="var inp=this.previousElementSibling;inp.value=(parseFloat(inp.value||0)+10).toFixed(2);OrdersPage.recalcTotals()" style="${sb}" onmouseenter="${hi}" onmouseleave="${ho}">+</button>
            </div>
          </div>
          <div style="flex-shrink:0;width:95px">
            <div style="font-size:0.6rem;color:var(--text-muted);margin-bottom:2px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px">Кол-во</div>
            <div style="${sw}">
              <button type="button" onclick="var inp=this.nextElementSibling;inp.value=Math.max(1,parseInt(inp.value||1)-1);OrdersPage.recalcTotals()" style="${sb}" onmouseenter="${hi}" onmouseleave="${ho}">−</button>
              <input type="number" class="form-control item-qty" value="${qty}" min="1" step="1" style="${si};font-weight:700" onchange="OrdersPage.recalcTotals()">
              <button type="button" onclick="var inp=this.previousElementSibling;inp.value=parseInt(inp.value||1)+1;OrdersPage.recalcTotals()" style="${sb}" onmouseenter="${hi}" onmouseleave="${ho}">+</button>
            </div>
          </div>
          <div style="flex-shrink:0;width:95px">
            <div style="font-size:0.6rem;color:var(--text-muted);margin-bottom:2px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px">Нац. %</div>
            <div style="${sw}">
              <button type="button" onclick="var inp=this.nextElementSibling;inp.value=parseInt(inp.value||0)-1;OrdersPage.recalcTotals()" style="${sb}" onmouseenter="${hi}" onmouseleave="${ho}">−</button>
              <input type="number" class="form-control item-markup-pct" value="${markupPct}" step="0.5" style="${si}" onchange="OrdersPage.recalcTotals()" placeholder="±%">
              <button type="button" onclick="var inp=this.previousElementSibling;inp.value=parseInt(inp.value||0)+1;OrdersPage.recalcTotals()" style="${sb}" onmouseenter="${hi}" onmouseleave="${ho}">+</button>
            </div>
          </div>
          <div style="flex-shrink:0;width:90px;text-align:right">
            <div style="font-size:0.6rem;color:var(--text-muted);margin-bottom:2px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px">Сумма</div>
            <div class="item-total" style="font-weight:700;font-size:0.95rem;color:var(--accent-teal);line-height:32px">—</div>
          </div>
          <button type="button" onclick="OrdersPage.removeItemRow(${idx})" style="flex-shrink:0;width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-tertiary);color:var(--accent-red);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.75rem;transition:all 0.15s;margin-top:10px" onmouseenter="this.style.background='var(--accent-red)';this.style.color='#fff';this.style.borderColor='var(--accent-red)'" onmouseleave="this.style.background='var(--bg-tertiary)';this.style.color='var(--accent-red)';this.style.borderColor='var(--border)'">✕</button>
        </div>
        <input type="hidden" class="item-product" value="${item.product_id || (isDrawing ? 'drawing_' + (item.drawing_id || '') : '')}">
        <input type="hidden" class="item-is-drawing" value="${isDrawing ? '1' : ''}">
      </div>
    `;
  },

  _itemIndex: 0,

  // Каталог компонентов — как в калькуляторе
  openComponentCatalog() {
    let filterCat = '';
    let filterSearch = '';
    const categories = [...new Set(this.components.map(c => c.category_name).filter(Boolean))];

    const renderList = () => {
      let filtered = this.components;
      if (filterCat) filtered = filtered.filter(c => c.category_name === filterCat);
      if (filterSearch) {
        const s = filterSearch.toLowerCase();
        filtered = filtered.filter(c => (c.article || '').toLowerCase().includes(s) || c.name.toLowerCase().includes(s));
      }

      return filtered.length > 0 ? `
        <div class="table-wrapper" style="max-height:350px;overflow-y:auto">
          <table class="data-table">
            <thead><tr><th></th><th>Артикул</th><th>Название</th><th>Категория</th><th class="text-right">Цена</th><th></th></tr></thead>
            <tbody>
              ${filtered.map(c => {
                const modCount = parseInt(c.modifications_count) || 0;
                return `
                  <tr style="cursor:pointer" onclick="OrdersPage._addCatalogComponent(${c.id})">
                    <td>${c.image_path ? `<img src="${c.image_path}" style="width:32px;height:32px;object-fit:cover;border-radius:4px">` : '📦'}</td>
                    <td class="font-mono" style="color:var(--accent-teal)">${c.article}</td>
                    <td>${c.name}${modCount > 0 ? `<span style="margin-left:6px;padding:1px 6px;border-radius:8px;font-size:0.65rem;font-weight:600;background:var(--accent-teal);color:#fff">${modCount} мод.</span>` : ''}</td>
                    <td><span class="badge badge-in_progress" style="font-size:0.7rem">${c.category_name || '—'}</span></td>
                    <td class="text-right">${Table.formatMoney(c.price)}</td>
                    <td class="text-right"><button class="btn btn-primary btn-sm" onclick="event.stopPropagation();OrdersPage._addCatalogComponent(${c.id})">+</button></td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` : Table.emptyState('Компоненты не найдены');
    };

    const overlay = document.createElement('div');
    overlay.id = 'order-catalog-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `
      <div style="background:var(--bg-card);border-radius:16px;padding:24px;width:700px;max-width:95vw;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.4)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="margin:0;color:var(--text-primary)">Каталог компонентов</h3>
          <button onclick="document.getElementById('order-catalog-overlay').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--text-muted);padding:4px 8px">✕</button>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <input type="text" class="form-control" id="order-cat-search" placeholder="Поиск по артикулу или названию..." style="flex:1">
          <select class="form-control" id="order-cat-filter" style="width:180px">
            <option value="">Все категории</option>
            ${categories.map(cat => `<option value="${cat}">${cat}</option>`).join('')}
          </select>
        </div>
        <div id="order-cat-list" style="flex:1;overflow-y:auto">${renderList()}</div>
      </div>
    `;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    document.getElementById('order-cat-search').addEventListener('input', (e) => {
      filterSearch = e.target.value;
      document.getElementById('order-cat-list').innerHTML = renderList();
    });
    document.getElementById('order-cat-filter').addEventListener('change', (e) => {
      filterCat = e.target.value;
      document.getElementById('order-cat-list').innerHTML = renderList();
    });
  },

  async _addCatalogComponent(compId) {
    const comp = this.components.find(c => c.id === compId);
    if (!comp) return;

    const modCount = parseInt(comp.modifications_count) || 0;
    if (modCount > 0) {
      try {
        const detail = await API.get(`/components/${compId}`);
        const mods = (detail.modifications || []).filter(m => m.is_active !== false);
        if (mods.length > 0) {
          this._showModPicker(comp, mods);
          return;
        }
      } catch (e) { /* fallback */ }
    }

    this._insertCatalogItem(comp, null);
  },

  _showModPicker(comp, mods) {
    const overlay = document.getElementById('order-catalog-overlay');
    if (!overlay) return;
    const content = overlay.querySelector('div');
    content.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0;color:var(--text-primary)">Модификации: ${comp.article}</h3>
        <button onclick="document.getElementById('order-catalog-overlay').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--text-muted);padding:4px 8px">✕</button>
      </div>
      <div style="margin-bottom:12px;font-size:0.85rem;color:var(--text-muted)">Выберите модификацию или базовый компонент</div>
      <div style="display:flex;flex-direction:column;gap:8px;overflow-y:auto;max-height:60vh">
        <div style="background:var(--bg-main);border:1px solid var(--border);border-radius:10px;padding:10px 14px;cursor:pointer;transition:border-color 0.2s"
             onclick="OrdersPage._insertCatalogItem(OrdersPage.components.find(c=>c.id===${comp.id}), null);OrdersPage._backToCatalog()"
             onmouseenter="this.style.borderColor='var(--accent-teal)'" onmouseleave="this.style.borderColor='var(--border)'">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div class="font-mono" style="font-weight:700">${comp.article}</div>
              <div style="font-size:0.85rem;color:var(--text-secondary)">Базовый компонент</div>
            </div>
            <div style="font-weight:600">${Table.formatMoney(comp.price)}</div>
          </div>
        </div>
        ${mods.map(m => {
          const fullArticle = comp.article + '.' + m.code;
          const price = m.price_override !== null ? m.price_override : comp.price;
          return `
            <div style="background:var(--bg-main);border:1px solid var(--border);border-radius:10px;padding:10px 14px;cursor:pointer;transition:border-color 0.2s"
                 onclick="OrdersPage._insertModItem(${comp.id}, ${m.id});OrdersPage._backToCatalog()"
                 onmouseenter="this.style.borderColor='var(--accent-teal)'" onmouseleave="this.style.borderColor='var(--border)'">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <div style="flex:1">
                  <span class="font-mono" style="font-weight:700;color:var(--accent-teal)">${fullArticle}</span>
                  ${m.name ? `<div style="font-size:0.82rem;color:var(--text-secondary);margin-top:2px">${m.name}</div>` : ''}
                </div>
                <div style="font-weight:600;margin-left:12px">${Table.formatMoney(price)}</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      <div style="margin-top:16px;text-align:right">
        <button class="btn btn-secondary btn-sm" onclick="OrdersPage._backToCatalog()">← К каталогу</button>
      </div>
    `;
  },

  _backToCatalog() {
    const overlay = document.getElementById('order-catalog-overlay');
    if (overlay) overlay.remove();
    this.openComponentCatalog();
  },

  _insertCatalogItem(comp, modId) {
    const container = document.getElementById('order-items-list');
    if (!container) return;
    const idx = container.querySelectorAll('[data-item-row]').length;
    container.insertAdjacentHTML('beforeend', this._renderItemCard({
      product_id: comp.id,
      product_name: comp.name,
      article: comp.article || '',
      unit_price: parseFloat(comp.price),
      doc_count: parseInt(comp.doc_count) || 0,
      quantity: 1,
    }, idx));
    this.recalcTotals();
    Toast.success(`${comp.name} добавлен`);
  },

  _insertModItem(compId, modId) {
    const comp = this.components.find(c => c.id === compId);
    if (!comp) return;
    API.get(`/components/${compId}`).then(detail => {
      const mod = (detail.modifications || []).find(m => m.id === modId);
      if (!mod) return;
      const price = mod.price_override !== null ? parseFloat(mod.price_override) : parseFloat(comp.price);
      const fullArticle = comp.article + '.' + mod.code;
      const name = comp.name + ' — ' + (mod.name || mod.code);
      const container = document.getElementById('order-items-list');
      if (!container) return;
      const idx = container.querySelectorAll('[data-item-row]').length;
      container.insertAdjacentHTML('beforeend', this._renderItemCard({
        product_id: comp.id,
        product_name: name,
        article: fullArticle,
        unit_price: price,
        doc_count: parseInt(comp.doc_count) || 0,
        quantity: 1,
      }, idx));
      this.recalcTotals();
      Toast.success(`${name} добавлен`);
    }).catch(() => {});
  },

  addCustomItem() {
    const container = document.getElementById('order-items-list');
    if (!container) return;
    const idx = container.querySelectorAll('[data-item-row]').length;
    container.insertAdjacentHTML('beforeend', this._renderItemCard({
      product_name: '',
      unit_price: 0,
      quantity: 1,
      _custom: true,
    }, idx));
  },

  removeItemRow(idx) {
    const row = document.querySelector(`[data-item-row="${idx}"]`);
    if (row) {
      row.remove();
      this.recalcTotals();
    }
  },

  recalcTotals() {
    // Получить наценку уровня клиента
    const clientSelect = document.getElementById('order-client');
    const clientOpt = clientSelect?.selectedOptions[0];
    const levelMarkupPct = parseFloat(clientOpt?.dataset?.markup) || 0;
    const levelName = clientOpt?.dataset?.level || '';

    const rows = document.querySelectorAll('[data-item-row]');
    let subtotalBase = 0;
    let subtotalWithLevel = 0;

    rows.forEach(row => {
      const basePrice = parseFloat(row.querySelector('.item-price')?.value) || 0;
      const qty = parseFloat(row.querySelector('.item-qty')?.value) || 0;
      const manualMarkupPct = parseFloat(row.querySelector('.item-markup-pct')?.value) || 0;
      // Цена с наценкой уровня
      const priceWithLevel = basePrice * (1 + levelMarkupPct / 100);
      // + ручная наценка сверху
      const effectivePrice = priceWithLevel * (1 + manualMarkupPct / 100);
      const lineTotal = effectivePrice * qty;
      subtotalBase += basePrice * qty;
      subtotalWithLevel += lineTotal;

      const totalEl = row.querySelector('.item-total');
      if (totalEl) totalEl.textContent = Table.formatMoneyRaw(lineTotal);
    });

    const principalSelect = document.getElementById('order-principal');
    const selectedOption = principalSelect?.selectedOptions[0];
    const commPct = parseFloat(selectedOption?.dataset?.comm) || 0;
    const commission = subtotalWithLevel * commPct / 100;
    const total = subtotalWithLevel;
    const levelDiff = subtotalWithLevel - subtotalBase;

    const totalsEl = document.getElementById('order-totals');
    if (totalsEl) {
      totalsEl.innerHTML = `
        <div style="font-size:1.1rem;">Итого: <strong style="color:var(--accent-teal)">${Table.formatMoney(total)}</strong></div>
        ${levelName ? `<div style="font-size:0.82rem;color:var(--text-secondary);margin-top:4px">💰 Наценка уровня «${levelName}» (${levelMarkupPct > 0 ? '+' : ''}${levelMarkupPct}%): <strong>${levelDiff >= 0 ? '+' : ''}${Table.formatMoneyRaw(levelDiff)}</strong></div>` : ''}
        <div style="font-size:0.82rem;color:var(--text-muted);margin-top:2px">в т.ч. комиссия агента (${commPct}%): ${Table.formatMoney(commission)}</div>
      `;
    }
  },

  async saveOrder(id) {
    const client_id = document.getElementById('order-client').value;
    const principal_id = document.getElementById('order-principal').value;
    const order_date = document.getElementById('order-date').value;
    const status = document.getElementById('order-status').value;
    const comment = document.getElementById('order-comment').value;
    const invoice_number = document.getElementById('order-invoice-number')?.value.trim() || null;
    const invoice_path = document.getElementById('order-invoice-path')?.value || null;
    const payment_date = document.getElementById('order-payment-date')?.value || null;
    const tracking_number = document.getElementById('order-tracking-number')?.value.trim() || null;

    if (!client_id || !principal_id) {
      Toast.error('Выберите клиента и принципала');
      return;
    }

    const rows = document.querySelectorAll('[data-item-row]');
    const items = [];
    rows.forEach(row => {
      const productInput = row.querySelector('.item-product');
      const nameInput = row.querySelector('.item-name');
      const priceInput = row.querySelector('.item-price');
      const qtyInput = row.querySelector('.item-qty');
      const isDrawingInput = row.querySelector('.item-is-drawing');

      const product_id = productInput ? (productInput.value && !productInput.value.startsWith('drawing_') ? productInput.value : null) : null;
      const product_name = nameInput ? nameInput.value : '';
      const isDrawing = isDrawingInput && isDrawingInput.value === '1';

      if (product_name && parseFloat(priceInput.value) > 0) {
        const basePrice = parseFloat(priceInput.value);
        const markupPctInput = row.querySelector('.item-markup-pct');
        const manualMarkupPct = parseFloat(markupPctInput?.value) || 0;
        // Наценка уровня клиента
        const clientOpt = document.getElementById('order-client')?.selectedOptions[0];
        const lvlMarkup = parseFloat(clientOpt?.dataset?.markup) || 0;
        const priceWithLevel = basePrice * (1 + lvlMarkup / 100);
        const effectivePrice = Math.round(priceWithLevel * (1 + manualMarkupPct / 100) * 100) / 100;
        items.push({
          product_id,
          product_name,
          unit_price: effectivePrice,
          quantity: Math.round(parseFloat(qtyInput.value)) || 1,
          is_drawing: isDrawing,
        });
      }
    });

    if (items.length === 0) {
      Toast.error('Добавьте хотя бы одну позицию');
      return;
    }

    try {
      const payload = { client_id, principal_id, order_date, status, comment, items,
                        invoice_number, invoice_path, payment_date, tracking_number };
      if (id) {
        await API.put(`/orders/${id}`, payload);
        Toast.success('Заказ обновлён');
      } else {
        await API.post('/orders', payload);
        Toast.success('Заказ создан');
      }
      Modal.close();
      this.loadOrders();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  // === Загрузка файла счёта ===
  _uploadInvoice() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx';
    input.onchange = async (e) => {
      if (!e.target.files[0]) return;
      const btn = document.getElementById('order-invoice-upload-btn');
      if (btn) btn.textContent = '✅ Загрузка...';
      try {
        const formData = new FormData();
        formData.append('file', e.target.files[0]);
        const res = await API.upload('/upload/drawing', formData);
        document.getElementById('order-invoice-path').value = res.path;
        if (btn) btn.textContent = `✅ ${e.target.files[0].name}`;
        Toast.success('Счёт загружен');
      } catch (err) {
        if (btn) btn.textContent = '❌ Ошибка';
        Toast.error(err.message);
      }
    };
    input.click();
  },

  async deleteOrder(id) {
    if (!confirm('Удалить этот заказ?')) return;
    try {
      await API.del(`/orders/${id}`);
      Toast.success('Заказ удалён');
      this.loadOrders();
    } catch (err) {
      Toast.error(err.message);
    }
  },
};
