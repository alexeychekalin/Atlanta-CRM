#!/usr/bin/env python3
"""Выполнение команд на VPS по SSH-паролю (paramiko).

Песочница разработки не выпускает SSH-соединения (порт 22 закрыт для всех
хостов), поэтому развёртывание идёт с раннера GitHub Actions: он подключается
к серверу, заливает scripts/vps-provision.sh и запускает его.

Параметры берутся из окружения, чтобы не светиться в командной строке:

    VPS_HOST, VPS_USER, VPS_PASSWORD   — доступ
    VPS_SRC                            — локальный файл, который заливаем
    VPS_ARGS                           — переменные для удалённого скрипта
                                         (строка вида "BRANCH=x WITH_CATALOG=1")

Пароль нигде не печатается и не попадает в логи.
"""
import os
import posixpath
import sys

import paramiko

HOST = os.environ['VPS_HOST']
PORT = int(os.environ.get('VPS_PORT', '22'))
USER = os.environ['VPS_USER']
PASSWORD = os.environ['VPS_PASSWORD']
SRC = os.environ.get('VPS_SRC', '')
ARGS = os.environ.get('VPS_ARGS', '')
REMOTE = '/root/vps-provision.sh'


def connect():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=PORT, username=USER, password=PASSWORD,
                   timeout=30, banner_timeout=30, auth_timeout=30,
                   allow_agent=False, look_for_keys=False)
    client.get_transport().set_keepalive(30)
    return client


def main():
    client = connect()
    print(f'подключено: {USER}@{HOST}:{PORT}', flush=True)

    if SRC:
        sftp = client.open_sftp()
        sftp.put(SRC, REMOTE)
        sftp.chmod(REMOTE, 0o755)
        sftp.close()
        print(f'загружено: {SRC} → {REMOTE}', flush=True)

    command = f'bash {posixpath.basename(REMOTE)}' if SRC else ARGS
    full = f'export DEBIAN_FRONTEND=noninteractive; {ARGS} bash {REMOTE}' if ARGS else command

    channel = client.get_transport().open_session()
    channel.exec_command(full)
    exit_code = None
    while True:
        if channel.recv_ready():
            sys.stdout.write(channel.recv(65536).decode('utf-8', 'replace'))
            sys.stdout.flush()
        if channel.recv_stderr_ready():
            sys.stderr.write(channel.recv_stderr(65536).decode('utf-8', 'replace'))
            sys.stderr.flush()
        if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
            exit_code = channel.recv_exit_status()
            break

    client.close()
    print(f'\nкод выхода: {exit_code}', flush=True)
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
