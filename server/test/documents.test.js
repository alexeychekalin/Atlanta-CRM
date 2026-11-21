/**
 * Раздел «Документы»: библиотека файлов по папкам.
 *
 * Проверяем три слоя:
 *   1. чистые правила — имена, вложенность, имена внутри ZIP, Content-Disposition;
 *   2. подключение — схема/миграция, маршруты, права по умолчанию;
 *   3. разметку страницы — что видит администратор и что обычный сотрудник.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  MAX_NAME_LENGTH,
  normalizeFolderName,
  normalizeFileName,
  isAllowedFile,
  fileKind,
  isPreviewable,
  isImage,
  mimeType,
  breadcrumbs,
  folderPaths,
  archiveEntries,
  contentDisposition,
  archiveName,
  formatSize,
} = require('../src/services/document-library');

const ROOT = path.resolve(__dirname, '../..');
const DB_DIR = path.join(ROOT, 'server/src/db');

/* ------------------------------------------------------------------ правила */

test('документы: имя папки чистят и не дают пустого', () => {
  assert.equal(normalizeFolderName('  Сертификаты  '), 'Сертификаты');
  assert.equal(normalizeFolderName('ТР   ТС   018'), 'ТР ТС 018');
  assert.equal(normalizeFolderName('ТР ТС 018/2011'), 'ТР ТС 018 2011');
  assert.equal(normalizeFolderName('отчёты: 2026?'), 'отчёты 2026');
  assert.equal(normalizeFolderName('   ...   '), '...');
  assert.equal(normalizeFolderName(''), null);
  assert.equal(normalizeFolderName(null), null);
  assert.equal(normalizeFolderName('   '), null);
  assert.equal(normalizeFolderName('a'.repeat(300)).length, MAX_NAME_LENGTH);
});

test('документы: имя файла сохраняет формат и чистит запрещённые символы', () => {
  assert.equal(normalizeFileName('Скан: договор*.PDF'), 'Скан договор.pdf');
  assert.equal(normalizeFileName('  Акт   приёмки.docx '), 'Акт приёмки.docx');
  assert.equal(normalizeFileName('', 'Документ'), 'Документ');
  assert.equal(normalizeFileName('.....'), 'Документ');
  assert.equal(normalizeFileName('файл.'), 'файл');
  // длинное имя обрезается, расширение остаётся
  const long = normalizeFileName(`${'a'.repeat(300)}.pdf`);
  assert.ok(long.endsWith('.pdf'));
  assert.ok(long.length <= MAX_NAME_LENGTH);
});

test('документы: принимаются только безопасные форматы', () => {
  for (const name of ['a.pdf', 'b.DOCX', 'c.jpg', 'd.xlsx', 'e.zip', 'f.dwg', 'g.txt']) {
    assert.equal(isAllowedFile(name), true, name);
  }
  for (const name of ['virus.exe', 'page.html', 'logo.svg', 'script.js', 'a.bat', 'noext']) {
    assert.equal(isAllowedFile(name), false, name);
  }
});

test('документы: формат определяет иконку, просмотр и MIME', () => {
  assert.deepEqual(fileKind('Сертификат.PDF'), { icon: '📕', label: 'PDF' });
  assert.equal(fileKind('фото.jpg').icon, '🖼️');
  assert.equal(fileKind('архив.rar').label, 'Архив');
  assert.equal(fileKind('без расширения').icon, '📄');

  assert.equal(isImage('a.PNG'), true);
  assert.equal(isImage('a.pdf'), false);
  assert.equal(isPreviewable('a.pdf'), true);
  assert.equal(isPreviewable('a.docx'), false);
  assert.equal(mimeType('a.pdf'), 'application/pdf');
  assert.equal(mimeType('a.exe'), 'application/octet-stream');
});

