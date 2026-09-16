/* Dashboard Page */
const DashboardPage = {
  activeView: 'general',

  async render() {
    const content = document.getElementById('content-area');

    content.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <button class="tab-btn ${this.activeView === 'general' ? 'active' : ''}" onclick="DashboardPage.switchView('general')">📊 Общий</button>
        <button class="tab-btn ${this.activeView === 'manager' ? 'active' : ''}" onclick="DashboardPage.switchView('manager')">👔 Руководитель</button>
      </div>
      <div id="dashboard-content">${Table.loading()}</div>
    `;

    if (this.activeView === 'general') {
      this.renderGeneral();
    } else {
      this.renderManager();
    }
  },

  switchView(view) {
    this.activeView = view;
    this.render();
  },

  // === Общий дашборд (как было) ===
  async renderGeneral() {
    const container = document.getElementById('dashboard-content');
    try {
      const data = await API.get('/dashboard');
      const kpi = data.kpi;

      container.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Всего заказов</div>
            <div class="kpi-value">${kpi.total_orders}</div>
            <div class="kpi-sub">Активных: ${parseInt(kpi.new_orders) + parseInt(kpi.in_progress_orders)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Общая сумма</div>
            <div class="kpi-value">${Table.formatMoney(kpi.total_amount)}</div>
            <div class="kpi-sub">Сумма всех заказов</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Комиссия агента</div>
            <div class="kpi-value">${Table.formatMoney(kpi.total_commission)}</div>
            <div class="kpi-sub">в т.ч. от суммы заказов</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Клиенты</div>
            <div class="kpi-value">${kpi.total_clients}</div>
            <div class="kpi-sub">Всего в базе</div>
          </div>
        </div>

        <div class="charts-grid">
          <div class="card">
            <div class="card-header">
              <div class="card-title">Заказы по месяцам</div>
            </div>
            <div class="chart-container">
              <canvas id="chart-monthly"></canvas>
            </div>
          </div>
          <div class="card">
            <div class="card-header">
              <div class="card-title">Статусы заказов</div>
            </div>
            <div class="chart-container">
              <canvas id="chart-statuses"></canvas>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">Последние заказы</div>
          </div>
          ${data.recent_orders.length > 0 ? `
            <div class="table-wrapper">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>№ заказа</th>
                    <th>Дата</th>
                    <th>Клиент</th>
                    <th>Статус</th>
                    <th class="text-right">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  ${data.recent_orders.map(o => `
                    <tr style="cursor:pointer" onclick="OrdersPage.viewOrder(${o.id})" title="Нажмите для просмотра заказа">
                      <td class="font-mono">${o.order_number}</td>
                      <td>${Table.formatDate(o.order_date)}</td>
                      <td>${o.client_name || '—'}</td>
                      <td>${Table.statusBadge(o.status)}</td>
                      <td class="text-right">${Table.formatMoney(o.total)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : Table.emptyState('Нет заказов')}
        </div>
      `;

      // Рисуем графики
      if (data.monthly.length > 0) {
        Charts.drawBarChart('chart-monthly', data.monthly.map(m => ({
          label: m.month_label || m.month,
          value: parseFloat(m.amount),
        })));
      }

      const statusData = [
        { key: 'new', label: 'Новые', value: parseInt(kpi.new_orders) },
        { key: 'in_progress', label: 'В работе', value: parseInt(kpi.in_progress_orders) },
        { key: 'paid', label: 'Оплачены', value: parseInt(kpi.paid_orders) },
        { key: 'completed', label: 'Выполнены', value: parseInt(kpi.completed_orders) },
        { key: 'cancelled', label: 'Отменены', value: parseInt(kpi.cancelled_orders) },
      ].filter(d => d.value > 0);

      if (statusData.length > 0) {
        Charts.drawDonutChart('chart-statuses', statusData);
      }

    } catch (err) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-text">${err.message}</div></div>`;
    }
  },

  // === Дашборд руководителя ===
  async renderManager() {
    const container = document.getElementById('dashboard-content');
    try {
      const data = await API.get('/dashboard/clients');
      const clients = data.clients;
      const statusStats = data.status_stats;

      // Считаем суммарные KPI
      const totalOrders = clients.reduce((s, c) => s + parseInt(c.total_orders), 0);
      const totalAmount = clients.reduce((s, c) => s + parseFloat(c.total_amount), 0);
      const totalCommission = clients.reduce((s, c) => s + parseFloat(c.total_commission), 0);
      const withStatus = clients.filter(c => c.status_name).length;

      container.innerHTML = `
        <!-- KPI -->
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Всего клиентов</div>
            <div class="kpi-value">${data.total_clients}</div>
            <div class="kpi-sub">Со статусом: ${withStatus}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Всего заказов</div>
            <div class="kpi-value">${totalOrders}</div>
            <div class="kpi-sub">По всем клиентам</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Общий оборот</div>
            <div class="kpi-value">${Table.formatMoney(totalAmount)}</div>
            <div class="kpi-sub">Сумма заказов</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Комиссия</div>
            <div class="kpi-value">${Table.formatMoney(totalCommission)}</div>
            <div class="kpi-sub">Итого агентская</div>
          </div>
        </div>

        <!-- Статусы клиентов -->
        ${statusStats.length > 0 ? `
          <div class="card mb-2">
            <div class="card-header"><div class="card-title">Статусы клиентов</div></div>
            <div style="padding:4px 0;display:flex;flex-wrap:wrap;gap:8px">
              ${statusStats.map(s => `
                <div style="display:flex;align-items:center;gap:6px;padding:6px 14px;border-radius:20px;background:${s.color}15;border:1px solid ${s.color}30">
                  <span style="width:8px;height:8px;border-radius:50%;background:${s.color}"></span>
                  <span style="font-size:0.85rem;color:${s.color};font-weight:600">${s.name}</span>
                  <span style="font-size:0.85rem;font-weight:700;color:var(--text-primary)">${s.count}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Таблица клиентов -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">Все клиенты</div>
            <input type="text" class="form-control" id="manager-client-search" placeholder="Поиск..." style="width:220px;font-size:0.85rem">
          </div>
          <div id="manager-clients-table">
            ${this._renderManagerTable(clients)}
          </div>
        </div>
      `;

      // Поиск
      document.getElementById('manager-client-search').addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        const filtered = clients.filter(c => 
          c.name.toLowerCase().includes(q) || 
          (c.phone || '').toLowerCase().includes(q) ||
          (c.email || '').toLowerCase().includes(q) ||
          (c.status_name || '').toLowerCase().includes(q)
        );
        document.getElementById('manager-clients-table').innerHTML = this._renderManagerTable(filtered);
      });

    } catch (err) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-text">${err.message}</div></div>`;
    }
  },

  _renderManagerTable(clients) {
    if (clients.length === 0) return Table.emptyState('Нет клиентов');

    return `
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th></th>
              <th>Клиент</th>
              <th>Статус</th>
              <th class="text-center">Заказов</th>
              <th class="text-right">Сумма</th>
              <th class="text-right">Комиссия</th>
              <th>Посл. заказ</th>
              <th class="text-right" style="width:30px"></th>
            </tr>
          </thead>
          <tbody>
            ${clients.map(c => {
              const avatar = c.avatar_path 
                ? `<img src="${c.avatar_path}" style="width:36px;height:36px;object-fit:cover;border-radius:50%">`
                : `<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#14b8a6,#3b82f6);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:0.85rem">${(c.name||'?').charAt(0).toUpperCase()}</div>`;
              
              const statusBadge = c.status_name 
                ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;background:${c.status_color}15;color:${c.status_color};font-size:0.78rem;font-weight:600;border:1px solid ${c.status_color}30;white-space:nowrap">
                    <span style="width:6px;height:6px;border-radius:50%;background:${c.status_color}"></span>
                    ${c.status_name}
                  </span>`
                : '<span style="color:var(--text-muted);font-size:0.8rem">—</span>';

              const lastOrder = c.last_order_date 
                ? new Date(c.last_order_date).toLocaleDateString('ru-RU') 
                : '—';

              const activeOrders = parseInt(c.new_orders) + parseInt(c.in_progress_orders);

              return `
                <tr style="cursor:pointer" onclick="App.navigateTo('client-profile', ${c.id})">
                  <td>${avatar}</td>
                  <td>
                    <div style="font-weight:600">${c.name}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted)">${c.phone || c.email || ''}</div>
                  </td>
                  <td>${statusBadge}</td>
                  <td class="text-center">
                    <span style="font-weight:600">${c.total_orders}</span>
                    ${activeOrders > 0 ? `<span style="font-size:0.7rem;color:var(--accent-teal);margin-left:4px">(${activeOrders} акт.)</span>` : ''}
                  </td>
                  <td class="text-right" style="font-weight:600">${Table.formatMoney(c.total_amount)}</td>
                  <td class="text-right" style="color:var(--accent-teal)">${Table.formatMoney(c.total_commission)}</td>
                  <td style="font-size:0.85rem;color:var(--text-secondary)">${lastOrder}</td>
                  <td class="text-right">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" style="color:var(--text-muted)"><polyline points="9 18 15 12 9 6"/></svg>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  },
};
