/* Components Catalog Page — Каталог компонентов */
const ComponentsCatalogPage = {
  activeTab: 'components',
  viewMode: 'grid', // 'grid' | 'table'
  categories: [],
  searchTimeout: null,
  allComponents: [],

  async render() {
    const content = document.getElementById('content-area');
    const isAdmin = API.isAdmin();

    content.innerHTML = `
      <div class="tabs-header">
        <button class="tab-btn active" data-tab="components" onclick="ComponentsCatalogPage.switchTab('components')">Компоненты</button>
        <button class="tab-btn" data-tab="categories" onclick="ComponentsCatalogPage.switchTab('categories')">Категории</button>
      </div>
      <div id="tab-components" class="tab-content active">
        <div class="toolbar" style="flex-wrap:wrap;gap:8px">
          <div class="search-input" style="flex:1;min-width:200px">
            <input type="text" id="comp-search" placeholder="Поиск по артикулу или названию...">
          </div>
          <div class="filter-group" style="display:flex;gap:8px;align-items:center">
            <select class="filter-select" id="comp-category-filter">
              <option value="">Все категории</option>
            </select>
            <select class="filter-select" id="comp-sort" style="width:auto">
              <option value="name">По названию</option>
              <option value="price_asc">Цена ↑</option>
              <option value="price_desc">Цена ↓</option>
              <option value="article">По артикулу</option>
            </select>
          </div>
          <div style="display:flex;gap:4px">
            <button class="btn btn-icon ${this.viewMode === 'grid' ? 'btn-primary' : 'btn-secondary'}" onclick="ComponentsCatalogPage.setViewMode('grid')" title="Витрина">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            </button>
            <button class="btn btn-icon ${this.viewMode === 'table' ? 'btn-primary' : 'btn-secondary'}" onclick="ComponentsCatalogPage.setViewMode('table')" title="Таблица">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
          </div>
          ${API.can('components', 'edit') ? '<button class="btn btn-primary" onclick="ComponentsCatalogPage.openComponentModal()">+ Новый</button>' : ''}
        </div>
        <!-- Чипсы категорий -->
        <div id="comp-category-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px"></div>
        <div id="comp-count" style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px"></div>
        <div id="components-table">${Table.loading()}</div>
      </div>
      <div id="tab-categories" class="tab-content" style="display:none">
        <div class="toolbar">
          ${API.can('components', 'edit') ? '<button class="btn btn-primary" onclick="ComponentsCatalogPage.openCategoryModal()">+ Новая категория</button>' : ''}
        </div>
        <div id="categories-table">${Table.loading()}</div>
      </div>

      <style>
        .comp-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:16px; }
        .comp-card {
          background:var(--bg-card);
          border:1px solid var(--border);
          border-radius:14px;
          overflow:hidden;
          transition:transform 0.2s, box-shadow 0.2s, border-color 0.2s;
          cursor:default;
          position:relative;
        }
        .comp-card:hover {
          transform:translateY(-3px);
          box-shadow:0 8px 25px rgba(0,0,0,0.25);
          border-color:var(--accent-teal);
        }
        .comp-card-img {
          width:100%;
          height:160px;
          object-fit:cover;
          background:var(--bg-secondary);
          display:flex;
          align-items:center;
          justify-content:center;
          position:relative;
          overflow:hidden;
        }
        .comp-card-img img {
          width:100%;
          height:100%;
          object-fit:cover;
          transition:transform 0.3s;
        }
        .comp-card:hover .comp-card-img img { transform:scale(1.05); }
        .comp-card-img .comp-placeholder {
          font-size:3rem;
          color:var(--text-muted);
          opacity:0.3;
        }
        .comp-card-body { padding:14px; }
        .comp-card-article {
          font-family:'JetBrains Mono',monospace;
          font-size:0.75rem;
          color:var(--accent-teal);
          letter-spacing:0.5px;
          margin-bottom:4px;
        }
        .comp-card-name {
          font-weight:600;
          font-size:0.92rem;
          line-height:1.3;
          margin-bottom:6px;
          display:-webkit-box;
          -webkit-line-clamp:2;
          -webkit-box-orient:vertical;
          overflow:hidden;
        }
        .comp-card-desc {
          font-size:0.78rem;
          color:var(--text-muted);
          line-height:1.4;
          margin-bottom:8px;
          display:-webkit-box;
          -webkit-line-clamp:2;
          -webkit-box-orient:vertical;
          overflow:hidden;
        }
        .comp-card-footer {
          display:flex;
          align-items:center;
          justify-content:space-between;
          padding:10px 14px;
          border-top:1px solid var(--border);
          background:rgba(0,0,0,0.1);
        }
        .comp-card-price {
          font-weight:700;
          font-size:1rem;
          color:var(--text-primary);
        }
        .comp-card-category {
          position:absolute;
          top:8px;
          left:8px;
          background:rgba(0,0,0,0.65);
          backdrop-filter:blur(6px);
          color:#fff;
          font-size:0.7rem;
          padding:3px 8px;
          border-radius:6px;
          font-weight:500;
        }
        .comp-card-status {
          position:absolute;
          top:8px;
          right:8px;
          width:10px;
          height:10px;
          border-radius:50%;
          border:2px solid var(--bg-card);
        }
        .comp-card-actions {
          display:flex;
          gap:4px;
        }
        .chip-filter {
          padding:5px 14px;
          border-radius:20px;
          border:1px solid var(--border);
          background:var(--bg-card);
          color:var(--text-secondary);
          font-size:0.8rem;
          cursor:pointer;
          transition:all 0.2s;
          white-space:nowrap;
        }
        .chip-filter:hover { border-color:var(--accent-teal);color:var(--text-primary); }
        .chip-filter.active {
          background:var(--accent-teal);
          color:#fff;
          border-color:var(--accent-teal);
        }
        @media(max-width:600px) {
          .comp-grid { grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:10px; }
          .comp-card-img { height:120px; }
        }
      </style>
    `;

    document.getElementById('comp-search').addEventListener('input', () => {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => this.filterAndRender(), 300);
    });
    document.getElementById('comp-category-filter').addEventListener('change', () => {
      this._syncChipWithSelect();
      this.filterAndRender();
    });
    document.getElementById('comp-sort').addEventListener('change', () => this.filterAndRender());

    await this.loadCategories();
    await this.loadAllComponents();
    this.renderCategoryChips();
    this.filterAndRender();
  },

  setViewMode(mode) {
    this.viewMode = mode;
    // Update buttons
    document.querySelectorAll('.toolbar .btn-icon').forEach(b => {
      b.className = b.className.replace(/btn-(primary|secondary)/g, '').trim();
    });
    const btns = document.querySelectorAll('.toolbar .btn-icon');
    if (btns[0]) btns[0].classList.add(mode === 'grid' ? 'btn-primary' : 'btn-secondary');
    if (btns[1]) btns[1].classList.add(mode === 'table' ? 'btn-primary' : 'btn-secondary');
    this.filterAndRender();
  },

  renderCategoryChips() {
    const container = document.getElementById('comp-category-chips');
    const activeId = document.getElementById('comp-category-filter')?.value || '';
    container.innerHTML = `
      <button class="chip-filter ${!activeId ? 'active' : ''}" onclick="ComponentsCatalogPage.filterByChip('')">Все</button>
      ${this.categories.map(c => `
        <button class="chip-filter ${activeId == c.id ? 'active' : ''}" onclick="ComponentsCatalogPage.filterByChip('${c.id}')">${c.name}</button>
      `).join('')}
    `;
  },

  filterByChip(catId) {
    const select = document.getElementById('comp-category-filter');
    if (select) select.value = catId;
    this.renderCategoryChips();
    this.filterAndRender();
  },

  _syncChipWithSelect() {
    this.renderCategoryChips();
  },

  async loadAllComponents() {
    try {
      const res = await API.get('/components?limit=1000');
      this.allComponents = res.data;
    } catch (err) {
      this.allComponents = [];
    }
  },

  filterAndRender() {
    const search = (document.getElementById('comp-search')?.value || '').toLowerCase();
    const categoryId = document.getElementById('comp-category-filter')?.value || '';
    const sort = document.getElementById('comp-sort')?.value || 'name';

    let filtered = this.allComponents;
    if (search) {
      filtered = filtered.filter(c =>
        c.article.toLowerCase().includes(search) ||
        c.name.toLowerCase().includes(search) ||
        (c.description || '').toLowerCase().includes(search)
      );
    }
    if (categoryId) {
      filtered = filtered.filter(c => c.category_id == categoryId);
    }

    // Сортировка
    filtered = [...filtered].sort((a, b) => {
      switch (sort) {
        case 'price_asc': return (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0);
        case 'price_desc': return (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0);
        case 'article': return a.article.localeCompare(b.article);
        default: return a.name.localeCompare(b.name);
      }
    });

    document.getElementById('comp-count').textContent = `Найдено: ${filtered.length} компонент(ов)`;

    const container = document.getElementById('components-table');
    if (filtered.length === 0) {
      container.innerHTML = Table.emptyState('Компоненты не найдены');
      return;
    }

    if (this.viewMode === 'grid') {
      this._renderGrid(container, filtered);
    } else {
      this._renderTable(container, filtered);
    }
  },

  _renderGrid(container, comps) {
    const canEdit = API.can('components', 'edit');
    container.innerHTML = `
      <div class="comp-grid">
        ${comps.map(c => `
          <div class="comp-card" onclick="ComponentsCatalogPage.viewComponent(${c.id})">
            <div class="comp-card-img">
              ${c.image_path
                ? `<img src="${c.image_path}" alt="${c.name}" loading="lazy">`
                : '<div class="comp-placeholder">📦</div>'}
              ${c.category_name ? `<div class="comp-card-category">${c.category_name}</div>` : ''}
              <div class="comp-card-status" style="background:${c.is_active !== false ? '#22c55e' : '#ef4444'}"></div>
            </div>
            <div class="comp-card-body">
              <div class="comp-card-article">${c.article}</div>
              <div class="comp-card-name">${c.name}</div>
              ${c.description ? `<div class="comp-card-desc">${c.description}</div>` : ''}
              ${parseInt(c.modifications_count) > 0 ? `<div style="margin-top:4px"><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:600;background:var(--accent-teal);color:#fff">${c.modifications_count} мод.</span></div>` : ''}
            </div>
            <div class="comp-card-footer">
              <div class="comp-card-price">${Table.formatMoney(c.price)}</div>
              ${canEdit ? `
                <div class="comp-card-actions" onclick="event.stopPropagation()">
                  <button class="btn btn-icon btn-sm" onclick="ComponentsCatalogPage.openComponentModal(${c.id})" title="Редактировать">
                    ${Table.editIcon}
                  </button>
                </div>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },

  _renderTable(container, comps) {
    const canEdit = API.can('components', 'edit');
    const canDelete = API.can('components', 'delete');
    const hasActions = canEdit || canDelete;
    container.innerHTML = `
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:50px"></th>
              <th>Артикул</th>
              <th>Название</th>
              <th>Категория</th>
              <th class="text-right">Цена</th>
              <th>Статус</th>
              ${hasActions ? '<th class="text-right">Действия</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${comps.map(c => `
              <tr style="cursor:pointer" onclick="ComponentsCatalogPage.viewComponent(${c.id})">
                <td>
                  ${c.image_path
                    ? `<img src="${c.image_path}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">`
                    : '<div style="width:40px;height:40px;border-radius:6px;background:var(--bg-secondary);display:flex;align-items:center;justify-content:center;font-size:16px">📦</div>'}
                </td>
                <td class="font-mono" style="color:var(--accent-teal)">${c.article}</td>
                <td><strong>${c.name}</strong>${c.description ? `<div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px">${c.description.substring(0, 60)}</div>` : ''}${parseInt(c.modifications_count) > 0 ? `<span style="display:inline-block;margin-top:2px;padding:1px 7px;border-radius:8px;font-size:0.7rem;font-weight:600;background:var(--accent-teal);color:#fff">${c.modifications_count} мод.</span>` : ''}</td>
                <td><span class="badge badge-in_progress">${c.category_name || '—'}</span></td>
                <td class="text-right" style="font-weight:600">${Table.formatMoney(c.price)}</td>
                <td>${c.is_active !== false ? '<span class="badge badge-completed">Активен</span>' : '<span class="badge badge-cancelled">Неактивен</span>'}</td>
                ${hasActions ? `<td class="text-right" onclick="event.stopPropagation()">
                  <div class="table-actions" style="justify-content:flex-end">
                    ${canEdit ? Table.actionBtn(Table.editIcon, 'Редактировать', `ComponentsCatalogPage.openComponentModal(${c.id})`) : ''}
                    ${canDelete ? Table.actionBtn(Table.deleteIcon, 'Удалить', `ComponentsCatalogPage.deleteComponent(${c.id})`, 'btn-danger') : ''}
                  </div>
                </td>` : ''}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  // === Просмотр карточки компонента ===
  async viewComponent(id) {
    try {
      const comp = await API.get(`/components/${id}`);
      const canEdit = API.can('components', 'edit');
      const mods = comp.modifications || [];

      const modsHtml = mods.length > 0 ? `
        <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div style="font-size:1rem;font-weight:700">🔧 Модификации (${mods.length})</div>
            ${canEdit ? `<button class="btn btn-sm btn-primary" onclick="ComponentsCatalogPage.openModificationModal(${id})">+ Добавить</button>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:10px" id="mods-list">
            ${mods.map(m => {
              const fullArticle = comp.article + '.' + m.code;
              const modPrice = m.price_override !== null ? m.price_override : comp.price;
              const images = m.images || [];
              return `
                <div style="background:var(--bg-main);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                    <div style="flex:1">
                      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                        <span style="font-family:'JetBrains Mono',monospace;font-size:0.85rem;font-weight:700;color:var(--accent-teal)">${fullArticle}</span>
                        ${m.is_active === false ? '<span style="font-size:0.7rem;color:#ef4444;font-weight:600">Неактивна</span>' : ''}
                        ${m.price_override !== null ? `<span style="font-weight:600;font-size:0.85rem">${Table.formatMoneyRaw(modPrice)}</span>` : ''}
                      </div>
                      ${m.name ? `<div style="font-size:0.88rem;line-height:1.4;color:var(--text-secondary)">${m.name}</div>` : ''}
                    </div>
                    ${canEdit ? `
                      <div style="display:flex;gap:4px;flex-shrink:0">
                        <button class="btn btn-icon btn-sm" onclick="event.stopPropagation();ComponentsCatalogPage.openModificationModal(${id}, ${m.id})" title="Редактировать">${Table.editIcon}</button>
                        <button class="btn btn-icon btn-sm btn-danger" onclick="event.stopPropagation();ComponentsCatalogPage.deleteModification(${id}, ${m.id})" title="Удалить">${Table.deleteIcon}</button>
                      </div>
                    ` : ''}
                  </div>
                  ${images.length > 0 ? `
                    <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
                      ${images.map(img => `
                        <div style="position:relative;width:80px;height:80px;border-radius:8px;overflow:hidden;border:1px solid var(--border);cursor:pointer" onclick="event.stopPropagation();ComponentsCatalogPage.viewModImage('${img.image_path}')">
                          <img src="${img.image_path}" style="width:100%;height:100%;object-fit:cover">
                          ${canEdit ? `<button style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.6);color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center" onclick="event.stopPropagation();ComponentsCatalogPage.deleteModImage(${id}, ${m.id}, ${img.id})">×</button>` : ''}
                        </div>
                      `).join('')}
                      ${canEdit ? `<div style="width:80px;height:80px;border-radius:8px;border:2px dashed var(--border);display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-muted);font-size:20px" onclick="event.stopPropagation();ComponentsCatalogPage.uploadModImage(${id}, ${m.id})" title="Добавить фото">+</div>` : ''}
                    </div>
                  ` : (canEdit ? `
                    <div style="margin-top:6px">
                      <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();ComponentsCatalogPage.uploadModImage(${id}, ${m.id})">📷 Добавить фото</button>
                    </div>
                  ` : '')}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : (canEdit ? `
        <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:16px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:1rem;font-weight:700">🔧 Модификации</div>
            <button class="btn btn-sm btn-primary" onclick="ComponentsCatalogPage.openModificationModal(${id})">+ Добавить</button>
          </div>
          <div style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.85rem">Нет модификаций</div>
        </div>
      ` : '');

      Modal.open({
        title: comp.name,
        wide: true,
        body: `
          <div style="display:grid;grid-template-columns:${comp.image_path ? '1fr 1fr' : '1fr'};gap:20px">
            ${comp.image_path ? `
              <div style="border-radius:12px;overflow:hidden;border:1px solid var(--border);max-height:350px">
                <img src="${comp.image_path}" alt="${comp.name}" style="width:100%;height:100%;object-fit:cover">
              </div>
            ` : ''}
            <div>
              <div style="margin-bottom:16px">
                <div style="font-family:'JetBrains Mono',monospace;font-size:0.85rem;color:var(--accent-teal);margin-bottom:4px">${comp.article}</div>
                <div style="font-size:1.3rem;font-weight:700;margin-bottom:8px">${comp.name}</div>
                ${comp.category_name ? `<span class="badge badge-in_progress" style="font-size:0.8rem">${comp.category_name}</span>` : ''}
              </div>
              <div style="background:var(--bg-main);border-radius:10px;padding:16px;border:1px solid var(--border);margin-bottom:12px">
                <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:4px">Базовая цена</div>
                <div style="font-size:1.6rem;font-weight:700;color:var(--accent-teal)">${Table.formatMoney(comp.price)}</div>
              </div>
              ${comp.description ? `
                <div style="margin-bottom:12px">
                  <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:4px">Описание</div>
                  <div style="font-size:0.9rem;line-height:1.5">${comp.description}</div>
                </div>
              ` : ''}
              ${comp.comment ? `
                <div style="margin-bottom:12px">
                  <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:4px">Комментарий</div>
                  <div style="font-size:0.9rem;line-height:1.5;color:var(--text-secondary)">${comp.comment}</div>
                </div>
              ` : ''}
              <div style="display:flex;gap:12px;font-size:0.82rem;color:var(--text-muted)">
                <span>Статус: ${comp.is_active !== false ? '🟢 Активен' : '🔴 Неактивен'}</span>
              </div>
            </div>
          </div>
          ${modsHtml}
          <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:16px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
              <div style="font-size:1rem;font-weight:700">📎 Документы</div>
              <button class="btn btn-sm btn-secondary" onclick="window.open('/api/components/${comp.id}/documents/download-all?token='+API.getToken(),'_blank')" title="Скачать все документы ZIP">📦 Скачать ZIP</button>
            </div>
            <div id="view-comp-docs" style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div style="color:var(--text-muted);font-size:0.82rem;grid-column:1/-1">Загрузка...</div></div>
          </div>
        `,
        footer: `
          <button class="btn btn-secondary" onclick="Modal.close()">Закрыть</button>
          ${canEdit ? `<button class="btn btn-primary" onclick="Modal.close();ComponentsCatalogPage.openComponentModal(${comp.id})">✏️ Редактировать</button>` : ''}
        `,
      });

      // Загрузить документы для просмотра
      this._loadViewDocs(comp.id);
    } catch (err) { Toast.error(err.message); }
  },

  async _loadViewDocs(componentId) {
    const container = document.getElementById('view-comp-docs');
    if (!container) return;
    try {
      const res = await API.get(`/components/${componentId}/documents`);
      const docs = res.data || [];
      if (docs.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted);font-size:0.82rem;grid-column:1/-1">Нет документов</div>';
        return;
      }
      const certs = docs.filter(d => d.doc_type === 'certificate');
      const infos = docs.filter(d => d.doc_type === 'info');
      const renderGroup = (title, icon, items, color) => {
        if (items.length === 0) return '';
        return `<div>
          <div style="font-size:0.85rem;font-weight:600;color:${color};margin-bottom:6px">${icon} ${title} (${items.length})</div>
          ${items.map(doc => {
            const fi = doc.file_type === 'pdf' ? '📄' : '🖼️';
            return `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--bg-tertiary);border-radius:6px;margin-bottom:3px;border:1px solid var(--border)">
              <span>${fi}</span>
              <span style="flex:1;font-size:0.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${doc.original_name}">${doc.original_name}</span>
              <a href="${doc.file_path}" download="${doc.original_name}" style="color:var(--accent-teal);font-size:0.75rem;text-decoration:none" title="Скачать">⬇️</a>
            </div>`;
          }).join('')}
        </div>`;
      };
      container.innerHTML = renderGroup('Сертификаты', '📜', certs, 'var(--accent-teal)') +
                             renderGroup('Инфо. сообщения', '📋', infos, 'var(--accent-blue)');
    } catch (err) {
      container.innerHTML = '<div style="color:var(--accent-red);font-size:0.8rem;grid-column:1/-1">Ошибка загрузки документов</div>';
    }
  },

  switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    document.getElementById(`tab-${tab}`).style.display = '';

    if (tab === 'categories') this.loadCategoriesTable();
  },

  // === КАТЕГОРИИ ===
  async loadCategories() {
    try {
      const res = await API.get('/component-categories');
      this.categories = res.data;
      const select = document.getElementById('comp-category-filter');
      if (select) {
        const val = select.value;
        select.innerHTML = '<option value="">Все категории</option>' +
          this.categories.map(c => `<option value="${c.id}" ${val == c.id ? 'selected' : ''}>${c.name}</option>`).join('');
      }
    } catch (err) {
      console.error(err);
    }
  },

  async loadCategoriesTable() {
    const container = document.getElementById('categories-table');
    const canEdit = API.can('components', 'edit');
    const canDelete = API.can('components', 'delete');
    const hasActions = canEdit || canDelete;
    try {
      const res = await API.get('/component-categories');
      this.categories = res.data;
      if (this.categories.length === 0) {
        container.innerHTML = Table.emptyState('Нет категорий');
        return;
      }
      container.innerHTML = `
        <div class="table-wrapper">
          <table class="data-table">
            <thead><tr><th>Название</th><th class="text-right">Порядок</th>${hasActions ? '<th class="text-right">Действия</th>' : ''}</tr></thead>
            <tbody>
              ${this.categories.map(c => `
                <tr ${canEdit ? `style="cursor:pointer" onclick="ComponentsCatalogPage.openCategoryModal(${c.id})" title="Редактировать категорию"` : ''}>
                  <td><strong>${c.name}</strong></td>
                  <td class="text-right">${c.sort_order}</td>
                  ${hasActions ? `<td class="text-right" onclick="event.stopPropagation()">
                    <div class="table-actions" style="justify-content:flex-end">
                      ${canEdit ? Table.actionBtn(Table.editIcon, 'Редактировать', `ComponentsCatalogPage.openCategoryModal(${c.id})`) : ''}
                      ${canDelete ? Table.actionBtn(Table.deleteIcon, 'Удалить', `ComponentsCatalogPage.deleteCategory(${c.id})`, 'btn-danger') : ''}
                    </div>
                  </td>` : ''}
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

  async openCategoryModal(id = null) {
    let cat = null;
    if (id) {
      cat = this.categories.find(c => c.id === id);
    }
    const isEdit = !!cat;
    Modal.open({
      title: isEdit ? 'Редактировать категорию' : 'Новая категория',
      body: `
        <div class="form-group"><label>Название *</label>
          <input type="text" class="form-control" id="cat-name" value="${isEdit ? cat.name : ''}" required></div>
        <div class="form-group"><label>Порядок сортировки</label>
          <input type="number" class="form-control" id="cat-sort" value="${isEdit ? cat.sort_order : 0}" min="0"></div>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Отмена</button>
        <button class="btn btn-primary" onclick="ComponentsCatalogPage.saveCategory(${isEdit ? cat.id : 'null'})">${isEdit ? 'Сохранить' : 'Создать'}</button>
      `,
    });
  },

  async saveCategory(id) {
    const data = {
      name: document.getElementById('cat-name').value.trim(),
      sort_order: parseInt(document.getElementById('cat-sort').value) || 0,
    };
    if (!data.name) { Toast.error('Введите название'); return; }
    try {
      if (id) { await API.put(`/component-categories/${id}`, data); Toast.success('Категория обновлена'); }
      else { await API.post('/component-categories', data); Toast.success('Категория создана'); }
      Modal.close();
      await this.loadCategories();
      this.renderCategoryChips();
      this.loadCategoriesTable();
    } catch (err) { Toast.error(err.message); }
  },

  async deleteCategory(id) {
    if (!confirm('Удалить категорию?')) return;
    try {
      await API.del(`/component-categories/${id}`);
      Toast.success('Категория удалена');
      await this.loadCategories();
      this.renderCategoryChips();
      this.loadCategoriesTable();
    } catch (err) { Toast.error(err.message); }
  },

  // === КОМПОНЕНТЫ CRUD ===
  async openComponentModal(id = null) {
    let comp = null;
    if (id) {
      try { comp = await API.get(`/components/${id}`); } catch (e) { Toast.error(e.message); return; }
    }
    const isEdit = !!comp;

    Modal.open({
      title: isEdit ? 'Редактировать компонент' : 'Новый компонент',
      wide: true,
      body: `
        <form id="comp-form">
          <div class="form-row">
            <div class="form-group">
              <label>Категория</label>
              <select class="form-control" id="comp-category">
                <option value="">Без категории</option>
                ${this.categories.map(c => `<option value="${c.id}" ${isEdit && comp.category_id == c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Артикул *</label>
              <input type="text" class="form-control" id="comp-article" value="${isEdit ? comp.article : ''}" required>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Название *</label>
              <input type="text" class="form-control" id="comp-name" value="${isEdit ? comp.name : ''}" required>
            </div>
            <div class="form-group">
              <label>Цена (₽)</label>
              <input type="number" class="form-control" id="comp-price" value="${isEdit ? comp.price : 0}" min="0" step="0.01">
            </div>
          </div>
          <div class="form-group">
            <label>Изображение</label>
            <div class="upload-zone" id="comp-upload-zone">
              <div id="comp-image-preview">
                ${isEdit && comp.image_path
                  ? `<img src="${comp.image_path}" style="max-height:120px;border-radius:8px">`
                  : '<div style="padding:24px;text-align:center;color:var(--text-muted)">📷 Перетащите изображение или нажмите для выбора</div>'}
              </div>
              <input type="file" id="comp-image-input" accept="image/*" style="display:none">
            </div>
            <input type="hidden" id="comp-image-path" value="${isEdit && comp.image_path ? comp.image_path : ''}">
          </div>
          <div class="form-group">
            <label>Описание</label>
            <textarea class="form-control" id="comp-description" rows="2">${isEdit ? (comp.description || '') : ''}</textarea>
          </div>
          <div class="form-group">
            <label>Комментарий</label>
            <textarea class="form-control" id="comp-comment" rows="2">${isEdit ? (comp.comment || '') : ''}</textarea>
          </div>
          <div class="form-group">
            <label><input type="checkbox" id="comp-active" ${!isEdit || comp.is_active ? 'checked' : ''}> Активен</label>
          </div>
          ${isEdit ? `
          <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px">
            <div style="font-size:1rem;font-weight:700;margin-bottom:12px">📎 Документы</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
              <div>
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                  <div style="font-size:0.85rem;font-weight:600;color:var(--accent-teal)">📜 Сертификаты</div>
                  <button type="button" class="btn btn-sm btn-secondary" onclick="ComponentsCatalogPage.uploadDoc(${comp.id}, 'certificate')">+ Добавить</button>
                </div>
                <div id="comp-docs-certificate" style="min-height:40px"><div style="color:var(--text-muted);font-size:0.82rem;padding:8px 0">Загрузка...</div></div>
              </div>
              <div>
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                  <div style="font-size:0.85rem;font-weight:600;color:var(--accent-blue)">📋 Инфо. сообщения</div>
                  <button type="button" class="btn btn-sm btn-secondary" onclick="ComponentsCatalogPage.uploadDoc(${comp.id}, 'info')">+ Добавить</button>
                </div>
                <div id="comp-docs-info" style="min-height:40px"><div style="color:var(--text-muted);font-size:0.82rem;padding:8px 0">Загрузка...</div></div>
              </div>
            </div>
          </div>
          ` : '<div style="margin-top:8px;font-size:0.8rem;color:var(--text-muted)">💡 Документы можно добавить после создания компонента</div>'}
        </form>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Отмена</button>
        <button class="btn btn-primary" onclick="ComponentsCatalogPage.saveComponent(${isEdit ? comp.id : 'null'})">${isEdit ? 'Сохранить' : 'Создать'}</button>
      `,
    });

    // Upload zone events
    const zone = document.getElementById('comp-upload-zone');
    const input = document.getElementById('comp-image-input');
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('drag-over'); if (e.dataTransfer.files[0]) this.uploadImage(e.dataTransfer.files[0]); });
    input.addEventListener('change', (e) => { if (e.target.files[0]) this.uploadImage(e.target.files[0]); });

    // Загрузить документы если редактирование
    if (isEdit) this.loadComponentDocs(comp.id);
  },

  async uploadImage(file) {
    const preview = document.getElementById('comp-image-preview');
    preview.innerHTML = '<div style="padding:24px;text-align:center">Загрузка...</div>';
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await API.upload('/upload/image', formData);
      document.getElementById('comp-image-path').value = res.path;
      preview.innerHTML = `<img src="${res.path}" style="max-height:120px;border-radius:8px">`;
      Toast.success('Изображение загружено');
    } catch (err) {
      preview.innerHTML = '<div style="padding:24px;text-align:center;color:var(--error)">Ошибка загрузки</div>';
      Toast.error(err.message);
    }
  },

  async saveComponent(id) {
    const data = {
      category_id: document.getElementById('comp-category').value || null,
      article: document.getElementById('comp-article').value.trim(),
      name: document.getElementById('comp-name').value.trim(),
      price: parseFloat(document.getElementById('comp-price').value) || 0,
      image_path: document.getElementById('comp-image-path').value || null,
      description: document.getElementById('comp-description').value.trim(),
      comment: document.getElementById('comp-comment').value.trim(),
      is_active: document.getElementById('comp-active').checked,
    };
    if (!data.article || !data.name) { Toast.error('Заполните артикул и название'); return; }
    try {
      if (id) { await API.put(`/components/${id}`, data); Toast.success('Компонент обновлён'); }
      else { await API.post('/components', data); Toast.success('Компонент создан'); }
      Modal.close();
      await this.loadAllComponents();
      this.filterAndRender();
    } catch (err) { Toast.error(err.message); }
  },

  async deleteComponent(id) {
    if (!confirm('Удалить компонент?')) return;
    try {
      await API.del(`/components/${id}`);
      Toast.success('Компонент удалён');
      await this.loadAllComponents();
      this.filterAndRender();
    } catch (err) { Toast.error(err.message); }
  },

  // === МОДИФИКАЦИИ CRUD ===
  async openModificationModal(componentId, modId = null) {
    let mod = null;
    if (modId) {
      try {
        const res = await API.get(`/components/${componentId}/modifications`);
        mod = res.data.find(m => m.id === modId);
        if (!mod) { Toast.error('Модификация не найдена'); return; }
      } catch (e) { Toast.error(e.message); return; }
    }
    const isEdit = !!mod;

    Modal.open({
      title: isEdit ? 'Редактировать модификацию' : 'Новая модификация',
      body: `
        <form id="mod-form">
          <div class="form-row">
            <div class="form-group">
              <label>Код модификации *</label>
              <input type="text" class="form-control" id="mod-code" value="${isEdit ? mod.code : ''}" placeholder="01.09" required>
              <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px">Будет добавлен к артикулу компонента</div>
            </div>
            <div class="form-group">
              <label>Цена модификации (₽)</label>
              <input type="number" class="form-control" id="mod-price" value="${isEdit && mod.price_override !== null ? mod.price_override : ''}" min="0" step="0.01" placeholder="Если не указана — базовая цена">
            </div>
          </div>
          <div class="form-group">
            <label>Описание</label>
            <textarea class="form-control" id="mod-name" rows="3" placeholder="Описание модификации">${isEdit ? (mod.name || '') : ''}</textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Порядок сортировки</label>
              <input type="number" class="form-control" id="mod-sort" value="${isEdit ? (mod.sort_order || 0) : 0}" min="0">
            </div>
            <div class="form-group" style="display:flex;align-items:flex-end;padding-bottom:8px">
              <label><input type="checkbox" id="mod-active" ${!isEdit || mod.is_active !== false ? 'checked' : ''}> Активна</label>
            </div>
          </div>
        </form>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Отмена</button>
        <button class="btn btn-primary" onclick="ComponentsCatalogPage.saveModification(${componentId}, ${isEdit ? mod.id : 'null'})">
          ${isEdit ? 'Сохранить' : 'Создать'}
        </button>
      `,
    });
  },

  async saveModification(componentId, modId) {
    const priceVal = document.getElementById('mod-price').value;
    const data = {
      code: document.getElementById('mod-code').value.trim(),
      name: document.getElementById('mod-name').value.trim(),
      price_override: priceVal !== '' ? parseFloat(priceVal) : null,
      sort_order: parseInt(document.getElementById('mod-sort').value) || 0,
      is_active: document.getElementById('mod-active').checked,
    };
    if (!data.code) { Toast.error('Укажите код модификации'); return; }
    try {
      if (modId) {
        await API.put(`/components/${componentId}/modifications/${modId}`, data);
        Toast.success('Модификация обновлена');
      } else {
        await API.post(`/components/${componentId}/modifications`, data);
        Toast.success('Модификация создана');
      }
      Modal.close();
      await this.loadAllComponents();
      this.filterAndRender();
      // Переоткрыть карточку компонента
      this.viewComponent(componentId);
    } catch (err) { Toast.error(err.message); }
  },

  async deleteModification(componentId, modId) {
    if (!confirm('Удалить модификацию?')) return;
    try {
      await API.del(`/components/${componentId}/modifications/${modId}`);
      Toast.success('Модификация удалена');
      await this.loadAllComponents();
      this.filterAndRender();
      this.viewComponent(componentId);
    } catch (err) { Toast.error(err.message); }
  },

  // === ФОТО МОДИФИКАЦИЙ ===
  uploadModImage(componentId, modId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.addEventListener('change', async (e) => {
      const files = e.target.files;
      if (!files.length) return;
      for (const file of files) {
        try {
          const formData = new FormData();
          formData.append('file', file);
          const res = await API.upload('/upload/image', formData);
          await API.post(`/components/${componentId}/modifications/${modId}/images`, {
            image_path: res.path,
          });
        } catch (err) {
          Toast.error(`Ошибка загрузки ${file.name}: ${err.message}`);
        }
      }
      Toast.success('Фото добавлены');
      this.viewComponent(componentId);
    });
    input.click();
  },

  async deleteModImage(componentId, modId, imgId) {
    if (!confirm('Удалить фото?')) return;
    try {
      await API.del(`/components/${componentId}/modifications/${modId}/images/${imgId}`);
      Toast.success('Фото удалено');
      this.viewComponent(componentId);
    } catch (err) { Toast.error(err.message); }
  },

  viewModImage(imagePath) {
    Modal.open({
      title: 'Фото модификации',
      wide: true,
      body: `<div style="text-align:center"><img src="${imagePath}" style="max-width:100%;max-height:70vh;border-radius:8px"></div>`,
      footer: '<button class="btn btn-secondary" onclick="Modal.close()">Закрыть</button>',
    });
  },

  // === ДОКУМЕНТЫ КОМПОНЕНТОВ ===
  async loadComponentDocs(componentId) {
    try {
      const res = await API.get(`/components/${componentId}/documents`);
      const docs = res.data || [];
      const certs = docs.filter(d => d.doc_type === 'certificate');
      const infos = docs.filter(d => d.doc_type === 'info');
      this._renderDocList('comp-docs-certificate', certs, componentId);
      this._renderDocList('comp-docs-info', infos, componentId);
    } catch (err) {
      const el1 = document.getElementById('comp-docs-certificate');
      const el2 = document.getElementById('comp-docs-info');
      if (el1) el1.innerHTML = '<div style="color:var(--accent-red);font-size:0.8rem">Ошибка загрузки</div>';
      if (el2) el2.innerHTML = '<div style="color:var(--accent-red);font-size:0.8rem">Ошибка загрузки</div>';
    }
  },

  _renderDocList(containerId, docs, componentId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (docs.length === 0) {
      el.innerHTML = '<div style="color:var(--text-muted);font-size:0.82rem;padding:8px 0">Нет документов</div>';
      return;
    }
    el.innerHTML = docs.map(doc => {
      const icon = doc.file_type === 'pdf' ? '📄' : '🖼️';
      const sizeKb = doc.file_size ? `${(doc.file_size / 1024).toFixed(0)} КБ` : '';
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg-tertiary);border-radius:8px;margin-bottom:4px;border:1px solid var(--border)">
          <span style="font-size:1rem">${icon}</span>
          <div style="flex:1;min-width:0;overflow:hidden">
            <div style="font-size:0.82rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${doc.original_name}">${doc.original_name}</div>
            ${sizeKb ? `<div style="font-size:0.7rem;color:var(--text-muted)">${sizeKb}</div>` : ''}
          </div>
          <a href="${doc.file_path}" download="${doc.original_name}" style="color:var(--accent-teal);font-size:0.8rem;text-decoration:none;white-space:nowrap" title="Скачать">⬇️</a>
          <button type="button" onclick="ComponentsCatalogPage.deleteDoc(${componentId}, ${doc.id})" style="background:none;border:none;color:var(--accent-red);cursor:pointer;font-size:0.8rem;padding:2px" title="Удалить">✕</button>
        </div>`;
    }).join('');
  },

  uploadDoc(componentId, docType) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png';
    input.multiple = true;
    input.addEventListener('change', async () => {
      for (const file of input.files) {
        try {
          const formData = new FormData();
          formData.append('file', file);
          const res = await API.upload('/upload/component-doc', formData);
          await API.post(`/components/${componentId}/documents`, {
            doc_type: docType,
            file_path: res.path,
            original_name: res.originalname,
            file_type: res.file_type,
            file_size: res.size,
          });
        } catch (err) {
          Toast.error(`Ошибка загрузки ${file.name}: ${err.message}`);
        }
      }
      Toast.success('Документ(ы) загружен(ы)');
      this.loadComponentDocs(componentId);
    });
    input.click();
  },

  async deleteDoc(componentId, docId) {
    if (!confirm('Удалить документ?')) return;
    try {
      await API.del(`/components/${componentId}/documents/${docId}`);
      Toast.success('Документ удалён');
      this.loadComponentDocs(componentId);
    } catch (err) { Toast.error(err.message); }
  },
};
