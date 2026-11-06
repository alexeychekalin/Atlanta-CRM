#!/usr/bin/env python3
"""Мост к VPS по SSH-паролю (paramiko) для развёртывания CRM.

Песочница разработки не выпускает SSH-соединения (порт 22 закрыт для всех
хостов), поэтому к серверу ходит раннер GitHub Actions.

Установка долгая (apt, PostgreSQL, npm, каталог), а соединение живёт не дольше
шага workflow, поэтому работа запускается **отвязанной**: скрипт стартует через
setsid с собственным логом, а состояние забирается короткими запросами.

Режимы (VPS_MODE):
  run    — залить скрипт и запустить его в фоне, вернуть управление
  poll   — допечатать новые строки журнала; код 0 — работа закончена,
           3 — ещё идёт
  status — только журнал, без ожидания

Параметры из окружения: VPS_HOST, VPS_USER, VPS_PASSWORD, VPS_ARGS,
VPS_SRC, VPS_LOG (локальная копия журнала).
"""
import os
import pathlib
import sys
import time
import traceback

import paramiko

HOST = os.environ['VPS_HOST']
PORT = int(os.environ.get('VPS_PORT', '22'))
USER = os.environ['VPS_USER']
PASSWORD = os.environ['VPS_PASSWORD']
MODE = os.environ.get('VPS_MODE', 'run')
PORTS = [int(p) for p in os.environ.get('VPS_PORTS', str(PORT)).replace(',', ' ').split()]
SRC = os.environ.get('VPS_SRC', '')
ARGS = os.environ.get('VPS_ARGS', '')

REMOTE = '/root/vps-provision.sh'
REMOTE_LOG = '/root/vps-provision.log'
REMOTE_OFFSET = '/root/vps-provision.offset'
REMOTE_PID = '/root/vps-provision.pid'
MARKER = '__PROVISION_DONE__'
LOCAL_LOG = pathlib.Path(os.environ.get('VPS_LOG', '/tmp/vps-deploy.log'))


def emit(text):
    sys.stdout.write(text)
    sys.stdout.flush()
    with LOCAL_LOG.open('a', encoding='utf-8') as handle:
        handle.write(text)


def probe():
    """Проверить, на каких портах сервер отвечает баннером и пускает по паролю."""
    import socket
    for port in PORTS:
        try:
            sock = socket.create_connection((HOST, port), timeout=10)
            sock.settimeout(10)
            banner = sock.recv(128)
            sock.close()
        except Exception as error:                       # noqa: BLE001
            emit(f'  {port}: {error}\n')
            continue
        emit(f'  {port}: баннер {banner[:40]!r}\n')
        if not banner:
            continue
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            client.connect(HOST, port=port, username=USER, password=PASSWORD,
                           timeout=20, banner_timeout=30, auth_timeout=30,
                           allow_agent=False, look_for_keys=False)
        except Exception as error:                       # noqa: BLE001
            emit(f'  {port}: вход не удался — {error}\n')
            continue
        code, out, _ = execute(client, 'hostname; uptime; free -m | head -2; df -h / | tail -1')
        emit(f'  {port}: вход ок\n{out}\n')
        client.close()
        return 0
    return 1


def connect(attempts=6, pause=25):
    """Нагруженный сервер рвёт handshake — пробуем несколько раз с паузой."""
    last = None
    for attempt in range(1, attempts + 1):
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            client.connect(HOST, port=PORT, username=USER, password=PASSWORD,
                           timeout=30, banner_timeout=45, auth_timeout=45,
                           allow_agent=False, look_for_keys=False)
            client.get_transport().set_keepalive(30)
            return client
        except paramiko.AuthenticationException:
            client.close()
            raise                                    # пароль не тот — повторять нет смысла
        except Exception as error:                   # noqa: BLE001
            last = error
            client.close()
            emit(f'попытка {attempt}/{attempts}: {error}\n')
            if attempt < attempts:
                time.sleep(pause)
    raise last


def execute(client, command, timeout=120):
    channel = client.get_transport().open_session()
    channel.settimeout(timeout)
    channel.exec_command(command)
    out, err = [], []
    while True:
        if channel.recv_ready():
            out.append(channel.recv(65536).decode('utf-8', 'replace'))
        if channel.recv_stderr_ready():
            err.append(channel.recv_stderr(65536).decode('utf-8', 'replace'))
        if channel.exit_status_ready() and not channel.recv_ready() \
                and not channel.recv_stderr_ready():
            break
    return channel.recv_exit_status(), ''.join(out), ''.join(err)


def launch(client):
    sftp = client.open_sftp()
    sftp.put(SRC, REMOTE)
    sftp.chmod(REMOTE, 0o755)
    sftp.close()

    # setsid + nohup: процесс живёт после закрытия канала и не получает SIGHUP,
    # когда раннер закончит шаг. Журнал — свой, прогресс — в отдельном файле.
    command = (
        f'if [ -f {REMOTE_PID} ]; then kill -TERM -"$(cat {REMOTE_PID})" 2>/dev/null || true; sleep 1; fi; '
        f'pkill -f "bash {REMOTE}" 2>/dev/null || true; '
        f'rm -f {REMOTE_LOG} {REMOTE_OFFSET} {REMOTE_PID}; '
        f'cd /root && '
        f'setsid nohup env {ARGS} bash {REMOTE} </dev/null '
        f'>{REMOTE_LOG}.boot 2>&1 & '
        f'echo $! > {REMOTE_PID}; sleep 2; cat {REMOTE_PID}'
    )
    code, out, err = execute(client, command, timeout=90)
    emit(f'запущено на {HOST}, pid {out.strip() or "?"}\n')
    if err.strip():
        emit(err)
    return 0 if code == 0 else 1


def poll(client, wait=False):
    command = (
        f'touch {REMOTE_LOG}; '
        f'[ -f {REMOTE_OFFSET} ] || echo 0 > {REMOTE_OFFSET}; '
        f'off=$(cat {REMOTE_OFFSET}); size=$(stat -c%s {REMOTE_LOG}); '
        f'if [ "$size" -gt "$off" ]; then tail -c +$((off+1)) {REMOTE_LOG}; fi; '
        f'echo "$size" > {REMOTE_OFFSET}; '
        f'if grep -q {MARKER} {REMOTE_LOG}; then '
        f'  echo; grep -o "{MARKER} [0-9]*" {REMOTE_LOG} | tail -1; exit 0; fi; '
        f'exit 3'
    )
    code, out, err = execute(client, command, timeout=120)
    emit(out)
    if err.strip():
        emit(err)
    return code


def main():
    if MODE == 'run':
        LOCAL_LOG.write_text('', encoding='utf-8')
    if MODE == 'probe':
        try:
            return probe()
        except Exception as error:                       # noqa: BLE001
            emit(f'\nошибка проверки: {error}\n')
            return 1
    try:
        client = connect()
        emit(f'подключено: {USER}@{HOST}:{PORT}\n')
        if MODE == 'run':
            result = launch(client)
        else:
            result = poll(client)
        client.close()
        return result
    except Exception as error:                            # noqa: BLE001 — журнал важнее
        text = f'\nошибка SSH: {error}\n' + traceback.format_exc()
        print(text, file=sys.stderr)
        with LOCAL_LOG.open('a', encoding='utf-8') as handle:
            handle.write(text)
        return 1


if __name__ == '__main__':
    sys.exit(main())
