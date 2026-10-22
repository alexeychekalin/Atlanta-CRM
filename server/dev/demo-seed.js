/* =============================================
   DEMO: реалистичные тестовые данные (только для локальной разработки)
   Запуск: node dev/demo-seed.js  (после demo-reset.js и migrate_roles.js)
   ============================================= */
const bcrypt = require('bcryptjs');
const db = require('../src/db');

const q = (sql, params) => db.query(sql, params);
const money = (n) => Math.round(n * 100) / 100;

async function seed() {
  await db.pglite.waitReady;

  // ---------- Уровни / статусы уже созданы schema.sql ----------
  const levels = (await q('SELECT id, code, markup_pct FROM client_pricing_levels')).rows;
  const statuses = (await q('SELECT id, name FROM client_work_statuses')).rows;
  const lvl = (code) => (levels.find(l => l.code === code) || {}).id || null;
  const st = (name) => (statuses.find(s => s.name === name) || {}).id || null;

  // ---------- Пользователи ----------
  const users = [
    ['admin', 'admin123', 'Администратор', 'admin'],
    ['manager', 'manager123', 'Менеджер по продажам', 'manager'],
    ['viewer', 'viewer123', 'Просмотр (только чтение)', 'viewer'],
  ];
  for (const [username, password, fullName, roleName] of users) {
    const roleId = (await q('SELECT id FROM roles WHERE name = $1', [roleName])).rows[0]?.id || null;
    const hash = await bcrypt.hash(password, 10);
    await q(
      `UPDATE users SET password_hash = $1, full_name = $2, role = $3, role_id = $4 WHERE username = $5`,
      [hash, fullName, roleName, roleId, username]
    );
    const exists = await q('SELECT id FROM users WHERE username = $1', [username]);
    if (exists.rows.length === 0) {
      await q(
        `INSERT INTO users (username, password_hash, full_name, role, role_id) VALUES ($1,$2,$3,$4,$5)`,
        [username, hash, fullName, roleName, roleId]
      );
    }
  }

  // ---------- Принципалы ----------
  const principals = [
    ['ООО «Атланта»', 10, '+7 (47472) 3-64-12', 'info@atlanta.ru', 'Основной принципал — производство'],
    ['ГК «СветоТех»', 12, '+7 (495) 220-10-40', 'sales@svetoteh.ru', 'Поставщик LED-оптики'],
    ['«АвтоЭлектроника Плюс»', 8, '+7 (812) 340-77-12', 'order@aep.spb.ru', 'Разъёмы, кабельная продукция'],
  ];
  for (const p of principals) {
    await q(`INSERT INTO principals (name, agent_commission_pct, phone, email, notes) VALUES ($1,$2,$3,$4,$5)`, p);
  }

  // ---------- Клиенты ----------
  const clients = [
    {
      name: 'ООО «ТрансПрицеп»', phone: '+7 (495) 741-22-08', email: 'buy@transpricep.ru',
      address: 'г. Москва, ул. Автозаводская, 23', status: 'Постоянный клиент', level: 'wholesale',
      inn: '7723456789', kpp: '772301001', ogrn: '1157746123456', director: 'Белов Андрей Викторович',
      legal: '115280, г. Москва, ул. Автозаводская, д. 23, оф. 512', client_type: 'ooo',
      bank_name: 'ПАО Сбербанк', bank_account: '40702810438000012345', bik: '044525225',
      corr: '30101810400000000225', telegram: '@transpricep', notes: 'Ключевой клиент, отсрочка 14 дней',
    },
    {
      name: 'ИП Смирнов Алексей Владимирович', phone: '+7 (4822) 55-13-90', email: 'smirnov.av@mail.ru',
      address: 'г. Тверь, пр-т Победы, 14', status: 'Покупки', level: 'retail',
      inn: '690500123456', ogrnip: '312690512300045', client_type: 'ip',
      legal: '170100, г. Тверь, пр-т Победы, д. 14', telegram: '@smirnov_parts',
      notes: 'Розничные заказы, самовывоз',
    },
    {
      name: 'АО «Спецтехника-Юг»', phone: '+7 (861) 210-44-77', email: 'info@specteh-yug.ru',
      address: 'г. Краснодар, ул. Уральская, 98/11', status: 'Переговоры', level: 'large_wholesale',
      inn: '2310123456', kpp: '231001001', ogrn: '1102310004321', director: 'Ковалёв Игорь Петрович',
      legal: '350000, г. Краснодар, ул. Уральская, д. 98/11', client_type: 'ooo',
      notes: 'Обсуждаем серию полуприцепов на 2027 год',
    },
    {
      name: 'ООО «ПрицепСервис»', phone: '+7 (343) 380-15-60', email: 'zakaz@pricep-service.ru',
      address: 'г. Екатеринбург, ул. Монтажников, 3', status: 'Согласование', level: 'wholesale',
      inn: '6659012345', kpp: '665901001', ogrn: '1146659012345', director: 'Морозова Елена Сергеевна',
      legal: '620141, г. Екатеринбург, ул. Монтажников, д. 3', client_type: 'ooo',
    },
    {
      name: 'ООО «АгроТрак»', phone: '+7 (473) 260-33-18', email: 'agro@agrotrak.ru',
      address: 'г. Воронеж, ул. Дорожная, 17', status: 'Новый', level: 'production',
      inn: '3666123456', kpp: '366601001', ogrn: '1203666001234', client_type: 'ooo',
    },
    {
      name: 'ИП Кузнецов Дмитрий Сергеевич', phone: '+7 (843) 570-88-21', email: 'kuznetsov.ds@bk.ru',
      address: 'г. Казань, ул. Технологическая, 8', status: 'Приостановлен', level: null,
      inn: '165500987654', ogrnip: '316169000123456', client_type: 'ip',
      notes: 'Приостановил закупки с августа 2026',
    },
  ];
  for (const c of clients) {
    await q(
      `INSERT INTO clients (name, phone, email, address, notes, status_id, pricing_level_id,
        inn, kpp, ogrn, ogrnip, director, legal_address, client_type, bank_name, bank_account, bik, corr_account, telegram)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [c.name, c.phone, c.email, c.address, c.notes || null, st(c.status), c.level ? lvl(c.level) : null,
       c.inn || null, c.kpp || null, c.ogrn || null, c.ogrnip || null, c.director || null,
       c.legal || null, c.client_type || 'ooo', c.bank_name || null, c.bank_account || null,
       c.bik || null, c.corr || null, c.telegram || null]
    );
  }
  const clientRows = (await q('SELECT id, name FROM clients ORDER BY id')).rows;
  const clientId = (i) => clientRows[i - 1].id;

  // ---------- Категории компонентов ----------
  const cats = (await q('SELECT id, name, sort_order FROM component_categories ORDER BY sort_order')).rows;
  const catId = (i) => cats[i - 1].id;

  // ---------- Компоненты ----------
  const components = [
    ['БК-101', 'Блок коммутации 12В, 8 каналов', 1850, 1, 'Блок коммутации для прицепов 12В'],
    ['БК-102', 'Блок коммутации 24В, 8 каналов', 2150, 1, 'Блок коммутации для прицепов 24В'],
    ['ГФ-201', 'Фонарь габаритный боковой 12В', 640, 2, 'Оранжевый, 2 диода'],
    ['ГФ-202', 'Фонарь габаритный боковой 24В', 720, 2, 'Оранжевый, 3 диода'],
    ['ГФ-301', 'Фонарь габаритный задний 12В', 980, 3, 'Красный, 5 диодов'],
    ['ГФ-302', 'Фонарь габаритный задний 24В', 1120, 3, 'Красный, 6 диодов'],
    ['НЗ-401', 'Фонарь освещения номерного знака 12В', 380, 4, 'Белый, с кронштейном'],
    ['НЗ-402', 'Фонарь освещения номерного знака 24В', 420, 4, 'Белый, с кронштейном'],
    ['КМ-501', 'Кабель монтажный 5 м, 7 жил', 320, 1, 'Медный, ПВХ изоляция'],
    ['КМ-503', 'Кабель монтажный 10 м, 7 жил', 540, 1, 'Медный, ПВХ изоляция'],
    ['РЗ-601', 'Разъём герметичный 2-pin', 120, 1, 'IP67'],
    ['РЗ-602', 'Разъём герметичный 4-pin', 180, 1, 'IP67'],
  ];
  for (const c of components) {
    await q(
      `INSERT INTO components (article, name, price, category_id, description, gisp_url)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [c[0], c[1], c[2], catId(c[3]), c[4], null]
    );
  }
  const compRows = (await q('SELECT id, article, name, price FROM components ORDER BY id')).rows;
  const comp = (article) => compRows.find(c => c.article === article);

  // ---------- Модификации ----------
  const mods = [
    ['ГФ-301', 'LED', 'LED-версия, 7 диодов', 180],
    ['ГФ-301', 'EURO', 'Евро-разъём, 5 диодов', 90],
    ['ГФ-302', 'LED', 'LED-версия, 8 диодов', 220],
    ['БК-102', 'CAN', 'С CAN-шиной', 640],
  ];
  for (const m of mods) {
    const c = comp(m[0]);
    await q(
      `INSERT INTO component_modifications (component_id, code, name, price_override)
       VALUES ($1,$2,$3,$4)`,
      [c.id, m[1], m[2], m[3]]
    );
  }

  // ---------- Чертежи (BOM) ----------
  const drawings = [
    {
      name: 'Полуприцеп 9.5 м — комплект освещения 24В', client: 1,
      desc: 'Базовый комплект: блок коммутации, боковые и задние фонари, номерной фонарь',
      items: [['БК-102', 1, 0, 0], ['ГФ-202', 6, 5, 0], ['ГФ-302', 4, 5, 0], ['НЗ-402', 1, 0, 0], ['КМ-503', 2, 0, 0], ['РЗ-601', 6, 0, 0]],
    },
    {
      name: 'Прицеп бортовой 5 м — комплект 12В', client: 2,
      desc: 'Комплект для лёгкого прицепа',
      items: [['БК-101', 1, 0, 0], ['ГФ-201', 4, 10, 0], ['ГФ-301', 2, 10, 0], ['НЗ-401', 1, 0, 0], ['КМ-501', 1, 0, 0], ['РЗ-601', 4, 0, 0]],
    },
    {
      name: 'Самосвал 12 м³ — усиленный комплект', client: 3,
      desc: 'Повышенная видимость, LED-модификации',
      items: [['БК-102', 1, 0, 0], ['ГФ-302', 4, 8, 0], ['ГФ-302', 2, 8, 0], ['НЗ-402', 2, 0, 0], ['КМ-503', 3, 0, 0], ['РЗ-602', 8, 0, 0]],
    },
    {
      name: 'Комплект освещения 24В (фикс. цена)', client: 4,
      desc: 'Согласованный комплект без детализации BOM',
      fixed: 48500, items: [],
    },
    {
      name: 'Прицеп-цистерна 30 м³ — комплект', client: 1,
      desc: 'Взрывозащищённое исполнение, согласовано с технологом',
      items: [['БК-102', 2, 0, 0], ['ГФ-202', 8, 5, 0], ['ГФ-302', 6, 5, 0], ['НЗ-402', 2, 0, 0], ['КМ-503', 4, 0, 0], ['РЗ-602', 10, 0, 0]],
    },
  ];
  const drawingIds = [];
  for (const d of drawings) {
    const res = await q(
      `INSERT INTO drawings (name, description, client_id, fixed_price, created_by, created_at)
       VALUES ($1,$2,$3,$4,1, now() - ($5::int * interval '1 day')) RETURNING id`,
      [d.name, d.desc, clientId(d.client), d.fixed || null, Math.floor(Math.random() * 90) + 5]
    );
    const id = res.rows[0].id;
    drawingIds.push({ id, ...d });
    if (d.client) {
      // Чертёж привязан к клиенту (общий BOM может быть у нескольких клиентов)
      await q(
        `INSERT INTO drawing_clients (drawing_id, client_id) VALUES ($1, $2)
         ON CONFLICT (drawing_id, client_id) DO NOTHING`,
        [id, clientId(d.client)]
      );
    }
    for (const it of d.items) {
      const compRow = comp(it[0]);
      await q(
        `INSERT INTO drawing_components (drawing_id, component_id, quantity, item_markup_pct, item_markup_rub)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, compRow.id, it[1], it[2], it[3]]
      );
    }
  }

  // ---------- Заказы ----------
  const price = (article) => parseFloat(comp(article).price);

  // Заказ из чертежа: считаем по BOM с наценками
  function calcDrawing(drawing) {
    if (drawing.fixed) {
      return {
        grand_total: drawing.fixed,
        metadata: { type: 'calculator_fixed_price', fixed_price: drawing.fixed, grand_total: drawing.fixed },
      };
    }
    let componentsTotal = 0, itemMarkupsTotal = 0;
    const comps = drawing.items.map(([article, qty, pct, rub]) => {
      const base = price(article) * qty;
      const mPct = base * pct / 100;
      const lineTotal = base + mPct + rub;
      componentsTotal += base;
      itemMarkupsTotal += mPct + rub;
      return {
        name: comp(article).name, article, price: price(article), quantity: qty,
        base_total: base, markup_pct: pct, markup_rub: rub,
        markup_pct_amount: money(mPct), line_total: money(lineTotal),
      };
    });
    const grandTotal = money(componentsTotal + itemMarkupsTotal);
    return {
      grand_total: grandTotal,
      metadata: {
        type: 'calculator_drawing', components: comps,
        components_total: money(componentsTotal), item_markups_total: money(itemMarkupsTotal),
        global_markup_pct: 0, global_markup_rub: 0, global_markup_pct_amount: 0,
        grand_total: grandTotal,
      },
    };
  }

  const orderPlan = [
    { client: 1, principal: 1, drawing: 0, date: '2026-04-14', status: 'completed', paid: '2026-04-22', invoice: 'СЧ-2026-041' },
    { client: 2, principal: 1, drawing: 1, date: '2026-05-06', status: 'completed', paid: '2026-05-12', invoice: 'СЧ-2026-058' },
    { client: 3, principal: 2, drawing: 2, date: '2026-06-02', status: 'cancelled', invoice: 'СЧ-2026-073' },
    { client: 4, principal: 2, drawing: 3, date: '2026-06-19', status: 'completed', paid: '2026-06-27', invoice: 'СЧ-2026-081' },
    { client: 1, principal: 1, drawing: 4, date: '2026-07-08', status: 'completed', paid: '2026-07-20', invoice: 'СЧ-2026-094', tracking: 'DPL-4471-880' },
    { client: 5, principal: 3, drawing: 1, date: '2026-07-21', status: 'paid', paid: '2026-07-29', invoice: 'СЧ-2026-102' },
    { client: 2, principal: 1, drawing: 1, date: '2026-08-11', status: 'completed', paid: '2026-08-19', invoice: 'СЧ-2026-118' },
    { client: 1, principal: 1, drawing: 4, date: '2026-08-28', status: 'in_progress', invoice: 'СЧ-2026-131', tracking: 'DPL-5520-114' },
    { client: 4, principal: 2, drawing: 0, date: '2026-09-09', status: 'in_progress', invoice: 'СЧ-2026-140' },
    { client: 3, principal: 2, drawing: 2, date: '2026-09-24', status: 'paid', paid: '2026-10-02', invoice: 'СЧ-2026-152' },
    { client: 5, principal: 3, drawing: 1, date: '2026-10-06', status: 'new', invoice: 'СЧ-2026-163' },
    { client: 1, principal: 1, drawing: 0, date: '2026-10-16', status: 'new', invoice: 'СЧ-2026-171' },
  ];

  let orderNo = 1;
  for (const o of orderPlan) {
    const drawing = drawings[o.drawing];
    const calc = calcDrawing(drawing);
    const commPct = [10, 12, 8][o.principal - 1];
    const subtotal = calc.grand_total;
    const commission = money(subtotal * commPct / 100);
    const orderNumber = `ORD-${String(orderNo).padStart(4, '0')}`;
    orderNo++;

    const res = await q(
      `INSERT INTO orders (order_number, client_id, principal_id, order_date, status, subtotal, commission_pct,
        commission_amount, total, comment, invoice_number, payment_date, tracking_number, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,$14) RETURNING id`,
      [orderNumber, clientId(o.client), o.principal, o.date, o.status, subtotal, commPct, commission, subtotal,
       `Комплект: ${drawing.name}`, o.invoice || null, o.paid || null, o.tracking || null, o.date]
    );
    const orderId = res.rows[0].id;
    await q(
      `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [orderId, null, drawing.name, subtotal, 1, subtotal, JSON.stringify(calc.metadata)]
    );

    // Таймлайн по клиенту
    await q(
      `INSERT INTO client_timeline (client_id, event_type, title, description, event_date, created_by)
       VALUES ($1,'order',$2,$3,$4,1)`,
      [clientId(o.client), `Заказ ${orderNumber}`, `${drawing.name} — ${subtotal.toLocaleString('ru-RU')} ₽`, o.date]
    );
  }

  // ---------- Коммерческие предложения ----------
  const proposalPlan = [
    { client: 3, principal: 1, status: 'sent', valid: '2026-11-15', drawing: 2, comment: 'Предложение на серию из 12 комплектов' },
    { client: 1, principal: 1, status: 'accepted', valid: '2026-10-30', drawing: 4, comment: 'Согласовано, переводим в заказ' },
    { client: 5, principal: 3, status: 'draft', valid: '2026-11-30', drawing: 1, comment: 'Черновик — уточнить сроки поставки' },
  ];
  let proposalNo = 1;
  for (const p of proposalPlan) {
    const drawing = drawings[p.drawing];
    const calc = calcDrawing(drawing);
    const number = `КП-${String(proposalNo++).padStart(4, '0')}`;
    const res = await q(
      `INSERT INTO proposals (proposal_number, client_id, principal_id, status, valid_until, comment, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,1, now() - ($7::int * interval '1 day')) RETURNING id`,
      [number, clientId(p.client), p.principal, p.status, p.valid, p.comment, proposalNo * 7]
    );
    await q(
      `INSERT INTO proposal_items (proposal_id, product_name, description, unit_price, quantity, line_total, is_drawing, drawing_id)
       VALUES ($1,$2,$3,$4,1,$4,true,$5)`,
      [res.rows[0].id, drawing.name, drawing.desc, calc.grand_total, drawingIds[p.drawing].id]
    );
  }

  // ---------- Производители и оборудование ----------
  const manufacturers = [
    ['ООО «ФОНАРЬ»', 'г. Брянск, ул. Промышленная, 12', 'https://fonar32.ru', '+7 (4832) 30-11-22', 'sales@fonar32.ru', 'Россия', 'Производитель светотехники для прицепов'],
    ['TruckLight GmbH', 'Hamburg, Industriestrasse 8', 'https://trucklight.de', '+49 40 5566 7788', 'info@trucklight.de', 'Германия', 'Европейская светотехника и разъёмы'],
  ];
  for (const m of manufacturers) {
    await q(
      `INSERT INTO manufacturers (name, address, website, phone, email, country, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`, m
    );
  }
  const mfrs = (await q('SELECT id, name FROM manufacturers ORDER BY id')).rows;
  const eqTypes = (await q('SELECT id, name FROM equipment_types ORDER BY sort_order')).rows;

  const products = [
    [mfrs[0].id, eqTypes[0].id, 'Комплект освещения полуприцепа 24В', 'TL-24-PRO', 'Полный комплект для полуприцепа', drawingIds[0].id],
    [mfrs[1].id, eqTypes[0].id, 'LED-модуль заднего фонаря', 'TL-LED-900', 'Модуль 900 люмен, 24В', null],
    [mfrs[0].id, eqTypes[1].id, 'Комплект освещения лёгкого прицепа 12В', 'TL-12-LITE', 'Для прицепов до 750 кг', drawingIds[1].id],
    [mfrs[0].id, eqTypes[2].id, 'Комплект освещения сельхозтехники', 'AGRO-24', 'Усиленный, для работы в поле', null],
  ];
  for (const p of products) {
    await q(
      `INSERT INTO manufacturer_products (manufacturer_id, equipment_type_id, name, model, description, drawing_id)
       VALUES ($1,$2,$3,$4,$5,$6)`, p
    );
  }

  // ---------- Контакты клиентов ----------
  await q(
    `INSERT INTO client_contacts (client_id, full_name, position, email, phone, notes, telegram)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [clientId(1), 'Белов Андрей Викторович', 'Генеральный директор', 'belov@transpricep.ru', '+7 (495) 741-22-08', 'Подписант', null]
  );
  await q(
    `INSERT INTO client_contacts (client_id, full_name, position, email, phone, notes, telegram)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [clientId(1), 'Орлова Мария Игоревна', 'Менеджер по закупкам', 'orlova@transpricep.ru', '+7 (495) 741-22-15', 'Рабочие вопросы по заказам', '@orlova_m']
  );
  await q(
    `INSERT INTO client_contacts (client_id, full_name, position, email, phone, notes, telegram)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [clientId(2), 'Смирнов Алексей Владимирович', 'ИП', 'smirnov.av@mail.ru', '+7 (4822) 55-13-90', null, '@smirnov_parts']
  );

  // ---------- Таймлайн ----------
  const timeline = [
    [1, 'call', 'Звонок по заказу ORD-0012', 'Обсудили сроки поставки, клиент просит до 25.10', '2026-10-17'],
    [1, 'payment', 'Оплата по счёту СЧ-2026-094', 'Поступило 100% оплаты', '2026-07-20'],
    [1, 'price_change', 'Согласована наценка 5% на фонари', 'Для уровня «Опт»', '2026-08-05'],
    [2, 'negotiation', 'Запрос на розничный комплект', 'Прицеп 5 м, нужен комплект 12В', '2026-05-04'],
    [2, 'payment', 'Оплата по счёту СЧ-2026-118', 'Поступило 100% оплаты', '2026-08-19'],
    [3, 'negotiation', 'Переговоры по серии на 2027', 'Обсуждаем 12 комплектов, скидка 5%', '2026-09-26'],
    [3, 'issue', 'Отменён заказ ORD-0003', 'Клиент изменил техническое задание', '2026-06-10'],
    [4, 'document', 'Получены реквизиты для договора', 'Карточка клиента заполнена', '2026-06-16'],
    [5, 'note', 'Первый контакт', 'Клиент найден на выставке «Транспорт-2026»', '2026-07-15'],
    [6, 'deferral', 'Отсрочка закупок', 'Клиент приостановил закупки до 2027 года', '2026-08-22'],
  ];
  for (const t of timeline) {
    await q(
      `INSERT INTO client_timeline (client_id, event_type, title, description, event_date, created_by)
       VALUES ($1,$2,$3,$4,$5,1)`, [clientId(t[0]), t[1], t[2], t[3], t[4]]
    );
  }

  // ---------- Согласование чертежа (без файлов) ----------
  const appr = await q(
    `INSERT INTO drawing_approvals (client_id, title, description, status, created_by)
     VALUES ($1,$2,$3,'waiting',1) RETURNING id`,
    [clientId(3), 'Согласование комплекта самосвала 12 м³', 'Ждём подтверждение от технического отдела клиента']
  );
  await q(
    `INSERT INTO drawing_approval_comments (approval_id, user_id, text) VALUES ($1,1,$2)`,
    [appr.rows[0].id, 'Отправили комплект на согласование 20.10.2026']
  );

  // ---------- Настройки ----------
  await q(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ('vat', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ enabled: true, rate: 22 })]
  );

  const counts = await q(`SELECT
      (SELECT count(*)::int FROM clients) clients,
      (SELECT count(*)::int FROM components) components,
      (SELECT count(*)::int FROM drawings) drawings,
      (SELECT count(*)::int FROM orders) orders,
      (SELECT count(*)::int FROM proposals) proposals,
      (SELECT count(*)::int FROM roles) roles`);
  console.log('✅ Демо-данные созданы:', counts.rows[0]);
  await db.close();
}

seed().catch(err => { console.error('❌ Ошибка демо-сида:', err); process.exit(1); });
