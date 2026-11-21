#!/usr/bin/env python3
"""Выкладка собранного сайта: копирование в папку, FTP/FTPS или rsync.

Зачем отдельный шаг. FTP-клиенты и панели хостинга падают, когда за раз улетает
вся сборка — 800+ файлов, несколько соединений, обрыв на середине, у каждого
файла заново авторизация и листинг каталога. Здесь файлы сравниваются по
содержимому, поэтому уходит только изменившееся: обычно 5–20 файлов вместо всей
сборки. Загрузка идёт одним соединением, с повтором, докачкой недописанного
файла и проверкой размера после каждой загрузки.

Приёмник определяется по строке:

    /var/www/atlanta                  папка (в том числе смонтированная сетевая)
    ftp://user@host/public_html/site  FTP; пароль — из SITE_FTP_PASSWORD или вопрос
    ftps://user@host/path             FTP с TLS
    root@103.80.87.197:/var/www/site  rsync по SSH

Примеры:

    python3 site/publish.py --to /var/www/atlanta
    python3 site/publish.py --to /var/www/atlanta --dry-run
    python3 site/publish.py --to ftp://user@host/public_html --pause 0.2
    python3 site/publish.py --to root@103.80.87.197:/var/www/atlanta --prune
    python3 site/build.py --publish /var/www/atlanta

Пароль FTP не передаётся аргументом (он попал бы в историю команд и в git):
только переменная окружения SITE_FTP_PASSWORD или запрос в терминале.

Кэш выложенного лежит в site/.publish-cache/ (в git не коммитится): по нему
видно, какие файлы уже уехали, чтобы не заливать их повторно.
"""
import argparse
import ftplib
import getpass
import hashlib
import json
import os
import posixpath
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote, urlparse

SITE_DIR = Path(__file__).resolve().parent
ROOT = SITE_DIR.parent
DEFAULT_SOURCE = SITE_DIR / 'dist'
DEFAULT_LOCAL_TARGET = '/var/www/atlanta'
CACHE_DIR = SITE_DIR / '.publish-cache'

CHUNK = 1 << 20
BLOCK = 256 * 1024


class PublishError(RuntimeError):
    """Ошибка выкладки, которую видит пользователь (без трассировки)."""


# --------------------------------------------------------------------------
# Отчёт
# --------------------------------------------------------------------------

@dataclass
class Report:
    """Что произошло с файлами. Считается одинаково для всех приёмников."""

    target: str = ''
    added: int = 0
    updated: int = 0
    unchanged: int = 0
    deleted: int = 0
    failed: list = field(default_factory=list)
    dry_run: bool = False

    @property
    def changed(self):
        return self.added + self.updated

    def as_dict(self):
        return {
            'target': self.target,
            'added': self.added,
            'updated': self.updated,
            'unchanged': self.unchanged,
            'deleted': self.deleted,
            'failed': self.failed,
            'dry_run': self.dry_run,
        }

    def summary(self):
        """Одна строка итога — её печатает и CLI, и сборка сайта."""
        if self.dry_run:
            return (f'будет выложено: добавить {self.added}, заменить {self.updated}, '
                    f'удалить {self.deleted}; без изменений {self.unchanged}')
        return (f'добавлено {self.added}, заменено {self.updated}, '
                f'без изменений {self.unchanged}, удалено {self.deleted}')

    def ok(self):
        return not self.failed


# --------------------------------------------------------------------------
# Общие помощники
# --------------------------------------------------------------------------

def sha1_file(path):
    digest = hashlib.sha1()
    with Path(path).open('rb') as handle:
        for chunk in iter(lambda: handle.read(CHUNK), b''):
            digest.update(chunk)
    return digest.hexdigest()


def collect_files(source):
    """Все файлы сборки: относительный путь в posix-виде → путь на диске."""
    source = Path(source)
    if not source.is_dir():
        raise PublishError(f'нет папки сборки: {source} — сначала python3 site/build.py')
    files = {}
    for path in sorted(source.rglob('*')):
        if path.is_file():
            files[path.relative_to(source).as_posix()] = path
    if not files:
        raise PublishError(f'папка сборки пуста: {source}')
    return files


def is_hidden(rel):
    """Служебные файлы хостинга (.htaccess, .well-known) не наши — их не трогаем."""
    return any(part.startswith('.') for part in rel.split('/'))


def _chmod(path, mode):
    try:
        os.chmod(path, mode)
    except OSError:
        pass


