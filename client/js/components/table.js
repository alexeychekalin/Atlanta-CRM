/* Table — компонент таблицы (утилиты) */
const Table = {
  statusLabels: {
    'new': 'Новый',
    'in_progress': 'В работе',
    'paid': 'Оплачен',
    'completed': 'Выполнен',
    'cancelled': 'Отменён',
  },

  statusBadge(status) {
    const label = this.statusLabels[status] || status;
    return `<span class="badge badge-${status}">${label}</span>`;
  },

  // === Настройки НДС (системные, из БД) ===
  _vatCache: null,

  // Загрузить настройки НДС с сервера (вызывается при старте приложения)
  async loadVATSettings() {
    try {
      const data = await API.get('/settings/vat');
      this._vatCache = {
        enabled: data.enabled !== undefined ? !!data.enabled : true,
        rate: typeof data.rate === 'number' ? data.rate : 22,
      };
    } catch (e) {
      // Если API недоступен, используем значения по умолчанию
      this._vatCache = { enabled: true, rate: 22 };
    }
    return this._vatCache;
  },

  getVATSettings() {
    // Возвращаем кэш, если загружен, иначе значения по умолчанию
    return this._vatCache || { enabled: true, rate: 22 };
  },

  async saveVATSettings(settings) {
    try {
      const current = this.getVATSettings();
      const updated = {
        enabled: settings.enabled !== undefined ? !!settings.enabled : current.enabled,
        rate: settings.rate !== undefined ? (parseFloat(settings.rate) || 0) : current.rate,
      };
      await API.put('/settings/vat', updated);
      this._vatCache = updated;
      return updated;
    } catch (e) {
      throw e;
    }
  },

  formatMoneyRaw(amount) {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      minimumFractionDigits: 2,
    }).format(amount || 0);
  },

  formatMoney(amount, withVat = true) {
    const raw = this.formatMoneyRaw(amount);
    if (!withVat) return raw;

    const vat = this.getVATSettings();
    if (!vat.enabled) return raw;

    const num = parseFloat(amount) || 0;
    const withVatAmount = num * (1 + (vat.rate / 100));
    const vatFormatted = this.formatMoneyRaw(withVatAmount);

    return `${raw} <span class="vat-info">(${vatFormatted} с НДС)</span>`;
  },

  formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('ru-RU');
  },

  formatDateTime(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString('ru-RU');
  },

  emptyState(text = 'Нет данных') {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <div class="empty-state-text">${text}</div>
      </div>
    `;
  },

  loading() {
    return `<div class="loading-spinner"><div class="spinner"></div></div>`;
  },

  actionBtn(icon, title, onclick, className = '') {
    return `<button class="btn btn-icon btn-sm ${className}" title="${title}" onclick="${onclick}">${icon}</button>`;
  },

  editIcon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,

  deleteIcon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,

  viewIcon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,

  // Рендер метаданных чертежа (компоненты + наценки) для заказов из калькулятора
  renderDrawingMetadata(items) {
    const drawingItems = (items || []).filter(i => i.metadata?.type === 'calculator_drawing');
    if (drawingItems.length === 0) return '';

    return drawingItems.map(item => {
      const m = item.metadata;
      const comps = m.components || [];
      const hasItemMarkups = comps.some(c => c.markup_pct !== 0 || c.markup_rub !== 0);
      const hasGlobalMarkup = m.global_markup_pct !== 0 || m.global_markup_rub !== 0;

      return `
        <div style="margin-top:16px;padding:16px;background:var(--bg-main);border-radius:10px;border:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <span style="font-size:1.1rem">📐</span>
            <span style="font-weight:700;font-size:0.95rem">Состав чертежа: ${item.product_name}</span>
          </div>
          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Компонент</th>
                  <th>Артикул</th>
                  <th class="text-right">Цена</th>
                  <th class="text-center">Кол-во</th>
                  <th class="text-right">Базовая сумма</th>
                  ${hasItemMarkups ? '<th class="text-right">Наценка</th><th class="text-right">Итого</th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${comps.map(c => {
                  const markupTotal = (c.markup_pct_amount || 0) + (c.markup_rub || 0);
                  const markupInfo = [];
                  if (c.markup_pct !== 0) markupInfo.push(c.markup_pct + '%');
                  if (c.markup_rub !== 0) markupInfo.push(Table.formatMoney(c.markup_rub));
                  const markupColor = markupTotal > 0 ? 'var(--accent-orange, #f97316)' : markupTotal < 0 ? '#ef4444' : 'var(--text-muted)';
                  return '<tr>' +
                    '<td style="font-weight:500">' + c.name + '</td>' +
                    '<td class="font-mono" style="color:var(--accent-teal);font-size:0.82rem">' + c.article + '</td>' +
                    '<td class="text-right">' + Table.formatMoney(c.price) + '</td>' +
                    '<td class="text-center">' + c.quantity + '</td>' +
                    '<td class="text-right">' + Table.formatMoney(c.base_total) + '</td>' +
                    (hasItemMarkups ?
                      '<td class="text-right" style="font-size:0.82rem;color:' + markupColor + '">' +
                        (markupTotal !== 0 ? (markupTotal > 0 ? '+' : '') + Table.formatMoney(markupTotal) : '—') +
                        (markupInfo.length > 0 ? '<div style="font-size:0.7rem;color:var(--text-muted)">' + markupInfo.join(' + ') + '</div>' : '') +
                      '</td>' +
                      '<td class="text-right" style="font-weight:600">' + Table.formatMoney(c.line_total) + '</td>'
                    : '') +
                  '</tr>';
                }).join('')}
              </tbody>
            </table>
          </div>
          <div style="margin-top:12px;padding:12px;background:var(--bg-card);border-radius:8px;border:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <span style="color:var(--text-secondary);font-size:0.88rem">Стоимость компонентов</span>
              <span style="font-weight:500;font-size:0.88rem">${Table.formatMoney(m.components_total)}</span>
            </div>
            ${m.item_markups_total !== 0 ? (() => {
              const c = m.item_markups_total > 0 ? 'var(--accent-orange, #f97316)' : '#ef4444';
              const l = m.item_markups_total > 0 ? 'Наценки на компоненты' : 'Скидки на компоненты';
              return '<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:' + c + ';font-size:0.88rem">' + l + '</span><span style="font-weight:500;font-size:0.88rem;color:' + c + '">' + (m.item_markups_total > 0 ? '+' : '') + Table.formatMoney(m.item_markups_total) + '</span></div>';
            })() : ''}
            ${hasGlobalMarkup ? (() => {
              const gt = (m.global_markup_pct_amount || 0) + (m.global_markup_rub || 0);
              const gc = gt >= 0 ? 'var(--accent-orange, #f97316)' : '#ef4444';
              const gl = gt >= 0 ? 'Общая наценка' : 'Общая скидка';
              const pp = m.global_markup_pct !== 0 ? ' (' + m.global_markup_pct + '%)' : '';
              const rp = m.global_markup_rub !== 0 ? (m.global_markup_rub > 0 ? ' + ' : ' ') + Table.formatMoney(m.global_markup_rub) : '';
              return '<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:' + gc + ';font-size:0.88rem">' + gl + pp + rp + '</span><span style="font-weight:500;font-size:0.88rem;color:' + gc + '">' + (gt > 0 ? '+' : '') + Table.formatMoney(gt) + '</span></div>';
            })() : ''}
            <div style="display:flex;justify-content:space-between;padding-top:8px;border-top:1px solid var(--border)">
              <span style="font-weight:700;font-size:0.92rem">Итого по чертежу</span>
              <span style="font-weight:700;font-size:0.92rem;color:var(--accent-teal)">${Table.formatMoney(m.grand_total)}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },
};
