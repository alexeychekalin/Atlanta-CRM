/* Leads Page — заявки с сайта: список, карточка, превращение в клиента */
const LeadsPage = {
  filters: { status: '', search: '' },
  searchTimeout: null,
  statuses: { new: 'Новая', in_progress: 'В работе', converted: 'Стала клиентом', rejected: 'Отказ' },
  statusColors: { new: '#3b82f6', in_progress: '#f59e0b', converted: '#22c55e', rejected: '#6b7280' },
  counts: {},
  currentId: null,

  async render() {
    const content = document.getElementById('content-area');
    content.innerHTML = `
      <div class="toolbar">
        <div class="search-input">
          <input type="text" id="leads-search" placeholder="Поиск по имени, телефону, тексту..." value="${esc(this.filters.search)}">
        </div>
        <div class="filter-group">
          <select class="filter-select" id="leads-status-filter">
            <option value="">Все заявки</option>
            <option value="new">Новые</option>
            <option value="in_progress">В работе</option>
            <option value="converted">Стали клиентами</option>
            <option value="rejected">Отказ</option>
          </select>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="LeadsPage.reload()" title="Обновить список">↻ Обновить</button>
      </div>
      <div id="leads-table-container">${Table.loading()}</div>
    `;

    document.getElementById('leads-status-filter').value = this.filters.status;
    document.getElementById('leads-search').addEventListener('input', (e) => {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => {
        this.filters.search = e.target.value.trim();
        this.load();
      }, 300);
    });
    document.getElementById('leads-status-filter').addEventListener('change', (e) => {
      this.filters.status = e.target.value;
      this.load();
    });

    this.load();
  },

  async reload() {
    await this.load();
    Toast.success('Список обновлён');
  },

  async load() {
    const container = document.getElementById('leads-table-container');
    if (!container) return;

    try {
      const params = new URLSearchParams();
      if (this.filters.status) params.set('status', this.filters.status);
      if (this.filters.search) params.set('search', this.filters.search);
      const query = params.toString();
      const res = await API.get('/leads' + (query ? `?${query}` : ''));
      this.counts = res.counts || {};
      if (res.statuses) this.statuses = res.statuses;
      const leads = res.data || [];

      const badge = (status) => {
        const color = this.statusColors[status] || '#6b7280';
        return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;background:${color}15;color:${color};font-size:0.75rem;font-weight:600;border:1px solid ${color}30;white-space:nowrap">${esc(this.statuses[status] || status)}</span>`;
      };

      if (leads.length === 0) {
        const text = this.filters.search || this.filters.status
          ? 'Заявок по этому фильтру нет'
          : 'Заявок пока нет. Они появятся здесь, как только кто-то отправит форму на сайте.';
        container.innerHTML = Table.emptyState(text);
        return;
      }

      const counters = Object.entries(this.statuses)
        .filter(([key]) => this.counts[key])
        .map(([key, label]) => `<span style="display:inline-flex;align-items:center;gap:6px;color:var(--text-secondary);font-size:0.82rem">
          <span style="width:8px;height:8px;border-radius:50%;background:${this.statusColors[key] || '#6b7280'}"></span>${esc(label)}: <strong>${this.counts[key]}</strong>
        </span>`).join('');

      container.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:12px">${counters}</div>
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>№</th>
                <th>Заявка</th>
                <th>Позиции</th>
                <th>Источник</th>
                <th>Статус</th>
                <th>Получена</th>
                <th class="text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              ${leads.map(lead => `
                <tr style="cursor:pointer" onclick="LeadsPage.open(${lead.id})" title="Открыть заявку">
                  <td style="color:var(--text-muted)">${lead.id}</td>
                  <td>
                    <strong>${esc(lead.name)}</strong>
                    <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px">
                      📞 ${esc(lead.phone)}${lead.email ? ` · ✉️ ${esc(lead.email)}` : ''}
                    </div>
                    ${lead.message ? `<div style="font-size:0.78rem;color:var(--text-muted);margin-top:3px;max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(lead.message)}">${esc(lead.message)}</div>` : ''}
                  </td>
                  <td>
                    ${lead.item_count > 0
                      ? `<span style="font-weight:600">${lead.item_count}</span> <span style="color:var(--text-muted);font-size:0.8rem">поз.</span>`
                      : (lead.article ? `<span style="font-size:0.82rem">${esc(lead.article)}</span>` : '<span style="color:var(--text-muted)">—</span>')}
                    ${lead.file_count > 0 ? `<div style="font-size:0.78rem;color:var(--text-muted)">📎 ${lead.file_count}</div>` : ''}
                  </td>
                  <td><span style="font-size:0.8rem;color:var(--text-muted)">${esc(lead.source || 'site')}</span></td>
                  <td>${badge(lead.status)}${lead.status === 'converted' && lead.client_name ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px">${esc(lead.client_name)}</div>` : ''}</td>
                  <td style="white-space:nowrap;font-size:0.82rem">${Table.formatDateTime(lead.created_at)}</td>
                  <td class="text-right" onclick="event.stopPropagation()">
                    <button class="btn btn-secondary btn-sm" onclick="LeadsPage.open(${lead.id})">Открыть</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-text">Ошибка: ${esc(err.message)}</div></div>`;
    }
  },

  async open(id) {
    this.currentId = id;
    const content = document.getElementById('content-area');
    content.innerHTML = Table.loading();

    let lead;
    try {
      lead = await API.get(`/leads/${id}`);
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state-text">Ошибка: ${esc(err.message)}</div></div>`;
      return;
    }

    const canEdit = API.can('leads', 'edit');
    const canConvert = API.can('clients', 'edit') && lead.status !== 'converted';
    const canDelete = API.can('leads', 'delete');
    const badge = (status) => {
      const color = this.statusColors[status] || '#6b7280';
      return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;background:${color}15;color:${color};font-size:0.78rem;font-weight:600;border:1px solid ${color}30">${esc(this.statuses[status] || status)}</span>`;
    };

    const notifyState = (lead.notifications || [])[0];
    let notifyLine = '<span style="color:var(--text-muted)">Уведомление ещё не отправлялось</span>';
    if (notifyState) {
      const when = Table.formatDateTime(notifyState.created_at);
      notifyLine = notifyState.ok
        ? `<span style="color:var(--accent-green)">✓ Отправлено ${when}</span>`
        : `<span style="color:var(--accent-red)">✗ Не отправлено ${when}</span> <span style="color:var(--text-muted);font-size:0.8rem">— проверьте токен бота и chat_id</span>`;
    }

    content.innerHTML = `
      <button class="btn btn-secondary btn-sm mb-2" onclick="App.navigateTo('leads')" style="gap:6px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="15 18 9 12 15 6"/></svg>
        К списку заявок
      </button>

      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:12px">
          <h2 style="margin:0">Заявка №${lead.id}</h2>
          ${badge(lead.status)}
          <span style="color:var(--text-muted);font-size:0.85rem">${Table.formatDateTime(lead.created_at)}</span>
          <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
            ${canEdit ? `<button class="btn btn-secondary btn-sm" onclick="LeadsPage.notify(${lead.id})" title="Отправить уведомление ещё раз">📨 Уведомить</button>` : ''}
            ${canConvert ? `<button class="btn btn-primary btn-sm" onclick="LeadsPage.convert(${lead.id})">→ В клиента</button>` : ''}
            ${canDelete ? `<button class="btn btn-danger btn-sm" onclick="LeadsPage.remove(${lead.id})">Удалить</button>` : ''}
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
          <div><div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em">Контакт</div>
            <div style="font-weight:600;margin-top:4px">${esc(lead.name)}</div>
            <div style="font-size:0.88rem;margin-top:4px">📞 <a href="tel:${esc(String(lead.phone).replace(/[^\d+]/g, ''))}" style="color:var(--accent-teal)">${esc(lead.phone)}</a></div>
            ${lead.email ? `<div style="font-size:0.88rem">✉️ <a href="mailto:${esc(lead.email)}" style="color:var(--accent-teal)">${esc(lead.email)}</a></div>` : ''}
            ${lead.company ? `<div style="font-size:0.88rem">🏢 ${esc(lead.company)}</div>` : ''}
          </div>
          <div><div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em">Откуда пришла</div>
            <div style="font-size:0.88rem;margin-top:4px">${esc(lead.page) || '—'}</div>
            <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">${esc(lead.source || 'site')}</div>
          </div>
          <div><div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em">Уведомление</div>
            <div style="font-size:0.85rem;margin-top:4px">${notifyLine}</div>
          </div>
          ${lead.client_id ? `<div><div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em">Клиент</div>
            <div style="margin-top:4px"><a href="#" onclick="App.navigateTo('client-profile',${lead.client_id});return false" class="client-link">${esc(lead.client_name || 'карточка клиента')}</a></div>` : ''}
        </div>
      </div>

      ${lead.items && lead.items.length > 0 ? `
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Позиции заявки (${lead.items.length})</div>
        <div class="table-wrapper">
          <table class="data-table">
            <thead><tr><th>Артикул</th><th>Наименование</th><th class="text-right">Кол-во</th></tr></thead>
            <tbody>
              ${lead.items.map(item => `<tr>
                <td>${esc(item.article) || '—'}</td>
                <td>${esc(item.name) || '—'}</td>
                <td class="text-right">${item.quantity}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div style="font-size:0.8rem;color:var(--text-muted);margin-top:8px">Цены не публикуются на сайте — смету считайте в калькуляторе и отвечайте клиенту.</div>
      </div>` : ''}

      ${lead.message ? `
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Сообщение клиента</div>
        <div style="white-space:pre-wrap;line-height:1.6">${esc(lead.message)}</div>
      </div>` : ''}

      ${lead.files && lead.files.length > 0 ? `
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Файлы (${lead.files.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${lead.files.map(file => {
            const isImage = /\.(jpe?g|png|webp|heic|heif)$/i.test(file.file_path);
            return `<a href="${esc(file.file_path)}" target="_blank" rel="noopener"
              style="display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;color:var(--text-primary);text-decoration:none">
              ${isImage ? '🖼️' : '📄'} ${esc(file.name || 'файл')}
              <span style="color:var(--text-muted);font-size:0.78rem">${file.file_size ? Math.round(file.file_size / 1024) + ' КБ' : ''}</span>
            </a>`;
          }).join('')}
        </div>
      </div>` : ''}

      <div class="card">
        <div class="card-title">Обработка</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
          <div class="form-group">
            <label>Статус заявки</label>
            <select class="form-control" id="lead-status" ${canEdit ? '' : 'disabled'}>
              ${Object.entries(this.statuses).map(([key, label]) =>
                `<option value="${key}" ${lead.status === key ? 'selected' : ''}>${esc(label)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label>Заметка менеджера</label>
            <textarea class="form-control" id="lead-note" rows="3" ${canEdit ? '' : 'disabled'}
              placeholder="Что обсудили, что обещали, когда перезвонить">${esc(lead.manager_note || '')}</textarea>
          </div>
        </div>
        ${canEdit ? `<button class="btn btn-primary btn-sm" onclick="LeadsPage.save(${lead.id})">💾 Сохранить</button>` : ''}
      </div>
    `;
  },

  async save(id) {
    const status = document.getElementById('lead-status').value;
    const manager_note = document.getElementById('lead-note').value;
    try {
      await API.put(`/leads/${id}`, { status, manager_note });
      Toast.success('Заявка сохранена');
      App.refreshLeadsBadge();
      await this.open(id);
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async convert(id) {
    if (!confirm('Превратить заявку в клиента? Если клиент с таким телефоном уже есть, заявка прилипнет к его карточке.')) return;
    try {
      const result = await API.post(`/leads/${id}/convert`, {});
      Toast.success(result.created ? 'Создан новый клиент' : 'Заявка привязана к существующему клиенту');
      App.refreshLeadsBadge();
      App.navigateTo('client-profile', result.client_id);
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async notify(id) {
    try {
      const result = await API.post(`/leads/${id}/notify`, {});
      if (result.telegram && result.telegram.ok) {
        Toast.success(`Отправлено в Telegram (${result.telegram.sent} из ${result.telegram.sent + result.telegram.failed.length})`);
      } else if (result.telegram && result.telegram.disabled) {
        Toast.error('Telegram не настроен: задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_IDS');
      } else {
        Toast.error('Telegram: ' + ((result.telegram.failed || []).map(f => f.error).join('; ') || 'не отправлено'));
      }
      await this.open(id);
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async remove(id) {
    if (!confirm('Удалить заявку? Файлы тоже будут удалены. Действие необратимо.')) return;
    try {
      await API.delete(`/leads/${id}`);
      Toast.success('Заявка удалена');
      App.refreshLeadsBadge();
      App.navigateTo('leads');
    } catch (err) {
      Toast.error(err.message);
    }
  },
};