# --------------------------------------------------------------------------
# Папка на диске
# --------------------------------------------------------------------------

class LocalTarget:
    """Копирование в папку: веб-корень на этом же сервере или сетевой диск."""

    kind = 'папка'

    def __init__(self, root, dry_run=False, verbose=True):
        self.root = Path(root).expanduser()
        self.dry_run = dry_run
        self.verbose = verbose

    def describe(self):
        return str(self.root)

    def publish(self, source, files, prune=False, force=False):
        report = Report(target=str(self.root), dry_run=self.dry_run)

        if not self.dry_run:
            self.root.mkdir(parents=True, exist_ok=True)

        for rel, src in files.items():
            dst = self.root / rel
            existed = dst.is_file()

            if existed and not force and dst.stat().st_size == src.stat().st_size \
                    and sha1_file(dst) == sha1_file(src):
                report.unchanged += 1
                continue

            if not self.dry_run:
                self._replace(src, dst)
            if existed:
                report.updated += 1
            else:
                report.added += 1
            if self.verbose:
                print(f'  {"~" if existed else "+"} {rel}', flush=True)

        if prune:
            for rel in self._stale(files):
                if not self.dry_run:
                    with_path = self.root / rel
                    with_path.unlink()
                    _prune_dirs(with_path.parent, self.root)
                report.deleted += 1
                if self.verbose:
                    print(f'  − {rel}', flush=True)

        return report

    def _replace(self, src, dst):
        """Пишем рядом и переименовываем: nginx не отдаст половину файла."""
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_name(f'.{dst.name}.publish-tmp')
        try:
            shutil.copy2(src, tmp)
            _chmod(tmp, 0o644)
            os.replace(tmp, dst)
        finally:
            if tmp.exists():
                tmp.unlink()
        _chmod(dst.parent, 0o755)

    def _stale(self, files):
        if not self.root.is_dir():
            return []
        stale = []
        for path in sorted(self.root.rglob('*')):
            if not path.is_file():
                continue
            rel = path.relative_to(self.root).as_posix()
            if rel in files or is_hidden(rel) or rel.endswith('.publish-tmp'):
                continue
            stale.append(rel)
        return stale


def _prune_dirs(start, stop):
    """Убрать опустевшие каталоги после удаления файлов."""
    current = start
    while current != stop and stop in current.parents:
        try:
            current.rmdir()
        except OSError:
            return
        current = current.parent


# --------------------------------------------------------------------------
# FTP / FTPS
# --------------------------------------------------------------------------

