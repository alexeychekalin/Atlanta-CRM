/* Загрузка документов в карточку клиента и поворот фото.
 *
 * Два изменения, которые видит пользователь:
 *   1. в «Документы» карточки клиента можно положить Word, Excel, PowerPoint
 *      и обычный текст, а не только PDF и картинки;
 *   2. фото в просмотре можно повернуть, и положение сохраняется — файл
 *      перезаписывается на месте, путь в базе не меняется.
 *
 * Проверяем правила фильтров, маршруты и то, что клиент просит именно их. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const uploadSource = fs.readFileSync(path.join(__dirname, '../src/routes/upload.js'), 'utf8');
const profileSource = fs.readFileSync(path.join(ROOT, 'client/js/pages/client-profile.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');

/** Достаёт список расширений из `const name = extensionFilter([...], …)`. */
function filterExtensions(name) {
  const match = uploadSource.match(new RegExp(`const ${name} = extensionFilter\\(\\s*\\[([^\\]]+)\\]`));
  assert.ok(match, `не найден фильтр ${name}`);
  return match[1].split(',').map(item => item.trim().replace(/['"]/g, '')).filter(Boolean);
}

/* ------------------------------------------------- документы в карточке клиента */

test('документы клиента принимают Word, Excel, PowerPoint и текст', () => {
  const allowed = filterExtensions('clientDocFilter');

  for (const ext of ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods']) {
    assert.ok(allowed.includes(ext), `нет ${ext}`);
  }
  for (const ext of ['.txt', '.csv', '.md', '.rtf', '.pdf']) {
    assert.ok(allowed.includes(ext), `нет ${ext}`);
  }
  // Фото и HEIC с телефона — тоже документы (сканы, фото подписанных листов)
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']) {
    assert.ok(allowed.includes(ext), `нет ${ext}`);
  }
});

test('опасные и посторонние форматы в документы клиента не попадают', () => {
  const allowed = filterExtensions('clientDocFilter');

  for (const ext of ['.svg', '.html', '.htm', '.js', '.exe', '.php', '.dwg', '.zip', '.rar']) {
    assert.ok(!allowed.includes(ext), `лишний формат ${ext}`);
  }
});

test('чертежи по-прежнему только PDF и изображения', () => {
  const allowed = filterExtensions('drawingFilter');

  assert.ok(allowed.includes('.pdf'));
  assert.ok(allowed.includes('.jpg'));
  assert.ok(!allowed.includes('.docx'), 'Word не должен попадать в чертежи');
  assert.ok(!allowed.includes('.xlsx'));
});

test('маршрут /upload/client-doc проверяет права, сигнатуру и формат', () => {
  const route = uploadSource.match(/router\.post\('\/client-doc'[^\n]+/);
  assert.ok(route, 'нет маршрута /client-doc');
  assert.match(route[0], /canEditClients/, 'нужны права на изменение клиентов');
  assert.match(route[0], /uploadClientDoc\.single\('file'\)/);
  assert.match(route[0], /verifyUploadedFile/, 'сигнатура проверяется');
  assert.match(uploadSource, /const uploadClientDoc = multer\(\{[\s\S]*?limits: \{ fileSize: 50 \* 1024 \* 1024 \}/);
});

test('документы клиента сохраняются в uploads/documents с префиксом doc_', () => {
  const route = uploadSource.match(/router\.post\('\/client-doc'[\s\S]*?\n\}\);/);
  assert.ok(route);
  assert.match(route[0], /fileResponse\(req, res, 'documents'/);
  assert.match(uploadSource, /buildStorage\(documentsDir, 'doc'\)/);
});

test('карточка клиента грузит документы через новый маршрут и перечисляет форматы', () => {
  assert.match(profileSource, /_uploadFile\('Загрузить документ', 'client-doc'/);

  const accept = profileSource.match(/const DOCUMENT_ACCEPT = ([^;]+);/);
  assert.ok(accept, 'нет списка форматов DOCUMENT_ACCEPT');
  for (const ext of ['.docx', '.xlsx', '.pptx', '.txt', '.rtf', '.pdf', '.heic']) {
    assert.ok(accept[1].includes(ext), `в accept нет ${ext}`);
  }

  assert.match(profileSource, /accept: DOCUMENT_ACCEPT/);
  assert.match(profileSource, /Word \(doc\/docx\), Excel \(xls\/xlsx\), PowerPoint \(pptx\)/);
});

test('иконки документов знают новые форматы', () => {
  const sandbox = { window: {}, document: { addEventListener() {} }, console, API: {}, Toast: {}, Modal: {} };
  vm.createContext(sandbox);
  vm.runInContext(`${profileSource}\n;globalThis.Page = ClientProfilePage;`, sandbox);

  const icons = sandbox.Page.getFileIcon;
  assert.equal(icons('docx'), '📝');
  assert.equal(icons('xlsx'), '📊');
  assert.equal(icons('pptx'), '📽️');
  assert.equal(icons('txt'), '📃');
  assert.equal(icons('heic'), '🖼️');
  assert.equal(icons('DOCX'), '📝', 'регистр не важен');
  assert.equal(icons('exe'), '📁');
  assert.equal(icons(null), '📁');
});

/* ------------------------------------------------------------------- поворот */

test('маршрут поворота: путь нормализуется, права и формат проверяются', () => {
  const route = uploadSource.match(/router\.post\('\/rotate'[\s\S]*?\n\}\);/);
  assert.ok(route, 'нет маршрута /rotate');
  assert.match(route[0], /normalizeUploadPath\(rawPath\)/, 'traversal должен отсекаться');
  assert.match(route[0], /safeUploadPath\(filePath\)/);
  assert.match(route[0], /canRotatePath\(req\.user, filePath\)/);
  assert.match(route[0], /isRotatablePath\(filePath\)/);
  assert.match(route[0], /rotatePhotoFile\(absolute, degrees\)/);
  assert.match(route[0], /res\.status\(404\)/, 'пропавший файл — 404');
});

test('поворот разрешён по разделам: фото компонентов, аватары, библиотека', () => {
  const rules = uploadSource.match(/const ROTATE_RULES = \[[\s\S]*?\];/);
  assert.ok(rules, 'нет ROTATE_RULES');
  assert.match(rules[0], /'\/uploads\/images\/', sections: \[\['components', 'edit'\]\]/);
  assert.match(rules[0], /'\/uploads\/documents\/', sections: \[\['components', 'edit'\], \['clients', 'edit'\]\]/);
  assert.match(rules[0], /'\/uploads\/avatars\/', sections: \[\['clients', 'edit'\]\]/);
  assert.match(rules[0], /'\/uploads\/library\/', sections: \[\['documents', 'edit'\]\]/);
  assert.match(rules[0], /'\/uploads\/files\/', adminOnly: true/);
  // достаточно любого права: менеджер с clients.edit поворачивает фото договора
  assert.match(uploadSource, /rule\.sections\.some\(\(\[section, action\]\) => sectionAllowed/);
});

test('фото в просмотре известно, где включить поворот', () => {
  const catalogSource = fs.readFileSync(path.join(ROOT, 'client/js/pages/components-catalog.js'), 'utf8');
  const documentsSource = fs.readFileSync(path.join(ROOT, 'client/js/pages/documents.js'), 'utf8');
  const lightboxSource = fs.readFileSync(path.join(ROOT, 'client/js/components/lightbox.js'), 'utf8');

  assert.match(lightboxSource, /onRotate/, 'Lightbox не умеет поворот');
  assert.match(catalogSource, /onRotate: this\._photoCanEdit/, 'галерея компонента без поворота');
  assert.match(catalogSource, /viewModImage[\s\S]{0,400}onRotate: canEdit/, 'фото модификаций без поворота');
  assert.match(documentsSource, /onRotate: this\.canEdit/, 'библиотека документов без поворота');
  assert.match(catalogSource, /API\.post\('\/upload\/rotate'/);
  assert.match(documentsSource, /API\.post\('\/upload\/rotate'/);
});

test('повёрнутое фото не остаётся в кэше браузера', () => {
  // no-cache + ETag: после перезаписи файла браузер перепроверяет картинку
  assert.match(indexSource, /Cache-Control', 'private, no-cache'/);
  assert.doesNotMatch(indexSource, /max-age=3600'\)/, 'часовой кэш вернул бы старое положение');
});

test('service worker обновлён — клиент получит новый JS', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'client/sw.js'), 'utf8');
  const version = Number(sw.match(/atlanta-crm-v(\d+)/)[1]);
  assert.ok(version >= 18, `версия кэша ${version}, ожидалась 18+`);
});

test('скрытые кнопки поворота действительно скрыты: CSS не спорит с hidden', () => {
  const css = fs.readFileSync(path.join(ROOT, 'client/css/styles.css'), 'utf8');
  // у .lightbox__tool задан display: flex, поэтому нужен явный [hidden]
  assert.match(css, /\.lightbox__tool\[hidden\]\s*\{\s*display: none;/);
});
