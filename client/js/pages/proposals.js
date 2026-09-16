/* Proposals Page — Коммерческие предложения */
const ProposalsPage = {
  filters: { status: '', client_id: '', search: '', page: 1 },
  clients: [],
  principals: [],
  components: [],
  searchTimeout: null,

  async render() {
    const content = document.getElementById('content-area');
    const canEdit = API.can('orders', 'edit');

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
          <input type="text" id="proposals-search" placeholder="Поиск по номеру или клиенту..." value="${this.filters.search}">
        </div>
        <div class="filter-group">
          <select class="filter-select" id="proposals-status-filter">
            <option value="">Все статусы</option>
            <option value="draft" ${this.filters.status === 'draft' ? 'selected' : ''}>Черновик</option>
            <option value="sent" ${this.filters.status === 'sent' ? 'selected' : ''}>Отправлено</option>
            <option value="accepted" ${this.filters.status === 'accepted' ? 'selected' : ''}>Принято</option>
            <option value="rejected" ${this.filters.status === 'rejected' ? 'selected' : ''}>Отклонено</option>
            <option value="converted" ${this.filters.status === 'converted' ? 'selected' : ''}>В заказе</option>
          </select>
          <select class="filter-select" id="proposals-client-filter">
            <option value="">Все клиенты</option>
            ${this.clients.map(c => `<option value="${c.id}" ${this.filters.client_id == c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
          </select>
        </div>
        ${canEdit ? '<button class="btn btn-primary" onclick="ProposalsPage.openCreateModal()">+ Новое КП</button>' : ''}
      </div>
      <div id="proposals-table-container">${Table.loading()}</div>
    `;

    document.getElementById('proposals-search').addEventListener('input', (e) => {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => { this.filters.search = e.target.value; this.filters.page = 1; this.loadProposals(); }, 300);
    });
    document.getElementById('proposals-status-filter').addEventListener('change', (e) => { this.filters.status = e.target.value; this.filters.page = 1; this.loadProposals(); });
    document.getElementById('proposals-client-filter').addEventListener('change', (e) => { this.filters.client_id = e.target.value; this.filters.page = 1; this.loadProposals(); });

    this.loadProposals();
  },

  async loadProposals() {
    const container = document.getElementById('proposals-table-container');
    const canEdit = API.can('orders', 'edit');
    const canDelete = API.can('orders', 'delete');

    try {
      const params = new URLSearchParams();
      if (this.filters.status) params.set('status', this.filters.status);
      if (this.filters.client_id) params.set('client_id', this.filters.client_id);
      if (this.filters.search) params.set('search', this.filters.search);
      params.set('page', this.filters.page);
      params.set('limit', 30);

      const res = await API.get('/proposals?' + params.toString());
      const proposals = res.data;
      const total = res.total;

      if (proposals.length === 0) {
        container.innerHTML = Table.emptyState('Нет коммерческих предложений');
        return;
      }

      const statusMap = {
        draft: { label: 'Черновик', color: '#6b7280' },
        sent: { label: 'Отправлено', color: '#3b82f6' },
        accepted: { label: 'Принято', color: '#22c55e' },
        rejected: { label: 'Отклонено', color: '#ef4444' },
        converted: { label: 'В заказе', color: '#8b5cf6' },
      };

      container.innerHTML = `
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>№ КП</th>
                <th>Дата</th>
                <th>Клиент</th>
                <th>Статус</th>
                <th class="text-right">Сумма</th>
                <th>Действ. до</th>
                <th class="text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              ${proposals.map(p => {
                const st = statusMap[p.status] || statusMap.draft;
                return `
                  <tr style="cursor:pointer" onclick="ProposalsPage.viewProposal(${p.id})" title="Нажмите для просмотра">
                    <td class="font-mono" style="font-weight:600">${p.proposal_number}</td>
                    <td>${Table.formatDate(p.created_at)}</td>
                    <td><a href="#" onclick="event.stopPropagation();App.navigateTo('client-profile',${p.client_id});return false" class="client-link">${p.client_name || '—'}</a></td>
                    <td>
                      <span class="badge" style="background:${st.color}15;color:${st.color};border:1px solid ${st.color}30;font-size:0.75rem;padding:2px 8px;border-radius:12px;font-weight:600">
                        ${st.label}
                      </span>
                    </td>
                    <td class="text-right" style="font-weight:600">${Table.formatMoney(p.total)}</td>
                    <td>${p.valid_until ? Table.formatDate(p.valid_until) : '<span class="text-muted">—</span>'}</td>
                    <td class="text-right" onclick="event.stopPropagation()">
                      <div class="table-actions" style="justify-content:flex-end">
                        <button class="action-btn" title="Скачать PDF" onclick="ProposalsPage.downloadPDF(${p.id})">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>
                        </button>
                        ${Table.actionBtn(Table.viewIcon, 'Просмотр', `ProposalsPage.viewProposal(${p.id})`)}
                        ${canEdit ? Table.actionBtn(Table.editIcon, 'Редактировать', `ProposalsPage.openEditModal(${p.id})`) : ''}
                        ${canEdit && !p.order_id ? `<button class="action-btn" title="Перевести в заказ" onclick="ProposalsPage.convertToOrder(${p.id})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></button>` : ''}
                        ${canDelete ? Table.actionBtn(Table.deleteIcon, 'Удалить', `ProposalsPage.deleteProposal(${p.id})`, 'btn-danger') : ''}
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
        ${total > 30 ? `
          <div class="pagination">
            ${this.filters.page > 1 ? `<button class="btn btn-secondary btn-sm" onclick="ProposalsPage.filters.page--;ProposalsPage.loadProposals()">← Назад</button>` : ''}
            <span class="text-muted" style="padding:0 10px">Стр. ${this.filters.page} из ${Math.ceil(total / 30)}</span>
            ${this.filters.page < Math.ceil(total / 30) ? `<button class="btn btn-secondary btn-sm" onclick="ProposalsPage.filters.page++;ProposalsPage.loadProposals()">Далее →</button>` : ''}
          </div>
        ` : ''}
      `;
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-text">${err.message}</div></div>`;
    }
  },

  // === ПРОСМОТР КП ===
  async viewProposal(id) {
    try {
      const p = await API.get(`/proposals/${id}`);
      const statusMap = { draft: 'Черновик', sent: 'Отправлено', accepted: 'Принято', rejected: 'Отклонено', converted: 'В заказе' };

      Modal.open({
        title: `КП ${p.proposal_number}`,
        wide: true,
        body: `
          <div class="grid-2 mb-2">
            <div><strong>Клиент:</strong> ${p.client_name || '—'}</div>
            <div><strong>Принципал:</strong> ${p.principal_name || '—'}</div>
            <div><strong>Дата:</strong> ${Table.formatDate(p.created_at)}</div>
            <div><strong>Статус:</strong> ${statusMap[p.status] || p.status}</div>
            ${p.valid_until ? `<div><strong>Действ. до:</strong> ${Table.formatDate(p.valid_until)}</div>` : ''}
            ${p.order_id ? `<div><strong>Заказ:</strong> <a href="#" onclick="Modal.close();App.navigateTo('orders')" style="color:var(--accent-teal)">Перейти к заказу</a></div>` : ''}
          </div>
          ${p.client_inn ? `<div class="mb-2" style="padding:10px;background:var(--bg-main);border-radius:8px;border:1px solid var(--border);font-size:0.85rem">
            <strong>Реквизиты:</strong> ИНН ${p.client_inn}${p.client_kpp ? ' / КПП ' + p.client_kpp : ''}
            ${p.client_legal_address ? '<br>' + p.client_legal_address : ''}
          </div>` : ''}
          ${p.comment ? `<div class="mb-2"><strong>Комментарий:</strong> ${p.comment}</div>` : ''}
          <h4 class="mb-1" style="color:var(--text-secondary)">Позиции</h4>
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th style="width:30px">#</th><th>Артикул</th><th>Название</th>${(p.items || []).some(i => i.image_path) ? '<th style="width:60px">Фото</th>' : ''}<th class="text-right">Цена</th><th class="text-right">Кол-во</th><th class="text-right">Сумма</th></tr></thead>
              <tbody>
                ${(p.items || []).map((item, i) => `
                  <tr>
                    <td style="color:var(--text-muted)">${i + 1}</td>
                    <td><span class="font-mono" style="color:var(--accent-teal);font-size:0.82rem">${item.article || '—'}</span></td>
                    <td title="${(item.product_name || '').replace(/"/g, '&quot;')}" style="font-weight:500"><span style="display:inline-block;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle">${item.product_name}${item.description ? '<br><span style="font-size:0.8rem;color:var(--text-muted)">' + item.description + '</span>' : ''} ${item.is_drawing ? '📐' : ''}</span></td>
                    ${(p.items || []).some(i => i.image_path) ? `<td>${item.image_path ? `<img src="${item.image_path}" style="width:48px;height:48px;object-fit:cover;border-radius:6px">` : ''}</td>` : ''}
                    <td class="text-right">${Table.formatMoney(item.unit_price)}</td>
                    <td class="text-right">${item.quantity}</td>
                    <td class="text-right" style="font-weight:600">${Table.formatMoney(item.line_total)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <div class="mt-2" style="text-align:right">
            <div style="font-size:1.15rem">Итого: <strong style="color:var(--accent-teal)">${Table.formatMoney(p.total)}</strong></div>
          </div>
        `,
        footer: `
          <button class="btn btn-secondary" onclick="Modal.close()">Закрыть</button>
          <button class="btn btn-secondary" onclick="ProposalsPage.downloadPDF(${p.id})">📄 Скачать PDF</button>
          ${p.status !== 'converted' && API.isAdmin() ? `<button class="btn btn-primary" onclick="Modal.close();ProposalsPage.convertToOrder(${p.id})">✅ Перевести в заказ</button>` : ''}
        `,
      });
    } catch (err) { Toast.error(err.message); }
  },

  // === СОЗДАНИЕ / РЕДАКТИРОВАНИЕ ===
  openCreateModal() { this._openModal(null); },

  async openEditModal(id) {
    try {
      const proposal = await API.get(`/proposals/${id}`);
      this._openModal(proposal);
    } catch (err) { Toast.error(err.message); }
  },

  _openModal(proposal) {
    const isEdit = !!proposal;
    const items = isEdit ? (proposal.items || []) : [];

    Modal.open({
      title: isEdit ? `Редактировать ${proposal.proposal_number}` : 'Новое КП',
      wide: true,
      body: `
        <form id="proposal-form">
          <div class="form-row">
            <div class="form-group">
              <label>Клиент *</label>
              <select class="form-control" id="prop-client">
                <option value="">Выберите клиента</option>
                ${this.clients.map(c => `<option value="${c.id}" data-markup="${c.pricing_markup_pct || 0}" data-level="${c.pricing_level_name || ''}" ${isEdit && proposal.client_id == c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
              </select>
              <div id="prop-client-level" style="margin-top:4px;font-size:0.78rem"></div>
            </div>
            <div class="form-group">
              <label>Принципал</label>
              <select class="form-control" id="prop-principal">
                <option value="">Без принципала</option>
                ${this.principals.map((p, i) => `<option value="${p.id}" ${isEdit ? (proposal.principal_id == p.id ? 'selected' : '') : (i === 0 ? 'selected' : '')}>${p.name}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Действительно до</label>
              <input type="date" class="form-control" id="prop-valid-until" value="${isEdit && proposal.valid_until ? proposal.valid_until.split('T')[0] : ''}">
            </div>
            <div class="form-group">
              <label>Статус</label>
              <select class="form-control" id="prop-status">
                <option value="draft" ${isEdit && proposal.status === 'draft' ? 'selected' : ''}>Черновик</option>
                <option value="sent" ${isEdit && proposal.status === 'sent' ? 'selected' : ''}>Отправлено</option>
                <option value="accepted" ${isEdit && proposal.status === 'accepted' ? 'selected' : ''}>Принято</option>
                <option value="rejected" ${isEdit && proposal.status === 'rejected' ? 'selected' : ''}>Отклонено</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Комментарий</label>
            <textarea class="form-control" id="prop-comment" rows="2">${isEdit ? (proposal.comment || '') : ''}</textarea>
          </div>

          <h4 class="mb-1 mt-2" style="color:var(--text-secondary)">Позиции</h4>
          <div id="prop-items-list">
            ${items.map((item, i) => this._renderItemCard(item, i)).join('')}
          </div>

          <div class="flex gap-1 mt-1" style="flex-wrap:wrap">
            <button type="button" class="btn btn-primary btn-sm" onclick="ProposalsPage.openComponentCatalog()">📦 Из каталога</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="ProposalsPage.addCustomItem()">✏️ Произвольная позиция</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="ProposalsPage.openDrawingPicker()">📐 Добавить чертёж</button>
          </div>

          <div class="mt-2" id="prop-totals" style="text-align:right; font-size:0.95rem;"></div>
        </form>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Отмена</button>
        <button class="btn btn-primary" onclick="ProposalsPage.saveProposal(${isEdit ? proposal.id : 'null'})">${isEdit ? 'Сохранить' : 'Создать'}</button>
      `,
    });
    document.getElementById('prop-client').addEventListener('change', () => this.recalcTotals());
    this.recalcTotals();
  },

  _renderItemCard(item, idx) {
    const isDrawing = item.is_drawing || false;
    const displayName = item.product_name || (isDrawing ? 'Чертёж' : 'Позиция');
    const icon = isDrawing ? '📐' : '📦';
    const article = item.article || '';
    const price = item.unit_price || 0;
    const qty = item.quantity || 1;
    const sw = 'display:flex;align-items:stretch;border-radius:6px;border:1px solid var(--border);overflow:hidden;height:32px';
    const sb = 'width:26px;border:none;background:var(--bg-tertiary);color:var(--text-secondary);cursor:pointer;font-size:0.95rem;font-weight:700;display:flex;align-items:center;justify-content:center;transition:all 0.15s;flex-shrink:0';
    const hi = "this.style.background='var(--accent-teal)';this.style.color='#fff'";
    const ho = "this.style.background='var(--bg-tertiary)';this.style.color='var(--text-secondary)'";
    const si = 'flex:1;text-align:center;font-size:0.85rem;font-weight:600;border:none;border-left:1px solid var(--border);border-right:1px solid var(--border);border-radius:0;padding:0;-moz-appearance:textfield;min-width:0';
    return `
      <div data-prop-item="${idx}" style="margin-bottom:6px;padding:8px 12px;background:var(--bg-main);border-radius:10px;border:1px solid var(--border);transition:border-color 0.15s" onmouseenter="this.style.borderColor='var(--accent-teal)'" onmouseleave="this.style.borderColor='var(--border)'">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:1rem;flex-shrink:0">${icon}</span>
          <div style="flex:1;min-width:80px;overflow:hidden">
            <div style="display:flex;align-items:baseline;gap:6px">
              ${article ? `<span class="font-mono" style="font-weight:700;font-size:0.82rem;color:var(--accent-teal);white-space:nowrap">${article}</span>` : ''}
              <span style="font-size:0.78rem;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${displayName.replace(/"/g, '&quot;')}">${displayName}</span>
            </div>
          </div>
          <div style="flex-shrink:0;width:140px">
            <div style="font-size:0.6rem;color:var(--text-muted);margin-bottom:2px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px">Цена ₽</div>
            <div style="${sw}">
              <button type="button" onclick="var inp=this.nextElementSibling;inp.value=Math.max(0,(parseFloat(inp.value||0)-10)).toFixed(2);inp.dispatchEvent(new Event('input'))" style="${sb}" onmouseenter="${hi}" onmouseleave="${ho}">−</button>
              <input type="number" step="0.01" class="form-control prop-item-price" value="${price}" placeholder="0" style="${si}" oninput="ProposalsPage._onPriceManualChange(this)">
              <button type="button" onclick="var inp=this.previousElementSibling;inp.value=(parseFloat(inp.value||0)+10).toFixed(2);inp.dispatchEvent(new Event('input'))" style="${sb}" onmouseenter="${hi}" onmouseleave="${ho}">+</button>
            </div>
          </div>
          <div style="flex-shrink:0;width:95px">
            <div style="font-size:0.6rem;color:var(--text-muted);margin-bottom:2px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px">Нац. %</div>
            <div style="${sw}">
              <button type="button" onclick="var inp=this.nextElementSibling;inp.value=parseInt(inp.value||0)-1;inp.dispatchEvent(new Event('input'))" style="${sb}" onmouseenter="${hi}" onmouseleave="${ho}">−</button>
              <input type="number" step="1" class="form-control prop-item-markup" value="0" style="${si}" oninput="ProposalsPage._applyMarkup(this)">
              <button type="button" onclick="var inp=this.previousElementSibling;inp.value=parseInt(inp.value||0)+1;inp.dispatchEvent(new Event('input'))" style="${sb}" onmouseenter="${hi}" onmouseleave="${ho}">+</button>
            </div>
          </div>
          <div style="flex-shrink:0;width:95px">
            <div style="font-size:0.6rem;color:var(--text-muted);margin-bottom:2px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px">Кол-во</div>
            <div style="${sw}">
              <button type="button" onclick="var inp=this.nextElementSibling;inp.value=Math.max(1,parseInt(inp.value||1)-1);inp.dispatchEvent(new Event('input'))" style="${sb}" onmouseenter="${hi}" onmouseleave="${ho}">−</button>
              <input type="number" class="form-control prop-item-qty" value="${qty}" min="1" style="${si};font-weight:700" oninput="ProposalsPage.recalcTotals()">
              <button type="button" onclick="var inp=this.previousElementSibling;inp.value=parseInt(inp.value||1)+1;inp.dispatchEvent(new Event('input'))" style="${sb}" onmouseenter="${hi}" onmouseleave="${ho}">+</button>
            </div>
          </div>
          <div style="flex-shrink:0;width:90px;text-align:right">
            <div style="font-size:0.6rem;color:var(--text-muted);margin-bottom:2px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px">Сумма</div>
            <div class="prop-item-total" style="font-weight:700;font-size:0.95rem;color:var(--accent-teal);line-height:32px">${Table.formatMoneyRaw(price * qty)}</div>
          </div>
          <button type="button" onclick="this.closest('[data-prop-item]').remove();ProposalsPage.recalcTotals()" style="flex-shrink:0;width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-tertiary);color:var(--accent-red);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.75rem;transition:all 0.15s;margin-top:10px" onmouseenter="this.style.background='var(--accent-red)';this.style.color='#fff';this.style.borderColor='var(--accent-red)'" onmouseleave="this.style.background='var(--bg-tertiary)';this.style.color='var(--accent-red)';this.style.borderColor='var(--border)'">✕</button>
        </div>
        <input type="hidden" class="prop-item-name" value="${item.product_name || ''}">
        <input type="hidden" class="prop-item-image" value="${item.image_path || ''}">
        <input type="hidden" class="prop-item-drawing-id" value="${item.drawing_id || ''}">
        <input type="hidden" class="prop-item-is-drawing" value="${isDrawing}">
        <input type="hidden" class="prop-item-product-id" value="${item.product_id || ''}">
        <input type="hidden" class="prop-item-base-price" value="${price}">
      </div>
    `;
  },



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
                  <tr style="cursor:pointer" onclick="ProposalsPage._addCatalogComponent(${c.id})">
                    <td>${c.image_path ? `<img src="${c.image_path}" style="width:32px;height:32px;object-fit:cover;border-radius:4px">` : '📦'}</td>
                    <td class="font-mono" style="color:var(--accent-teal)">${c.article}</td>
                    <td>${c.name}${modCount > 0 ? `<span style="margin-left:6px;padding:1px 6px;border-radius:8px;font-size:0.65rem;font-weight:600;background:var(--accent-teal);color:#fff">${modCount} мод.</span>` : ''}</td>
                    <td><span class="badge badge-in_progress" style="font-size:0.7rem">${c.category_name || '—'}</span></td>
                    <td class="text-right">${Table.formatMoney(c.price)}</td>
                    <td class="text-right"><button class="btn btn-primary btn-sm" onclick="event.stopPropagation();ProposalsPage._addCatalogComponent(${c.id})">+</button></td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` : Table.emptyState('Компоненты не найдены');
    };

    // Overlay поверх модальки КП
    const overlay = document.createElement('div');
    overlay.id = 'prop-catalog-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `
      <div style="background:var(--bg-card);border-radius:16px;padding:24px;width:700px;max-width:95vw;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.4)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="margin:0;color:var(--text-primary)">Каталог компонентов</h3>
          <button onclick="document.getElementById('prop-catalog-overlay').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--text-muted);padding:4px 8px">✕</button>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <input type="text" class="form-control" id="prop-cat-search" placeholder="Поиск по артикулу или названию..." style="flex:1">
          <select class="form-control" id="prop-cat-filter" style="width:180px">
            <option value="">Все категории</option>
            ${categories.map(cat => `<option value="${cat}">${cat}</option>`).join('')}
          </select>
        </div>
        <div id="prop-cat-list" style="flex:1;overflow-y:auto">${renderList()}</div>
      </div>
    `;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    document.getElementById('prop-cat-search').addEventListener('input', (e) => {
      filterSearch = e.target.value;
      document.getElementById('prop-cat-list').innerHTML = renderList();
    });
    document.getElementById('prop-cat-filter').addEventListener('change', (e) => {
      filterCat = e.target.value;
      document.getElementById('prop-cat-list').innerHTML = renderList();
    });
  },

  async _addCatalogComponent(compId) {
    const comp = this.components.find(c => c.id === compId);
    if (!comp) return;

    // Если есть модификации — показать пикер
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

    this._insertComponentItem(comp, null);
  },

  _showModPicker(comp, mods) {
    const overlay = document.getElementById('prop-catalog-overlay');
    if (!overlay) return;
    const content = overlay.querySelector('div');

    const renderMods = () => {
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="margin:0;color:var(--text-primary)">Модификации: ${comp.article}</h3>
          <button onclick="document.getElementById('prop-catalog-overlay').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--text-muted);padding:4px 8px">✕</button>
        </div>
        <div style="margin-bottom:12px;font-size:0.85rem;color:var(--text-muted)">Выберите модификацию или базовый компонент</div>
        <div style="display:flex;flex-direction:column;gap:8px;overflow-y:auto;max-height:60vh">
          <div style="background:var(--bg-main);border:1px solid var(--border);border-radius:10px;padding:10px 14px;cursor:pointer;transition:border-color 0.2s"
               onclick="ProposalsPage._insertComponentItem(ProposalsPage.components.find(c=>c.id===${comp.id}), null);ProposalsPage._backToCatalog()"
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
                   onclick="ProposalsPage._insertModItem(${comp.id}, ${m.id});ProposalsPage._backToCatalog()"
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
          <button class="btn btn-secondary btn-sm" onclick="ProposalsPage._backToCatalog()">← К каталогу</button>
        </div>
      `;
    };

    content.innerHTML = renderMods();
  },

  _backToCatalog() {
    const overlay = document.getElementById('prop-catalog-overlay');
    if (overlay) overlay.remove();
    this.openComponentCatalog();
  },

  _insertComponentItem(comp, modId) {
    const container = document.getElementById('prop-items-list');
    if (!container) return;
    const idx = container.querySelectorAll('[data-prop-item]').length;
    const item = {
      product_id: comp.id,
      product_name: comp.name,
      article: comp.article || '',
      unit_price: parseFloat(comp.price),
      quantity: 1,
      image_path: comp.image_path || '',
    };
    container.insertAdjacentHTML('beforeend', this._renderItemCard(item, idx));
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
      const container = document.getElementById('prop-items-list');
      if (!container) return;
      const idx = container.querySelectorAll('[data-prop-item]').length;
      container.insertAdjacentHTML('beforeend', this._renderItemCard({
        product_id: comp.id,
        product_name: name,
        article: fullArticle,
        unit_price: price,
        quantity: 1,
        image_path: comp.image_path || '',
      }, idx));
      this.recalcTotals();
      Toast.success(`${name} добавлен`);
    }).catch(() => {});
  },

  async openDrawingPicker() {
    const clientId = document.getElementById('prop-client')?.value;
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
                   onclick="ProposalsPage.addDrawingItem(${d.id})">
                <div style="width:48px;height:48px;background:var(--bg-main);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.2rem">📐</div>
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

    const container = document.getElementById('prop-items-list');
    if (!container) return;
    const idx = container.querySelectorAll('[data-prop-item]').length;
    const drawingName = drawing.title || drawing.name || `Чертёж #${drawingId}`;
    container.insertAdjacentHTML('beforeend', this._renderItemCard({
      product_name: `Чертёж: ${drawingName}`,
      unit_price: parseFloat(drawing.total_cost) || 0,
      quantity: 1,
      is_drawing: true,
      drawing_id: drawing.id,
      image_path: '',
    }, idx));
    this.recalcTotals();
    Toast.success(`Чертёж «${drawingName}» добавлен`);
  },

  addCustomItem() {
    const container = document.getElementById('prop-items-list');
    if (!container) return;
    const idx = container.querySelectorAll('[data-prop-item]').length;
    container.insertAdjacentHTML('beforeend', this._renderCustomItemCard(idx));
  },

  _renderCustomItemCard(idx) {
    return `
      <div data-prop-item="${idx}" style="margin-bottom:8px;padding:10px 14px;background:var(--bg-main);border-radius:10px;border:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:1rem">✏️</span>
          <input type="text" class="form-control prop-item-name" value="" placeholder="Название позиции" style="flex:1;font-weight:600;font-size:0.88rem">
          <button type="button" class="btn btn-danger btn-sm" onclick="this.closest('[data-prop-item]').remove();ProposalsPage.recalcTotals()" style="padding:2px 8px;font-size:0.75rem">✕</button>
        </div>
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div style="flex-shrink:0">
            <label style="display:block;font-size:0.7rem;color:var(--text-muted);margin-bottom:3px">Цена, ₽</label>
            <input type="number" step="0.01" class="form-control prop-item-price" value="" placeholder="0.00" style="width:110px;text-align:right;font-size:0.85rem" oninput="ProposalsPage._onPriceManualChange(this)">
          </div>
          <div style="flex-shrink:0">
            <label style="display:block;font-size:0.7rem;color:var(--text-muted);margin-bottom:3px">Наценка, %</label>
            <input type="number" step="1" class="form-control prop-item-markup" value="0" style="width:65px;text-align:center;font-size:0.85rem" oninput="ProposalsPage._applyMarkup(this)">
          </div>
          <div style="flex-shrink:0">
            <label style="display:block;font-size:0.7rem;color:var(--text-muted);margin-bottom:3px">Кол-во</label>
            <input type="number" class="form-control prop-item-qty" value="1" min="1" style="width:60px;text-align:center;font-size:0.85rem" oninput="ProposalsPage.recalcTotals()">
          </div>
          <div style="flex-shrink:0;min-width:90px;text-align:right;padding-bottom:6px">
            <label style="display:block;font-size:0.7rem;color:var(--text-muted);margin-bottom:3px">Сумма</label>
            <div style="font-weight:600;font-size:0.85rem;color:var(--accent-teal)" class="prop-item-total">—</div>
          </div>
        </div>
        <input type="hidden" class="prop-item-image" value="">
        <input type="hidden" class="prop-item-drawing-id" value="">
        <input type="hidden" class="prop-item-is-drawing" value="false">
        <input type="hidden" class="prop-item-product-id" value="">
        <input type="hidden" class="prop-item-base-price" value="0">
      </div>
    `;
  },

  _applyMarkup(input) {
    const row = input.closest('[data-prop-item]');
    const priceInput = row.querySelector('.prop-item-price');
    const basePriceInput = row.querySelector('.prop-item-base-price');
    let basePrice = parseFloat(basePriceInput.value) || 0;

    // If no base price, use current price as base
    if (basePrice === 0) {
      basePrice = parseFloat(priceInput.value) || 0;
      if (basePrice > 0) basePriceInput.value = basePrice;
    }

    const pct = parseInt(input.value) || 0;
    if (basePrice > 0) {
      const newPrice = Math.round(basePrice * (1 + pct / 100) * 100) / 100;
      priceInput.value = Math.max(0, newPrice);
    }
    this.recalcTotals();
  },

  _onPriceManualChange(input) {
    const row = input.closest('[data-prop-item]');
    const markupInput = row.querySelector('.prop-item-markup');
    if (markupInput) markupInput.value = 0;
    this.recalcTotals();
  },

  recalcTotals() {
    const clientSelect = document.getElementById('prop-client');
    const clientOpt = clientSelect?.selectedOptions[0];
    const levelMarkupPct = parseFloat(clientOpt?.dataset?.markup) || 0;
    const levelName = clientOpt?.dataset?.level || '';

    // Обновить бейдж уровня
    const levelEl = document.getElementById('prop-client-level');
    if (levelEl && clientSelect?.value) {
      if (levelName) {
        const color = levelMarkupPct > 0 ? 'var(--accent-teal)' : levelMarkupPct < 0 ? 'var(--accent-blue)' : 'var(--text-muted)';
        levelEl.innerHTML = `<span style="padding:2px 10px;border-radius:12px;background:${color}15;color:${color};border:1px solid ${color}40;font-weight:600">💰 ${levelName} (${levelMarkupPct > 0 ? '+' : ''}${levelMarkupPct}%)</span>`;
      } else {
        levelEl.innerHTML = '<span style="color:var(--accent-red);font-weight:600">⚠️ Уровень цен не задан</span>';
      }
    } else if (levelEl) {
      levelEl.innerHTML = '';
    }

    const rows = document.querySelectorAll('[data-prop-item]');
    let totalBase = 0;
    let totalWithLevel = 0;
    rows.forEach(row => {
      const price = parseFloat(row.querySelector('.prop-item-price')?.value) || 0;
      const qty = parseInt(row.querySelector('.prop-item-qty')?.value) || 1;
      const priceWithLevel = price * (1 + levelMarkupPct / 100);
      totalBase += price * qty;
      totalWithLevel += priceWithLevel * qty;
      const totalEl = row.querySelector('.prop-item-total');
      if (totalEl) totalEl.textContent = Table.formatMoneyRaw(priceWithLevel * qty);
    });
    const levelDiff = totalWithLevel - totalBase;
    const el = document.getElementById('prop-totals');
    if (el) {
      el.innerHTML = `
        <div style="font-size:1.1rem">Итого: <strong style="color:var(--accent-teal)">${Table.formatMoney(totalWithLevel)}</strong></div>
        ${levelName ? `<div style="font-size:0.82rem;color:var(--text-secondary);margin-top:4px">💰 Наценка уровня «${levelName}» (${levelMarkupPct > 0 ? '+' : ''}${levelMarkupPct}%): <strong>${levelDiff >= 0 ? '+' : ''}${Table.formatMoneyRaw(levelDiff)}</strong></div>` : ''}
      `;
    }
  },

  async saveProposal(id) {
    const client_id = document.getElementById('prop-client').value;
    const principal_id = document.getElementById('prop-principal').value || null;
    const valid_until = document.getElementById('prop-valid-until').value || null;
    const status = document.getElementById('prop-status').value;
    const comment = document.getElementById('prop-comment').value;

    if (!client_id) { Toast.error('Выберите клиента'); return; }

    const rows = document.querySelectorAll('[data-prop-item]');
    const items = [];
    rows.forEach(row => {
      const nameInput = row.querySelector('.prop-item-name');
      const priceInput = row.querySelector('.prop-item-price');
      const qtyInput = row.querySelector('.prop-item-qty');
      const imgInput = row.querySelector('.prop-item-image');
      const drawingIdInput = row.querySelector('.prop-item-drawing-id');
      const isDrawingInput = row.querySelector('.prop-item-is-drawing');
      const productIdInput = row.querySelector('.prop-item-product-id');

      const isDrawing = isDrawingInput && (isDrawingInput.value === 'true' || isDrawingInput.value === true);
      const product_id = productIdInput ? productIdInput.value || null : null;
      const product_name = nameInput ? nameInput.value : '';

      const price = parseFloat(priceInput.value) || 0;
      // Применить наценку уровня клиента к цене при сохранении
      const clientOpt = document.getElementById('prop-client')?.selectedOptions[0];
      const lvlMarkup = parseFloat(clientOpt?.dataset?.markup) || 0;
      const finalPrice = price * (1 + lvlMarkup / 100);
      if (product_name && price > 0) {
        items.push({
          product_id,
          product_name,
          description: '',
          unit_price: Math.round(finalPrice * 100) / 100,
          quantity: parseInt(qtyInput.value) || 1,
          image_path: imgInput ? imgInput.value || null : null,
          drawing_id: drawingIdInput && drawingIdInput.value ? parseInt(drawingIdInput.value) : null,
          is_drawing: isDrawing,
        });
      }
    });

    if (items.length === 0) { Toast.error('Добавьте хотя бы одну позицию'); return; }

    try {
      if (id) {
        await API.put(`/proposals/${id}`, { client_id, principal_id, valid_until, status, comment, items });
        Toast.success('КП обновлено');
      } else {
        await API.post('/proposals', { client_id, principal_id, valid_until, status, comment, items });
        Toast.success('КП создано');
      }
      Modal.close();
      this.loadProposals();
    } catch (err) { Toast.error(err.message); }
  },

  // === PDF ===
  downloadPDF(id) {
    const token = API.getToken();
    const vat = Table.getVATSettings();
    window.open(`/api/proposals/${id}/pdf?token=${token}&vat_rate=${vat.rate}`, '_blank');
  },

  // === ПЕРЕВОД В ЗАКАЗ ===
  async convertToOrder(id) {
    if (!confirm('Перевести это КП в заказ? Будет создан новый заказ с позициями из КП.')) return;
    try {
      const result = await API.post(`/proposals/${id}/convert`);
      Toast.success(`Заказ ${result.order_number} создан из КП`);
      this.loadProposals();
    } catch (err) { Toast.error(err.message); }
  },

  // === УДАЛЕНИЕ ===
  async deleteProposal(id) {
    if (!confirm('Удалить это КП?')) return;
    try {
      await API.del(`/proposals/${id}`);
      Toast.success('КП удалено');
      this.loadProposals();
    } catch (err) { Toast.error(err.message); }
  },
};
