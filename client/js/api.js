/* =============================================
   API Client — HTTP-обёртка с JWT
   ============================================= */
const API = {
  baseUrl: '/api',

  getToken() {
    return localStorage.getItem('atlanta_token');
  },

  setToken(token) {
    localStorage.setItem('atlanta_token', token);
  },

  removeToken() {
    localStorage.removeItem('atlanta_token');
    localStorage.removeItem('atlanta_user');
  },

  getUser() {
    const raw = localStorage.getItem('atlanta_user');
    return raw ? JSON.parse(raw) : null;
  },

  setUser(user) {
    localStorage.setItem('atlanta_user', JSON.stringify(user));
  },

  isAdmin() {
    const user = this.getUser();
    return user && user.role === 'admin';
  },

  can(section, action = 'view') {
    const user = this.getUser();
    if (!user) return false;
    if (user.role === 'admin') return true;

    const permissions = user.permissions;
    if (!permissions) {
      if (user.role === 'manager') {
        if (section === 'settings') return false;
        if (action === 'delete' && (section === 'clients' || section === 'components')) return false;
        return true;
      }
      if (user.role === 'technologist') {
        if (section === 'reports' || section === 'settings') return false;
        if (action === 'delete' && (section === 'orders' || section === 'clients')) return false;
        return true;
      }
      if (user.role === 'viewer') {
        return action === 'view' && section !== 'settings';
      }
      return false;
    }

    const sectionPerms = permissions[section];
    if (!sectionPerms) return false;

    if (action === 'view') {
      return sectionPerms.view !== false;
    }
    return !!sectionPerms[action];
  },

  getRoleDisplayName() {
    const user = this.getUser();
    if (!user) return '';
    return user.role_display_name || (user.role === 'admin' ? 'Администратор' : user.role === 'manager' ? 'Менеджер' : user.role === 'technologist' ? 'Инженер-конструктор' : 'Наблюдатель');
  },

  async request(method, path, body = null, isBlob = false) {
    const headers = {
      'Authorization': `Bearer ${this.getToken()}`,
    };

    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const config = {
      method,
      headers,
    };

    if (body) {
      config.body = body instanceof FormData ? body : JSON.stringify(body);
    }

    const response = await fetch(this.baseUrl + path, config);

    if (response.status === 401) {
      this.removeToken();
      window.location.reload();
      throw new Error('Сессия истекла');
    }

    if (isBlob) {
      if (!response.ok) {
        throw new Error('Ошибка экспорта');
      }
      return response.blob();
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Произошла ошибка');
    }

    return data;
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  del(path) { return this.request('DELETE', path); },
  getBlob(path) { return this.request('GET', path, null, true); },
  upload(path, formData) { return this.request('POST', path, formData); },

  // Auth
  async login(username, password) {
    const res = await fetch(this.baseUrl + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    this.setToken(data.token);
    this.setUser(data.user);
    return data;
  },

  logout() {
    this.removeToken();
  },
};
