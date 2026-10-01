-- Добавление полей мессенджеров и ОГРНИП для клиентов и контактов

-- Клиенты: ОГРНИП
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ogrnip VARCHAR(20);

-- Клиенты: мессенджеры
ALTER TABLE clients ADD COLUMN IF NOT EXISTS telegram VARCHAR(100);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS max_messenger VARCHAR(500);

-- Контакты: мессенджеры
ALTER TABLE client_contacts ADD COLUMN IF NOT EXISTS telegram VARCHAR(100);
ALTER TABLE client_contacts ADD COLUMN IF NOT EXISTS max_messenger VARCHAR(500);
