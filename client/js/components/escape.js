/* Экранирование пользовательских данных перед вставкой в innerHTML.
 * Использование: esc(value) — для текста и значений атрибутов.
 * Всегда экранируйте строки, пришедшие от пользователя (названия, ФИО,
 * комментарии, адреса, имена файлов), иначе возможен stored XSS. */
(function () {
  const MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;',
  };

  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"'`]/g, (ch) => MAP[ch]);
  }

  // Безопасный URL для href/src: только http(s)/относительные пути /uploads.
  function safeUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^(javascript|data|vbscript):/i.test(raw)) return '';
    if (/^https?:\/\//i.test(raw)) return esc(raw);
    if (raw.startsWith('/')) return esc(raw);
    return '';
  }

  window.esc = esc;
  window.safeUrl = safeUrl;
})();
