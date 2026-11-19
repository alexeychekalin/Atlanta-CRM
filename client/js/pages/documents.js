/* Страница «Документы» — библиотека файлов по папкам.
 *
 * Смотреть и скачивать могут все, кому в матрице прав разрешён раздел
 * «Документы»; создавать папки, загружать, переименовывать и удалять —
 * только с правом documents.edit / documents.delete (по умолчанию админ).
 *
 * Адрес страницы: #documents и #documents/<id папки>, поэтому «назад»
 * в браузере возвращает в предыдущую папку.
 */
const DocumentsPage = {
  folderId: null,
  data: null,
  query: '',
  uploading: false,
  canEdit: false,
  canDelete: false,

  async render(param) {
    const content = document.getElementById('content-area');
    this.canEdit = API.can('documents', 'edit');
    this.canDelete = API.can('documents', 'delete');
    this.query = '';

    const raw = param && typeof param === 'object' ? param.id : param;
    this.folderId = /^\d+$/.test(String(raw || '')) ? Number(raw) : null;

    if (!API.can('documents', 'view')) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔒</div>
        <div class="empty-state-text">Раздел «Документы» недоступен для вашей роли</div></div>`;
      return;
    }

    content.innerHTML = `
      <div class="docs" id="docs-area">
        <div class="docs-toolbar">
          <nav class="docs-crumbs" id="docs-crumbs" aria-label="Путь к папке"></nav>
          <div class="docs-tools">
            <div class="search-input docs-search">
              <input type="search" id="docs-search" placeholder="Поиск по папкам и файлам"
                     autocomplete="off" oninput="DocumentsPage.setQuery(this.value)">
            </div>
            ${this.canEdit ? `
              <button type="button" class="btn btn-secondary" onclick="DocumentsPage.openFolderModal()">
                <span aria-hidden="true">＋</span> Папка
              </button>
              <button type="button" class="btn btn-primary" onclick="document.getElementById('docs-file-input').click()">
                <span aria-hidden="true">⤒</span> Загрузить файлы
              </button>
              <input type="file" id="docs-file-input" multiple hidden
                     accept=".pdf,.doc,.docx,.odt,.xls,.xlsx,.ods,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.gif,.tif,.tiff,.heic,.heif,.txt,.csv,.md,.zip,.rar,.7z,.dwg,.dxf"
                     onchange="DocumentsPage.uploadFiles(this.files); this.value='';">
            ` : ''}
            <button type="button" class="btn btn-secondary" id="docs-archive" onclick="DocumentsPage.downloadArchive()"
                    title="Скачать папку со всеми подпапками одним архивом">⤓ ZIP</button>
          </div>
        </div>
        <div class="docs-body" id="docs-body">${Table.loading()}</div>
        <div class="docs-progress" id="docs-progress" hidden>
          <div class="docs-progress__text" id="docs-progress-text"></div>
          <div class="docs-progress__bar"><span id="docs-progress-bar"></span></div>
        </div>
      </div>
    `;

    this._bindDragAndDrop();
    await this.reload();
  },

  async reload() {
    const body = document.getElementById('docs-body');
    if (!body) return;

    try {
      const query = this.folderId ? `?folder=${this.folderId}` : '';
      this.data = await API.get(`/documents/browse${query}`);
      this._renderCrumbs();
      body.innerHTML = this._bodyHtml(this.data);
      const archiveBtn = document.getElementById('docs-archive');
      if (archiveBtn) {
        archiveBtn.disabled = !(this.data.folders.length || this.data.files.length);
      }
    } catch (err) {
      if (err && err.status === 404) {
        Toast.error('Папка не найдена — открываю корень документов');
        App.navigateTo('documents');
        return;
      }
      body.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div>
        <div class="empty-state-text">${esc(err.message)}</div></div>`;
    }
  },

  /* ------------------------------------------------------------- разметка */

  _renderCrumbs() {
    const nav = document.getElementById('docs-crumbs');
    if (!nav || !this.data) return;

    const crumbs = [{ id: null, name: 'Документы' }].concat(this.data.breadcrumbs || []);
    nav.innerHTML = crumbs.map((crumb, index) => {
      const current = index === crumbs.length - 1;
      const label = crumb.id === null ? '📁 Документы' : esc(crumb.name);
      if (current) {
        return `<span class="docs-crumb docs-crumb--current" aria-current="page">${label}</span>`;
      }
      const target = crumb.id === null ? 'null' : crumb.id;
      return `<a href="#documents${crumb.id ? '/' + crumb.id : ''}" class="docs-crumb"
                 onclick="event.preventDefault(); DocumentsPage.open(${target})">${label}</a>
              <span class="docs-crumb__sep" aria-hidden="true">/</span>`;
    }).join('');
  },

  _matches(text) {
    if (!this.query) return true;
    return String(text || '').toLowerCase().includes(this.query);
  },

  _bodyHtml(data) {
    const folders = (data.folders || []).filter(folder => this._matches(folder.name));
    const files = (data.files || []).filter(file =>
      this._matches(file.name) || this._matches(file.comment));

    if (!folders.length && !files.length) {
      const nothingAtAll = !(data.folders || []).length && !(data.files || []).length;
      if (nothingAtAll) {
        return `<div class="empty-state">
          <div class="empty-state-icon">📂</div>
          <div class="empty-state-text">
            ${this.folderId ? 'Папка пуста' : 'Библиотека документов пока пуста'}
            ${this.canEdit ? '<div class="docs-empty-hint">Создайте папку и загрузите в неё документы — PDF, Word, фотографии или архивы.</div>' : ''}
          </div>
        </div>`;
      }
      return `<div class="empty-state"><div class="empty-state-icon">🔍</div>
        <div class="empty-state-text">По запросу ничего не найдено</div></div>`;
    }

    const foldersHtml = folders.length ? `
      <section class="docs-section">
        <div class="docs-section__title">Папки <span class="docs-count">${folders.length}</span></div>
        <div class="docs-folders">
          ${folders.map(folder => `
            <div class="docs-folder" role="button" tabindex="0"
                 onclick="DocumentsPage.open(${folder.id})"
                 onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();DocumentsPage.open(${folder.id});}">
              <div class="docs-folder__icon" aria-hidden="true">📁</div>
              <div class="docs-folder__text">
                <div class="docs-folder__name">${esc(folder.name)}</div>
                <div class="docs-folder__meta">${this._folderMeta(folder)}</div>
              </div>
              ${this.canEdit ? `
                <div class="docs-folder__acts" onclick="event.stopPropagation()">
                  <button type="button" class="btn btn-icon btn-sm" title="Переименовать папку"
                          onclick="DocumentsPage.openFolderModal(${folder.id})">✏️</button>
                  <button type="button" class="btn btn-icon btn-sm" title="Скачать папку архивом"
                          onclick="DocumentsPage.downloadArchive(${folder.id})">⤓</button>
                  ${this.canDelete ? `<button type="button" class="btn btn-icon btn-sm btn-danger" title="Удалить папку"
                          onclick="DocumentsPage.deleteFolder(${folder.id})">✕</button>` : ''}
                </div>` : ''}
            </div>
          `).join('')}
        </div>
      </section>` : '';

    const filesHtml = files.length ? `
      <section class="docs-section">
        <div class="docs-section__title">Файлы <span class="docs-count">${files.length}</span></div>
        <div class="docs-files-wrap">
          <table class="data-table docs-files">
            <thead>
              <tr>
                <th>Название</th>
                <th class="docs-col-size">Размер</th>
                <th class="docs-col-author">Загрузил</th>
                <th class="docs-col-date">Дата</th>
                <th class="text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              ${files.map(file => this._fileRowHtml(file)).join('')}
            </tbody>
          </table>
        </div>
      </section>` : '';

    return `${foldersHtml}${filesHtml}`;
  },

  _fileRowHtml(file) {
    return `
      <tr>
        <td>
          <div class="docs-file">
            <span class="docs-file__icon" aria-hidden="true">${file.icon || '📄'}</span>
            <div class="docs-file__text">
              <div class="docs-file__name">${esc(file.name)}</div>
              <div class="docs-file__meta">
                <span class="docs-file__kind">${esc(file.kind || 'Файл')}</span>
                ${file.comment ? ` · ${esc(file.comment)}` : ''}
              </div>
            </div>
          </div>
        </td>
        <td class="docs-col-size">${this.formatSize(file.file_size)}</td>
        <td class="docs-col-author">${esc(file.uploaded_by_name || '—')}</td>
        <td class="docs-col-date">${this.formatDate(file.created_at)}</td>
        <td class="text-right">
          <div class="table-actions" style="justify-content:flex-end">
            <button type="button" class="btn btn-sm btn-secondary" onclick="DocumentsPage.openFile(${file.id})">
              ${file.image ? 'Просмотр' : 'Открыть'}
            </button>
            <button type="button" class="btn btn-icon btn-sm" title="Скачать"
                    onclick="DocumentsPage.downloadFile(${file.id})">⤓</button>
            ${this.canEdit ? `<button type="button" class="btn btn-icon btn-sm" title="Переименовать"
                    onclick="DocumentsPage.openFileModal(${file.id})">✏️</button>` : ''}
            ${this.canDelete ? `<button type="button" class="btn btn-icon btn-sm btn-danger" title="Удалить"
                    onclick="DocumentsPage.deleteFile(${file.id})">✕</button>` : ''}
          </div>
        </td>
      </tr>`;
  },

  /* ------------------------------------------------------------- действия */

  setQuery(value) {
    this.query = String(value || '').trim().toLowerCase();
    const body = document.getElementById('docs-body');
    if (body && this.data) body.innerHTML = this._bodyHtml(this.data);
  },

  open(folderId) {
    App.navigateTo('documents', folderId || null);
  },

  openFolderModal(folderId = null) {
    if (!this.canEdit) return;
    const folder = folderId && this.data
      ? (this.data.folders || []).find(item => item.id === folderId)
      : null;

    Modal.open({
      title: folder ? 'Переименовать папку' : 'Новая папка',
      body: `
        <div class="form-group">
          <label>Название папки *</label>
          <input type="text" class="form-control" id="docs-folder-name" maxlength="120"
                 placeholder="Например: Сертификаты" value="${folder ? esc(folder.name) : ''}">
          <div class="form-hint">Папку можно вложить в текущую${this.data && this.data.folder
            ? ` — «${esc(this.data.folder.name)}»` : ''}. Символы / \\ : * ? " &lt; &gt; | заменяются пробелом.</div>
        </div>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Отмена</button>
        <button class="btn btn-primary" onclick="DocumentsPage.saveFolder(${folder ? folder.id : 'null'})">
          ${folder ? 'Сохранить' : 'Создать'}
        </button>
      `,
    });

    const input = document.getElementById('docs-folder-name');
    if (input) setTimeout(() => input.focus(), 40);
  },

  async saveFolder(folderId = null) {
    const input = document.getElementById('docs-folder-name');
    const name = input ? input.value.trim() : '';
    if (!name) { Toast.error('Укажите название папки'); return; }

    try {
      if (folderId) {
        await API.patch(`/documents/folders/${folderId}`, { name });
        Toast.success('Папка переименована');
      } else {
        await API.post('/documents/folders', { name, parent_id: this.folderId });
        Toast.success('Папка создана');
      }
      Modal.close();
      await this.reload();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async deleteFolder(folderId) {
    const folder = (this.data && this.data.folders || []).find(item => item.id === folderId);
    const name = folder ? folder.name : 'папку';
    const ok = await ConfirmDialog.show(
      `Удалить папку «${esc(name)}» со всеми вложенными папками и файлами? Файлы будут удалены безвозвратно.`,
      { title: 'Удалить папку', confirmText: 'Удалить', danger: true }
    );
    if (!ok) return;

    try {
      const result = await API.del(`/documents/folders/${folderId}`);
      Toast.success(`Удалено файлов: ${result.files || 0}`);
      await this.reload();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  openFileModal(fileId) {
    const file = (this.data && this.data.files || []).find(item => item.id === fileId);
    if (!file) return;

    Modal.open({
      title: 'Изменить файл',
      body: `
        <div class="form-group">
          <label>Название *</label>
          <input type="text" class="form-control" id="docs-file-name" maxlength="120" value="${esc(file.name)}">
          <div class="form-hint">Формат сохранится: ${esc(file.kind || 'файл')}</div>
        </div>
        <div class="form-group">
          <label>Комментарий</label>
          <textarea class="form-control" id="docs-file-comment" rows="2"
                    placeholder="Версия, назначение, примечание">${esc(file.comment || '')}</textarea>
        </div>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Отмена</button>
        <button class="btn btn-primary" onclick="DocumentsPage.saveFile(${fileId})">Сохранить</button>
      `,
    });
  },

  async saveFile(fileId) {
    const name = document.getElementById('docs-file-name').value.trim();
    const comment = document.getElementById('docs-file-comment').value.trim();
    if (!name) { Toast.error('Укажите название файла'); return; }

    try {
      await API.patch(`/documents/files/${fileId}`, { name, comment });
      Toast.success('Сохранено');
      Modal.close();
      await this.reload();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async deleteFile(fileId) {
    const file = (this.data && this.data.files || []).find(item => item.id === fileId);
    const ok = await ConfirmDialog.show(
      `Удалить файл «${esc(file ? file.name : 'файл')}»?`,
      { title: 'Удалить файл', confirmText: 'Удалить', danger: true }
    );
    if (!ok) return;

    try {
      await API.del(`/documents/files/${fileId}`);
      Toast.success('Файл удалён');
      await this.reload();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  /** Открыть: фото — во весь экран, PDF — в новой вкладке, остальное — скачать. */
  openFile(fileId) {
    const file = (this.data && this.data.files || []).find(item => item.id === fileId);
    if (!file) return;

    if (file.image) {
      // листаем все фотографии текущей папки, начиная с выбранной
      const imageFiles = (this.data.files || []).filter(item => item.image);
      const index = Math.max(0, imageFiles.findIndex(item => item.id === fileId));
      if (typeof Lightbox !== 'undefined') {
        Lightbox.open({
          images: imageFiles.map(item => `/api/documents/files/${item.id}/view`),
          index,
          title: file.name,
        });
        return;
      }
    }

    if (file.previewable) {
      window.open(`/api/documents/files/${fileId}/view`, '_blank', 'noopener');
      return;
    }
    this.downloadFile(fileId);
  },

  async downloadFile(fileId) {
    const file = (this.data && this.data.files || []).find(item => item.id === fileId);
    try {
      const blob = await API.getBlob(`/documents/files/${fileId}/download`);
      downloadBlob(blob, file ? file.name : 'document');
    } catch (err) {
      Toast.error(err.message || 'Не удалось скачать файл');
    }
  },

  async downloadArchive(folderId = null) {
    const id = folderId || this.folderId;
    const folder = folderId
      ? (this.data && this.data.folders || []).find(item => item.id === folderId)
      : (this.data && this.data.folder);
    const name = `${(folder && folder.name) || 'Документы'}.zip`;

    try {
      Toast.info('Собираю архив…');
      const blob = await API.getBlob(id ? `/documents/folders/${id}/archive` : '/documents/archive');
      downloadBlob(blob, name);
    } catch (err) {
      Toast.error(err.message || 'Не удалось собрать архив');
    }
  },

  /* ------------------------------------------------------------- загрузка */

  _bindDragAndDrop() {
    const zone = document.getElementById('docs-area');
    if (!zone || !this.canEdit) return;

    let depth = 0;
    const clear = () => {
      depth = 0;
      zone.classList.remove('docs--dragover');
    };

    zone.addEventListener('dragenter', (event) => {
      event.preventDefault();
      depth += 1;
      zone.classList.add('docs--dragover');
    });
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });
    zone.addEventListener('dragleave', () => {
      depth -= 1;
      if (depth <= 0) clear();
    });
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      clear();
      const files = event.dataTransfer ? event.dataTransfer.files : null;
      if (files && files.length) this.uploadFiles(files);
    });
  },

  async uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (!this.canEdit) { Toast.error('Загружать документы может только администратор'); return; }
    if (this.uploading) { Toast.info('Дождитесь окончания загрузки'); return; }

    const limit = (this.data && this.data.limits && this.data.limits.max_file_size) || 50 * 1024 * 1024;
    const tooBig = files.find(file => file.size > limit);
    if (tooBig) {
      Toast.error(`Файл «${tooBig.name}» больше ${Math.round(limit / (1024 * 1024))} МБ`);
      return;
    }

    this.uploading = true;
    const failed = [];
    let done = 0;
    this._showProgress(0, files.length, files[0].name);

    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        const uploaded = await API.upload('/upload/library-file', formData);
        await API.post('/documents/files', {
          folder_id: this.folderId,
          name: file.name,
          original_name: uploaded.originalname || file.name,
          file_path: uploaded.path,
          file_type: uploaded.file_type || (uploaded.path.split('.').pop() || ''),
          file_size: uploaded.size,
        });
        done += 1;
      } catch (err) {
        failed.push(`${file.name}: ${err.message}`);
      }
      this._showProgress(done, files.length, file.name);
    }

    this.uploading = false;
    this._hideProgress();

    if (done > 0) Toast.success(done === 1 ? 'Файл загружен' : `Загружено файлов: ${done}`);
    if (failed.length) Toast.error(`Не загружено: ${failed.length}. ${failed[0]}`);
    if (done > 0) await this.reload();
  },

  _showProgress(done, total, currentName) {
    const box = document.getElementById('docs-progress');
    const text = document.getElementById('docs-progress-text');
    const bar = document.getElementById('docs-progress-bar');
    if (!box) return;
    box.hidden = false;
    if (text) {
      text.textContent = `Загрузка ${Math.min(done + 1, total)} из ${total}: ${currentName || ''}`;
    }
    if (bar) bar.style.width = `${Math.round((done / Math.max(total, 1)) * 100)}%`;
  },

  _hideProgress() {
    const box = document.getElementById('docs-progress');
    if (box) box.hidden = true;
  },

  /* ------------------------------------------------------------- утилиты */

  formatSize(bytes) {
    const value = Number(bytes) || 0;
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1).replace('.', ',')} МБ`;
    if (value >= 1024) return `${Math.round(value / 1024)} КБ`;
    return `${value} Б`;
  },

  formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('ru-RU');
  },

  /** «2 файла · 1 папка»; у старых ответов API есть только files_count. */
  _folderMeta(folder) {
    const files = folder.total_files !== undefined ? folder.total_files : folder.files_count;
    const parts = [`${files} ${this._filesWord(files)}`];
    if (folder.folders_count) {
      parts.push(`${folder.folders_count} ${this._plural(folder.folders_count, 'папка', 'папки', 'папок')}`);
    }
    return parts.join(' · ');
  },

  _filesWord(count) {
    return this._plural(count, 'файл', 'файла', 'файлов');
  },

  _plural(count, one, few, many) {
    const value = Math.abs(Number(count) || 0) % 100;
    const last = value % 10;
    if (value > 10 && value < 20) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  },
};
