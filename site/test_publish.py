#!/usr/bin/env python3
"""Тесты выкладки сайта: папка на диске и FTP (на поддельном сервере).

Запуск:  python3 site/test_publish.py
Их же дёргает server/test/site-publish.test.js, чтобы всё шло в общем npm test.
"""
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import publish  # noqa: E402


def make_tree(root, files):
    for name, text in files.items():
        path = Path(root) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')
    return Path(root)


class LocalTargetTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='atlanta-publish-'))
        self.src = make_tree(self.tmp / 'dist', {
            'index.html': '<h1>Атланта</h1>',
            'catalog/index.html': '<h1>Каталог</h1>',
            'static/site.css': 'body{}',
        })
        self.dst = self.tmp / 'www'

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_first_run_copies_everything(self):
        report = publish.run(source=self.src, target=self.dst, verbose=False)

        self.assertEqual((report.added, report.updated, report.unchanged), (3, 0, 0))
        self.assertEqual((self.dst / 'catalog/index.html').read_text(encoding='utf-8'),
                         '<h1>Каталог</h1>')

    def test_second_run_touches_nothing(self):
        publish.run(source=self.src, target=self.dst, verbose=False)
        before = (self.dst / 'index.html').stat().st_mtime_ns

        report = publish.run(source=self.src, target=self.dst, verbose=False)

        self.assertEqual((report.added, report.updated), (0, 0))
        self.assertEqual(report.unchanged, 3)
        self.assertEqual((self.dst / 'index.html').stat().st_mtime_ns, before,
                         'неизменившийся файл не должен перезаписываться')

    def test_changed_file_is_replaced(self):
        publish.run(source=self.src, target=self.dst, verbose=False)
        (self.src / 'index.html').write_text('<h1>Новая главная</h1>', encoding='utf-8')

        report = publish.run(source=self.src, target=self.dst, verbose=False)

        self.assertEqual((report.added, report.updated, report.unchanged), (0, 1, 2))
        self.assertIn('Новая главная', (self.dst / 'index.html').read_text(encoding='utf-8'))
        self.assertEqual(list(self.dst.rglob('*.publish-tmp')), [],
                         'временные файлы должны исчезать')

    def test_force_rewrites_everything(self):
        publish.run(source=self.src, target=self.dst, verbose=False)
        report = publish.run(source=self.src, target=self.dst, verbose=False, force=True)
        self.assertEqual((report.added, report.updated, report.unchanged), (0, 3, 0))

    def test_prune_removes_stale_but_keeps_hosting_files(self):
        publish.run(source=self.src, target=self.dst, verbose=False)
        (self.dst / 'old-page.html').write_text('старое', encoding='utf-8')
        (self.dst / '.htaccess').write_text('RewriteEngine On', encoding='utf-8')
        (self.dst / '.well-known').mkdir()
        (self.dst / '.well-known' / 'acme').write_text('token', encoding='utf-8')

        report = publish.run(source=self.src, target=self.dst, prune=True, verbose=False)

        self.assertEqual(report.deleted, 1)
        self.assertFalse((self.dst / 'old-page.html').exists())
        self.assertTrue((self.dst / '.htaccess').exists(), '.htaccess — не наш файл')
        self.assertTrue((self.dst / '.well-known' / 'acme').exists())

    def test_dry_run_changes_nothing(self):
        report = publish.run(source=self.src, target=self.dst, dry_run=True, verbose=False)

        self.assertTrue(report.dry_run)
        self.assertEqual(report.added, 3)
        self.assertFalse(self.dst.exists(), 'пробный прогон не должен создавать папку')

    def test_source_missing_is_reported(self):
        with self.assertRaises(publish.PublishError):
            publish.run(source=self.tmp / 'nope', target=self.dst, verbose=False)


