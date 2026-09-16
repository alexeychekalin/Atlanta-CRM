/* Clients Page */
const ClientsPage = {
  searchTimeout: null,

  async render() {
    const content = document.getElementById('content-area');
    const canEdit = API.can('clients', 'edit');

    content.innerHTML = `
      <div class="toolbar">
        <div class="search-input">
          <input type="text" id="clients-search" placeholder="Поиск клиентов...">
        </div>
        ${canEdit ? '<button class="btn btn-primary" onclick="ClientsPage.openCreateModal()">+ Новый клиент</button>' : ''}
      </div>
      <div id="clients-table-container">${Table.loading()}</div>
    `;

    document.getElementById('clients-search').addEventListener('input', (e) => {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => this.loadClients(e.target.value), 300);
    });

    this.loadClients();
  },

  async loadClients(search = '') {
    const container = document.getElementById('clients-table-container');
    const canEdit = API.can('clients', 'edit');
    const canDelete = API.can('clients', 'delete');
    const hasActions = canEdit || canDelete;

    try {
      const params = search ? `?search=${encodeURIComponent(search)}` : '';
      const res = await API.get('/clients' + params);
      const clients = res.data;

      if (clients.length === 0) {
        container.innerHTML = Table.emptyState('Нет клиентов');
        return;
      }

      container.innerHTML = `
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th></th>
                <th>Название</th>
                <th>Статус</th>
                <th>Уровень цен</th>
                <th>Телефон</th>
                <th>Email</th>
                <th>Адрес</th>
                ${hasActions ? '<th class="text-right">Действия</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${clients.map(c => {
                const avatar = c.avatar_path 
                  ? `<img src="${c.avatar_path}" style="width:32px;height:32px;object-fit:cover;border-radius:50%">`
                  : `<div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#14b8a6,#3b82f6);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:0.8rem">${(c.name||'?').charAt(0).toUpperCase()}</div>`;
                const statusBadge = c.status_name 
                  ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;background:${c.status_color}15;color:${c.status_color};font-size:0.75rem;font-weight:600;border:1px solid ${c.status_color}30;white-space:nowrap"><span style="width:6px;height:6px;border-radius:50%;background:${c.status_color}"></span>${c.status_name}</span>`
                  : '<span style="color:var(--text-muted);font-size:0.8rem">—</span>';
                return `
                <tr style="cursor:pointer" onclick="App.navigateTo('client-profile',${c.id})" title="Открыть карточку клиента">
                  <td>${avatar}</td>
                  <td><a href="#" onclick="event.stopPropagation();App.navigateTo('client-profile',${c.id});return false" class="client-link"><strong>${c.name}</strong></a></td>
                  <td>${statusBadge}</td>
                  <td>${c.pricing_level_name
                    ? `<span style="padding:2px 8px;border-radius:12px;background:var(--accent-teal)15;color:var(--accent-teal);font-size:0.75rem;font-weight:600;border:1px solid var(--accent-teal)30;white-space:nowrap">${c.pricing_level_name}</span>`
                    : '<span style="color:var(--accent-red);font-size:0.75rem">⚠️</span>'}</td>
                  <td>${c.phone || '—'}</td>
                  <td>${c.email || '—'}</td>
                  <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${c.address || '—'}</td>
                  ${hasActions ? `
                    <td class="text-right" onclick="event.stopPropagation()">
                      <div class="table-actions" style="justify-content:flex-end">
                        ${Table.actionBtn('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>', 'Карточка', `App.navigateTo('client-profile',${c.id})`)}
                        ${canEdit ? Table.actionBtn(Table.editIcon, 'Редактировать', `ClientsPage.openEditModal(${c.id})`) : ''}
                        ${canDelete ? Table.actionBtn(Table.deleteIcon, 'Удалить', `ClientsPage.deleteClient(${c.id})`, 'btn-danger') : ''}
                      </div>
                    </td>
                  ` : ''}
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-text">${err.message}</div></div>`;
    }
  },

  openCreateModal() {
    this._openModal(null);
  },

  async openEditModal(id) {
    try {
      const client = await API.get(`/clients/${id}`);
      this._openModal(client);
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async _openModal(client) {
    // Загрузить уровни цен
    try {
      const res = await API.get('/pricing-levels');
      this._pricingLevels = res.data || [];
    } catch { this._pricingLevels = []; }

    const isEdit = !!client;
    Modal.open({
      title: isEdit ? 'Редактировать клиента' : 'Новый клиент',
      body: `
        <form id="client-form">
          <div class="form-group">
            <label>Название *</label>
            <input type="text" class="form-control" id="client-name" value="${isEdit ? client.name : ''}" required>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Телефон</label>
              <input type="text" class="form-control" id="client-phone" value="${isEdit ? (client.phone || '') : ''}">
            </div>
            <div class="form-group">
              <label>Email</label>
              <input type="email" class="form-control" id="client-email" value="${isEdit ? (client.email || '') : ''}">
            </div>
          </div>
          <div class="form-group">
            <label>Адрес</label>
            <input type="text" class="form-control" id="client-address" value="${isEdit ? (client.address || '') : ''}">
          </div>
          <div class="form-group">
            <label>Примечание</label>
            <textarea class="form-control" id="client-notes" rows="2">${isEdit ? (client.notes || '') : ''}</textarea>
          </div>
          <div class="form-group">
            <label>💰 Уровень цен *</label>
            <select class="form-control" id="client-pricing-level" required>
              <option value="">Выберите уровень</option>
              ${(this._pricingLevels || []).map(l => `<option value="${l.id}" ${isEdit && client.pricing_level_id == l.id ? 'selected' : ''}>${l.name} (${l.markup_pct > 0 ? '+' : ''}${l.markup_pct}%)</option>`).join('')}
            </select>
          </div>

          <div style="margin-top:12px;padding:14px;background:var(--bg-main);border-radius:10px;border:1px solid var(--border)">
            <div style="font-weight:600;font-size:0.9rem;margin-bottom:10px;color:var(--text-secondary)">📦 Данные доставки</div>
            <div class="form-group">
              <label>Адрес доставки / терминал ТК</label>
              <input type="text" class="form-control" id="client-delivery-address" value="${isEdit ? (client.delivery_address || '') : ''}" placeholder="Адрес доставки или терминал транспортной компании">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>ФИО контактного лица</label>
                <input type="text" class="form-control" id="client-delivery-name" value="${isEdit ? (client.delivery_contact_name || '') : ''}" placeholder="Иванов Иван Иванович">
              </div>
              <div class="form-group">
                <label>Контактный телефон</label>
                <input type="text" class="form-control" id="client-delivery-phone" value="${isEdit ? (client.delivery_contact_phone || '') : ''}" placeholder="+7 (999) 123-45-67">
              </div>
            </div>
          </div>

          <div style="margin-top:12px;padding:14px;background:var(--bg-main);border-radius:10px;border:1px solid var(--border)">
            <div style="font-weight:600;font-size:0.9rem;margin-bottom:10px;color:var(--text-secondary)">🏦 Реквизиты</div>
            <div class="form-row">
              <div class="form-group"><label>ИНН</label><input type="text" class="form-control" id="client-inn" value="${isEdit ? (client.inn || '') : ''}" placeholder="1234567890"></div>
              <div class="form-group"><label>КПП</label><input type="text" class="form-control" id="client-kpp" value="${isEdit ? (client.kpp || '') : ''}" placeholder="123456789"></div>
            </div>
            <div class="form-group"><label>ОГРНИП</label><input type="text" class="form-control" id="client-ogrnip" value="${isEdit ? (client.ogrnip || '') : ''}" placeholder="ОГРНИП (15 цифр)"></div>
            <div class="form-group"><label>Юридический адрес</label><input type="text" class="form-control" id="client-legal-address" value="${isEdit ? (client.legal_address || '') : ''}" placeholder="Юридический адрес организации"></div>
            <div class="form-group"><label>Банковские реквизиты</label><input type="text" class="form-control" id="client-bank-details" value="${isEdit ? (client.bank_details || '') : ''}" placeholder="Р/С, Банк, БИК, К/С"></div>
          </div>
        </form>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Отмена</button>
        <button class="btn btn-primary" onclick="ClientsPage.saveClient(${isEdit ? client.id : 'null'})">${isEdit ? 'Сохранить' : 'Создать'}</button>
      `,
    });
  },

  async saveClient(id) {
    const data = {
      name: document.getElementById('client-name').value.trim(),
      phone: document.getElementById('client-phone').value.trim(),
      email: document.getElementById('client-email').value.trim(),
      address: document.getElementById('client-address').value.trim(),
      notes: document.getElementById('client-notes').value.trim(),
      delivery_address: document.getElementById('client-delivery-address')?.value.trim() || '',
      delivery_contact_name: document.getElementById('client-delivery-name')?.value.trim() || '',
      delivery_contact_phone: document.getElementById('client-delivery-phone')?.value.trim() || '',
      inn: document.getElementById('client-inn')?.value.trim() || '',
      kpp: document.getElementById('client-kpp')?.value.trim() || '',
      ogrnip: document.getElementById('client-ogrnip')?.value.trim() || '',
      legal_address: document.getElementById('client-legal-address')?.value.trim() || '',
      bank_details: document.getElementById('client-bank-details')?.value.trim() || '',
      pricing_level_id: document.getElementById('client-pricing-level')?.value || null,
    };

    if (!data.name) {
      Toast.error('Введите название клиента');
      return;
    }

    try {
      if (id) {
        await API.put(`/clients/${id}`, data);
        Toast.success('Клиент обновлён');
      } else {
        await API.post('/clients', data);
        Toast.success('Клиент создан');
      }
      Modal.close();
      this.loadClients();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async deleteClient(id) {
    if (!confirm('Удалить клиента?')) return;
    try {
      await API.del(`/clients/${id}`);
      Toast.success('Клиент удалён');
      this.loadClients();
    } catch (err) {
      Toast.error(err.message);
    }
  },
};