test('документы: хлебные крошки строятся до корня и не зацикливаются', () => {
  const folders = [
    { id: 1, name: 'Сертификаты', parent_id: null },
    { id: 2, name: 'ТР ТС 018-2011', parent_id: 1 },
    { id: 3, name: '2026', parent_id: 2 },
    { id: 4, name: 'Договоры', parent_id: null },
  ];
  assert.deepEqual(
    breadcrumbs(folders, 3).map(folder => folder.name),
    ['Сертификаты', 'ТР ТС 018-2011', '2026']
  );
  assert.deepEqual(breadcrumbs(folders, 4).map(folder => folder.name), ['Договоры']);
  assert.deepEqual(breadcrumbs(folders, 999), []);

  // битые данные с циклом не должны вешать сервер
  const cyclic = [
    { id: 1, name: 'A', parent_id: 2 },
    { id: 2, name: 'B', parent_id: 1 },
  ];
  assert.ok(breadcrumbs(cyclic, 1).length <= 100);
});

test('документы: пути папок в архиве — от корня или от выбранной папки', () => {
  const folders = [
    { id: 1, name: 'Сертификаты', parent_id: null },
    { id: 2, name: 'ТР ТС 018-2011', parent_id: 1 },
    { id: 3, name: '2026', parent_id: 2 },
  ];

  const fromRoot = folderPaths(folders, null);
  assert.equal(fromRoot.get(1), 'Сертификаты');
  assert.equal(fromRoot.get(3), 'Сертификаты/ТР ТС 018-2011/2026');

  const inside = folderPaths(folders, 2);
  assert.equal(inside.get(2), 'ТР ТС 018-2011');
  assert.equal(inside.get(3), 'ТР ТС 018-2011/2026');
});

test('документы: ZIP сохраняет вложенность и не теряет одноимённые файлы', () => {
  const folders = [
    { id: 1, name: 'Сертификаты', parent_id: null },
    { id: 2, name: '2026', parent_id: 1 },
  ];
  const files = [
    { folder_id: 2, name: 'Акт.pdf' },
    { folder_id: 2, name: 'Акт.pdf' },
    { folder_id: 1, name: 'Акт.pdf' },
    { folder_id: null, name: 'x:y.docx' },
  ];

  const entries = archiveEntries(folders, files, 1);
  assert.deepEqual(entries.map(entry => entry.name), [
    'Сертификаты/2026/Акт.pdf',
    'Сертификаты/2026/Акт (2).pdf',
    'Сертификаты/Акт.pdf',
    'xy.docx',
  ]);

  // весь архив: пути от корня
  const all = archiveEntries(folders, files, null);
  assert.deepEqual(all.map(entry => entry.name), [
    'Сертификаты/2026/Акт.pdf',
    'Сертификаты/2026/Акт (2).pdf',
    'Сертификаты/Акт.pdf',
    'xy.docx',
  ]);
});

test('документы: Content-Disposition понимает кириллицу', () => {
  const header = contentDisposition('attachment', 'Договоры 2026.zip');
  assert.match(header, /^attachment; filename="________ 2026\.zip"/);
  assert.match(header, /filename\*=UTF-8''%D0%94%D0%BE%D0%B3%D0%BE%D0%B2%D0%BE%D1%80%D1%8B%202026\.zip$/);

  // спецсимволы RFC 5987 кодируются, а не остаются как есть
  const special = contentDisposition('inline', "a'b(c)*.pdf");
  assert.ok(!/filename\*=UTF-8''[^;]*[()'*]/.test(special));
  assert.match(special, /filename="a'b\(c\)\*\.pdf"/);
  assert.match(special, /filename\*=UTF-8''a%27b%28c%29%2A\.pdf$/);
});

test('документы: имя архива и размер для интерфейса', () => {
  assert.equal(archiveName('Договоры'), 'Договоры.zip');
  assert.equal(archiveName('  '), 'Документы.zip');
  assert.equal(archiveName(undefined), 'Документы.zip');
  assert.equal(formatSize(0), '0 Б');
  assert.equal(formatSize(1024), '1 КБ');
  assert.equal(formatSize(5 * 1024 * 1024), '5,0 МБ');
});

/* ------------------------------------------------------------- подключение */

test('документы: таблицы есть и в полной схеме, и в миграции', () => {
  for (const file of ['schema.sql', 'migration_document_library.sql']) {
    const sql = fs.readFileSync(path.join(DB_DIR, file), 'utf8');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS document_folders/, file);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS document_files/, file);
    assert.match(sql, /parent_id INT REFERENCES document_folders\(id\) ON DELETE CASCADE/, file);
    assert.match(sql, /folder_id INT REFERENCES document_folders\(id\) ON DELETE CASCADE/, file);
    assert.match(sql, /ux_document_folders_name/, file);
  }

  // миграция идемпотентна: повторный деплой не должен падать
  const migration = fs.readFileSync(path.join(DB_DIR, 'migration_document_library.sql'), 'utf8');
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS/);
});

