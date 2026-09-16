/* Products Page */
const ProductsPage = {
  async render() {
    const content = document.getElementById('content-area');
    const isAdmin = API.isAdmin();

    content.innerHTML = `
      <div class="toolbar">
        <div class="search-input">
          <input type="text" id="products-search" placeholder="Поиск товаров/услуг...">
        </div>
        ${isAdmin ? '<button class="btn btn-primary" onclick="ProductsPage.openCreateModal()">+ Новый товар</button>' : ''}
      </div>
      <div id="products-table-container">${Table.loading()}</div>
    `;

    document.getElementById('products-search').addEventListener('input', (e) => {
      this.loadProducts(e.target.value);
    });

    this.loadProducts();
  },

  async loadProducts(search = '') {
    const container = document.getElementById('products-table-container');
    const isAdmin = API.isAdmin();

    try {
      const params = search ? `?search=${encodeURIComponent(search)}` : '';
      const res = await API.get('/products' + params);
      const products = res.data;

      if (products.length === 0) {
        container.innerHTML = Table.emptyState('Нет товаров/услуг');
        return;
      }

      container.innerHTML = `
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Название</th>
                <th class="text-right">Цена</th>
                <th>Ед. изм.</th>
                <th>Описание</th>
                <th>Статус</th>
                ${isAdmin ? '<th>Действия</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${products.map(p => `
                <tr>
                  <td><strong>${p.name}</strong></td>
                  <td class="text-right">${Table.formatMoney(p.base_price)}</td>
                  <td>${p.unit || 'шт.'}</td>
                  <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis">${p.description || '—'}</td>
                  <td>${p.is_active ? '<span class="badge badge-completed">Активен</span>' : '<span class="badge badge-cancelled">Неактивен</span>'}</td>
                  ${isAdmin ? `
                    <td>
                      <div class="table-actions">
                        ${Table.actionBtn(Table.editIcon, 'Редактировать', `ProductsPage.openEditModal(${p.id})`)}
                        ${Table.actionBtn(Table.deleteIcon, 'Удалить', `ProductsPage.deleteProduct(${p.id})`, 'btn-danger')}
                      </div>
                    </td>
                  ` : ''}
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

  openCreateModal() {
    this._openModal(null);
  },

  async openEditModal(id) {
    try {
      const product = await API.get(`/products/${id}`);
      this._openModal(product);
    } catch (err) {
      Toast.error(err.message);
    }
  },

  _openModal(product) {
    const isEdit = !!product;
    Modal.open({
      title: isEdit ? 'Редактировать товар' : 'Новый товар/услуга',
      body: `
        <form id="product-form">
          <div class="form-group">
            <label>Название *</label>
            <input type="text" class="form-control" id="product-name" value="${isEdit ? product.name : ''}" required>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Базовая цена</label>
              <input type="number" class="form-control" id="product-price" value="${isEdit ? product.base_price : 0}" min="0" step="0.01">
            </div>
            <div class="form-group">
              <label>Единица измерения</label>
              <input type="text" class="form-control" id="product-unit" value="${isEdit ? (product.unit || 'шт.') : 'шт.'}">
            </div>
          </div>
          <div class="form-group">
            <label>Описание</label>
            <textarea class="form-control" id="product-description" rows="2">${isEdit ? (product.description || '') : ''}</textarea>
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" id="product-active" ${!isEdit || product.is_active ? 'checked' : ''}>
              Активен
            </label>
          </div>
        </form>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Отмена</button>
        <button class="btn btn-primary" onclick="ProductsPage.saveProduct(${isEdit ? product.id : 'null'})">${isEdit ? 'Сохранить' : 'Создать'}</button>
      `,
    });
  },

  async saveProduct(id) {
    const data = {
      name: document.getElementById('product-name').value.trim(),
      base_price: parseFloat(document.getElementById('product-price').value) || 0,
      unit: document.getElementById('product-unit').value.trim() || 'шт.',
      description: document.getElementById('product-description').value.trim(),
      is_active: document.getElementById('product-active').checked,
    };

    if (!data.name) {
      Toast.error('Введите название товара');
      return;
    }

    try {
      if (id) {
        await API.put(`/products/${id}`, data);
        Toast.success('Товар обновлён');
      } else {
        await API.post('/products', data);
        Toast.success('Товар создан');
      }
      Modal.close();
      this.loadProducts();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async deleteProduct(id) {
    if (!confirm('Удалить товар/услугу?')) return;
    try {
      await API.del(`/products/${id}`);
      Toast.success('Товар удалён');
      this.loadProducts();
    } catch (err) {
      Toast.error(err.message);
    }
  },
};
