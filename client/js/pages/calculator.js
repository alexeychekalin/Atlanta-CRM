/* Calculator Page — Калькулятор чертежей */
const CalculatorPage = {
  principals: [],
  clients: [],
  categories: [],
  components: [],
  drawings: [],
  bomItems: [],
  drawingFile: null,
  pendingDrawingId: null,
  pendingClientId: null,

  async render(drawingId) {
    const content = document.getElementById('content-area');

    // Если передан drawingId — запомним для автозагрузки после рендера
    if (drawingId) this.pendingDrawingId = drawingId;

    // Загрузить справочники
    const [principalsRes, clientsRes, catRes, compRes, drawRes] = await Promise.all([
      API.get('/principals'),
      API.get('/clients?limit=1000'),
      API.get('/component-categories'),
      API.get('/components?active=true'),
      API.get('/drawings'),
    ]);
    this.principals = principalsRes.data;
    this.clients = clientsRes.data;
    this.categories = catRes.data;
    this.components = compRes.data;
    this.drawings = drawRes.data;
    this.bomItems = [];
    this.drawingFile = null;

    content.innerHTML = `
      <div class="calc-layout">
        <!-- Левая колонка -->
        <div class="calc-left">
          <!-- Чертёж -->
          <div class="card mb-2">
            <div class="card-header">
              <div class="card-title">📐 Чертёж</div>
              ${this.drawings.length > 0 ? `
                <select class="filter-select" id="calc-template" style="width:auto" onchange="CalculatorPage.loadTemplate(this.value)">
                  <option value="">Загрузить шаблон...</option>
                  ${this.drawings.map(d => `<option value="${d.id}">${d.name} (${d.components_count} комп.)</option>`).join('')}
                </select>
              ` : ''}
            </div>
            <div class="upload-zone" id="calc-drawing-zone" style="min-height:100px">
              <div id="calc-drawing-preview">
                <div style="padding:20px;text-align:center;color:var(--text-muted)">
                  <div style="font-size:2rem;margin-bottom:8px">📎</div>
                  Перетащите чертёж (PDF/изображение) или нажмите для выбора
                </div>
              </div>
              <input type="file" id="calc-drawing-input" accept=".pdf,.jpg,.jpeg,.png,.webp,.tiff" style="display:none">
            </div>
            <input type="hidden" id="calc-drawing-path" value="">
            <input type="hidden" id="calc-drawing-type" value="">
          </div>

          <!-- Контрагент -->
          <div class="card mb-2">
            <div class="card-header"><div class="card-title">👤 Контрагент</div></div>
            <div class="form-row" style="padding:0">
              <div class="form-group">
                <label>Клиент</label>
                <select class="form-control" id="calc-client" onchange="CalculatorPage.onClientChange(this.value)">
                  <option value="">Не выбран</option>
                  ${this.clients.map(c => `<option value="${c.id}" data-markup="${c.pricing_markup_pct || 0}" data-level="${c.pricing_level_name || ''}">${c.name}</option>`).join('')}
                </select>
                <div id="calc-client-level" style="margin-top:4px;font-size:0.78rem"></div>
              </div>
              <div class="form-group">
                <label>Принципал</label>
                <select class="form-control" id="calc-principal">
                  ${this.principals.map(p => `<option value="${p.id}" data-comm="${p.agent_commission_pct}">${p.name} (${p.agent_commission_pct}%)</option>`).join('')}
                </select>
              </div>
            </div>
            <!-- Блок расчётов клиента — появляется при выборе клиента -->
            <div id="calc-client-drawings" style="display:none"></div>
          </div>

          <!-- BOM — Компоненты -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">🔩 Компоненты (BOM)</div>
              <button class="btn btn-primary btn-sm" onclick="CalculatorPage.openAddComponentModal()">+ Добавить</button>
            </div>
            <div id="calc-bom-list">
              ${Table.emptyState('Добавьте компоненты из каталога')}
            </div>
          </div>
        </div>

        <!-- Правая колонка — Расчёт -->
        <div class="calc-right">
          <div class="calc-summary-card">
            <h3 style="font-size:1.05rem;margin-bottom:16px;color:var(--text-secondary)">Расчёт стоимости</h3>
            <div id="calc-totals">
              <div class="calc-summary-row">
                <span class="label">Сумма компонентов</span>
                <span class="value" id="calc-base">0,00 ₽</span>
              </div>
              <div class="calc-summary-row">
                <span class="label">Наценки позиций</span>
                <span class="value" id="calc-item-markup">+0,00 ₽</span>
              </div>
              <div class="calc-summary-row" style="border-top:1px solid var(--border);padding-top:8px;margin-top:8px">
                <span class="label">Подитог</span>
                <span class="value" id="calc-subtotal" style="font-weight:600">0,00 ₽</span>
              </div>
            </div>

            <div style="margin-top:16px">
              <label style="font-size:0.85rem;color:var(--text-secondary);display:block;margin-bottom:6px">Общая наценка</label>
              <div class="form-row" style="gap:8px">
                <div class="form-group" style="margin-bottom:0">
                  <div style="display:flex;align-items:center;gap:4px">
                    <input type="number" class="form-control" id="calc-markup-pct" value="0" step="0.1" style="width:80px" onchange="CalculatorPage.recalc()">
                    <span style="color:var(--text-muted)">%</span>
                  </div>
                </div>
                <div class="form-group" style="margin-bottom:0">
                  <div style="display:flex;align-items:center;gap:4px">
                    <input type="number" class="form-control" id="calc-markup-rub" value="0" step="1" style="width:100px" onchange="CalculatorPage.recalc()">
                    <span style="color:var(--text-muted)">₽</span>
                  </div>
                </div>
              </div>
            </div>

            <div id="calc-final" style="margin-top:16px;padding-top:12px;border-top:2px solid var(--accent-teal)">
              <div class="calc-summary-row total">
                <span class="label">ИТОГО</span>
                <span class="value" id="calc-total" style="font-size:1.3rem">0,00 ₽</span>
              </div>
            </div>

            <div style="margin-top:20px;display:flex;flex-direction:column;gap:8px">
              ${API.isAdmin() ? `
                <button class="btn btn-primary btn-full" onclick="CalculatorPage.saveAsDrawing()">💾 Сохранить как шаблон</button>
                <button class="btn btn-secondary btn-full" onclick="CalculatorPage.saveAsOrder()">📋 Сохранить как заказ</button>
              ` : ''}
            </div>
          </div>
        </div>
      </div>

      <!-- Zoom overlay для увеличения фото компонентов -->
      <div id="calc-image-zoom-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:10000;cursor:zoom-out;display:none;align-items:center;justify-content:center" onclick="this.style.display='none'">
        <img id="calc-image-zoom-img" src="" style="max-width:90vw;max-height:90vh;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.5)">
      </div>
    `;

    // Drawing upload events
    const zone = document.getElementById('calc-drawing-zone');
    const input = document.getElementById('calc-drawing-input');
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('drag-over'); if (e.dataTransfer.files[0]) this.uploadDrawing(e.dataTransfer.files[0]); });
    input.addEventListener('change', (e) => { if (e.target.files[0]) this.uploadDrawing(e.target.files[0]); });

    // Если есть отложенная загрузка шаблона — выполняем
    if (this.pendingDrawingId) {
      const drawingId = this.pendingDrawingId;
      this.pendingDrawingId = null;
      // Загружаем шаблон и устанавливаем клиента
      await this.loadTemplate(drawingId);
      // Выставить клиента из шаблона если есть
      if (this.pendingClientId) {
        const clientSelect = document.getElementById('calc-client');
        clientSelect.value = this.pendingClientId;
        this.pendingClientId = null;
      }
    }
  },

  // === При выборе клиента — показать его расчёты ===
  async onClientChange(clientId) {
    const container = document.getElementById('calc-client-drawings');
    if (!clientId) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    try {
      const res = await API.get(`/clients/${clientId}/documents/calculations`);
      const calcs = res.data;
      if (calcs.length === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
      }

      container.style.display = 'block';
      container.innerHTML = `
        <div style="padding:8px 0 0;border-top:1px solid var(--border);margin-top:8px">
          <label style="font-size:0.82rem;color:var(--text-secondary);display:block;margin-bottom:6px">📋 Сохранённые расчёты клиента</label>
          <div style="display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto">
            ${calcs.map(c => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--bg-main);border-radius:6px;border:1px solid var(--border);cursor:pointer;transition:background 0.15s" 
                   onmouseenter="this.style.background='var(--bg-hover)'" 
                   onmouseleave="this.style.background='var(--bg-main)'"
                   onclick="CalculatorPage.loadTemplate(${c.id})">
                <div>
                  <div style="font-weight:600;font-size:0.85rem">${c.name}</div>
                  <div style="font-size:0.75rem;color:var(--text-muted)">${c.components_count} комп. · ${new Date(c.created_at).toLocaleDateString('ru-RU')}</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-weight:600;font-size:0.85rem;color:var(--accent-teal)">${Table.formatMoney(c.base_cost)}</span>
                  <span style="font-size:0.8rem;color:var(--text-muted)">→</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } catch (err) {
      container.style.display = 'none';
    }
  },

  // === Загрузка чертежа ===
  async uploadDrawing(file) {
    const preview = document.getElementById('calc-drawing-preview');
    preview.innerHTML = '<div style="padding:20px;text-align:center">⏳ Загрузка...</div>';
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await API.upload('/upload/drawing', formData);
      document.getElementById('calc-drawing-path').value = res.path;
      document.getElementById('calc-drawing-type').value = res.file_type;
      this.drawingFile = res;

      if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(res.file_type)) {
        preview.innerHTML = `<img src="${res.path}" style="max-height:200px;border-radius:8px;display:block;margin:8px auto">`;
      } else {
        preview.innerHTML = `
          <div style="padding:16px;text-align:center">
            <div style="font-size:2rem;margin-bottom:8px">📄</div>
            <div style="color:var(--text-primary)">${res.originalname}</div>
            <a href="${res.path}" target="_blank" style="color:var(--accent-teal);font-size:0.85rem">Открыть PDF →</a>
          </div>`;
      }
      Toast.success('Чертёж загружен');
    } catch (err) {
      preview.innerHTML = '<div style="padding:20px;text-align:center;color:var(--error)">Ошибка загрузки</div>';
      Toast.error(err.message);
    }
  },

  // === Загрузка шаблона ===
  async loadTemplate(drawingId) {
    if (!drawingId) return;
    try {
      const drawing = await API.get(`/drawings/${drawingId}`);
      this.bomItems = (drawing.components || []).map(c => {
        // Использовать цену модификации, если есть
        const effectivePrice = c.modification_price !== null && c.modification_price !== undefined
          ? parseFloat(c.modification_price) : parseFloat(c.price);
        const displayArticle = c.modification_code ? c.article + '.' + c.modification_code : c.article;
        return {
          component_id: c.component_id,
          modification_id: c.modification_id || null,
          article: displayArticle,
          name: c.component_name,
          modification_name: c.modification_name || null,
          category_name: c.category_name,
          price: effectivePrice,
          image_path: c.image_path,
          quantity: parseInt(c.quantity) || 1,
          item_markup_pct: parseFloat(c.item_markup_pct),
          item_markup_rub: parseFloat(c.item_markup_rub),
        };
      });

      // Если у шаблона есть client_id — выставить клиента
      if (drawing.client_id) {
        const clientSelect = document.getElementById('calc-client');
        if (clientSelect) {
          clientSelect.value = drawing.client_id;
        } else {
          this.pendingClientId = drawing.client_id;
        }
      }

      if (drawing.file_path) {
        document.getElementById('calc-drawing-path').value = drawing.file_path;
        document.getElementById('calc-drawing-type').value = drawing.file_type || '';
        const preview = document.getElementById('calc-drawing-preview');
        if (['jpg', 'jpeg', 'png', 'webp'].includes(drawing.file_type)) {
          preview.innerHTML = `<img src="${drawing.file_path}" style="max-height:200px;border-radius:8px;display:block;margin:8px auto">`;
        } else if (drawing.file_type === 'pdf') {
          preview.innerHTML = `<div style="padding:16px;text-align:center"><div style="font-size:2rem">📄</div><a href="${drawing.file_path}" target="_blank" style="color:var(--accent-teal)">Открыть PDF →</a></div>`;
        }
      }

      // Выставить шаблон в select если он есть
      const templateSelect = document.getElementById('calc-template');
      if (templateSelect) templateSelect.value = drawingId;

      this.renderBom();
      this.recalc();
      Toast.success(`Шаблон «${drawing.name}» загружен`);
    } catch (err) { Toast.error(err.message); }
  },

  // === Увеличение фото компонента ===
  zoomImage(src) {
    const overlay = document.getElementById('calc-image-zoom-overlay');
    const img = document.getElementById('calc-image-zoom-img');
    img.src = src;
    overlay.style.display = 'flex';
  },

  // === BOM — добавление компонента ===
  openAddComponentModal() {
    let filterCat = '';
    let filterSearch = '';

    const renderList = () => {
      let filtered = this.components;
      if (filterCat) filtered = filtered.filter(c => c.category_id == filterCat);
      if (filterSearch) {
        const s = filterSearch.toLowerCase();
        filtered = filtered.filter(c => c.article.toLowerCase().includes(s) || c.name.toLowerCase().includes(s));
      }

      return filtered.length > 0 ? `
        <div class="table-wrapper" style="max-height:300px;overflow-y:auto">
          <table class="data-table">
            <thead><tr><th></th><th>Артикул</th><th>Название</th><th>Категория</th><th class="text-right">Цена</th><th class="text-right"></th></tr></thead>
            <tbody>
              ${filtered.map(c => {
                const already = this.bomItems.some(b => b.component_id === c.id && !b.modification_id);
                const modCount = parseInt(c.modifications_count) || 0;
                return `
                  <tr style="cursor:pointer;${already ? 'opacity:0.5' : ''}" onclick="CalculatorPage.addComponent(${c.id})" title="Добавить компонент">
                    <td>${c.image_path ? `<img src="${c.image_path}" style="width:32px;height:32px;object-fit:cover;border-radius:4px;cursor:zoom-in" onclick="event.stopPropagation();CalculatorPage.zoomImage('${c.image_path}')">` : '📦'}</td>
                    <td class="font-mono" style="color:var(--accent-teal)">${c.article}</td>
                    <td>${c.name}${modCount > 0 ? `<span style="margin-left:6px;padding:1px 6px;border-radius:8px;font-size:0.65rem;font-weight:600;background:var(--accent-teal);color:#fff">${modCount} мод.</span>` : ''}</td>
                    <td><span class="badge badge-in_progress" style="font-size:0.7rem">${c.category_name || '—'}</span></td>
                    <td class="text-right">${Table.formatMoney(c.price)}</td>
                    <td class="text-right" onclick="event.stopPropagation()">${already ? '✓' : `<button class="btn btn-primary btn-sm" onclick="CalculatorPage.addComponent(${c.id})">+</button>`}</td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` : Table.emptyState('Компоненты не найдены');
    };

    this._renderCompList = renderList;

    Modal.open({
      title: 'Добавить компонент',
      wide: true,
      body: `
        <div class="form-row mb-2">
          <div class="form-group" style="margin-bottom:0">
            <input type="text" class="form-control" id="calc-comp-search" placeholder="Поиск по артикулу или названию...">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <select class="form-control" id="calc-comp-cat">
              <option value="">Все категории</option>
              ${this.categories.map(cat => `<option value="${cat.id}">${cat.name}</option>`).join('')}
            </select>
          </div>
        </div>
        <div id="calc-comp-list">${renderList()}</div>
      `,
      footer: '<button class="btn btn-secondary" onclick="Modal.close()">Закрыть</button>',
    });

    const searchInput = document.getElementById('calc-comp-search');
    const catSelect = document.getElementById('calc-comp-cat');
    const updateList = () => {
      filterSearch = searchInput.value;
      filterCat = catSelect.value;
      document.getElementById('calc-comp-list').innerHTML = renderList();
    };
    searchInput.addEventListener('input', updateList);
    catSelect.addEventListener('change', updateList);
  },

  async addComponent(compId, modificationId = null) {
    const comp = this.components.find(c => c.id === compId);
    if (!comp) return;

    // Если у компонента есть модификации и не выбрана конкретная — показать выбор
    if (parseInt(comp.modifications_count) > 0 && modificationId === null) {
      try {
        const compDetail = await API.get(`/components/${compId}`);
        const mods = compDetail.modifications || [];
        if (mods.length > 0) {
          this._showModificationPicker(comp, mods);
          return;
        }
      } catch (e) { /* если не удалось загрузить — добавить без модификации */ }
    }

    // 0 = базовый компонент без модификации
    if (modificationId === 0) modificationId = null;

    // Проверка дубликата
    if (this.bomItems.some(b => b.component_id === compId && b.modification_id === modificationId)) return;

    let article = comp.article;
    let name = comp.name;
    let price = parseFloat(comp.price);
    let modName = null;

    // Если выбрана модификация
    if (modificationId && this._lastMods) {
      const mod = this._lastMods.find(m => m.id === modificationId);
      if (mod) {
        article = comp.article + '.' + mod.code;
        modName = mod.name;
        if (mod.price_override !== null && mod.price_override !== undefined) {
          price = parseFloat(mod.price_override);
        }
      }
    }

    this.bomItems.push({
      component_id: comp.id,
      modification_id: modificationId,
      article,
      name,
      modification_name: modName,
      category_name: comp.category_name,
      price,
      image_path: comp.image_path,
      doc_count: parseInt(comp.doc_count) || 0,
      quantity: 1,
      item_markup_pct: 0,
      item_markup_rub: 0,
    });

    // Обновить список в модалке (не закрывать)
    const listEl = document.getElementById('calc-comp-list');
    if (listEl && this._renderCompList) {
      listEl.innerHTML = this._renderCompList();
    }
    this.renderBom();
    this.recalc();
    Toast.success(`${comp.name} добавлен`);
  },

  _showModificationPicker(comp, mods) {
    this._lastMods = mods;

    const renderModPicker = () => {
      const items = mods.filter(m => m.is_active !== false).map(m => {
        const fullArticle = comp.article + '.' + m.code;
        const price = m.price_override !== null ? m.price_override : comp.price;
        const already = this.bomItems.some(b => b.component_id === comp.id && b.modification_id === m.id);
        return `
          <div style="background:var(--bg-main);border:1px solid ${already ? 'var(--accent-teal)' : 'var(--border)'};border-radius:10px;padding:10px 14px;cursor:${already ? 'default' : 'pointer'};transition:border-color 0.2s;${already ? 'opacity:0.5' : ''}"
               ${!already ? `onclick="CalculatorPage._addModAndRefresh(${comp.id}, ${m.id})"
               onmouseenter="this.style.borderColor='var(--accent-teal)'" onmouseleave="this.style.borderColor='var(--border)'"` : ''}>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div style="flex:1">
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-family:'JetBrains Mono',monospace;font-size:0.85rem;font-weight:700;color:var(--accent-teal)">${fullArticle}</span>
                  ${already ? '<span style="font-size:0.7rem;color:var(--accent-teal)">✓ Добавлено</span>' : ''}
                </div>
                ${m.name ? `<div style="font-size:0.82rem;color:var(--text-secondary);margin-top:2px">${m.name}</div>` : ''}
              </div>
              <div style="font-weight:600;flex-shrink:0;margin-left:12px">${Table.formatMoney(price)}</div>
            </div>
          </div>
        `;
      }).join('');

      const baseAlready = this.bomItems.some(b => b.component_id === comp.id && !b.modification_id);
      return `
        <div style="margin-bottom:12px;font-size:0.85rem;color:var(--text-muted)">
          Выберите модификацию или добавьте базовый компонент без модификации
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="background:var(--bg-main);border:1px solid ${baseAlready ? 'var(--accent-teal)' : 'var(--border)'};border-radius:10px;padding:10px 14px;cursor:${baseAlready ? 'default' : 'pointer'};transition:border-color 0.2s;${baseAlready ? 'opacity:0.5' : ''}"
               ${!baseAlready ? `onclick="CalculatorPage._addModAndRefresh(${comp.id}, 0)"
               onmouseenter="this.style.borderColor='var(--accent-teal)'" onmouseleave="this.style.borderColor='var(--border)'"` : ''}>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-family:'JetBrains Mono',monospace;font-size:0.85rem;font-weight:700;color:var(--text-primary)">${comp.article}</div>
                <div style="font-size:0.85rem;color:var(--text-secondary)">Базовый компонент (без модификации)</div>
              </div>
              <div style="font-weight:600">${Table.formatMoney(comp.price)}</div>
            </div>
          </div>
          ${items}
        </div>
      `;
    };

    this._refreshModPicker = renderModPicker;

    Modal.open({
      title: `Модификации: ${comp.article} — ${comp.name}`,
      body: renderModPicker(),
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Закрыть</button>
        <button class="btn btn-primary" onclick="Modal.close();CalculatorPage.openAddComponentModal()">← К каталогу</button>
      `,
    });
  },

  _addModAndRefresh(compId, modId) {
    // 0 = без модификации
    if (modId === 0) modId = null;
    const comp = this.components.find(c => c.id === compId);
    if (!comp) return;
    if (this.bomItems.some(b => b.component_id === compId && b.modification_id === modId)) return;

    let article = comp.article;
    let name = comp.name;
    let price = parseFloat(comp.price);
    let modName = null;

    if (modId && this._lastMods) {
      const mod = this._lastMods.find(m => m.id === modId);
      if (mod) {
        article = comp.article + '.' + mod.code;
        modName = mod.name;
        if (mod.price_override !== null && mod.price_override !== undefined) {
          price = parseFloat(mod.price_override);
        }
      }
    }

    this.bomItems.push({
      component_id: comp.id,
      modification_id: modId,
      article,
      name,
      modification_name: modName,
      category_name: comp.category_name,
      price,
      image_path: comp.image_path,
      quantity: 1,
      item_markup_pct: 0,
      item_markup_rub: 0,
    });

    this.renderBom();
    this.recalc();
    Toast.success(`${name} добавлен`);

    // Обновить пикер модификаций (отметить добавленные)
    const modalBody = document.querySelector('.modal-body');
    if (modalBody && this._refreshModPicker) {
      modalBody.innerHTML = this._refreshModPicker();
    }
  },

  removeComponent(idx) {
    this.bomItems.splice(idx, 1);
    this.renderBom();
    this.recalc();
  },

  // === Рендер спецификации (BOM) ===
  renderBom() {
    const container = document.getElementById('calc-bom-list');
    if (!container) return;
    if (this.bomItems.length === 0) {
      container.innerHTML = Table.emptyState('Добавьте компоненты из каталога');
      return;
    }

    container.innerHTML = `
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:40px"></th>
              <th>Компонент</th>
              <th style="width:90px" class="text-center">Кол-во</th>
              <th style="width:140px" class="text-right">Цена</th>
              <th style="width:100px" class="text-center">Наценка %</th>
              <th style="width:120px" class="text-center">Наценка ₽</th>
              <th style="width:150px" class="text-right">Итого</th>
              <th style="width:50px" class="text-right"></th>
            </tr>
          </thead>
          <tbody>
            ${this.bomItems.map((item, i) => {
              const base = item.price * item.quantity;
              const mPct = base * (item.item_markup_pct || 0) / 100;
              const mRub = item.item_markup_rub || 0;
              const lineTotal = base + mPct + mRub;
              return `
                <tr>
                  <td>${item.image_path ? `<img src="${item.image_path}" class="calc-comp-thumb" style="width:28px;height:28px;object-fit:cover;border-radius:4px;cursor:zoom-in;transition:transform 0.2s,box-shadow 0.2s" onmouseenter="this.style.transform='scale(3)';this.style.zIndex='100';this.style.position='relative';this.style.boxShadow='0 8px 30px rgba(0,0,0,0.4)'" onmouseleave="this.style.transform='scale(1)';this.style.zIndex='';this.style.position='';this.style.boxShadow=''" onclick="CalculatorPage.zoomImage('${item.image_path}')">` : '📦'}</td>
                  <td>
                    <div style="font-weight:600;font-size:0.85rem">${item.name}${item.doc_count > 0 ? ` <a href="/api/components/${item.component_id}/documents/download-all?token=${API.getToken()}" title="Скачать документы (${item.doc_count})" style="text-decoration:none;cursor:pointer">📎<sup style="font-size:0.65rem;color:var(--accent-teal)">${item.doc_count}</sup></a>` : ''}</div>
                    <div style="font-size:0.75rem;color:var(--accent-teal)" class="font-mono">${item.article}</div>
                    ${item.modification_name ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:1px">${item.modification_name}</div>` : ''}
                  </td>
                  <td class="text-center"><div style="display:flex;align-items:stretch;border-radius:6px;border:1px solid var(--border);overflow:hidden;height:30px;margin:0 auto;max-width:100px"><button type="button" onclick="CalculatorPage.updateBomItem(${i},'quantity',Math.max(1,${item.quantity}-1))" style="width:24px;border:none;background:var(--bg-tertiary);color:var(--text-secondary);cursor:pointer;font-size:0.9rem;font-weight:700;display:flex;align-items:center;justify-content:center;transition:all 0.15s" onmouseenter="this.style.background='var(--accent-teal)';this.style.color='#fff'" onmouseleave="this.style.background='var(--bg-tertiary)';this.style.color='var(--text-secondary)'">−</button><input type="number" value="${item.quantity}" min="1" step="1" style="flex:1;font-size:0.85rem;padding:0;text-align:center;border:none;border-left:1px solid var(--border);border-right:1px solid var(--border);border-radius:0;-moz-appearance:textfield;-webkit-appearance:none;min-width:0;font-weight:700;height:100%;line-height:30px;background:var(--bg-input);color:var(--text-primary);outline:none;box-sizing:border-box" onchange="CalculatorPage.updateBomItem(${i},'quantity',this.value)"><button type="button" onclick="CalculatorPage.updateBomItem(${i},'quantity',${item.quantity}+1)" style="width:24px;border:none;background:var(--bg-tertiary);color:var(--text-secondary);cursor:pointer;font-size:0.9rem;font-weight:700;display:flex;align-items:center;justify-content:center;transition:all 0.15s" onmouseenter="this.style.background='var(--accent-teal)';this.style.color='#fff'" onmouseleave="this.style.background='var(--bg-tertiary)';this.style.color='var(--text-secondary)'">+</button></div></td>
                  <td class="text-right" style="font-size:0.85rem">${Table.formatMoney(item.price)}</td>
                  <td class="text-center"><div style="display:flex;align-items:stretch;border-radius:6px;border:1px solid var(--border);overflow:hidden;height:30px;margin:0 auto;max-width:100px"><button type="button" onclick="CalculatorPage.updateBomItem(${i},'item_markup_pct',${item.item_markup_pct||0}-1)" style="width:24px;border:none;background:var(--bg-tertiary);color:var(--text-secondary);cursor:pointer;font-size:0.9rem;font-weight:700;display:flex;align-items:center;justify-content:center;transition:all 0.15s" onmouseenter="this.style.background='var(--accent-teal)';this.style.color='#fff'" onmouseleave="this.style.background='var(--bg-tertiary)';this.style.color='var(--text-secondary)'">−</button><input type="number" value="${item.item_markup_pct}" step="0.1" style="flex:1;font-size:0.85rem;padding:0;text-align:center;border:none;border-left:1px solid var(--border);border-right:1px solid var(--border);border-radius:0;-moz-appearance:textfield;-webkit-appearance:none;min-width:0;height:100%;line-height:30px;background:var(--bg-input);color:var(--text-primary);outline:none;box-sizing:border-box" onchange="CalculatorPage.updateBomItem(${i},'item_markup_pct',this.value)"><button type="button" onclick="CalculatorPage.updateBomItem(${i},'item_markup_pct',${item.item_markup_pct||0}+1)" style="width:24px;border:none;background:var(--bg-tertiary);color:var(--text-secondary);cursor:pointer;font-size:0.9rem;font-weight:700;display:flex;align-items:center;justify-content:center;transition:all 0.15s" onmouseenter="this.style.background='var(--accent-teal)';this.style.color='#fff'" onmouseleave="this.style.background='var(--bg-tertiary)';this.style.color='var(--text-secondary)'">+</button></div></td>
                  <td class="text-center"><div style="display:flex;align-items:stretch;border-radius:6px;border:1px solid var(--border);overflow:hidden;height:30px;margin:0 auto;max-width:120px"><button type="button" onclick="CalculatorPage.updateBomItem(${i},'item_markup_rub',${item.item_markup_rub||0}-10)" style="width:24px;border:none;background:var(--bg-tertiary);color:var(--text-secondary);cursor:pointer;font-size:0.9rem;font-weight:700;display:flex;align-items:center;justify-content:center;transition:all 0.15s" onmouseenter="this.style.background='var(--accent-teal)';this.style.color='#fff'" onmouseleave="this.style.background='var(--bg-tertiary)';this.style.color='var(--text-secondary)'">−</button><input type="number" value="${item.item_markup_rub}" step="1" style="flex:1;font-size:0.85rem;padding:0;text-align:center;border:none;border-left:1px solid var(--border);border-right:1px solid var(--border);border-radius:0;-moz-appearance:textfield;-webkit-appearance:none;min-width:0;height:100%;line-height:30px;background:var(--bg-input);color:var(--text-primary);outline:none;box-sizing:border-box" onchange="CalculatorPage.updateBomItem(${i},'item_markup_rub',this.value)"><button type="button" onclick="CalculatorPage.updateBomItem(${i},'item_markup_rub',${item.item_markup_rub||0}+10)" style="width:24px;border:none;background:var(--bg-tertiary);color:var(--text-secondary);cursor:pointer;font-size:0.9rem;font-weight:700;display:flex;align-items:center;justify-content:center;transition:all 0.15s" onmouseenter="this.style.background='var(--accent-teal)';this.style.color='#fff'" onmouseleave="this.style.background='var(--bg-tertiary)';this.style.color='var(--text-secondary)'">+</button></div></td>
                  <td class="text-right" style="font-weight:600;font-size:0.85rem">${Table.formatMoney(lineTotal)}</td>
                  <td class="text-right"><button class="btn btn-icon btn-sm btn-danger" onclick="CalculatorPage.removeComponent(${i})">✕</button></td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${this.bomItems.some(it => it.doc_count > 0) ? `
        <div style="margin-top:10px;text-align:right">
          <button class="btn btn-sm btn-secondary" onclick="CalculatorPage.downloadAllDocs()" title="Скачать все сертификаты и документы по компонентам">📦 Скачать все документы</button>
        </div>
      ` : ''}
    `;
  },

  updateBomItem(idx, field, value) {
    if (field === 'quantity') {
      this.bomItems[idx][field] = parseInt(value) || 1;
    } else {
      this.bomItems[idx][field] = parseFloat(value) || 0;
    }
    this.renderBom();
    this.recalc();
  },

  // === Пересчёт ===
  recalc() {
    // Наценка уровня клиента
    const clientSelect = document.getElementById('calc-client');
    const clientOpt = clientSelect?.selectedOptions[0];
    const levelMarkupPct = parseFloat(clientOpt?.dataset?.markup) || 0;
    const levelName = clientOpt?.dataset?.level || '';

    // Обновить бейдж уровня
    const levelEl = document.getElementById('calc-client-level');
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

    let baseTotal = 0;
    let itemMarkupTotal = 0;

    this.bomItems.forEach(item => {
      const base = item.price * item.quantity;
      const mPct = base * (item.item_markup_pct || 0) / 100;
      const mRub = item.item_markup_rub || 0;
      baseTotal += base;
      itemMarkupTotal += mPct + mRub;
    });

    const subtotal = baseTotal + itemMarkupTotal;
    // Наценка уровня клиента
    const levelMarkupAmount = subtotal * levelMarkupPct / 100;
    const subtotalWithLevel = subtotal + levelMarkupAmount;

    const totalMarkupPct = parseFloat(document.getElementById('calc-markup-pct')?.value) || 0;
    const totalMarkupRub = parseFloat(document.getElementById('calc-markup-rub')?.value) || 0;
    const totalMarkup = subtotalWithLevel * totalMarkupPct / 100 + totalMarkupRub;
    const total = subtotalWithLevel + totalMarkup;

    document.getElementById('calc-base').innerHTML = Table.formatMoney(baseTotal);
    document.getElementById('calc-item-markup').innerHTML = (itemMarkupTotal >= 0 ? '+' : '') + Table.formatMoney(itemMarkupTotal);
    document.getElementById('calc-subtotal').innerHTML = Table.formatMoney(subtotal);

    // Показать наценку уровня
    let levelEl2 = document.getElementById('calc-level-markup');
    if (!levelEl2) {
      const subtotalEl = document.getElementById('calc-subtotal');
      if (subtotalEl) {
        levelEl2 = document.createElement('div');
        levelEl2.id = 'calc-level-markup';
        subtotalEl.parentElement.insertAdjacentElement('afterend', levelEl2);
      }
    }
    if (levelEl2) {
      if (levelName && clientSelect?.value) {
        levelEl2.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:0.85rem;padding:4px 0;color:var(--text-secondary)">
          <span>💰 Наценка «${levelName}» (${levelMarkupPct > 0 ? '+' : ''}${levelMarkupPct}%)</span>
          <span style="font-weight:600">${levelMarkupAmount >= 0 ? '+' : ''}${Table.formatMoneyRaw(levelMarkupAmount)}</span>
        </div>`;
      } else {
        levelEl2.innerHTML = '';
      }
    }

    document.getElementById('calc-total').innerHTML = Table.formatMoney(total);
  },

  // === Сохранить как шаблон чертежа ===
  async saveAsDrawing(autoName) {
    if (this.bomItems.length === 0) { Toast.error('Добавьте хотя бы один компонент'); return null; }

    const defaultName = autoName || 'Чертёж ' + new Date().toLocaleDateString('ru-RU');
    const name = autoName || prompt('Название шаблона чертежа:', defaultName);
    if (!name) return null;

    const client_id = document.getElementById('calc-client').value || null;

    try {
      const result = await API.post('/drawings', {
        name,
        file_path: document.getElementById('calc-drawing-path').value || null,
        file_type: document.getElementById('calc-drawing-type').value || null,
        description: '',
        client_id,
        components: this.bomItems.map(item => ({
          component_id: item.component_id,
          modification_id: item.modification_id || null,
          quantity: item.quantity,
          item_markup_pct: item.item_markup_pct,
          item_markup_rub: item.item_markup_rub,
        })),
      });
      if (!autoName) Toast.success('Шаблон чертежа сохранён!');
      // Обновить список шаблонов
      const drawRes = await API.get('/drawings');
      this.drawings = drawRes.data;
      return result;
    } catch (err) { Toast.error(err.message); return null; }
  },

  // === Сохранить как заказ ===
  async saveAsOrder() {
    const client_id = document.getElementById('calc-client').value;
    const principal_id = document.getElementById('calc-principal').value;
    if (!client_id) { Toast.error('Выберите клиента'); return; }
    if (this.bomItems.length === 0) { Toast.error('Добавьте компоненты'); return; }

    const defaultName = 'Чертёж ' + new Date().toLocaleDateString('ru-RU');
    const drawingName = prompt('Название чертежа для заказа:', defaultName);
    if (!drawingName) return;

    const totalMarkupPct = parseFloat(document.getElementById('calc-markup-pct')?.value) || 0;
    const totalMarkupRub = parseFloat(document.getElementById('calc-markup-rub')?.value) || 0;

    // Автоматически сохраняем шаблон
    await this.saveAsDrawing(drawingName);

    // Считаем итог
    let componentsTotal = 0;
    let itemMarkupsTotal = 0;
    const componentsData = this.bomItems.map(item => {
      const base = item.price * item.quantity;
      const mPct = base * (item.item_markup_pct || 0) / 100;
      const mRub = item.item_markup_rub || 0;
      const lineTotal = base + mPct + mRub;
      componentsTotal += base;
      itemMarkupsTotal += mPct + mRub;
      return {
        name: item.name,
        article: item.article,
        price: item.price,
        quantity: item.quantity,
        base_total: base,
        markup_pct: item.item_markup_pct || 0,
        markup_rub: item.item_markup_rub || 0,
        markup_pct_amount: mPct,
        line_total: lineTotal,
      };
    });

    const subtotalBeforeGlobal = componentsTotal + itemMarkupsTotal;
    // Наценка уровня клиента
    const clientOpt = document.getElementById('calc-client')?.selectedOptions[0];
    const lvlMarkup = parseFloat(clientOpt?.dataset?.markup) || 0;
    const levelMarkupAmount = subtotalBeforeGlobal * lvlMarkup / 100;
    const subtotalWithLevel = subtotalBeforeGlobal + levelMarkupAmount;
    const globalMarkupPctAmount = subtotalWithLevel * totalMarkupPct / 100;
    const globalMarkupRubAmount = totalMarkupRub;
    const grandTotal = subtotalWithLevel + globalMarkupPctAmount + globalMarkupRubAmount;

    // Одна позиция с названием чертежа + metadata
    const items = [{
      product_id: null,
      product_name: drawingName,
      unit_price: grandTotal,
      quantity: 1,
      metadata: {
        type: 'calculator_drawing',
        components: componentsData,
        components_total: componentsTotal,
        item_markups_total: itemMarkupsTotal,
        global_markup_pct: totalMarkupPct,
        global_markup_rub: totalMarkupRub,
        global_markup_pct_amount: globalMarkupPctAmount,
        grand_total: grandTotal,
      },
    }];

    try {
      await API.post('/orders', {
        client_id,
        principal_id,
        order_date: new Date().toISOString().split('T')[0],
        status: 'new',
        comment: `Создан из калькулятора: ${drawingName}`,
        items,
      });
      Toast.success('Заказ создан из калькулятора!');
      App.navigateTo('orders');
    } catch (err) { Toast.error(err.message); }
  },

  downloadAllDocs() {
    const ids = [...new Set(this.bomItems.filter(it => it.doc_count > 0).map(it => it.component_id))];
    if (ids.length === 0) { Toast.error('Нет документов для скачивания'); return; }
    window.open(`/api/component-documents/download-zip?ids=${ids.join(',')}&token=${API.getToken()}`, '_blank');
  },
};