class FtpTarget:
    """FTP-загрузка по одному соединению, с повтором и докачкой.

    Именно на этом ломаются обычные FTP-клиенты: десяток параллельных
    соединений и полная перезаливка при каждом обновлении. Здесь соединение
    одно, файлы идут по очереди, оборванная загрузка продолжается с того же
    места, а уже выложенное не отправляется заново.
    """

    kind = 'FTP'

    def __init__(self, host, root='/', port=None, user=None, password=None, tls=False,
                 retries=3, timeout=60, pause=0.0, dry_run=False, verbose=True):
        self.host = host
        self.root = '/' + (root or '').strip('/') if root not in (None, '', '/') else '/'
        self.port = port
        self.user = user or os.environ.get('SITE_FTP_USER') or 'anonymous'
        self.password = password if password is not None else os.environ.get('SITE_FTP_PASSWORD')
        self.tls = tls
        self.retries = max(0, retries)
        self.timeout = timeout
        self.pause = pause
        self.dry_run = dry_run
        self.verbose = verbose
        self.ftp = None
        self._dirs = set()
        self._root_ready = False
        self.cache_path = CACHE_DIR / f'{self._slug()}.json'

    def describe(self):
        return f'ftp://{self.user}@{self.host}{self.root}'

    def _slug(self):
        raw = f'{self.host}{self.root}'.lower()
        short = hashlib.sha1(raw.encode('utf-8')).hexdigest()[:8]
        name = ''.join(ch if ch.isalnum() else '-' for ch in raw)[:48].strip('-')
        return f'{name}-{short}'

    # ---- соединение -----------------------------------------------------
    def _connect(self):
        if not self.password:
            if sys.stdin.isatty():
                self.password = getpass.getpass(f'Пароль FTP для {self.user}@{self.host}: ')
            else:
                raise PublishError(
                    'нет пароля FTP: задайте SITE_FTP_PASSWORD '
                    f'или укажите его в адресе ftp://{self.user}:…@{self.host}')

        factory = ftplib.FTP_TLS if self.tls else ftplib.FTP
        ftp = factory(timeout=self.timeout)
        try:
            ftp.connect(self.host, self.port or 21)
            ftp.login(self.user, self.password)
            ftp.set_pasv(True)
            if self.tls:
                ftp.prot_p()
            ftp.voidcmd('TYPE I')
        except Exception:
            try:
                ftp.close()
            except Exception:
                pass
            raise
        self.ftp = ftp
        self._dirs = set()
        self._root_ready = False
        return ftp

    def _ensure_root(self):
        """Первый запуск на пустой хостинг: корня может ещё не быть."""
        if self._root_ready or self.root == '/':
            self._root_ready = True
            return
        path = ''
        for part in self.root.strip('/').split('/'):
            path += '/' + part
            try:
                self.ftp.mkd(path)
            except ftplib.error_perm:
                pass                 # каталог уже есть — это нормально
        self._root_ready = True

    def ensure(self):
        if self.ftp is None:
            self._connect()
        return self.ftp

    def close(self):
        if self.ftp is not None:
            try:
                self.ftp.quit()
            except Exception:
                try:
                    self.ftp.close()
                except Exception:
                    pass
            self.ftp = None

    def _remote(self, rel):
        return posixpath.join(self.root, rel) if self.root != '/' else '/' + rel

    # ---- листинг и размеры ---------------------------------------------
    def _walk(self, path, prefix=''):
        entries = {}
        for name, facts in self.ftp.mlsd(path):
            if name in ('.', '..'):
                continue
            rel = f'{prefix}/{name}' if prefix else name
            kind = facts.get('type', '')
            if isinstance(kind, list):
                kind = kind[0] if kind else ''
            if kind == 'dir':
                entries.update(self._walk(posixpath.join(path, name), rel))
            elif kind == 'file':
                size = facts.get('size')
                entries[rel] = int(size) if size and size.isdigit() else None
        return entries

    def remote_files(self):
        """Файлы на сервере (rel → размер) или None, если сервер не умеет MLSD."""
        self.ensure()
        try:
            return self._walk(self.root)
        except ftplib.error_perm:
            return None

    def _size(self, rel):
        try:
            return self.ftp.size(self._remote(rel))
        except ftplib.error_perm:
            return None

    # ---- каталоги и файлы ----------------------------------------------
    def _ensure_dirs(self, rel_dir):
        if not rel_dir:
            return
        current = ''
        for part in rel_dir.split('/'):
            current = f'{current}/{part}' if current else part
            if current in self._dirs:
                continue
            try:
                self.ftp.mkd(self._remote(current))
            except ftplib.error_perm:
                # 550 на существующий каталог — нормально; на права — упадёт STOR
                pass
            self._dirs.add(current)

    def _store(self, rel, src):
        self.ensure()          # после обрыва соединения его надо поднять заново
        remote = self._remote(rel)
        size = src.stat().st_size
        current = self._size(rel)

        self._ensure_dirs(posixpath.dirname(rel))
        with src.open('rb') as handle:
            if current and 0 < current < size:
                # недописанный файл после обрыва — докачиваем с того же места
                self.ftp.voidcmd('TYPE I')
                conn = self.ftp.transfercmd(f'STOR {remote}', rest=current)
                handle.seek(current)
                try:
                    for chunk in iter(lambda: handle.read(BLOCK), b''):
                        conn.sendall(chunk)
                finally:
                    conn.close()
                self.ftp.voidresp()
            else:
                self.ftp.storbinary(f'STOR {remote}', handle, blocksize=BLOCK)

        got = self._size(rel)
        if got != size:
            raise PublishError(f'{rel}: после загрузки {got} байт вместо {size}')
        return 'uploaded'

    def _upload(self, rel, src):
        last = None
        for attempt in range(1, self.retries + 2):
            try:
                return self._store(rel, src)
            except ftplib.error_perm as err:
                # 550 — нет прав или пути: повторять бессмысленно
                raise PublishError(f'{rel}: {err}')
            except ftplib.all_errors + (PublishError,) as err:
                last = err
                self.close()
                if attempt <= self.retries:
                    if self.verbose:
                        print(f'    ↻ {rel}: {err} — повтор {attempt}/{self.retries}', flush=True)
                    time.sleep(min(2 ** attempt, 10))
        raise PublishError(f'{rel}: {last}')

    # ---- кэш уже выложенного -------------------------------------------
    def _load_cache(self):
        try:
            data = json.loads(self.cache_path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return {}
        return data.get('files') or {}

    def _save_cache(self, files):
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        payload = {'target': self.describe(), 'files': files}
        self.cache_path.write_text(json.dumps(payload, ensure_ascii=False, indent=1),
                                   encoding='utf-8')

    # ---- основной цикл --------------------------------------------------
    def publish(self, source, files, prune=False, force=False):
        report = Report(target=self.describe(), dry_run=self.dry_run)
        known = self._load_cache()

        remote = self.remote_files()
        todo = []
        for rel, src in files.items():
            digest = sha1_file(src)
            size = src.stat().st_size
            entry = known.get(rel) or {}

            same_as_cache = (entry.get('sha1') == digest and entry.get('size') == size)
            if same_as_cache and not force:
                if remote is None or remote.get(rel) == size:
                    report.unchanged += 1
                    continue

            todo.append((rel, src, digest, remote.get(rel) if remote else None))

        if not self.dry_run and todo:
            self.ensure()
            self._ensure_root()

        for index, (rel, src, digest, remote_size) in enumerate(todo, 1):
            if self.dry_run:
                if remote_size is not None:
                    report.updated += 1
                else:
                    report.added += 1
                if self.verbose:
                    print(f'  {index}/{len(todo)} {rel}', flush=True)
                continue

            try:
                status = self._upload(rel, src)
            except PublishError as err:
                report.failed.append(str(err))
                continue

            if status == 'unchanged':
                report.unchanged += 1
            else:
                if remote_size is not None:
                    report.updated += 1
                else:
                    report.added += 1
                if self.verbose:
                    print(f'  {index}/{len(todo)} ↑ {rel}', flush=True)

            known[rel] = {'sha1': digest, 'size': src.stat().st_size}
            if self.pause and index < len(todo):
                time.sleep(self.pause)

        if prune:
            stale = self._stale(remote, files)
            if stale is None:
                report.failed.append('--prune: сервер не отдаёт MLSD, удалять нечем')
            else:
                for rel in stale:
                    if not self.dry_run:
                        try:
                            self.ensure().delete(self._remote(rel))
                        except ftplib.all_errors as err:
                            report.failed.append(f'{rel}: {err}')
                            continue
                        known.pop(rel, None)
                    report.deleted += 1
                    if self.verbose:
                        print(f'  − {rel}', flush=True)

        if not self.dry_run:
            for rel in list(known):
                if rel not in files:
                    known.pop(rel)
            self._save_cache(known)

        self.close()
        return report

    def _stale(self, remote, files):
        if remote is None:
            return None
        return [rel for rel in sorted(remote)
                if rel not in files and not is_hidden(rel)]


# --------------------------------------------------------------------------
# rsync по SSH
# --------------------------------------------------------------------------

class RsyncTarget:
    """user@host:/path — тот же rsync, что у scripts/deploy-site.sh."""

    kind = 'rsync'

    def __init__(self, spec, dry_run=False, verbose=True):
        self.spec = spec
        self.dry_run = dry_run
        self.verbose = verbose

    def describe(self):
        return self.spec

    def publish(self, source, files, prune=False, force=False):
        if shutil.which('rsync') is None:
            raise PublishError('нет rsync: apt install -y rsync (или brew install rsync)')

        report = Report(target=self.spec, dry_run=self.dry_run)
        cmd = ['rsync', '-a', '-z', '--human-readable', '--itemize-changes']
        if prune:
            cmd.append('--delete')
        if self.dry_run:
            cmd.append('--dry-run')
        cmd += [f'{Path(source).resolve()}/', self.spec.rstrip('/') + '/']

        if self.verbose:
            print('  $ ' + ' '.join(cmd), flush=True)
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise PublishError((proc.stderr or proc.stdout).strip()
                               or f'rsync завершился с кодом {proc.returncode}')

        for line in proc.stdout.splitlines():
            if self.verbose:
                print(f'  {line}', flush=True)
            if line.startswith('>f'):
                if '+++++++++' in line:
                    report.added += 1
                else:
                    report.updated += 1
            elif line.startswith('*deleting'):
                report.deleted += 1
        return report


# --------------------------------------------------------------------------
# Разбор адреса и запуск
# --------------------------------------------------------------------------

def parse_target(spec, dry_run=False, retries=3, timeout=60, pause=0.0, verbose=True):
    """Строка адреса → объект приёмника."""
    spec = str(spec or '').strip()
    if not spec:
        raise PublishError('не указано, куда выкладывать сайт')

    if spec.startswith(('ftp://', 'ftps://')):
        parsed = urlparse(spec)
        if not parsed.hostname:
            raise PublishError(f'в адресе нет хоста: {spec}')
        return FtpTarget(
            host=parsed.hostname,
            port=parsed.port,
            root=unquote(parsed.path or '/'),
            user=unquote(parsed.username) if parsed.username else None,
            password=unquote(parsed.password) if parsed.password else None,
            tls=spec.startswith('ftps://'),
            retries=retries, timeout=timeout, pause=pause,
            dry_run=dry_run, verbose=verbose,
        )

    if spec.startswith('sftp://'):
        raise PublishError('sftp:// не поддерживается — укажите user@host:/путь (rsync) '
                           'или ftp://…')

    if ':' in spec.split('/')[0] and '@' in spec.split(':')[0]:
        return RsyncTarget(spec, dry_run=dry_run, verbose=verbose)

    return LocalTarget(Path(spec).expanduser(), dry_run=dry_run, verbose=verbose)


def default_target():
    """Куда выкладывать, если адрес не указан: SITE_ROOT или /var/www/atlanta."""
    return os.environ.get('SITE_ROOT') or DEFAULT_LOCAL_TARGET


def run(source=DEFAULT_SOURCE, target=None, prune=False, dry_run=False, force=False,
        retries=3, timeout=60, pause=0.0, verbose=True):
    """Собрать список файлов и выложить их в приёмник. Возвращает Report."""
    source = Path(source)
    files = collect_files(source)
    receiver = parse_target(target or default_target(), dry_run=dry_run,
                            retries=retries, timeout=timeout, pause=pause, verbose=verbose)

    if verbose:
        print(f'  источник: {source} — {len(files)} файлов')
        print(f'  приёмник: {receiver.describe()} ({receiver.kind})', flush=True)

    try:
        report = receiver.publish(source, files, prune=prune, force=force)
    except OSError as err:
        # нет прав, кончилось место, отвалился сетевой диск — без трассировки
        raise PublishError(f'{receiver.describe()}: {err.strerror or err}') from err
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(
        description='Выкладка собранного сайта: папка, FTP/FTPS или rsync')
    parser.add_argument('--from', dest='source', default=str(DEFAULT_SOURCE),
                        help=f'папка сборки (по умолчанию {DEFAULT_SOURCE})')
    parser.add_argument('--to', dest='target', default=None,
                        help='папка, ftp://user@host/путь или user@host:/путь '
                             f'(по умолчанию $SITE_ROOT или {DEFAULT_LOCAL_TARGET})')
    parser.add_argument('--prune', action='store_true',
                        help='удалить в приёмнике файлы, которых нет в сборке')
    parser.add_argument('--force', action='store_true', help='выложить всё, не сравнивая')
    parser.add_argument('--dry-run', action='store_true', help='только показать, что изменится')
    parser.add_argument('--json', action='store_true', help='итог в машинном виде')
    parser.add_argument('--retries', type=int, default=3, help='повторов на файл (FTP)')
    parser.add_argument('--timeout', type=int, default=60, help='таймаут FTP, секунды')
    parser.add_argument('--pause', type=float, default=0.0,
                        help='пауза между файлами, секунды — для капризных FTP-серверов')
    args = parser.parse_args(argv)

    try:
        report = run(source=Path(args.source), target=args.target, prune=args.prune,
                     dry_run=args.dry_run, force=args.force, retries=args.retries,
                     timeout=args.timeout, pause=args.pause, verbose=not args.json)
    except PublishError as err:
        print(f'✗ {err}', file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(report.as_dict(), ensure_ascii=False))
    else:
        icon = '🔍' if report.dry_run else '✅'
        print(f'\n{icon} {report.target}: {report.summary()}')
        if report.failed:
            print(f'⚠️  не выложено файлов: {len(report.failed)}')
            for item in report.failed[:20]:
                print(f'   • {item}')
            if len(report.failed) > 20:
                print(f'   … и ещё {len(report.failed) - 20}')
    return 0 if report.ok() else 1


if __name__ == '__main__':
    sys.exit(main())
