-- SEC-08: версия токена — сброс всех сессий пользователя при смене пароля
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
