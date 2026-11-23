/**
 * Чертежи в карточке компонента.
 *
 * Чертёж — третий тип документа компонента (кроме сертификатов и инфо).
 * Проверяем то, что ломается тихо:
 *   • ограничение doc_type в БД и в маршруте принимает 'drawing';
 *   • CAD-файлы (DWG/DXF) проходят проверку сигнатуры и попадают в загрузку;
 *   • в ZIP-архивах чертежи лежат в своей папке, а не в «Информации»;
 *   • отдача файла идёт с типом по расширению и именем в UTF-8 — иначе
 *     «Вал привода.dwg» скачивается как «file» или без расширения;
 *   • в интерфейсе есть третья группа и она читает свой тип.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DB = path.join(ROOT, 'server/src/db');
const ROUTE = fs.readFileSync(path.join(ROOT, 'server/src/routes/component-documents.js'), 'utf8');
const UPLOAD = fs.readFileSync(path.join(ROOT, 'server/src/routes/upload.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'server/src/index.js'), 'utf8');
const CLIENT = fs.readFileSync(path.join(ROOT, 'client/js/pages/components-catalog.js'), 'utf8');
const { hasValidSignature } = require('../src/utils/files');
const { mimeType, contentDisposition, fileKind, isPreviewable } = require('../src/services/document-library');

test('чертежи: тип drawing разрешён в схеме и в миграции', () => {
  const schema = fs.readFileSync(path.join(DB, 'schema.sql'), 'utf8');
  assert.match(schema, /doc_type\s+VARCHAR\(20\)[^,\n]*CHECK \(doc_type IN \('certificate', 'info', 'drawing'\)\)/,
    'schema.sql должен разрешать тип drawing');

  const migration = path.join(DB, 'migration_component_drawings.sql');
  assert.ok(fs.existsSync(migration), 'нет миграции migration_component_drawings.sql');
  const sql = fs.readFileSync(migration, 'utf8');
  assert.match(sql, /'certificate', 'info', 'drawing'/, 'миграция добавляет drawing в ограничение');
  assert.match(sql, /pg_constraint/, 'ограничение ищется по определению, а не по угаданному имени');
  assert.match(sql, /format\('ALTER TABLE component_documents DROP CONSTRAINT %I'/,
    'имя ограничения подставляется безопасно');
});

test('чертежи: маршрут принимает третий тип и кладёт его в свою папку архива', () => {
  assert.match(ROUTE, /DOC_TYPES = new Set\(\['certificate', 'info', 'drawing'\]\)/);
  assert.match(ROUTE, /drawing: 'Чертежи'/);
  // папка берётся из карты, а не из тернарника «сертификат или всё остальное»
  assert.match(ROUTE, /const folder = docFolder\(doc\.doc_type\)/);
  assert.match(INDEX, /'Чертежи'/);
  assert.doesNotMatch(INDEX, /doc\.doc_type === 'certificate' \? 'Сертификаты' : 'Информация'/,
    'в общем ZIP-архиве чертежи не должны попадать в «Информацию»');
});

test('чертежи: загрузка принимает DWG и DXF', () => {
  assert.match(UPLOAD, /router\.post\('\/component-drawing'/, 'нужна точка загрузки чертежа');
  const filter = UPLOAD.match(/const compDrawingFilter = extensionFilter\(\s*\[([\s\S]*?)\]/);
  assert.ok(filter, 'не найден список форматов');
  for (const ext of ['.dwg', '.dxf', '.pdf', '.docx', '.xlsx', '.zip']) {
    assert.ok(filter[1].includes(`'${ext}'`), `формат ${ext} должен быть разрешён`);
  }
  // 50 МБ: CAD-файлы крупнее сертификатов
  assert.match(UPLOAD, /uploadCompDrawing[\s\S]*?fileSize: 50 \* 1024 \* 1024/);
});

test('чертежи: сигнатура DWG и DXF проверяется', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlanta-drawing-'));
  const dwg = path.join(dir, 'вал.dwg');
  const fakeDwg = path.join(dir, 'fake.dwg');
  const dxf = path.join(dir, 'вал.dxf');

  fs.writeFileSync(dwg, Buffer.from('AC1027' + '0'.repeat(32), 'ascii'));
  fs.writeFileSync(fakeDwg, '<svg onload="alert(1)"></svg>');
  fs.writeFileSync(dxf, '0\nSECTION\n2\nHEADER\n');

  assert.equal(hasValidSignature(dwg, '.dwg'), true, 'DWG с сигнатурой AC10 принимается');
  assert.equal(hasValidSignature(fakeDwg, '.dwg'), false, 'переименованный SVG не принимается');
  assert.equal(hasValidSignature(dxf, '.dxf'), true, 'DXF — текстовый, сигнатуры нет');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('чертежи: файл отдаётся с типом по расширению и именем в UTF-8', () => {
  assert.match(ROUTE, /router\.get\('\/:docId\/file'/, 'нужен маршрут отдачи файла');
  assert.match(ROUTE, /setHeader\('Content-Type', mimeType\(doc\.original_name\)\)/);
  assert.match(ROUTE, /contentDisposition\(inline \? 'inline' : 'attachment'/);
  // перед download-all: иначе параметр :docId перехватит «file»
  assert.ok(ROUTE.indexOf("'/:docId/file'") < ROUTE.indexOf("'/download-all'"),
    'маршрут файла объявлен раньше download-all');

  assert.equal(mimeType('Вал привода.dwg'), 'image/vnd.dwg');
  assert.equal(mimeType('Вал привода.DXF'), 'image/vnd.dxf');
  assert.equal(mimeType('Скан.pdf'), 'application/pdf');
  assert.equal(mimeType('неизвестное.zzz'), 'application/octet-stream');

  const header = contentDisposition('attachment', 'Вал привода.dwg');
  assert.match(header, /^attachment; filename="[^"]+"/);
  assert.match(header, /filename\*=UTF-8''%D0%92%D0%B0%D0%BB/,
    'кириллица кодируется по RFC 5987 — иначе имя приходит пустым');
  assert.equal(isPreviewable('Чертёж.pdf'), true, 'PDF открывается в браузере');
  assert.equal(isPreviewable('Вал.dwg'), false, 'DWG только скачивается');
  assert.equal(fileKind('Вал.dwg').icon, '📐');
});

test('чертежи: в карточке компонента — третья группа «Чертежи»', () => {
  assert.match(CLIENT, /d\.doc_type === 'drawing'/, 'клиент выбирает чертежи из общего списка');
  assert.match(CLIENT, /renderGroup\('Чертежи', '📐', drawings/);
  assert.match(CLIENT, /id="comp-docs-drawing"/, 'в форме редактирования есть свой список');
  assert.match(CLIENT, /uploadDoc\(\$\{comp\.id\}, 'drawing'\)/, 'кнопка загрузки чертежа');
  assert.match(CLIENT, /'\/upload\/component-drawing'/, 'загрузка чертежа идёт своим маршрутом');
  assert.match(CLIENT, /\.dwg/, 'в выборе файла есть DWG');
  // скачивание — через API: иначе у DWG теряется кириллическое имя
  assert.match(CLIENT, /documents\/\$\{doc\.id\}\/file/);
  assert.match(CLIENT, /_docIcon\(doc\)/, 'иконка зависит от формата (DWG ≠ картинка)');
});