test('документы: маршруты подключены с проверкой прав и папкой хранения', () => {
  const index = fs.readFileSync(path.join(ROOT, 'server/src/index.js'), 'utf8');
  assert.match(index, /app\.use\('\/api\/documents', requirePermission\('documents'\), require\('\.\/routes\/document-library'\)\)/);
  assert.match(index, /\['images', 'drawings', 'avatars', 'documents', 'files', 'library'\]/);

  const upload = fs.readFileSync(path.join(ROOT, 'server/src/routes/upload.js'), 'utf8');
  assert.match(upload, /const libraryDir = path\.join\(uploadsDir, 'library'\)/);
  assert.match(upload, /router\.post\('\/library-file', auth, canEditDocuments/);
  assert.match(upload, /requireAnyPermission\(\[\['documents', 'edit'\]\]\)/);

  const routes = fs.readFileSync(path.join(ROOT, 'server/src/routes/document-library.js'), 'utf8');
  // загружать можно только в uploads/library, чужие файлы не регистрируются
  assert.match(routes, /if \(!filePath\.startsWith\('\/uploads\/library\/'\)\)/);
  // файл из архива удаляется с диска, если на него больше никто не ссылается
  assert.match(routes, /async function removeStoredFile/);
  assert.match(routes, /fs\.unlinkSync/);
});

test('документы: по умолчанию смотрят все, меняет администратор', () => {
  const source = fs.readFileSync(path.join(DB_DIR, 'migrate_roles.js'), 'utf8');

  const admin = source.slice(source.indexOf("name: 'admin'"), source.indexOf("name: 'manager'"));
  const manager = source.slice(source.indexOf("name: 'manager'"), source.indexOf("name: 'technologist'"));
  const technologist = source.slice(source.indexOf("name: 'technologist'"), source.indexOf("name: 'viewer'"));
  const viewer = source.slice(source.indexOf("name: 'viewer'"), source.indexOf("name: 'guest'"));
  const guest = source.slice(source.indexOf("name: 'guest'"));

  assert.match(admin, /documents: \{ view: true, edit: true, delete: true \}/);
  for (const [role, block] of [['manager', manager], ['technologist', technologist], ['viewer', viewer]]) {
    assert.match(block, /documents: \{ view: true, edit: false, delete: false \}/, role);
  }
  assert.match(guest, /documents: \{ view: false, edit: false, delete: false \}/);
});

test('документы: страница подключена к меню, роутеру и service worker', () => {
  const html = fs.readFileSync(path.join(ROOT, 'client/index.html'), 'utf8');
  assert.match(html, /class="nav-item" data-page="documents"/);
  assert.match(html, /<script src="\/js\/pages\/documents\.js"><\/script>/);

  const app = fs.readFileSync(path.join(ROOT, 'client/js/app.js'), 'utf8');
  assert.match(app, /documents: \{ title: 'Документы'/);
  assert.equal((app.match(/documents: 'documents'/g) || []).length, 2,
    'раздел должен быть в карте прав и в карте маршрутов');

  const sw = fs.readFileSync(path.join(ROOT, 'client/sw.js'), 'utf8');
  assert.match(sw, /'\/js\/pages\/documents\.js'/);
  assert.match(sw, /atlanta-crm-v\d+/);
  const cacheVersion = Number(sw.match(/atlanta-crm-v(\d+)/)[1]);
  assert.ok(cacheVersion >= 20, `версия кэша устарела: v${cacheVersion}`);

  const settings = fs.readFileSync(path.join(ROOT, 'client/js/pages/settings.js'), 'utf8');
  assert.match(settings, /perm-documents-view/);
  assert.match(settings, /documents: \{[\s\S]*?view: isChecked\('documents-view'\)/);
});

/* ---------------------------------------------------------------- страница */

/** Песочница с минимальным DOM: хватает для render/_bodyHtml страницы. */
function loadDocumentsPage({ canEdit = true } = {}) {
  const elements = new Map();
  const makeElement = () => ({
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    disabled: false,
    style: {},
    className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {},
    appendChild() {},
    focus() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  });

  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => makeElement(),
    body: makeElement(),
  };

  const sandbox = {
    console,
    document,
    window: {},
    setTimeout,
    FormData: class { append() {} },
    API: {
      can: (section, action) => canEdit || action === 'view',
      get: async () => ({ folders: [], files: [] }),
      post: async () => ({}),
      patch: async () => ({}),
      del: async () => ({}),
      upload: async () => ({}),
      getBlob: async () => ({}),
    },
    Table: { loading: () => '<div class="loading">Загрузка…</div>', emptyState: () => '' },
    Toast: { success() {}, error() {}, info() {} },
    Modal: { open() {}, close() {} },
    ConfirmDialog: { show: async () => true },
    Lightbox: { open() {} },
    App: { navigateTo() {} },
    downloadBlob() {},
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'client/js/components/escape.js'), 'utf8'), sandbox);
  sandbox.esc = sandbox.window.esc;
  vm.runInContext(
    `${fs.readFileSync(path.join(ROOT, 'client/js/pages/documents.js'), 'utf8')}
     ;globalThis.DocumentsPage = DocumentsPage;`,
    sandbox
  );
  return { page: sandbox.DocumentsPage, elements, sandbox };
}