class FakeFtp:
    """Минимальный FTP-сервер в памяти: только то, что нужно publish.py."""

    def __init__(self):
        self.files = {}        # '/root/a.html' → bytes
        self.dirs = set()
        self.commands = []
        self.fail_once = set()  # имена файлов, на которых рвётся соединение
        self.closed = False

    # --- интерфейс ftplib.FTP ---
    def connect(self, host, port):
        pass

    def login(self, user, password):
        pass

    def set_pasv(self, value):
        pass

    def voidcmd(self, command):
        return '200 ok'

    def quit(self):
        self.closed = True

    def close(self):
        self.closed = True

    def mkd(self, path):
        if path in self.dirs:
            raise publish.ftplib.error_perm('550 already exists')
        self.dirs.add(path)

    def size(self, path):
        if path not in self.files:
            raise publish.ftplib.error_perm('550 no file')
        return len(self.files[path])

    def mlsd(self, path):
        prefix = path.rstrip('/') + '/'
        names = {name[len(prefix):].split('/')[0] for name in self.files
                 if name.startswith(prefix)}
        for name in sorted(names):
            full = prefix + name
            kind = 'dir' if full in self.dirs else 'file'
            facts = {'type': kind}
            if kind == 'file':
                facts['size'] = str(len(self.files[full]))
            yield name, facts

    def storbinary(self, command, handle, blocksize=8192):
        path = command.split(' ', 1)[1]
        self.commands.append(command)
        data = handle.read()
        if path in self.fail_once:
            self.fail_once.discard(path)
            self.files[path] = data[:len(data) // 2]      # оборвались на середине
            raise ConnectionResetError('421 connection reset')
        self.files[path] = data

    def transfercmd(self, command, rest=None):
        path = command.split(' ', 1)[1]
        self.commands.append(f'REST {rest} {command}')
        existing = self.files.get(path, b'')
        start = int(rest or 0)
        assert existing[:start] == existing[:start], 'докачка с середины файла'
        buffer = io.BytesIO()

        class Conn:
            def sendall(_self, chunk):
                buffer.write(chunk)

            def close(_self):
                self.files[path] = existing[:start] + buffer.getvalue()

        return Conn()

    def voidresp(self):
        return '226 ok'

    def delete(self, path):
        if path not in self.files:
            raise publish.ftplib.error_perm('550 no file')
        del self.files[path]


class FtpTargetTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='atlanta-ftp-'))
        self.src = make_tree(self.tmp / 'dist', {
            'index.html': 'главная',
            'images/logo.jpg': 'x' * 4096,
        })
        self.cache_dir = Path(tempfile.mkdtemp(prefix='atlanta-cache-'))
        self._cache = publish.CACHE_DIR
        publish.CACHE_DIR = self.cache_dir
        self.fake = FakeFtp()
        self._ftp_class = publish.ftplib.FTP
        publish.ftplib.FTP = lambda timeout=60: self.fake

    def tearDown(self):
        publish.ftplib.FTP = self._ftp_class
        publish.CACHE_DIR = self._cache
        shutil.rmtree(self.tmp, ignore_errors=True)
        shutil.rmtree(self.cache_dir, ignore_errors=True)

    def target(self, **kwargs):
        return publish.FtpTarget('host', root='/www', user='user', password='secret',
                                 verbose=False, **kwargs)

    def test_upload_and_repeat_without_reupload(self):
        report = self.target().publish(self.src, publish.collect_files(self.src))
        self.assertEqual((report.added, report.updated), (2, 0))
        self.assertEqual(self.fake.files['/www/index.html'], b'\xd0\xb3\xd0\xbb\xd0\xb0\xd0\xb2\xd0\xbd\xd0\xb0\xd1\x8f')
        self.assertIn('/www', self.fake.dirs, 'корень создаётся сам')

        uploads = [c for c in self.fake.commands if c.startswith('STOR')]
        report = self.target().publish(self.src, publish.collect_files(self.src))
        self.assertEqual(report.unchanged, 2)
        self.assertEqual(report.added + report.updated, 0)
        self.assertEqual(len([c for c in self.fake.commands if c.startswith('STOR')]),
                         len(uploads), 'повторно ничего не заливается')

    def test_changed_file_only(self):
        self.target().publish(self.src, publish.collect_files(self.src))
        (self.src / 'images/logo.jpg').write_text('y' * 4096, encoding='utf-8')

        report = self.target().publish(self.src, publish.collect_files(self.src))

        self.assertEqual((report.updated, report.unchanged), (1, 1))
        self.assertEqual(self.fake.files['/www/images/logo.jpg'], b'y' * 4096)

    def test_broken_transfer_is_resumed(self):
        # первый STOR обрывается на середине — файл должен докачаться
        self.fake.fail_once.add('/www/images/logo.jpg')
        report = self.target(retries=2).publish(self.src, publish.collect_files(self.src))

        self.assertEqual(report.failed, [])
        self.assertEqual(len(self.fake.files['/www/images/logo.jpg']), 4096)
        self.assertTrue(any(cmd.startswith('REST') for cmd in self.fake.commands),
                        'после обрыва файл докачивается, а не льётся заново')

    def test_prune_removes_remote_leftovers_and_keeps_hidden(self):
        self.target().publish(self.src, publish.collect_files(self.src))
        self.fake.files['/www/old.html'] = b'old'
        self.fake.files['/www/.htaccess'] = b'deny'

        report = self.target().publish(self.src, publish.collect_files(self.src), prune=True)

        self.assertEqual(report.deleted, 1)
        self.assertNotIn('/www/old.html', self.fake.files)
        self.assertIn('/www/.htaccess', self.fake.files)

    def test_dry_run_uploads_nothing(self):
        report = self.target(dry_run=True).publish(self.src, publish.collect_files(self.src))
        self.assertTrue(report.dry_run)
        self.assertEqual(report.added, 2)
        self.assertEqual(self.fake.files, {})

    def test_cache_is_per_target(self):
        self.target().publish(self.src, publish.collect_files(self.src))
        cache_files = list(self.cache_dir.glob('*.json'))
        self.assertEqual(len(cache_files), 1)
        data = json.loads(cache_files[0].read_text(encoding='utf-8'))
        self.assertIn('index.html', data['files'])


class ParseTargetTest(unittest.TestCase):
    def test_local_path(self):
        target = publish.parse_target('/var/www/atlanta')
        self.assertIsInstance(target, publish.LocalTarget)

    def test_ftp_url(self):
        target = publish.parse_target('ftp://user:pass@example.ru:2121/public_html/site')
        self.assertIsInstance(target, publish.FtpTarget)
        self.assertEqual((target.host, target.port, target.root), ('example.ru', 2121, '/public_html/site'))
        self.assertEqual((target.user, target.password), ('user', 'pass'))

    def test_ftps_url(self):
        self.assertTrue(publish.parse_target('ftps://host/path').tls)

    def test_rsync_spec(self):
        target = publish.parse_target('root@103.80.87.197:/var/www/atlanta')
        self.assertIsInstance(target, publish.RsyncTarget)

    def test_sftp_is_explained(self):
        with self.assertRaises(publish.PublishError):
            publish.parse_target('sftp://host/path')

    def test_password_from_env(self):
        os.environ['SITE_FTP_PASSWORD'] = 'из-окружения'
        try:
            target = publish.parse_target('ftp://user@host/path')
            self.assertEqual(target.password, 'из-окружения')
        finally:
            del os.environ['SITE_FTP_PASSWORD']


if __name__ == '__main__':
    unittest.main(verbosity=2)
