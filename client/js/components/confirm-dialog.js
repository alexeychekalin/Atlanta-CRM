/* ConfirmDialog — замена нативного confirm() */
const ConfirmDialog = {
  _resolve: null,

  /**
   * Показать диалог подтверждения
   * @param {string} message — текст вопроса
   * @param {object} opts — опции { title, confirmText, cancelText, danger }
   * @returns {Promise<boolean>}
   */
  show(message, opts = {}) {
    const {
      title = 'Подтверждение',
      confirmText = 'Да, подтвердить',
      cancelText = 'Отмена',
      danger = false,
    } = opts;

    return new Promise((resolve) => {
      this._resolve = resolve;

      // Создать overlay если нет
      let overlay = document.getElementById('confirm-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'confirm-overlay';
        overlay.className = 'confirm-overlay';
        document.body.appendChild(overlay);
      }

      overlay.innerHTML = `
        <div class="confirm-dialog">
          <div class="confirm-header">
            <span class="confirm-icon">${danger ? '⚠️' : '❓'}</span>
            <span class="confirm-title">${title}</span>
          </div>
          <div class="confirm-body">${message}</div>
          <div class="confirm-footer">
            <button class="btn btn-secondary confirm-cancel">${cancelText}</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} confirm-ok">${confirmText}</button>
          </div>
        </div>
      `;

      overlay.style.display = 'flex';

      // Обработчики
      const okBtn = overlay.querySelector('.confirm-ok');
      const cancelBtn = overlay.querySelector('.confirm-cancel');

      okBtn.onclick = () => this._close(true);
      cancelBtn.onclick = () => this._close(false);
      overlay.onclick = (e) => {
        if (e.target === overlay) this._close(false);
      };

      // ESC
      this._escHandler = (e) => {
        if (e.key === 'Escape') this._close(false);
      };
      document.addEventListener('keydown', this._escHandler);

      // Enter подтверждает
      this._enterHandler = (e) => {
        if (e.key === 'Enter') this._close(true);
      };
      document.addEventListener('keydown', this._enterHandler);

      okBtn.focus();
    });
  },

  _close(result) {
    const overlay = document.getElementById('confirm-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
    document.removeEventListener('keydown', this._escHandler);
    document.removeEventListener('keydown', this._enterHandler);
    if (this._resolve) {
      this._resolve(result);
      this._resolve = null;
    }
  },

  /** Подтверждение удаления (красная кнопка) */
  delete(message = 'Удалить этот элемент?') {
    return this.show(message, {
      title: 'Удаление',
      confirmText: 'Удалить',
      cancelText: 'Отмена',
      danger: true,
    });
  },
};
