require('dotenv').config();
const db = require('../db');

async function migrate() {
  console.log('🔄 Запуск миграции ролевой модели...');

  try {
    // 1. Создание таблицы roles
    await db.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        display_name VARCHAR(150) NOT NULL,
        description TEXT,
        is_system BOOLEAN DEFAULT false,
        permissions JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP DEFAULT now()
      );
    `);
    console.log('✅ Таблица roles проверена/создана');

    // 2. Добавление role_id в users если нет и расширение role
    await db.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS role_id INT REFERENCES roles(id) ON DELETE SET NULL;
      ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(100);
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
    `);
    console.log('✅ Поле users.role_id и тип users.role проверены/обновлены');

    // 3. Базовые роли
    const defaultRoles = [
      {
        name: 'admin',
        display_name: 'Администратор',
        description: 'Полный доступ ко всем разделам системы, управлению ролями, пользователями и настройкам',
        is_system: true,
        permissions: {
          dashboard: { view: true },
          orders: { view: true, edit: true, delete: true },
          clients: { view: true, edit: true, delete: true },
          calculator: { view: true, edit: true },
          drawings: { view: true, edit: true, delete: true },
          components: { view: true, edit: true, delete: true },
          reports: { view: true, export: true },
          settings: { view: true, edit: true },
        },
      },
      {
        name: 'manager',
        display_name: 'Менеджер по продажам',
        description: 'Работа с заказами, клиентами, расчетами чертежей и отчетами',
        is_system: false,
        permissions: {
          dashboard: { view: true },
          orders: { view: true, edit: true, delete: false },
          clients: { view: true, edit: true, delete: false },
          calculator: { view: true, edit: true },
          drawings: { view: true, edit: true, delete: false },
          components: { view: true, edit: false, delete: false },
          reports: { view: true, export: true },
          settings: { view: false, edit: false },
        },
      },
      {
        name: 'technologist',
        display_name: 'Инженер-конструктор',
        description: 'Расчет чертежей, управление спецификациями и каталогом компонентов',
        is_system: false,
        permissions: {
          dashboard: { view: true },
          orders: { view: true, edit: false, delete: false },
          clients: { view: true, edit: false, delete: false },
          calculator: { view: true, edit: true },
          drawings: { view: true, edit: true, delete: true },
          components: { view: true, edit: true, delete: true },
          reports: { view: false, export: false },
          settings: { view: false, edit: false },
        },
      },
      {
        name: 'viewer',
        display_name: 'Наблюдатель',
        description: 'Просмотр данных без права изменения и удаления',
        is_system: false,
        permissions: {
          dashboard: { view: true },
          orders: { view: true, edit: false, delete: false },
          clients: { view: true, edit: false, delete: false },
          calculator: { view: true, edit: false },
          drawings: { view: true, edit: false, delete: false },
          components: { view: true, edit: false, delete: false },
          reports: { view: true, export: true },
          settings: { view: false, edit: false },
        },
      },
    ];

    for (const r of defaultRoles) {
      await db.query(`
        INSERT INTO roles (name, display_name, description, is_system, permissions)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (name) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          is_system = EXCLUDED.is_system,
          description = EXCLUDED.description;
      `, [r.name, r.display_name, r.description, r.is_system, JSON.stringify(r.permissions)]);
    }
    console.log('✅ Базовые роли заполнены/обновлены');

    // 4. Привязка существующих пользователей к ролям
    await db.query(`
      UPDATE users u
      SET role_id = r.id
      FROM roles r
      WHERE u.role = r.name AND (u.role_id IS NULL OR u.role_id != r.id);
    `);
    console.log('✅ Существующие пользователи привязаны к roles.id');

    console.log('🎉 Миграция успешно завершена!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Ошибка миграции:', err);
    process.exit(1);
  }
}

migrate();
