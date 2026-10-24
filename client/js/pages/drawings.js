/* Drawings Page — Рассчитанные чертежи (Шаблоны и расчёты) */
const DrawingsPage = {
  viewMode: 'table', // 'grid' | 'table'
  groupByClient: false,
  selectedClientId: '',
  searchQuery: '',
  showArchived: false,
  allDrawings: [],
  clients: [],
  searchTimeout: null,

  async render() {
    const content = document.getElementById('content-area');
    const isAdmin = API.isAdmin();

    content.innerHTML = `
      <div class="toolbar" style="flex-wrap:wrap;gap:8px;margin-bottom:14px">
        <div class="search-input" style="flex:1;min-width:220px">
          <input type="text" id="drawings-search" placeholder="Поиск по названию чертежа, клиенту, описанию..." value="${this.searchQuery}">
        </div>
        <div class="filter-group" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select class="filter-select" id="drawings-client-filter" style="min-width:180px">
            <option value="">Все клиенты</option>
          </select>
          <button class="btn btn-icon ${this.groupByClient ? 'btn-primary' : 'btn-secondary'}" id="btn-group-client" title="Группировать по клиентам" onclick="DrawingsPage.toggleGroupByClient()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span style="font-size:0.8rem;margin-left:4px">По клиентам</span>
          </button>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-icon ${this.viewMode === 'grid' ? 'btn-primary' : 'btn-secondary'}" onclick="DrawingsPage.setViewMode('grid')" title="Витрина">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          </button>
          <button class="btn btn-icon ${this.viewMode === 'table' ? 'btn-primary' : 'btn-secondary'}" onclick="DrawingsPage.setViewMode('table')" title="Таблица">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
        </div>
        <button class="btn btn-secondary" onclick="DrawingsPage.openJournal()">🧾 Журнал расчётов</button>
        <button class="btn btn-icon ${this.showArchived ? 'btn-primary' : 'btn-secondary'}" id="btn-archive-toggle" title="Показать архив" onclick="DrawingsPage.toggleArchive()">📦</button>
        <button class="btn btn-primary" onclick="App.navigateTo('calculator')">+ Рассчитать чертёж</button>
      </div>

      <!-- Быстрые чипсы клиентов -->
      <div id="drawings-client-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px"></div>
      <div id="drawings-count" style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px"></div>
      <div id="drawings-container">${Table.loading()}</div>

      <style>
        .drawing-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:16px; }
        .drawing-card {
          background:var(--bg-card);
          border:1px solid var(--border);
          border-radius:14px;
          overflow:hidden;
          transition:transform 0.2s, box-shadow 0.2s, border-color 0.2s;
          cursor:pointer;
          display:flex;
          flex-direction:column;
          position:relative;
        }
        .drawing-card:hover {
          transform:translateY(-3px);
          box-shadow:var(--shadow-md);
          border-color:var(--accent-teal);
        }
        .drawing-card-header {
          padding:16px;
          border-bottom:1px solid var(--border);
          display:flex;
          align-items:flex-start;
          gap:12px;
          background:var(--bg-glass);
        }
        .drawing-card-icon {
          width:44px;
          height:44px;
          border-radius:10px;
          background:linear-gradient(135deg, var(--accent-teal), var(--accent-blue));
          display:flex;
          align-items:center;
          justify-content:center;
          font-size:1.3rem;
          color:#fff;
          flex-shrink:0;
        }
        .drawing-card-title {
          font-weight:700;
          font-size:1rem;
          color:var(--text-primary);
          line-height:1.3;
          margin-bottom:4px;
        }
        .drawing-card-client {
          display:inline-flex;
          align-items:center;
          gap:4px;
          font-size:0.78rem;
          color:var(--accent-teal);
          font-weight:500;
        }
        .drawing-card-body {
          padding:14px 16px;
          flex:1;
          display:flex;
          flex-direction:column;
          gap:10px;
        }
        .drawing-card-desc {
          font-size:0.83rem;
          color:var(--text-secondary);
          line-height:1.4;
          display:-webkit-box;
          -webkit-line-clamp:2;
          -webkit-box-orient:vertical;
          overflow:hidden;
        }
        .drawing-card-stats {
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:8px;
          background:var(--bg-tertiary);
          padding:10px 12px;
          border-radius:8px;
          margin-top:auto;
        }
        .drawing-stat-item .stat-lbl {
          font-size:0.7rem;
          color:var(--text-muted);
          text-transform:uppercase;
          letter-spacing:0.4px;
        }
        .drawing-stat-item .stat-val {
          font-size:0.95rem;
          font-weight:700;
          color:var(--text-primary);
          margin-top:2px;
        }
        .drawing-stat-item .stat-val.highlight {
          color:var(--accent-teal);
        }
        .drawing-card-footer {
          padding:10px 16px;
          border-top:1px solid var(--border);
          display:flex;
          align-items:center;
          justify-content:space-between;
          background:var(--bg-glass);
          font-size:0.75rem;
          color:var(--text-muted);
        }
        .client-group-section {
          background:var(--bg-card);
          border:1px solid var(--border);
          border-radius:14px;
          padding:18px;
          margin-bottom:20px;
        }
        .client-group-header {
          display:flex;
          align-items:center;
          justify-content:space-between;
          padding-bottom:12px;
          margin-bottom:14px;
          border-bottom:1px solid var(--border);
          flex-wrap:wrap;
          gap:10px;
        }
      </style>
    `;

    this.bindEvents();
    await this.loadData();
  },

  bindEvents() {
    const searchInput = document.getElementById('drawings-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        clearTimeout(this.searchTimeout);
        this.searchQuery = e.target.value;
        this.searchTimeout = setTimeout(() => this.filterAndRender(), 250);
      });
    }

    const clientFilter = document.getElementById('drawings-client-filter');
    if (clientFilter) {
      clientFilter.addEventListener('change', (e) => {
        this.selectedClientId = e.target.value;
        this.updateClientChips();
        this.filterAndRender();
      });
    }
  },

  async loadData() {
    try {
      const [drawRes, clientRes] = await Promise.all([
        API.get(`/drawings?archived=${this.showArchived ? '1' : '0'}`),
        API.get('/clients?limit=1000'),
      ]);

      this.allDrawings = drawRes.data || [];
      this.clients = clientRes.data || [];

      this.populateClientFilter();
      this.updateClientChips();
      this.filterAndRender();
    } catch (err) {
      document.getElementById('drawings-container').innerHTML = Table.emptyState('Ошибка загрузки чертежей: ' + err.message);
    }
  },

  populateClientFilter() {
    const select = document.getElementById('drawings-client-filter');
    if (!select) return;

    select.innerHTML = '<option value="">Все клиенты</option><option value="none">Без клиента</option>' +
      this.clients.map(c => `<option value="${c.id}" ${this.selectedClientId == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  },

  updateClientChips() {
    const chipsEl = document.getElementById('drawings-client-chips');
    if (!chipsEl) return;

    // Считаем количество чертежей по клиентам (общий BOM — у всех привязанных)
    const clientCounts = {};
    let noClientCount = 0;
    this.allDrawings.forEach(d => {
      const ids = [...new Set([...(d.client_ids || []), ...(d.client_id ? [d.client_id] : [])])];
      if (ids.length === 0) {
        noClientCount++;
      } else {
        ids.forEach(id => { clientCounts[id] = (clientCounts[id] || 0) + 1; });
      }
    });

    const activeStyle = 'background:var(--accent-teal);color:#fff;border-color:var(--accent-teal);font-weight:600;';
    const inactiveStyle = 'background:var(--bg-tertiary);color:var(--text-secondary);border:1px solid var(--border);';

    let html = `
      <button class="btn btn-sm" style="border-radius:20px;padding:4px 12px;font-size:0.78rem;${!this.selectedClientId ? activeStyle : inactiveStyle}" onclick="DrawingsPage.selectClientChip('')">
        Все (${this.allDrawings.length})
      </button>
    `;

    if (noClientCount > 0) {
      html += `
        <button class="btn btn-sm" style="border-radius:20px;padding:4px 12px;font-size:0.78rem;${this.selectedClientId === 'none' ? activeStyle : inactiveStyle}" onclick="DrawingsPage.selectClientChip('none')">
          Без клиента (${noClientCount})
        </button>
      `;
    }

    this.clients.forEach(c => {
      const count = clientCounts[c.id] || 0;
      if (count > 0) {
        const isSelected = String(this.selectedClientId) === String(c.id);
        html += `
          <button class="btn btn-sm" style="border-radius:20px;padding:4px 12px;font-size:0.78rem;${isSelected ? activeStyle : inactiveStyle}" onclick="DrawingsPage.selectClientChip('${c.id}')">
            ${esc(c.name)} (${count})
          </button>
        `;
      }
    });

    chipsEl.innerHTML = html;
  },

  selectClientChip(clientId) {
    this.selectedClientId = clientId;
    const select = document.getElementById('drawings-client-filter');
    if (select) select.value = clientId;
    this.updateClientChips();
    this.filterAndRender();
  },

  setViewMode(mode) {
    this.viewMode = mode;
    this.render();
  },

  toggleGroupByClient() {
    this.groupByClient = !this.groupByClient;
    const btn = document.getElementById('btn-group-client');
    if (btn) {
      btn.className = `btn btn-icon ${this.groupByClient ? 'btn-primary' : 'btn-secondary'}`;
    }
    this.filterAndRender();
  },

  getFilteredDrawings() {
    const q = (this.searchQuery || '').toLowerCase().trim();
    return this.allDrawings.filter(d => {
      // Фильтр по клиенту: учитываем и владельца, и привязки (общий BOM)
      const linkedIds = [...new Set([...(d.client_ids || []), ...(d.client_id ? [d.client_id] : [])])]
        .map(String);
      if (this.selectedClientId === 'none') {
        if (linkedIds.length > 0) return false;
      } else if (this.selectedClientId) {
        if (!linkedIds.includes(String(this.selectedClientId))) return false;
      }

      // Поиск
      if (q) {
        const name = (d.name || '').toLowerCase();
        const desc = (d.description || '').toLowerCase();
        const client = (d.client_name || '').toLowerCase();
        const author = (d.author_name || '').toLowerCase();
        if (!name.includes(q) && !desc.includes(q) && !client.includes(q) && !author.includes(q)) {
          return false;
        }
      }
      return true;
    });
  },

  filterAndRender() {
    const filtered = this.getFilteredDrawings();
    const container = document.getElementById('drawings-container');
    const countEl = document.getElementById('drawings-count');

    if (countEl) {
      countEl.textContent = `Показано чертежей: ${filtered.length} из ${this.allDrawings.length}`;
    }

    if (filtered.length === 0) {
      container.innerHTML = Table.emptyState('Чертежи не найдены. Создайте новый в калькуляторе.');
      return;
    }

    if (this.groupByClient) {
      this.renderGrouped(filtered, container);
    } else if (this.viewMode === 'grid') {
      this.renderGrid(filtered, container);
    } else {
      this.renderTable(filtered, container);
    }
  },

  renderGrid(drawings, container) {
    container.innerHTML = `
      <div class="drawing-grid">
        ${drawings.map(d => this._renderCardHtml(d)).join('')}
      </div>
    `;
  },

  _renderCardHtml(d, clientNameOverride, clientPrice) {
    const clientName = clientNameOverride || d.client_name || 'Без клиента';
    const compCount = d.components_count || 0;
    const totalCost = clientPrice !== undefined && clientPrice !== null
      ? clientPrice
      : parseFloat(d.total_cost || d.base_cost) || 0;
    const dateStr = d.created_at ? new Date(d.created_at).toLocaleDateString('ru-RU') : '—';
    const authorStr = d.author_name || '—';

    return `
      <div class="drawing-card" onclick="DrawingsPage.openDrawingModal(${d.id})">
        <div class="drawing-card-header">
          <div class="drawing-card-icon">📐</div>
          <div style="flex:1;min-width:0">
            <div class="drawing-card-title">${esc(d.name)}</div>
            <div class="drawing-card-client">
              👤 ${esc(clientName)}${d.archived_at ? ' · 📦 архив' : ''}
            </div>
          </div>
        </div>
        <div class="drawing-card-body">
          ${d.description ? `<div class="drawing-card-desc">${esc(d.description)}</div>` : '<div style="font-size:0.8rem;color:var(--text-muted);font-style:italic;">Без описания</div>'}
          
          <div class="drawing-card-stats">
            <div class="drawing-stat-item">
              <div class="stat-lbl">Компонентов</div>
              <div class="stat-val">${compCount} шт.</div>
            </div>
            <div class="drawing-stat-item">
              <div class="stat-lbl">Итоговая стоимость</div>
              <div class="stat-val highlight">${Table.formatMoney(totalCost)}</div>
            </div>
          </div>
        </div>
        <div class="drawing-card-footer">
          <span>${esc(authorStr)} · ${esc(dateStr)}</span>
          <span style="color:var(--accent-teal);font-weight:600">Подробнее →</span>
        </div>
      </div>
    `;
  },

  renderTable(drawings, container) {
    const canDelete = API.can('drawings', 'delete');
    container.innerHTML = `
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Название чертежа</th>
              <th>Клиент</th>
              <th class="text-center">Компонентов</th>
              <th class="text-right">Базовая цена</th>
              <th class="text-right">Стоимость с наценкой</th>
              <th>Дата создания</th>
              <th class="text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            ${drawings.map(d => {
              const baseCost = parseFloat(d.base_cost) || 0;
              const totalCost = parseFloat(d.total_cost || d.base_cost) || 0;
              const clientId = d.client_id;
              const clientName = d.client_name;
              const dateStr = d.created_at ? new Date(d.created_at).toLocaleDateString('ru-RU') : '—';
              return `
                <tr style="cursor:pointer" onclick="DrawingsPage.openDrawingModal(${d.id})">
                  <td>
                    <div style="font-weight:600;display:flex;align-items:center;gap:8px">
                      <span style="font-size:1.1rem">📐</span>
                      <span>${esc(d.name)}</span>
                      ${d.archived_at ? '<span class="badge" style="background:var(--bg-tertiary);color:var(--text-muted);font-size:0.7rem">📦 архив</span>' : ''}
                    </div>
                    ${d.description ? `<div style="font-size:0.78rem;color:var(--text-muted);margin-left:24px">${esc(d.description)}</div>` : ''}
                  </td>
                  <td>
                    ${clientId ? `
                      <a href="#" class="client-link" onclick="event.stopPropagation();App.navigateTo('client-profile', ${clientId})">
                        👤 ${esc(clientName || 'Клиент')}
                      </a>
                    ` : '<span class="text-muted">—</span>'}
                  </td>
                  <td class="text-center">
                    <span class="badge" style="background:var(--bg-tertiary);color:var(--text-secondary)">${d.components_count || 0}</span>
                  </td>
                  <td class="text-right">${Table.formatMoney(baseCost)}</td>
                  <td class="text-right"><strong style="color:var(--accent-teal)">${Table.formatMoney(totalCost)}</strong></td>
                  <td class="text-muted" style="font-size:0.83rem">${dateStr}</td>
                  <td class="text-right" onclick="event.stopPropagation()">
                    <div class="table-actions" style="justify-content:flex-end">
                      <button class="btn btn-icon btn-sm" onclick="DrawingsPage.openDrawingModal(${d.id})" title="Просмотр">👁️</button>
                      <button class="btn btn-icon btn-sm" onclick="event.stopPropagation();DrawingsPage.renameDrawing(${d.id})" title="Переименовать">✏️</button>
                      ${d.archived_at ? '' : `<button class="btn btn-icon btn-sm" onclick="event.stopPropagation();DrawingsPage.openInCalculator(${d.id}, ${d.client_id || 'null'})" title="Открыть в калькуляторе">🧮</button>`}
                      ${canDelete ? (d.archived_at
                        ? `<button class="btn btn-icon btn-sm" onclick="DrawingsPage.restoreDrawing(${d.id})" title="Вернуть из архива">♻️</button>`
                        : `<button class="btn btn-icon btn-sm btn-danger" onclick="DrawingsPage.deleteDrawing(${d.id})" title="В архив">📥</button>`) : ''}
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  // Цена чертежа для конкретного клиента (у одного BOM цены разные)
  priceForClient(drawing, clientId) {
    const entry = (drawing.client_prices || [])
      .find(p => String(p.client_id) === String(clientId));
    if (entry && entry.price) return parseFloat(entry.price.total) || 0;
    return parseFloat(drawing.total_cost || drawing.base_cost) || 0;
  },

  renderGrouped(drawings, container) {
    // Группируем по клиентам: общий BOM попадает в каждую группу, где есть связь
    const groups = {};
    const noClientDrawings = [];
    const clientById = {};
    (this.clients || []).forEach(c => { clientById[c.id] = c; });

    drawings.forEach(d => {
      const linkedIds = [...new Set([
        ...(d.client_ids || []),
        ...(d.client_id ? [d.client_id] : []),
      ])].map(Number);

      if (linkedIds.length === 0) {
        noClientDrawings.push(d);
        return;
      }

      linkedIds.forEach(clientId => {
        if (!groups[clientId]) {
          const client = clientById[clientId];
          groups[clientId] = {
            client_id: clientId,
            client_name: (client && client.name) || (d.client_id === clientId ? d.client_name : null) || `Клиент #${clientId}`,
            client_phone: (client && client.phone) || (d.client_id === clientId ? d.client_phone : '') || '',
            drawings: [],
            totalSum: 0,
            sharedCount: 0,
          };
        }
        groups[clientId].drawings.push(d);
        // Сумма группы — по цене именно этого клиента
        groups[clientId].totalSum += this.priceForClient(d, clientId);
        if (linkedIds.length > 1) groups[clientId].sharedCount += 1;
      });
    });

    let html = '';

    // Группы с клиентами
    Object.values(groups).forEach(g => {
      html += `
        <div class="client-group-section">
          <div class="client-group-header">
            <div style="display:flex;align-items:center;gap:10px">
              <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg, var(--accent-teal), var(--accent-blue));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700">
                ${g.client_name.charAt(0).toUpperCase()}
              </div>
              <div>
                <a href="#" class="client-link" style="font-weight:700;font-size:1.05rem" onclick="App.navigateTo('client-profile', ${g.client_id})">
                  ${g.client_name}
                </a>
                ${g.client_phone ? `<span style="font-size:0.8rem;color:var(--text-muted);margin-left:8px">📞 ${g.client_phone}</span>` : ''}
              </div>
            </div>
            <div style="display:flex;gap:16px;align-items:center">
              <span class="badge" style="background:var(--bg-tertiary);color:var(--text-secondary);font-size:0.8rem">
                ${g.drawings.length} чертеж(ей)${g.sharedCount > 0 ? ` · ${g.sharedCount} общих` : ''}
              </span>
              <span style="font-size:0.95rem;font-weight:700;color:var(--accent-teal)">
                Итого: ${Table.formatMoney(g.totalSum)}
              </span>
            </div>
          </div>
          ${this.viewMode === 'grid'
            ? `<div class="drawing-grid">${g.drawings.map(d => this._renderCardHtml(d, g.client_name, this.priceForClient(d, g.client_id))).join('')}</div>`
            : this._renderSimpleTable(g.drawings, g)
          }
        </div>
      `;
    });

    // Без клиента
    if (noClientDrawings.length > 0) {
      const sum = noClientDrawings.reduce((acc, d) => acc + (parseFloat(d.total_cost || d.base_cost) || 0), 0);
      html += `
        <div class="client-group-section">
          <div class="client-group-header">
            <div style="display:flex;align-items:center;gap:10px">
              <div style="width:36px;height:36px;border-radius:50%;background:var(--bg-tertiary);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-weight:700">
                ?
              </div>
              <div style="font-weight:700;font-size:1.05rem;color:var(--text-secondary)">
                Без привязки к клиенту (Общие шаблоны)
              </div>
            </div>
            <div style="display:flex;gap:16px;align-items:center">
              <span class="badge" style="background:var(--bg-tertiary);color:var(--text-secondary);font-size:0.8rem">
                ${noClientDrawings.length} чертеж(ей)
              </span>
              <span style="font-size:0.95rem;font-weight:700;color:var(--accent-teal)">
                Итого: ${Table.formatMoney(sum)}
              </span>
            </div>
          </div>
          ${this.viewMode === 'grid' 
            ? `<div class="drawing-grid">${noClientDrawings.map(d => this._renderCardHtml(d)).join('')}</div>`
            : this._renderSimpleTable(noClientDrawings)
          }
        </div>
      `;
    }

    container.innerHTML = html;
  },

  _renderSimpleTable(drawings, groupClient) {
    const isAdmin = API.isAdmin();
    return `
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Название чертежа</th>
              <th class="text-center">Компонентов</th>
              <th class="text-right">Базовая цена</th>
              <th class="text-right">Стоимость с наценкой</th>
              <th>Дата</th>
              <th class="text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            ${drawings.map(d => {
              const baseCost = parseFloat(d.base_cost) || 0;
              const totalCost = groupClient
                ? this.priceForClient(d, groupClient.client_id)
                : parseFloat(d.total_cost || d.base_cost) || 0;
              return `
                <tr style="cursor:pointer" onclick="DrawingsPage.openDrawingModal(${d.id})">
                  <td><strong>${esc(d.name)}</strong></td>
                  <td class="text-center">${d.components_count || 0}</td>
                  <td class="text-right">${Table.formatMoney(baseCost)}</td>
                  <td class="text-right"><strong style="color:var(--accent-teal)">${Table.formatMoney(totalCost)}</strong></td>
                  <td class="text-muted" style="font-size:0.8rem">${d.created_at ? new Date(d.created_at).toLocaleDateString('ru-RU') : '—'}</td>
                  <td class="text-right" onclick="event.stopPropagation()">
                    <div class="table-actions" style="justify-content:flex-end">
                      <button class="btn btn-icon btn-sm" onclick="DrawingsPage.openDrawingModal(${d.id})" title="Просмотр">👁️</button>
                      <button class="btn btn-icon btn-sm" onclick="event.stopPropagation();DrawingsPage.renameDrawing(${d.id})" title="Переименовать">✏️</button>
                      ${d.archived_at ? '' : `<button class="btn btn-icon btn-sm" onclick="event.stopPropagation();DrawingsPage.openInCalculator(${d.id}, ${groupClient ? groupClient.client_id : 'null'})" title="В калькулятор">🧮</button>`}
                      ${API.can('drawings', 'delete') ? (d.archived_at
                        ? `<button class="btn btn-icon btn-sm" onclick="DrawingsPage.restoreDrawing(${d.id})" title="Вернуть из архива">♻️</button>`
                        : `<button class="btn btn-icon btn-sm btn-danger" onclick="DrawingsPage.deleteDrawing(${d.id})" title="В архив">📥</button>`) : ''}
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  // =================== ПЕРЕИМЕНОВАНИЕ ===================
  // Название можно поправить: оно попадает в каталог, карточку клиента,
  // калькулятор и журнал расчётов, но файл и состав не меняются.
  async renameDrawing(drawingId) {
    let drawing = (this.allDrawings || []).find(d => String(d.id) === String(drawingId));
    if (!drawing) {
      try {
        drawing = await API.get(`/drawings/${drawingId}`);
      } catch (err) {
        Toast.error(err.message);
        return;
      }
    }

    Modal.open({
      title: 'Название чертежа',
      body: `
        <div class="form-group">
          <label>Название *</label>
          <input type="text" class="form-control" id="drawing-rename-input" maxlength="255" value="${esc(drawing.name)}">
          <div class="form-hint" style="margin-top:4px">Изменится только название — файл, состав и цены останутся прежними.</div>
        </div>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Отмена</button>
        <button class="btn btn-primary" onclick="DrawingsPage.saveDrawingName(${drawingId})">Сохранить</button>
      `,
    });

    setTimeout(() => {
      const input = document.getElementById('drawing-rename-input');
      if (input) { input.focus(); input.select(); }
    }, 50);
  },

  async saveDrawingName(drawingId) {
    const input = document.getElementById('drawing-rename-input');
    const name = input ? input.value.trim() : '';
    if (!name) { Toast.error('Укажите название чертежа'); return; }

    try {
      const updated = await API.request('PATCH', `/drawings/${drawingId}/name`, { name });
      (this.allDrawings || []).forEach(d => {
        if (String(d.id) === String(drawingId)) d.name = updated.name || name;
      });
      Toast.success('Название обновлено');
      Modal.close();
      if (typeof this.loadData === 'function') await this.loadData();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  // =================== МОДАЛКА КАРТОЧКИ ЧЕРТЕЖА ===================
  async openDrawingModal(drawingId) {
    try {
      Modal.open({
        title: 'Загрузка карточки чертежа...',
        body: Table.loading(),
        footer: '',
        wide: true,
      });

      const drawing = await API.get(`/drawings/${drawingId}`);
      const components = drawing.components || [];

      // Подсчет стоимости
      let subtotalBase = 0;
      let subtotalWithMarkups = 0;

      components.forEach(c => {
        const effectivePrice = c.modification_price !== null && c.modification_price !== undefined
          ? parseFloat(c.modification_price) : parseFloat(c.price);
        const base = effectivePrice * parseFloat(c.quantity);
        const markupPct = base * (parseFloat(c.item_markup_pct) || 0) / 100;
        const markupRub = parseFloat(c.item_markup_rub) || 0;
        const lineTotal = base + markupPct + markupRub;
        subtotalBase += base;
        subtotalWithMarkups += lineTotal;
      });

      // Итог считает сервер (цена владельца); резерв — сумма по составу
      const priceTotal = drawing.price ? parseFloat(drawing.price.total) : subtotalWithMarkups;

      const dateStr = drawing.created_at ? new Date(drawing.created_at).toLocaleString('ru-RU') : '—';
      const clientName = drawing.client_name || 'Не привязан';

      // Цены по клиентам: у каждого может быть своя фикс-цена или наценка
      const linkedClients = drawing.clients || [];
      const canEditDrawings = API.can('drawings', 'edit');
      const priceRows = linkedClients.map(c => {
        const p = c.price || {};
        const isFixed = p.fixedPrice !== null && p.fixedPrice !== undefined;
        const markupPct = parseFloat(c.markup_pct);
        const markupRub = parseFloat(c.markup_rub) || 0;
        const details = [
          isFixed ? 'фикс.' : null,
          Number.isFinite(markupPct) ? `${markupPct > 0 ? '+' : ''}${markupPct}%` : null,
          markupRub ? `${markupRub > 0 ? '+' : ''}${Table.formatMoneyRaw(markupRub)}` : null,
        ].filter(Boolean).join(' · ') || 'уровень цен';
        return `
          <tr>
            <td>
              <a href="#" class="client-link" onclick="event.preventDefault();Modal.close();App.navigateTo('client-profile', ${c.client_id})">${esc(c.client_name)}</a>
              <div style="font-size:0.72rem;color:var(--text-muted)">${esc(c.pricing_level_name) || 'уровень не задан'}</div>
            </td>
            <td class="text-muted" style="font-size:0.8rem">${details}</td>
            <td class="text-right" style="font-weight:600;color:var(--accent-teal)">${Table.formatMoney(p.total)}</td>
            <td class="text-right" onclick="event.stopPropagation()">
              ${API.can('calculator', 'view') ? `<button class="btn btn-icon btn-sm" title="Открыть в калькуляторе для этого клиента" onclick="DrawingsPage.openInCalculator(${drawing.id}, ${c.client_id})">🧮</button>` : ''}
              ${canEditDrawings ? `<button class="btn btn-icon btn-sm" title="Наценка и фикс-цена для клиента" onclick="DrawingsPage.openClientPriceModal(${drawing.id}, ${c.client_id})">✏️</button>` : ''}
              ${canEditDrawings ? `<button class="btn btn-icon btn-sm" title="Отвязать клиента" onclick="DrawingsPage.unlinkClient(${drawing.id}, ${c.client_id})">✖</button>` : ''}
            </td>
          </tr>`;
      }).join('');

      const availableClients = (this.clients || []).filter(cl =>
        !linkedClients.some(lc => String(lc.client_id) === String(cl.id)));

      const priceSection = `
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;flex-wrap:wrap">
            <h4 style="margin:0;font-size:0.95rem;font-weight:700;color:var(--text-primary)">
              Цены по клиентам (${linkedClients.length})
            </h4>
            ${canEditDrawings && availableClients.length > 0 ? `
              <div style="display:flex;gap:6px;align-items:center">
                <select class="form-control" id="drawing-link-client" style="width:auto;padding:5px 10px;font-size:0.82rem">
                  <option value="">Привязать клиента...</option>
                  ${availableClients.map(cl => `<option value="${cl.id}">${esc(cl.name)}</option>`).join('')}
                </select>
                <button class="btn btn-secondary btn-sm" onclick="DrawingsPage.linkClient(${drawing.id})">＋</button>
              </div>
            ` : ''}
          </div>
          ${linkedClients.length === 0 ? `
            <div style="padding:14px;text-align:center;color:var(--text-muted);background:var(--bg-tertiary);border-radius:10px;font-size:0.85rem">
              Чертёж не привязан к клиентам — цена считается по уровню, зафиксированному в чертеже
            </div>
          ` : `
            <div class="table-wrapper">
              <table class="data-table">
                <thead><tr><th>Клиент</th><th>Наценка / фикс.</th><th class="text-right">Цена</th><th class="text-right"></th></tr></thead>
                <tbody>${priceRows}</tbody>
              </table>
            </div>
          `}
        </div>
      `;

      const bodyHtml = `
        <div style="display:flex;flex-direction:column;gap:18px">
          <!-- Верхняя карточка чертежа -->
          <div style="display:flex;justify-content:space-between;align-items:flex-start;background:var(--bg-tertiary);padding:16px 20px;border-radius:12px;flex-wrap:wrap;gap:12px">
            <div>
              <div style="display:flex;align-items:center;gap:10px">
                <span style="font-size:1.5rem">📐</span>
                <h3 style="margin:0;font-size:1.25rem;font-weight:700;color:var(--text-primary)">${esc(drawing.name)}</h3>
                ${canEditDrawings ? `<button class="btn btn-icon btn-sm" title="Переименовать чертёж" onclick="DrawingsPage.renameDrawing(${drawing.id})">✏️</button>` : ''}
              </div>
              <div style="margin-top:8px;display:flex;gap:14px;flex-wrap:wrap;font-size:0.85rem;color:var(--text-secondary)">
                <span>👤 Клиент: 
                  ${drawing.client_id ? `
                    <a href="#" class="client-link" style="font-weight:600" onclick="Modal.close();App.navigateTo('client-profile', ${drawing.client_id})">
                      ${esc(clientName)}
                    </a>
                  ` : '<span class="text-muted">Без клиента</span>'}
                </span>
                ${(drawing.clients || []).length > 0 ? `
                  <span>👥 Привязан: ${drawing.clients.map(c => `<a href="#" class="client-link" onclick="Modal.close();App.navigateTo('client-profile', ${c.client_id})">${esc(c.client_name)}</a>${parseFloat(c.markup_pct) ? ` (+${parseFloat(c.markup_pct)}%)` : ''}`).join(', ')}</span>
                ` : ''}
                ${drawing.approval_id ? `<span>📋 Из согласования #${drawing.approval_id} · ${esc(drawing.approval_status) || ''}</span>` : ''}
                <span>👨‍💼 Автор: <strong>${esc(drawing.author_name) || '—'}</strong></span>
                <span>📅 Создан: <strong>${dateStr}</strong></span>
              </div>
              ${drawing.description ? `<p style="margin-top:8px;font-size:0.85rem;color:var(--text-secondary);line-height:1.4">${esc(drawing.description)}</p>` : ''}
            </div>

            <!-- Итоговый блок стоимости -->
            <div style="text-align:right;background:var(--bg-card);padding:12px 18px;border-radius:10px;border:1px solid var(--border)">
              <div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">
                ${linkedClients.length > 0 ? 'Цена владельца' : 'Итоговая стоимость'}
              </div>
              <div style="font-size:1.35rem;font-weight:800;color:var(--accent-teal);margin-top:2px">
                ${Table.formatMoney(priceTotal)}
              </div>
              <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px">
                Базовая: ${Table.formatMoney(subtotalBase)}
              </div>
            </div>
          </div>

          ${priceSection}

          <!-- Таблица состава компонентов (BOM) -->
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <h4 style="margin:0;font-size:0.95rem;font-weight:700;color:var(--text-primary)">
                Состав чертежа (${components.length} позиций)
              </h4>
            </div>
            
            ${components.length === 0 ? `
              <div style="padding:20px;text-align:center;color:var(--text-muted);background:var(--bg-tertiary);border-radius:10px">
                В чертеже нет добавленных компонентов
              </div>
            ` : `
              <div class="table-wrapper" style="max-height:300px;overflow-y:auto">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th style="width:40px">#</th>
                      <th>Артикул</th>
                      <th>Наименование компонента</th>
                      <th>Категория</th>
                      <th class="text-right">Цена за ед.</th>
                      <th class="text-center">Кол-во</th>
                      <th class="text-center">Наценка</th>
                      <th class="text-right">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${components.map((c, idx) => {
                      const effectivePrice = c.modification_price !== null && c.modification_price !== undefined
                        ? parseFloat(c.modification_price) : parseFloat(c.price);
                      const base = effectivePrice * parseFloat(c.quantity);
                      const markupPct = parseFloat(c.item_markup_pct) || 0;
                      const markupRub = parseFloat(c.item_markup_rub) || 0;
                      const lineTotal = base * (1 + markupPct / 100) + markupRub;

                      let markupLabel = '—';
                      if (markupPct !== 0 && markupRub !== 0) {
                        markupLabel = `${markupPct > 0 ? '+' : ''}${markupPct}% / ${markupRub > 0 ? '+' : ''}${Table.formatMoney(markupRub)}`;
                      } else if (markupPct !== 0) {
                        markupLabel = `${markupPct > 0 ? '+' : ''}${markupPct}%`;
                      } else if (markupRub !== 0) {
                        markupLabel = `${markupRub > 0 ? '+' : ''}${Table.formatMoney(markupRub)}`;
                      }

                      return `
                        <tr>
                          <td style="color:var(--text-muted)">${idx + 1}</td>
                          <td><span class="font-mono" style="color:var(--accent-teal);font-size:0.8rem">${esc(c.modification_code ? c.article + '.' + c.modification_code : (c.article || '—'))}</span></td>
                          <td><strong>${esc(c.component_name)}</strong>${c.modification_name ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:1px">${esc(c.modification_name)}</div>` : ''}</td>
                          <td><span class="badge" style="background:var(--bg-tertiary);color:var(--text-secondary)">${esc(c.category_name) || '—'}</span></td>
                          <td class="text-right">${Table.formatMoney(c.modification_price !== null && c.modification_price !== undefined ? c.modification_price : c.price)}</td>
                          <td class="text-center">${c.quantity}</td>
                          <td class="text-center" style="font-size:0.8rem;color:${markupPct < 0 || markupRub < 0 ? '#ef4444' : markupPct > 0 || markupRub > 0 ? '#22c55e' : 'var(--text-muted)'}">
                            ${markupLabel}
                          </td>
                          <td class="text-right font-mono" style="font-weight:600">${Table.formatMoney(lineTotal)}</td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>
        </div>
      `;

      const footerHtml = `
        <div style="display:flex;justify-content:space-between;width:100%;align-items:center">
          <div>
            ${API.can('drawings', 'delete') ? (drawing.archived_at
              ? `<button class="btn btn-secondary btn-sm" onclick="DrawingsPage.restoreDrawing(${drawing.id})">♻️ Вернуть из архива</button>`
              : `<button class="btn btn-danger btn-sm" onclick="DrawingsPage.deleteDrawing(${drawing.id})">📥 В архив</button>`) : ''}
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary" onclick="Modal.close()">Закрыть</button>
            ${drawing.archived_at ? '' : `<button class="btn btn-primary" onclick="DrawingsPage.openInCalculator(${drawing.id}, ${drawing.client_id || 'null'})">
              🧮 Открыть в калькуляторе
            </button>`}
          </div>
        </div>
      `;

      Modal.open({
        title: `Карточка чертежа: ${esc(drawing.name)}`,
        body: bodyHtml,
        footer: footerHtml,
        wide: true,
      });

    } catch (err) {
      Toast.error('Ошибка загрузки чертежа: ' + err.message);
    }
  },

  // =================== ЦЕНЫ ПО КЛИЕНТАМ ===================

  async openClientPriceModal(drawingId, clientId) {
    try {
      const drawing = await API.get(`/drawings/${drawingId}`);
      const link = (drawing.clients || []).find(c => String(c.client_id) === String(clientId));
      if (!link) { Toast.error('Клиент не привязан к чертежу'); return; }
      const price = link.price || {};

      Modal.open({
        title: `Цена для: ${link.client_name}`,
        body: `
          <div class="form-row">
            <div class="form-group">
              <label>Наценка, %</label>
              <input type="number" step="0.1" class="form-control" id="cp-markup-pct"
                     value="${link.markup_pct !== null && link.markup_pct !== undefined ? parseFloat(link.markup_pct) : ''}"
                     placeholder="по уровню цен клиента">
            </div>
            <div class="form-group">
              <label>Наценка, ₽</label>
              <input type="number" step="1" class="form-control" id="cp-markup-rub" value="${parseFloat(link.markup_rub) || 0}">
            </div>
          </div>
          <div class="form-group">
            <label>Фиксированная цена, ₽</label>
            <input type="number" step="0.01" class="form-control" id="cp-fixed-price"
                   value="${price.fixedPrice !== null && price.fixedPrice !== undefined ? price.fixedPrice : ''}"
                   placeholder="пусто — считать по составу">
            <div style="font-size:0.78rem;color:var(--text-muted);margin-top:4px">
              Действует только для этого клиента. Пустое поле — расчёт по BOM с его уровнем цен.
            </div>
          </div>
          <div style="padding:10px 14px;background:var(--bg-main);border-radius:8px;font-size:0.85rem;display:flex;justify-content:space-between">
            <span>Текущая цена</span>
            <strong style="color:var(--accent-teal)">${Table.formatMoney(price.total)}</strong>
          </div>
        `,
        footer: `
          <button class="btn btn-secondary" onclick="DrawingsPage.openDrawingModal(${drawingId})">Отмена</button>
          <button class="btn btn-primary" onclick="DrawingsPage.saveClientPrice(${drawingId}, ${clientId})">Сохранить</button>
        `,
      });
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async saveClientPrice(drawingId, clientId) {
    const markupPctValue = document.getElementById('cp-markup-pct').value.trim();
    const fixedValue = document.getElementById('cp-fixed-price').value.trim();
    try {
      await API.put(`/drawings/${drawingId}/clients/${clientId}`, {
        markup_pct: markupPctValue === '' ? null : parseFloat(markupPctValue),
        markup_rub: parseFloat(document.getElementById('cp-markup-rub').value) || 0,
        fixed_price: fixedValue === '' ? null : parseFloat(fixedValue),
      });
      Toast.success('Цена для клиента сохранена');
      await this.openDrawingModal(drawingId);
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async linkClient(drawingId) {
    const select = document.getElementById('drawing-link-client');
    const clientId = select && select.value;
    if (!clientId) { Toast.error('Выберите клиента'); return; }
    try {
      await API.post(`/drawings/${drawingId}/clients`, { client_id: Number(clientId) });
      Toast.success('Клиент привязан');
      await this.openDrawingModal(drawingId);
      await this.loadData();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async unlinkClient(drawingId, clientId) {
    // Имя берём из состояния, а не из inline-обработчика: пользовательские
    // строки в onclick ломают разметку и открывают XSS.
    const client = (this.clients || []).find(c => String(c.id) === String(clientId));
    const clientName = client ? client.name : `Клиент #${clientId}`;
    if (!await ConfirmDialog.delete(`Отвязать чертёж от клиента «${clientName}»? Сам чертёж останется.`)) return;
    try {
      await API.del(`/drawings/${drawingId}/clients/${clientId}`);
      Toast.success('Клиент отвязан');
      await this.openDrawingModal(drawingId);
      await this.loadData();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  openInCalculator(drawingId, clientId) {
    Modal.close();
    const query = `drawing=${drawingId}${clientId ? `&client=${clientId}` : ''}`;
    App.navigateTo(`calculator?${query}`);
  },

  async deleteDrawing(id) {
    if (!await ConfirmDialog.delete('Отправить чертёж в архив? Он сохранится, и его можно будет вернуть.')) return;

    try {
      await API.del(`/drawings/${id}`);
      Toast.success('Чертёж в архиве');
      Modal.close();
      await this.loadData();
    } catch (err) {
      Toast.error('Ошибка при архивации: ' + err.message);
    }
  },

  async restoreDrawing(id) {
    try {
      await API.post(`/drawings/${id}/restore`, {});
      Toast.success('Чертёж восстановлен из архива');
      Modal.close();
      await this.loadData();
    } catch (err) {
      Toast.error('Ошибка восстановления: ' + err.message);
    }
  },

  toggleArchive() {
    this.showArchived = !this.showArchived;
    const btn = document.getElementById('btn-archive-toggle');
    if (btn) btn.className = `btn btn-icon ${this.showArchived ? 'btn-primary' : 'btn-secondary'}`;
    this.loadData();
  },

  async openJournal() {
    try {
      const res = await API.get('/drawings/calculations?limit=200');
      const rows = res.data || [];
      Modal.open({
        title: '🧾 Журнал расчётов',
        wide: true,
        body: rows.length === 0
          ? Table.emptyState('Расчётов пока нет')
          : `
            <div class="table-wrapper" style="max-height:60vh;overflow-y:auto">
              <table class="data-table">
                <thead><tr><th>Дата</th><th>Чертёж</th><th>Клиент</th><th class="text-right">BOM</th><th class="text-right">Уровень</th><th class="text-right">Итого</th><th>Автор</th></tr></thead>
                <tbody>
                  ${rows.map(r => `
                    <tr>
                      <td class="text-muted" style="font-size:0.83rem">${new Date(r.created_at).toLocaleString('ru-RU')}</td>
                      <td><strong>${esc(r.drawing_name)}</strong>${r.drawing_archived_at ? ' <span class="badge" style="background:var(--bg-tertiary);color:var(--text-muted)">архив</span>' : ''}</td>
                      <td>${esc(r.client_name) || '—'}</td>
                      <td class="text-right">${Table.formatMoney(r.subtotal)}</td>
                      <td class="text-right">${parseFloat(r.level_markup_pct) > 0 ? '+' : ''}${parseFloat(r.level_markup_pct) || 0}%</td>
                      <td class="text-right" style="font-weight:600;color:var(--accent-teal)">${Table.formatMoney(r.total)}</td>
                      <td class="text-muted" style="font-size:0.83rem">${esc(r.author_name) || '—'}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>`,
        footer: '<button class="btn btn-secondary" onclick="Modal.close()">Закрыть</button>',
      });
    } catch (err) {
      Toast.error(err.message);
    }
  },
};
