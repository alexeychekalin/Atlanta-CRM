/* Modal — модальные окна */
const Modal = {
  overlay: null,
  modal: null,
  titleEl: null,
  bodyEl: null,
  footerEl: null,

  init() {
    this.overlay = document.getElementById('modal-overlay');
    this.modal = document.getElementById('modal');
    this.titleEl = document.getElementById('modal-title');
    this.bodyEl = document.getElementById('modal-body');
    this.footerEl = document.getElementById('modal-footer');

    document.getElementById('modal-close').addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  },

  /** className — дополнительный класс на окно (например, modal-comp),
   *  autoFocus — ставить ли курсор в первое поле: в карточке просмотра это
   *  поле поиска по модификациям, и фокус прокручивал бы карточку вниз. */
  open({ title, body, footer = '', wide = false, className = '', autoFocus = true }) {
    this.titleEl.textContent = title;
    this.bodyEl.innerHTML = body;
    this.footerEl.innerHTML = footer;
    this.modal.classList.toggle('modal-wide', wide);
    this.modal.classList.toggle('modal-comp', className === 'modal-comp');
    this.overlay.classList.toggle('modal-overlay--comp', className === 'modal-comp');
    this.overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    if (!autoFocus) return;

    // Focus first input
    setTimeout(() => {
      const firstInput = this.bodyEl.querySelector('input, select, textarea');
      if (firstInput) firstInput.focus();
    }, 100);
  },

  close() {
    this.overlay.style.display = 'none';
    document.body.style.overflow = '';
  },
};