const SAMPLE = {
  folder: { id: 2, name: 'ТР ТС 018-2011', parent_id: 1 },
  breadcrumbs: [{ id: 1, name: 'Сертификаты' }, { id: 2, name: 'ТР ТС 018-2011' }],
  folders: [
    { id: 3, name: '2026', parent_id: 2, files_count: 2 },
  ],
  files: [
    {
      id: 10, folder_id: 2, name: 'Сертификат соответствия.pdf', comment: 'до 2029',
      file_size: 11925, uploaded_by_name: 'Администратор', created_at: '2026-11-18T09:00:00Z',
      icon: '📕', kind: 'PDF', previewable: true, image: false,
    },
    {
      id: 11, folder_id: 2, name: 'Фонарь <script>alert(1)</script>.jpg', comment: '',
      file_size: 104956, uploaded_by_name: 'Администратор', created_at: '2026-11-18T09:00:00Z',
      icon: '🖼️', kind: 'Фото', previewable: true, image: true,
    },
  ],
  limits: { max_file_size: 50 * 1024 * 1024 },
};

test('документы: страница показывает папки, файлы и действия администратора', () => {
  const { page } = loadDocumentsPage({ canEdit: true });
  page.folderId = 2;
  page.query = '';
  page.canEdit = true;
  page.canDelete = true;
  page.data = SAMPLE;

  const html = page._bodyHtml(SAMPLE);

  assert.match(html, /docs-folder/);
  assert.match(html, /2026/);
  assert.match(html, /2 файла/);
  assert.match(html, /docs-folder__meta/);
  assert.match(html, /Сертификат соответствия\.pdf/);
  assert.match(html, /12 КБ/);
  assert.match(html, /DocumentsPage\.open\(3\)/);
  assert.match(html, /DocumentsPage\.downloadFile\(10\)/);
  assert.match(html, /DocumentsPage\.openFileModal\(10\)/);
  assert.match(html, /DocumentsPage\.deleteFile\(10\)/);
  assert.match(html, /DocumentsPage\.downloadArchive\(3\)/);
  assert.match(html, /DocumentsPage\.openFolderModal\(3\)/);

  // имя файла экранируется: скрипт в названии не становится тегом
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /Фонарь &lt;script&gt;alert\(1\)&lt;\/script&gt;\.jpg/);
});

