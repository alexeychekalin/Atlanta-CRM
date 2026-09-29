-- Добавление полей мессенджеров для клиентов и контактов

-- Клиенты
ALTER TABLE clients ADD COLUMN IF NOT EXISTS telegram VARCHAR(100);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS max_messenger VARCHAR(500);

-- Контакты
ALTER TABLE client_contacts ADD COLUMN IF NOT EXISTS telegram VARCHAR(100);
ALTER TABLE client_contacts ADD COLUMN IF NOT EXISTS max_messenger VARCHAR(500);
