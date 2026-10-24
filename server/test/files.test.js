const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  UPLOADS_DIR,
  safeUploadPath,
  normalizeUploadPath,
  safeArchiveName,
  hasValidSignature,
} = require('../src/utils/files');

test('safeUploadPath принимает только пути внутри uploads', () => {
  const ok = safeUploadPath('/uploads/images/photo.png');
  assert.equal(ok, path.join(UPLOADS_DIR, 'images/photo.png'));

  assert.equal(safeUploadPath('../../../../etc/passwd'), null);
  assert.equal(safeUploadPath('/etc/passwd'), null);
  assert.equal(safeUploadPath('/uploads/../../src/db.js'), null);
  assert.equal(safeUploadPath('uploads/images/a.png'), null);
  assert.equal(safeUploadPath('/uploads/'), null);
  assert.equal(safeUploadPath(null), null);
  assert.equal(safeUploadPath('/uploads/a\0.png'), null);
});

test('normalizeUploadPath приводит путь к виду /uploads/...', () => {
  assert.equal(normalizeUploadPath('/uploads//images//a.png'), null);
  assert.equal(normalizeUploadPath('/uploads/documents/../images/a.png'), '/uploads/images/a.png');
  assert.equal(normalizeUploadPath('/uploads/../secret'), null);
});

test('safeArchiveName защищает от zip-slip', () => {
  assert.equal(safeArchiveName('../../etc/passwd'), 'passwd');
  assert.equal(safeArchiveName('C:\\temp\\cert.pdf'), 'cert.pdf');
  assert.equal(safeArchiveName(''), 'file');
  assert.equal(safeArchiveName('..'), 'file');
});

test('hasValidSignature проверяет магические байты', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlanta-files-'));
  const png = path.join(dir, 'a.png');
  const fakePng = path.join(dir, 'b.png');
  const pdf = path.join(dir, 'c.pdf');
  const svg = path.join(dir, 'd.svg');

  fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a0000000d', 'hex'));
  fs.writeFileSync(fakePng, '<svg onload="alert(1)"></svg>');
  fs.writeFileSync(pdf, '%PDF-1.4\n...');
  fs.writeFileSync(svg, '<svg></svg>');

  assert.equal(hasValidSignature(png, '.png'), true);
  assert.equal(hasValidSignature(fakePng, '.png'), false);
  assert.equal(hasValidSignature(pdf, '.pdf'), true);
  assert.equal(hasValidSignature(svg, '.svg'), false);
  assert.equal(hasValidSignature(path.join(dir, 'missing.png'), '.png'), false);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('hasValidSignature распознаёт офисные форматы, архивы и чертежи', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlanta-files2-'));
  const write = (name, bytes) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'hex'));
    return file;
  };

  const zipHeader = Buffer.from('504b0304', 'hex');
  const docx = write('a.docx', Buffer.concat([zipHeader, Buffer.from('fake')]));
  const xlsx = write('b.xlsx', Buffer.concat([zipHeader, Buffer.from('fake')]));
  const zip = write('c.zip', Buffer.concat([zipHeader, Buffer.from('fake')]));
  const doc = write('d.doc', Buffer.from('d0cf11e0a1b11ae10000', 'hex'));
  const rar = write('e.rar', Buffer.from('526172211a0700', 'hex'));
  const sevenZip = write('f.7z', Buffer.from('377abcaf271c0004', 'hex'));
  const dwg = write('g.dwg', Buffer.from('AC10272000000000', 'utf8'));
  const txt = write('h.txt', Buffer.from('просто текст', 'utf8'));
  const fakeDocx = write('i.docx', Buffer.from('504b0304', 'hex').subarray(0, 2).toString() + '<html>');

  const { hasValidSignature: check } = require('../src/utils/files');
  assert.equal(check(docx, '.docx'), true);
  assert.equal(check(xlsx, '.xlsx'), true);
  assert.equal(check(zip, '.zip'), true);
  assert.equal(check(doc, '.doc'), true);
  assert.equal(check(rar, '.rar'), true);
  assert.equal(check(sevenZip, '.7z'), true);
  assert.equal(check(dwg, '.dwg'), true);
  assert.equal(check(txt, '.txt'), true);
  assert.equal(check(fakeDocx, '.docx'), false);
  assert.equal(check(txt, '.html'), false);

  fs.rmSync(dir, { recursive: true, force: true });
});
