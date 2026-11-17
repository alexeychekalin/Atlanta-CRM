/* Скачивание файла, который пришёл с сервера (blob): отчёт, реквизиты, архив.
 * Имя файла задаёт вызывающий код — браузер сохранит его как есть.
 * Использование: downloadBlob(blob, 'Реквизиты.docx'). */
(function () {
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'file';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Safari/iOS не начинает скачивание, если освободить URL сразу
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  window.downloadBlob = downloadBlob;
})();
