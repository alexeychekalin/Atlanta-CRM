/* Login Page */
const LoginPage = {
  init() {
    const form = document.getElementById('login-form');
    form.addEventListener('submit', (e) => this.handleSubmit(e));
  },

  async handleSubmit(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit');

    if (!username || !password) {
      errorEl.textContent = 'Введите логин и пароль';
      errorEl.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Вход...</span>';
    errorEl.style.display = 'none';

    try {
      await API.login(username, password);
      App.showApp();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Войти</span>';
    }
  },
};
