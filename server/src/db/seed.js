require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../db');

async function seed() {
  console.log('🚀 Инициализация базы данных...\n');

  try {
    // Выполнить schema.sql
    const schemaSQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await db.query(schemaSQL);
    console.log('✅ Таблицы созданы');

    // Создать администратора
    const passwordHash = await bcrypt.hash('admin123', 10);
    await db.query(
      `INSERT INTO users (username, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO NOTHING`,
      ['admin', passwordHash, 'Администратор', 'admin']
    );
    console.log('✅ Пользователь admin создан (пароль: admin123)');

    // Создать пользователя-просмотрщика
    const viewerHash = await bcrypt.hash('viewer123', 10);
    await db.query(
      `INSERT INTO users (username, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO NOTHING`,
      ['viewer', viewerHash, 'Просмотр', 'viewer']
    );
    console.log('✅ Пользователь viewer создан (пароль: viewer123)');

    // Создать принципала «Атланта»
    await db.query(
      `INSERT INTO principals (name, agent_commission_pct, phone, email, notes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      ['Атланта', 10.00, '+7 (999) 123-45-67', 'info@atlanta.ru', 'Основной принципал']
    );
    console.log('✅ Принципал «Атланта» создан (комиссия 10%)');

    // Тестовые клиенты
    const clients = [
      ['ООО «Меридиан»', '+7 (495) 111-22-33', 'meridian@mail.ru', 'г. Москва, ул. Ленина, 15', ''],
      ['ИП Петров А.С.', '+7 (812) 444-55-66', 'petrov@gmail.com', 'г. Санкт-Петербург, пр. Невский, 42', 'VIP клиент'],
      ['ЗАО «Сибирь»', '+7 (383) 777-88-99', 'siberia@yandex.ru', 'г. Новосибирск, ул. Красная, 7', ''],
    ];
    for (const c of clients) {
      await db.query(
        `INSERT INTO clients (name, phone, email, address, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        c
      );
    }
    console.log('✅ Тестовые клиенты созданы (3 шт.)');

    // Тестовые товары
    const products = [
      ['Консультация (1 час)', 5000.00, 'час', 'Консультационные услуги', true],
      ['Разработка сайта', 150000.00, 'проект', 'Создание сайта под ключ', true],
      ['Техническая поддержка', 25000.00, 'мес.', 'Ежемесячная техподдержка', true],
      ['Дизайн логотипа', 30000.00, 'шт.', 'Разработка фирменного логотипа', true],
      ['SEO-продвижение', 40000.00, 'мес.', 'Комплексное SEO-продвижение', true],
    ];
    for (const p of products) {
      await db.query(
        `INSERT INTO products (name, base_price, unit, description, is_active)
         VALUES ($1, $2, $3, $4, $5)`,
        p
      );
    }
    console.log('✅ Тестовые товары/услуги созданы (5 шт.)');

    // Тестовые заказы
    const orderData = [
      { clientId: 1, principalId: 1, status: 'completed', date: '2024-07-10', items: [{ productId: 1, name: 'Консультация (1 час)', price: 5000, qty: 3 }, { productId: 2, name: 'Разработка сайта', price: 150000, qty: 1 }] },
      { clientId: 2, principalId: 1, status: 'paid', date: '2024-07-25', items: [{ productId: 3, name: 'Техническая поддержка', price: 25000, qty: 6 }] },
      { clientId: 3, principalId: 1, status: 'in_progress', date: '2024-08-01', items: [{ productId: 4, name: 'Дизайн логотипа', price: 30000, qty: 1 }, { productId: 5, name: 'SEO-продвижение', price: 40000, qty: 3 }] },
      { clientId: 1, principalId: 1, status: 'new', date: '2024-08-10', items: [{ productId: 2, name: 'Разработка сайта', price: 150000, qty: 1 }] },
    ];

    let orderNum = 1;
    for (const o of orderData) {
      const subtotal = o.items.reduce((sum, item) => sum + item.price * item.qty, 0);
      const commPct = 10;
      // Комиссия уже заложена в цену — выделяем из суммы, итого = сумма
      const commAmount = subtotal * commPct / 100;
      const total = subtotal;

      const res = await db.query(
        `INSERT INTO orders (order_number, client_id, principal_id, order_date, status, subtotal, commission_pct, commission_amount, total, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [`ORD-${String(orderNum).padStart(4, '0')}`, o.clientId, o.principalId, o.date, o.status, subtotal, commPct, commAmount, total, 1]
      );
      const orderId = res.rows[0].id;

      for (const item of o.items) {
        await db.query(
          `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [orderId, item.productId, item.name, item.price, item.qty, item.price * item.qty]
        );
      }
      orderNum++;
    }
    console.log('✅ Тестовые заказы созданы (4 шт.)');

    console.log('\n🎉 Инициализация завершена!');
    console.log('   Вход: admin / admin123');
    console.log('   Просмотр: viewer / viewer123');
    process.exit(0);
  } catch (err) {
    console.error('❌ Ошибка инициализации:', err.message);
    process.exit(1);
  }
}

seed();
