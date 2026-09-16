/* =============================================
   Подбор компонентов — Производители, техника, корзина
   ============================================= */
const EquipmentPage = {
  equipmentTypes: [],
  manufacturers: [],
  selectedTypeId: null,
  searchQuery: '',
  sortBy: 'name', // name | products | country
  viewMode: 'cards', // cards | table
  expandedMfr: null,
  expandedProd: null,
  allComponents: [],
  cartVisible: false,

  // ===== КОРЗИНА (localStorage) =====
  _cartKey: 'atlanta_equipment_cart',

  getCart() {
    try {
      return JSON.parse(localStorage.getItem(this._cartKey)) || [];
    } catch { return []; }
  },

  saveCart(items) {
    localStorage.setItem(this._cartKey, JSON.stringify(items));
    this._updateCartBadge();
  },

  addToCart(item) {
    const cart = this.getCart();
    const key = `${item.component_id}_${item.modification_id || 0}`;
    const existing = cart.find(c => `${c.component_id}_${c.modification_id || 0}` === key);
    if (existing) {
      existing.quantity += (item.quantity || 1);
    } else {
      cart.push({
        component_id: item.component_id,
        modification_id: item.modification_id || null,
        article: item.article,
        name: item.name,
        price: item.price,
        quantity: item.quantity || 1,
        image_path: item.image_path || '',
        manufacturer_name: item.manufacturer_name || '',
        product_name: item.product_name || '',
      });
    }
    this.saveCart(cart);
    Toast.success(`${item.article} добавлен в корзину`);
  },

  removeFromCart(index) {
    const cart = this.getCart();
    cart.splice(index, 1);
    this.saveCart(cart);
    if (this.cartVisible) this._renderCartPanel();
  },

  updateCartQty(index, qty) {
    const cart = this.getCart();
    if (cart[index]) {
      cart[index].quantity = Math.max(1, parseInt(qty) || 1);
      this.saveCart(cart);
      if (this.cartVisible) this._renderCartPanel();
    }
  },

  clearCart() {
    localStorage.removeItem(this._cartKey);
    this._updateCartBadge();
    if (this.cartVisible) this._renderCartPanel();
  },

  _updateCartBadge() {
    const badge = document.getElementById('eq-cart-badge');
    const cart = this.getCart();
    if (badge) {
      badge.textContent = cart.length;
      badge.style.display = cart.length > 0 ? 'flex' : 'none';
    }
  },

  // ===== RENDER =====
  async render() {
    const content = document.getElementById('content-area');
    content.innerHTML = '<div class="loading">Загрузка...</div>';

    try {
      const [typesRes, mfrRes] = await Promise.all([
        API.get('/equipment-types'),
        API.get('/manufacturers'),
      ]);
      this.equipmentTypes = typesRes.data || [];
      this.manufacturers = mfrRes.data || [];
    } catch (err) {
      content.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
      return;
    }

    this._renderPage();
  },

  _renderPage() {
    const content = document.getElementById('content-area');
    const canEdit = API.can('equipment', 'edit');

    content.innerHTML = `
      <!-- Шапка-тулбар как в чертежах -->
      <div class="toolbar" style="flex-wrap:wrap;gap:8px;margin-bottom:14px">
        <div class="search-input" style="flex:1;min-width:220px">
          <input type="text" id="eq-search" placeholder="Поиск по производителю, стране..." value="${this.searchQuery}">
        </div>
        <div class="filter-group" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select class="filter-select" id="eq-type-filter" style="min-width:160px">
            <option value="">Все типы техники</option>
            ${this.equipmentTypes.map(t => `<option value="${t.id}" ${this.selectedTypeId == t.id ? 'selected' : ''}>${t.icon || ''} ${t.name}</option>`).join('')}
          </select>
          <select class="filter-select" id="eq-sort" style="min-width:140px">
            <option value="name" ${this.sortBy === 'name' ? 'selected' : ''}>По названию</option>
            <option value="products" ${this.sortBy === 'products' ? 'selected' : ''}>По кол-ву продукции</option>
            <option value="country" ${this.sortBy === 'country' ? 'selected' : ''}>По стране</option>
          </select>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-icon ${this.viewMode === 'cards' ? 'btn-primary' : 'btn-secondary'}" onclick="EquipmentPage.setViewMode('cards')" title="Карточки">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          </button>
          <button class="btn btn-icon ${this.viewMode === 'table' ? 'btn-primary' : 'btn-secondary'}" onclick="EquipmentPage.setViewMode('table')" title="Таблица">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
        </div>
        ${canEdit ? '<button class="btn btn-primary" onclick="EquipmentPage.showManufacturerForm()">+ Производитель</button>' : ''}
      </div>

      <!-- Быстрые табы типов -->
      <div id="eq-type-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">
        <button class="btn ${!this.selectedTypeId ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="EquipmentPage.filterByType(null)">Все</button>
        ${this.equipmentTypes.map(t => `
          <button class="btn ${this.selectedTypeId == t.id ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="EquipmentPage.filterByType(${t.id})">
            ${t.icon || ''} ${t.name}
          </button>
        `).join('')}
      </div>

      <div id="eq-count" style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px"></div>

      <!-- Список производителей -->
      <div id="eq-manufacturers-list"></div>

      <!-- Корзина (выезжающая панель) -->
      <div id="eq-cart-panel" style="display:none"></div>

      <!-- Плавающая кнопка корзины -->
      <div id="eq-cart-fab" onclick="EquipmentPage.toggleCart()" style="position:fixed;bottom:32px;right:32px;width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,var(--accent-teal),var(--accent-blue));color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.5rem;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,0.35);z-index:999;transition:transform 0.2s,box-shadow 0.2s" onmouseenter="this.style.transform='scale(1.1)'" onmouseleave="this.style.transform='scale(1)'">
        🛒
        <span id="eq-cart-badge" style="position:absolute;top:-2px;right:-2px;background:var(--accent-red);color:#fff;font-size:0.65rem;font-weight:700;min-width:20px;height:20px;border-radius:10px;display:none;align-items:center;justify-content:center;padding:0 5px">0</span>
      </div>
    `;

    this._updateCartBadge();
    this._renderManufacturers();

    // Bind events
    document.getElementById('eq-search').addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => this._loadManufacturers(), 300);
    });
    document.getElementById('eq-type-filter').addEventListener('change', (e) => {
      this.filterByType(e.target.value || null);
    });
    document.getElementById('eq-sort').addEventListener('change', (e) => {
      this.sortBy = e.target.value;
      this._renderManufacturers();
    });
  },

  setViewMode(mode) {
    this.viewMode = mode;
    this._renderPage();
  },

  filterByType(typeId) {
    this.selectedTypeId = typeId;
    this.expandedMfr = null;
    this.expandedProd = null;
    this._loadManufacturers();
  },

  async _loadManufacturers() {
    try {
      let url = '/manufacturers?';
      if (this.selectedTypeId) url += `equipment_type_id=${this.selectedTypeId}&`;
      if (this.searchQuery) url += `search=${encodeURIComponent(this.searchQuery)}&`;
      const res = await API.get(url);
      this.manufacturers = res.data || [];
      this._renderManufacturers();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  _getSortedManufacturers() {
    const sorted = [...this.manufacturers];
    if (this.sortBy === 'products') {
      sorted.sort((a, b) => (b.products_count || 0) - (a.products_count || 0));
    } else if (this.sortBy === 'country') {
      sorted.sort((a, b) => (a.country || '').localeCompare(b.country || ''));
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  },

  _renderManufacturers() {
    const container = document.getElementById('eq-manufacturers-list');
    if (!container) return;

    const sorted = this._getSortedManufacturers();

    // Счётчик
    const countEl = document.getElementById('eq-count');
    if (countEl) countEl.textContent = `Найдено: ${sorted.length} производител${sorted.length === 1 ? 'ь' : sorted.length < 5 ? 'я' : 'ей'}`;

    if (sorted.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:60px 20px;color:var(--text-muted)">
          <div style="font-size:3rem;margin-bottom:12px">🏭</div>
          <div style="font-size:1.1rem;font-weight:600">Производители не найдены</div>
          <div style="font-size:0.9rem;margin-top:4px">Добавьте первого производителя</div>
        </div>
      `;
      return;
    }

    const canEdit = API.can('equipment', 'edit');

    if (this.viewMode === 'table') {
      this._renderTableView(sorted, canEdit, container);
    } else {
      this._renderCardsView(sorted, canEdit, container);
    }
  },

  _renderCardsView(sorted, canEdit, container) {
    container.innerHTML = sorted.map(m => {
      const isExpanded = this.expandedMfr === m.id;
      return `
        <div class="card mb-2" style="overflow:hidden">
          <div style="display:flex;align-items:center;gap:16px;padding:16px 20px;cursor:pointer;transition:background 0.2s"
               onclick="EquipmentPage.toggleManufacturer(${m.id})"
               onmouseenter="this.style.background='var(--bg-main)'" onmouseleave="this.style.background=''">
            ${m.logo_path
              ? `<img src="${m.logo_path}" style="width:56px;height:56px;object-fit:contain;border-radius:10px;background:var(--bg-main);padding:4px">`
              : `<div style="width:56px;height:56px;background:linear-gradient(135deg,var(--accent-teal),var(--accent-blue));border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;font-weight:700;color:#fff">${m.name.charAt(0)}</div>`
            }
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:1.05rem;color:var(--text-primary)">${m.name}</div>
              <div style="font-size:0.82rem;color:var(--text-muted);margin-top:2px">
                ${m.country ? `<span>🌍 ${m.country}</span>` : ''}
                ${m.phone ? ` · <span>📞 ${m.phone}</span>` : ''}
                ${m.website ? ` · <a href="${m.website.startsWith('http') ? m.website : 'https://' + m.website}" target="_blank" onclick="event.stopPropagation()" style="color:var(--accent-teal)">🌐 Сайт</a>` : ''}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="badge badge-success" style="font-size:0.75rem">${m.products_count || 0} продукции</span>
              ${canEdit ? `
                <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();EquipmentPage.showManufacturerForm(${m.id})" title="Редактировать">✏️</button>
                <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();EquipmentPage.deleteManufacturer(${m.id})" title="Удалить">🗑️</button>
              ` : ''}
              <span style="font-size:1.2rem;transition:transform 0.2s;transform:rotate(${isExpanded ? '180' : '0'}deg)">▼</span>
            </div>
          </div>
          <div id="mfr-detail-${m.id}" style="display:${isExpanded ? 'block' : 'none'};border-top:1px solid var(--border)">
            <div style="padding:16px 20px;text-align:center;color:var(--text-muted)">Загрузка...</div>
          </div>
        </div>
      `;
    }).join('');
  },

  _renderTableView(sorted, canEdit, container) {
    container.innerHTML = `
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr>
            <th style="width:50px"></th>
            <th>Название</th>
            <th>Страна</th>
            <th>Телефон</th>
            <th>Сайт</th>
            <th class="text-center">Продукция</th>
            ${canEdit ? '<th style="width:90px"></th>' : ''}
          </tr></thead>
          <tbody>
            ${sorted.map(m => `
              <tr style="cursor:pointer" onclick="EquipmentPage.toggleManufacturer(${m.id})">
                <td>${m.logo_path
                  ? `<img src="${m.logo_path}" style="width:36px;height:36px;object-fit:contain;border-radius:6px">`
                  : `<div style="width:36px;height:36px;background:linear-gradient(135deg,var(--accent-teal),var(--accent-blue));border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff">${m.name.charAt(0)}</div>`
                }</td>
                <td style="font-weight:600">${m.name}</td>
                <td>${m.country || '—'}</td>
                <td>${m.phone || '—'}</td>
                <td>${m.website ? `<a href="${m.website.startsWith('http') ? m.website : 'https://' + m.website}" target="_blank" onclick="event.stopPropagation()" style="color:var(--accent-teal)">↗</a>` : '—'}</td>
                <td class="text-center"><span class="badge badge-success">${m.products_count || 0}</span></td>
                ${canEdit ? `<td class="text-right">
                  <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();EquipmentPage.showManufacturerForm(${m.id})">✏️</button>
                  <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();EquipmentPage.deleteManufacturer(${m.id})">🗑️</button>
                </td>` : ''}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div id="mfr-detail-expanded" style="display:none"></div>
    `;
  },

  async toggleManufacturer(id) {
    if (this.expandedMfr === id) {
      this.expandedMfr = null;
      this._renderManufacturers();
      return;
    }
    this.expandedMfr = id;
    this.expandedProd = null;

    if (this.viewMode === 'cards') {
      this._renderManufacturers();
      try {
        const mfr = await API.get(`/manufacturers/${id}`);
        this._renderManufacturerDetail(mfr);
      } catch (err) {
        const detail = document.getElementById(`mfr-detail-${id}`);
        if (detail) detail.innerHTML = `<div style="padding:16px 20px;color:var(--accent-red)">${err.message}</div>`;
      }
    } else {
      // table mode: show detail below table
      try {
        const mfr = await API.get(`/manufacturers/${id}`);
        const detailEl = document.getElementById('mfr-detail-expanded');
        if (detailEl) {
          detailEl.style.display = 'block';
          detailEl.id = `mfr-detail-${id}`;
          this._renderManufacturerDetail(mfr);
        }
      } catch (err) { Toast.error(err.message); }
    }
  },

  _renderManufacturerDetail(mfr) {
    const detail = document.getElementById(`mfr-detail-${mfr.id}`);
    if (!detail) return;
    const canEdit = API.can('equipment', 'edit');
    const products = mfr.products || [];

    detail.innerHTML = `
      <div style="padding:12px 20px;background:var(--bg-main);display:flex;gap:24px;flex-wrap:wrap;font-size:0.85rem">
        ${mfr.address ? `<div><span style="color:var(--text-muted)">📍 Адрес:</span> ${mfr.address}</div>` : ''}
        ${mfr.email ? `<div><span style="color:var(--text-muted)">📧</span> <a href="mailto:${mfr.email}" style="color:var(--accent-teal)">${mfr.email}</a></div>` : ''}
        ${mfr.contact_person ? `<div><span style="color:var(--text-muted)">👤</span> ${mfr.contact_person}</div>` : ''}
        ${mfr.description ? `<div style="flex-basis:100%;color:var(--text-secondary)">${mfr.description}</div>` : ''}
      </div>
      <div style="padding:16px 20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h4 style="margin:0;color:var(--text-primary)">Продукция (${products.length})</h4>
          ${canEdit ? `<button class="btn btn-primary btn-sm" onclick="EquipmentPage.showProductForm(${mfr.id})">+ Добавить продукцию</button>` : ''}
        </div>
        ${products.length === 0 ? `
          <div style="text-align:center;padding:30px;color:var(--text-muted);font-size:0.9rem">Нет добавленной продукции</div>
        ` : products.map(p => this._renderProductCard(p, mfr, canEdit)).join('')}
      </div>
    `;
  },

  _renderProductCard(product, mfr, canEdit) {
    const comps = product.components || [];
    const isExpanded = this.expandedProd === product.id;

    return `
      <div style="margin-bottom:10px;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--bg-card)">
        <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;transition:background 0.15s"
             onclick="EquipmentPage.toggleProduct(${product.id}, ${mfr.id})"
             onmouseenter="this.style.background='var(--bg-main)'" onmouseleave="this.style.background=''">
          ${product.image_path
            ? `<img src="${product.image_path}" style="width:48px;height:48px;object-fit:cover;border-radius:8px">`
            : `<div style="width:48px;height:48px;background:var(--bg-main);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1.3rem">📦</div>`
          }
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;color:var(--text-primary)">${product.name}</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">
              ${product.model ? `Модель: ${product.model}` : ''}
              ${product.equipment_type_name ? ` · ${product.equipment_type_name}` : ''}
              · ${comps.length} компонентов
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            ${product.drawing_id ? `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();App.navigateTo('calculator', ${product.drawing_id})" title="Открыть чертёж">📐</button>` : ''}
            ${canEdit ? `
              <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();EquipmentPage.showProductForm(${mfr.id}, ${product.id})" title="Редактировать">✏️</button>
              <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();EquipmentPage.deleteProduct(${product.id}, ${mfr.id})" title="Удалить">🗑️</button>
            ` : ''}
            <span style="font-size:1rem;transition:transform 0.2s;transform:rotate(${isExpanded ? '180' : '0'}deg)">▾</span>
          </div>
        </div>

        <div style="display:${isExpanded ? 'block' : 'none'};border-top:1px solid var(--border)">
          ${canEdit ? `<div style="padding:8px 16px;text-align:right"><button class="btn btn-primary btn-sm" onclick="EquipmentPage.showAddComponentForm(${product.id}, ${mfr.id})">+ Привязать компонент</button></div>` : ''}
          ${comps.length === 0 ? `
            <div style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.85rem">Компоненты не привязаны</div>
          ` : `
            <div style="padding:0 16px 12px">
              <table class="data-table" style="margin:0">
                <thead><tr>
                  <th style="width:40px"></th>
                  <th>Артикул</th>
                  <th>Название</th>
                  <th class="text-right">Цена</th>
                  <th class="text-right" style="width:60px">Кол-во</th>
                  <th style="width:90px"></th>
                </tr></thead>
                <tbody>
                  ${comps.map(c => {
                    const fullArticle = c.modification_code ? c.article + '.' + c.modification_code : c.article;
                    const displayName = c.modification_name ? c.component_name + ' — ' + c.modification_name : c.component_name;
                    const price = c.modification_price !== null && c.modification_price !== undefined ? parseFloat(c.modification_price) : parseFloat(c.component_price);
                    return `
                      <tr>
                        <td>${c.component_image ? `<img src="${c.component_image}" style="width:32px;height:32px;object-fit:cover;border-radius:4px">` : '📦'}</td>
                        <td><span class="font-mono" style="color:var(--accent-teal);font-weight:600">${fullArticle}</span></td>
                        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${displayName}">${displayName}</td>
                        <td class="text-right">${Table.formatMoney(price)}</td>
                        <td class="text-right">${c.quantity}</td>
                        <td class="text-right">
                          <button class="btn btn-primary btn-sm" onclick="EquipmentPage.addToCart({
                            component_id: ${c.component_id},
                            modification_id: ${c.modification_id || 'null'},
                            article: '${fullArticle}',
                            name: '${displayName.replace(/'/g, "\\'")}',
                            price: ${price},
                            quantity: ${c.quantity},
                            image_path: '${c.component_image || ''}',
                            manufacturer_name: '${mfr.name.replace(/'/g, "\\'")}',
                            product_name: '${product.name.replace(/'/g, "\\'")}'
                          })" title="В корзину">🛒</button>
                          ${canEdit ? `<button class="btn btn-danger btn-sm" onclick="EquipmentPage.unlinkComponent(${product.id}, ${c.id}, ${mfr.id})" title="Отвязать">✕</button>` : ''}
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
              <div style="text-align:right;margin-top:8px">
                <button class="btn btn-primary btn-sm" onclick="EquipmentPage._addAllToCart(${product.id}, ${mfr.id})">🛒 Всё в корзину</button>
              </div>
            </div>
          `}
        </div>
      </div>
    `;
  },

  async toggleProduct(productId, mfrId) {
    this.expandedProd = this.expandedProd === productId ? null : productId;
    try {
      const mfr = await API.get(`/manufacturers/${mfrId}`);
      this._renderManufacturerDetail(mfr);
    } catch (err) { Toast.error(err.message); }
  },

  _addAllToCart(productId, mfrId) {
    API.get(`/manufacturers/${mfrId}`).then(mfr => {
      const product = (mfr.products || []).find(p => p.id === productId);
      if (!product) return;
      (product.components || []).forEach(c => {
        const fullArticle = c.modification_code ? c.article + '.' + c.modification_code : c.article;
        const displayName = c.modification_name ? c.component_name + ' — ' + c.modification_name : c.component_name;
        const price = c.modification_price !== null && c.modification_price !== undefined ? parseFloat(c.modification_price) : parseFloat(c.component_price);
        this.addToCart({
          component_id: c.component_id,
          modification_id: c.modification_id || null,
          article: fullArticle, name: displayName, price,
          quantity: c.quantity,
          image_path: c.component_image || '',
          manufacturer_name: mfr.name, product_name: product.name,
        });
      });
    }).catch(() => {});
  },

  // ===== КОРЗИНА UI — плавающая панель =====
  toggleCart() {
    this.cartVisible = !this.cartVisible;
    this._renderCartPanel();
  },

  _renderCartPanel() {
    // Backdrop
    let backdrop = document.getElementById('eq-cart-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'eq-cart-backdrop';
      backdrop.onclick = () => this.toggleCart();
      document.body.appendChild(backdrop);
    }

    let panel = document.getElementById('eq-cart-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'eq-cart-panel';
      document.body.appendChild(panel);
    }

    if (!this.cartVisible) {
      backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999;opacity:0;pointer-events:none;transition:opacity 0.3s';
      panel.style.cssText = 'position:fixed;top:0;right:-450px;bottom:0;width:430px;max-width:92vw;background:var(--bg-card);z-index:1000;transition:right 0.3s ease;display:flex;flex-direction:column';
      return;
    }

    const cart = this.getCart();
    const total = cart.reduce((s, c) => s + (c.price * c.quantity), 0);
    const totalQty = cart.reduce((s, c) => s + c.quantity, 0);

    // Группировка по производителям
    const grouped = {};
    cart.forEach((item, i) => {
      const key = item.manufacturer_name || 'Без производителя';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({ ...item, _index: i });
    });

    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:999;opacity:1;pointer-events:auto;transition:opacity 0.3s;cursor:pointer';
    panel.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:430px;max-width:92vw;background:var(--bg-card);border-left:1px solid var(--border);z-index:1000;display:flex;flex-direction:column;box-shadow:-10px 0 40px rgba(0,0,0,0.35);transition:right 0.3s ease';

    panel.innerHTML = `
      <!-- Шапка -->
      <div style="padding:18px 20px;background:linear-gradient(135deg,var(--accent-teal),var(--accent-blue));display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-weight:700;font-size:1.15rem;color:#fff">🛒 Корзина</div>
          <div style="font-size:0.78rem;color:rgba(255,255,255,0.8);margin-top:2px">${cart.length} позиц${cart.length === 1 ? 'ия' : cart.length < 5 ? 'ии' : 'ий'} · ${totalQty} шт.</div>
        </div>
        <button onclick="EquipmentPage.toggleCart()" style="background:rgba(255,255,255,0.15);border:none;width:36px;height:36px;border-radius:50%;font-size:1.1rem;cursor:pointer;color:#fff;display:flex;align-items:center;justify-content:center;transition:background 0.2s"
                onmouseenter="this.style.background='rgba(255,255,255,0.3)'" onmouseleave="this.style.background='rgba(255,255,255,0.15)'">✕</button>
      </div>

      <!-- Содержимое -->
      <div style="flex:1;overflow-y:auto;padding:0">
        ${cart.length === 0 ? `
          <div style="text-align:center;padding:60px 20px;color:var(--text-muted)">
            <div style="font-size:3.5rem;margin-bottom:12px;opacity:0.4">🛒</div>
            <div style="font-size:1rem;font-weight:600">Корзина пуста</div>
            <div style="font-size:0.85rem;margin-top:6px">Добавляйте компоненты из карточек продукции</div>
          </div>
        ` : Object.entries(grouped).map(([mfrName, items]) => `
          <div style="border-bottom:2px solid var(--border)">
            <div style="padding:10px 20px;background:var(--bg-main);font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">
              🏭 ${mfrName}
              <span style="float:right;font-weight:400;text-transform:none">${items.length} поз.</span>
            </div>
            ${items.map(item => `
              <div style="padding:12px 20px;display:flex;gap:12px;align-items:flex-start;border-bottom:1px solid var(--border);transition:background 0.15s"
                   onmouseenter="this.style.background='var(--bg-main)'" onmouseleave="this.style.background=''">
                ${item.image_path
                  ? `<img src="${item.image_path}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0">`
                  : `<div style="width:44px;height:44px;border-radius:8px;background:var(--bg-main);display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0">📦</div>`
                }
                <div style="flex:1;min-width:0">
                  <div class="font-mono" style="font-size:0.75rem;color:var(--accent-teal);font-weight:700">${item.article}</div>
                  <div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${item.name}">${item.name}</div>
                  ${item.product_name ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:1px">📦 ${item.product_name}</div>` : ''}
                  <div style="display:flex;align-items:center;gap:6px;margin-top:6px">
                    <div style="display:flex;align-items:center;border:1px solid var(--border);border-radius:6px;overflow:hidden">
                      <button onclick="EquipmentPage.updateCartQty(${item._index}, ${item.quantity - 1})" style="width:28px;height:28px;border:none;background:var(--bg-main);cursor:pointer;color:var(--text-primary);font-size:0.9rem;display:flex;align-items:center;justify-content:center" ${item.quantity <= 1 ? 'disabled style="opacity:0.3;cursor:default"' : ''}>−</button>
                      <input type="number" value="${item.quantity}" min="1" style="width:36px;text-align:center;border:none;border-left:1px solid var(--border);border-right:1px solid var(--border);background:transparent;color:var(--text-primary);font-size:0.82rem;font-weight:600;padding:4px 0"
                             oninput="EquipmentPage.updateCartQty(${item._index}, this.value)">
                      <button onclick="EquipmentPage.updateCartQty(${item._index}, ${item.quantity + 1})" style="width:28px;height:28px;border:none;background:var(--bg-main);cursor:pointer;color:var(--text-primary);font-size:0.9rem;display:flex;align-items:center;justify-content:center">+</button>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted)">× ${Table.formatMoneyRaw(item.price)}</span>
                    <span style="font-weight:700;font-size:0.88rem;color:var(--text-primary);margin-left:auto">${Table.formatMoneyRaw(item.price * item.quantity)}</span>
                  </div>
                </div>
                <button onclick="EquipmentPage.removeFromCart(${item._index})" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:0.85rem;padding:4px;transition:color 0.2s;flex-shrink:0"
                        onmouseenter="this.style.color='var(--accent-red)'" onmouseleave="this.style.color='var(--text-muted)'" title="Удалить">✕</button>
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>

      <!-- Футер -->
      <div style="padding:16px 20px;border-top:2px solid var(--border);background:var(--bg-main)">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px">
          <div>
            <div style="font-size:0.78rem;color:var(--text-muted)">Итого к заказу:</div>
            <div style="font-weight:800;font-size:1.3rem;color:var(--accent-teal)">${Table.formatMoney(total)}</div>
          </div>
          <div style="text-align:right;font-size:0.78rem;color:var(--text-muted)">
            ${totalQty} шт. · ${cart.length} позиц.
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary" style="flex:1;padding:10px 16px;font-size:0.95rem" onclick="EquipmentPage.createOrderFromCart()" ${cart.length === 0 ? 'disabled' : ''}>
            📋 Создать заказ
          </button>
          <button class="btn btn-secondary" style="padding:10px 12px" onclick="if(confirm('Очистить корзину?'))EquipmentPage.clearCart()" ${cart.length === 0 ? 'disabled' : ''} title="Очистить корзину">
            🗑️
          </button>
        </div>
      </div>
    `;
  },

  // ===== СОЗДАНИЕ ЗАКАЗА ИЗ КОРЗИНЫ =====
  async createOrderFromCart() {
    const cart = this.getCart();
    if (cart.length === 0) return;

    this.cartVisible = false;
    this._renderCartPanel();

    const items = cart.map(c => ({
      product_id: c.component_id,
      product_name: c.name,
      article: c.article,
      unit_price: c.price,
      quantity: c.quantity,
      image_path: c.image_path || '',
    }));

    await App.navigateTo('orders');
    setTimeout(() => {
      OrdersPage.openCreateModal(items);
    }, 500);
  },

  // ===== CRUD ПРОИЗВОДИТЕЛЕЙ =====
  async showManufacturerForm(id = null) {
    let mfr = {};
    if (id) {
      try {
        mfr = await API.get(`/manufacturers/${id}`);
      } catch (err) { Toast.error(err.message); return; }
    }

    Modal.open({
      title: id ? 'Редактировать производителя' : 'Новый производитель',
      size: 'medium',
      body: `
        <form id="mfr-form">
          <div class="form-row">
            <div class="form-group" style="flex:1">
              <label>Название *</label>
              <input type="text" class="form-control" id="mfr-name" value="${mfr.name || ''}" required>
            </div>
            <div class="form-group" style="flex:1">
              <label>Страна</label>
              <input type="text" class="form-control" id="mfr-country" value="${mfr.country || ''}">
            </div>
          </div>
          <div class="form-group">
            <label>Адрес</label>
            <input type="text" class="form-control" id="mfr-address" value="${mfr.address || ''}">
          </div>
          <div class="form-row">
            <div class="form-group" style="flex:1">
              <label>Телефон</label>
              <input type="text" class="form-control" id="mfr-phone" value="${mfr.phone || ''}">
            </div>
            <div class="form-group" style="flex:1">
              <label>Email</label>
              <input type="email" class="form-control" id="mfr-email" value="${mfr.email || ''}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group" style="flex:1">
              <label>Сайт</label>
              <input type="text" class="form-control" id="mfr-website" value="${mfr.website || ''}">
            </div>
            <div class="form-group" style="flex:1">
              <label>Контактное лицо</label>
              <input type="text" class="form-control" id="mfr-contact" value="${mfr.contact_person || ''}">
            </div>
          </div>
          <div class="form-group">
            <label>Логотип (URL изображения)</label>
            <input type="text" class="form-control" id="mfr-logo" value="${mfr.logo_path || ''}" placeholder="/uploads/...">
          </div>
          <div class="form-group">
            <label>Описание</label>
            <textarea class="form-control" id="mfr-desc" rows="2">${mfr.description || ''}</textarea>
          </div>
        </form>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Отмена</button>
        <button class="btn btn-primary" onclick="EquipmentPage.saveManufacturer(${id || 'null'})">${id ? 'Сохранить' : 'Создать'}</button>
      `,
    });
  },

  async saveManufacturer(id) {
    const data = {
      name: document.getElementById('mfr-name').value,
      country: document.getElementById('mfr-country').value,
      address: document.getElementById('mfr-address').value,
      phone: document.getElementById('mfr-phone').value,
      email: document.getElementById('mfr-email').value,
      website: document.getElementById('mfr-website').value,
      contact_person: document.getElementById('mfr-contact').value,
      logo_path: document.getElementById('mfr-logo').value,
      description: document.getElementById('mfr-desc').value,
    };
    if (!data.name) { Toast.error('Укажите название'); return; }

    try {
      if (id) {
        await API.put(`/manufacturers/${id}`, data);
        Toast.success('Производитель обновлён');
      } else {
        await API.post('/manufacturers', data);
        Toast.success('Производитель создан');
      }
      Modal.close();
      this._loadManufacturers();
    } catch (err) { Toast.error(err.message); }
  },

  async deleteManufacturer(id) {
    if (!confirm('Удалить производителя и всю его продукцию?')) return;
    try {
      await API.del(`/manufacturers/${id}`);
      Toast.success('Удалено');
      this.expandedMfr = null;
      this._loadManufacturers();
    } catch (err) { Toast.error(err.message); }
  },

  // ===== CRUD ПРОДУКЦИИ =====
  async showProductForm(mfrId, productId = null) {
    let product = {};
    if (productId) {
      try {
        product = await API.get(`/manufacturer-products/${productId}`);
      } catch (err) { Toast.error(err.message); return; }
    }

    let drawings = [];
    try {
      const dr = await API.get('/drawings?limit=500');
      drawings = dr.data || [];
    } catch {}

    Modal.open({
      title: productId ? 'Редактировать продукцию' : 'Новая продукция',
      size: 'medium',
      body: `
        <form id="prod-form">
          <div class="form-row">
            <div class="form-group" style="flex:1">
              <label>Название *</label>
              <input type="text" class="form-control" id="prod-name" value="${product.name || ''}">
            </div>
            <div class="form-group" style="flex:1">
              <label>Модель</label>
              <input type="text" class="form-control" id="prod-model" value="${product.model || ''}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group" style="flex:1">
              <label>Тип техники</label>
              <select class="form-control" id="prod-type">
                <option value="">— Не указан —</option>
                ${this.equipmentTypes.map(t => `<option value="${t.id}" ${product.equipment_type_id == t.id ? 'selected' : ''}>${t.icon || ''} ${t.name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="flex:1">
              <label>Чертёж</label>
              <select class="form-control" id="prod-drawing">
                <option value="">— Без чертежа —</option>
                ${drawings.map(d => `<option value="${d.id}" ${product.drawing_id == d.id ? 'selected' : ''}>${d.name || d.title || 'Чертёж #' + d.id}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Фото (URL)</label>
            <input type="text" class="form-control" id="prod-image" value="${product.image_path || ''}" placeholder="/uploads/...">
          </div>
          <div class="form-group">
            <label>Описание</label>
            <textarea class="form-control" id="prod-desc" rows="2">${product.description || ''}</textarea>
          </div>
        </form>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Отмена</button>
        <button class="btn btn-primary" onclick="EquipmentPage.saveProduct(${mfrId}, ${productId || 'null'})">${productId ? 'Сохранить' : 'Создать'}</button>
      `,
    });
  },

  async saveProduct(mfrId, productId) {
    const data = {
      manufacturer_id: mfrId,
      equipment_type_id: document.getElementById('prod-type').value || null,
      name: document.getElementById('prod-name').value,
      model: document.getElementById('prod-model').value,
      image_path: document.getElementById('prod-image').value,
      drawing_id: document.getElementById('prod-drawing').value || null,
      description: document.getElementById('prod-desc').value,
    };
    if (!data.name) { Toast.error('Укажите название'); return; }

    try {
      if (productId) {
        await API.put(`/manufacturer-products/${productId}`, data);
        Toast.success('Продукция обновлена');
      } else {
        await API.post('/manufacturer-products', data);
        Toast.success('Продукция создана');
      }
      Modal.close();
      this.toggleManufacturer(mfrId);
    } catch (err) { Toast.error(err.message); }
  },

  async deleteProduct(productId, mfrId) {
    if (!confirm('Удалить продукцию?')) return;
    try {
      await API.del(`/manufacturer-products/${productId}`);
      Toast.success('Удалено');
      this.toggleManufacturer(mfrId);
    } catch (err) { Toast.error(err.message); }
  },

  // ===== ПРИВЯЗКА КОМПОНЕНТОВ — по аналогии с заказами =====
  async showAddComponentForm(productId, mfrId) {
    try {
      const res = await API.get('/components?active=true');
      this.allComponents = res.data || [];
    } catch (err) { Toast.error(err.message); return; }

    this._currentLinkProductId = productId;
    this._currentLinkMfrId = mfrId;

    let filterSearch = '';
    let filterCat = '';
    const categories = [...new Set(this.allComponents.map(c => c.category_name).filter(Boolean))];

    const renderList = () => {
      let filtered = this.allComponents;
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
                  <tr style="cursor:pointer" onclick="EquipmentPage._addCatalogComponent(${c.id})">
                    <td>${c.image_path ? `<img src="${c.image_path}" style="width:32px;height:32px;object-fit:cover;border-radius:4px">` : '📦'}</td>
                    <td class="font-mono" style="color:var(--accent-teal)">${c.article}</td>
                    <td>${c.name}${modCount > 0 ? `<span style="margin-left:6px;padding:1px 6px;border-radius:8px;font-size:0.65rem;font-weight:600;background:var(--accent-teal);color:#fff">${modCount} мод.</span>` : ''}</td>
                    <td><span class="badge badge-in_progress" style="font-size:0.7rem">${c.category_name || '—'}</span></td>
                    <td class="text-right">${Table.formatMoney(c.price)}</td>
                    <td class="text-right"><button class="btn btn-primary btn-sm" onclick="event.stopPropagation();EquipmentPage._addCatalogComponent(${c.id})">+</button></td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` : '<div style="text-align:center;padding:20px;color:var(--text-muted)">Не найдено</div>';
    };

    // Удалить предыдущий пикер, если есть
    const existing = document.getElementById('eq-comp-picker');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'eq-comp-picker';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `
      <div style="background:var(--bg-card);border-radius:16px;padding:24px;width:750px;max-width:95vw;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.4)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="margin:0;color:var(--text-primary)">Привязать компонент</h3>
          <button onclick="document.getElementById('eq-comp-picker').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--text-muted)">✕</button>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <input type="text" class="form-control" id="eq-comp-search" placeholder="Поиск..." style="flex:1">
          <select class="form-control" id="eq-comp-cat-filter" style="width:180px">
            <option value="">Все категории</option>
            ${categories.map(cat => `<option value="${cat}">${cat}</option>`).join('')}
          </select>
        </div>
        <div id="eq-comp-list" style="flex:1;overflow-y:auto">${renderList()}</div>
      </div>
    `;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    document.getElementById('eq-comp-search').addEventListener('input', (e) => {
      filterSearch = e.target.value;
      document.getElementById('eq-comp-list').innerHTML = renderList();
    });
    document.getElementById('eq-comp-cat-filter').addEventListener('change', (e) => {
      filterCat = e.target.value;
      document.getElementById('eq-comp-list').innerHTML = renderList();
    });
  },

  // Клик по строке каталога — как в заказах: если есть модификации — показать пикер
  async _addCatalogComponent(compId) {
    const comp = this.allComponents.find(c => c.id === compId);
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
      } catch (e) { /* fallback to base */ }
    }

    this._linkComponent(this._currentLinkProductId, compId, null, this._currentLinkMfrId);
  },

  // Пикер модификаций — по аналогии с заказами
  _showModPicker(comp, mods) {
    const overlay = document.getElementById('eq-comp-picker');
    if (!overlay) return;
    const content = overlay.querySelector('div');
    const productId = this._currentLinkProductId;
    const mfrId = this._currentLinkMfrId;

    content.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0;color:var(--text-primary)">Модификации: ${comp.article}</h3>
        <button onclick="document.getElementById('eq-comp-picker').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--text-muted);padding:4px 8px">✕</button>
      </div>
      <div style="margin-bottom:12px;font-size:0.85rem;color:var(--text-muted)">Выберите модификацию или базовый компонент</div>
      <div style="display:flex;flex-direction:column;gap:8px;overflow-y:auto;max-height:60vh">
        <div style="background:var(--bg-main);border:1px solid var(--border);border-radius:10px;padding:10px 14px;cursor:pointer;transition:border-color 0.2s"
             onclick="EquipmentPage._linkComponent(${productId}, ${comp.id}, null, ${mfrId})"
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
                 onclick="EquipmentPage._linkComponent(${productId}, ${comp.id}, ${m.id}, ${mfrId})"
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
        <button class="btn btn-secondary btn-sm" onclick="EquipmentPage.showAddComponentForm(${productId}, ${mfrId})">← К каталогу</button>
      </div>
    `;
  },

  async _linkComponent(productId, componentId, modificationId, mfrId) {
    try {
      await API.post(`/manufacturer-products/${productId}/components`, {
        component_id: componentId,
        modification_id: modificationId,
        quantity: 1,
      });
      Toast.success('Компонент привязан');
      // Обновить детали производителя в фоне (не закрывая пикер)
      this.expandedProd = productId;
      API.get(`/manufacturers/${mfrId}`).then(mfr => this._renderManufacturerDetail(mfr)).catch(() => {});
      // Вернуться к каталогу для продолжения выбора
      this.showAddComponentForm(productId, mfrId);
    } catch (err) { Toast.error(err.message); }
  },

  async unlinkComponent(productId, linkId, mfrId) {
    if (!confirm('Отвязать компонент от продукции?')) return;
    try {
      await API.del(`/manufacturer-products/${productId}/components/${linkId}`);
      Toast.success('Компонент отвязан');
      const mfr = await API.get(`/manufacturers/${mfrId}`);
      this._renderManufacturerDetail(mfr);
    } catch (err) { Toast.error(err.message); }
  },
};