test('документы: сотруднику без права изменения не показывают кнопки правки', () => {
  const { page } = loadDocumentsPage({ canEdit: false });
  page.folderId = 2;
  page.query = '';
  page.canEdit = false;
  page.canDelete = false;
  page.data = SAMPLE;

  const html = page._bodyHtml(SAMPLE);
  assert.match(html, /Сертификат соответствия\.pdf/);
  assert.match(html, /DocumentsPage\.downloadFile\(10\)/);
  assert.ok(!/openFolderModal/.test(html), 'нет кнопки создания/переименования папки');
  assert.ok(!/openFileModal/.test(html), 'нет переименования файла');
  assert.ok(!/deleteFile|deleteFolder/.test(html), 'нет удаления');
  assert.ok(!/Upload|uploadFiles/.test(html));
});

test('документы: поиск фильтрует и папки, и файлы', () => {
  const { page } = loadDocumentsPage({ canEdit: true });
  page.data = SAMPLE;
  page.canEdit = true;

  page.query = 'договор';
  let html = page._bodyHtml(SAMPLE);
  assert.match(html, /ничего не найдено/i);

  page.query = 'сертификат';
  html = page._bodyHtml(SAMPLE);
  assert.match(html, /Сертификат соответствия\.pdf/);
  assert.ok(!/2026<\/div>/.test(html));
});

test('документы: хлебные крошки ведут в корень и по родителям', () => {
  const { page, elements } = loadDocumentsPage({ canEdit: true });
  page.data = SAMPLE;

  page._renderCrumbs();
  const html = elements.get('docs-crumbs').innerHTML;

  assert.match(html, /DocumentsPage\.open\(null\)/);
  assert.match(html, /DocumentsPage\.open\(1\)/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /ТР ТС 018-2011/);
});

test('документы: пустая папка подсказывает админу, что делать', () => {
  const { page } = loadDocumentsPage({ canEdit: true });
  page.folderId = null;
  page.query = '';
  page.canEdit = true;

  const html = page._bodyHtml({ folders: [], files: [], breadcrumbs: [] });
  assert.match(html, /Библиотека документов пока пуста/);
  assert.match(html, /Создайте папку и загрузите/);

  page.canEdit = false;
  const viewerHtml = page._bodyHtml({ folders: [], files: [], breadcrumbs: [] });
  assert.ok(!/Создайте папку/.test(viewerHtml));
});

test('документы: размер, дата и склонение «файл/файла/файлов»', () => {
  const { page } = loadDocumentsPage();
  assert.equal(page.formatSize(0), '0 Б');
  assert.equal(page.formatSize(2048), '2 КБ');
  assert.equal(page.formatSize(1536 * 1024), '1,5 МБ');
  assert.equal(page.formatDate('2026-11-18T09:00:00Z').length > 0, true);
  assert.equal(page.formatDate(null), '—');
  assert.equal(page.formatDate('не дата'), '—');
  assert.equal(page._filesWord(1), 'файл');
  assert.equal(page._filesWord(2), 'файла');
  assert.equal(page._filesWord(5), 'файлов');
  assert.equal(page._filesWord(11), 'файлов');
  assert.equal(page._filesWord(21), 'файл');

  // «Сертификаты» с двумя файлами во вложенной папке не выглядят пустыми
  assert.equal(page._folderMeta({ files_count: 0, total_files: 2, folders_count: 1 }), '2 файла · 1 папка');
  assert.equal(page._folderMeta({ files_count: 5, total_files: 5, folders_count: 2 }), '5 файлов · 2 папки');
  assert.equal(page._folderMeta({ files_count: 0, total_files: 11, folders_count: 0 }), '11 файлов');
  // ответ старого API без total_files
  assert.equal(page._folderMeta({ files_count: 3 }), '3 файла');
});
