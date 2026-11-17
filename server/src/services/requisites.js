/**
 * Реквизиты клиента для документов: карточка предприятия, DOCX, письма.
 *
 * Один источник данных — строка clients в базе. Функции чистые (никакой БД),
 * поэтому их удобно проверять тестами и переиспользовать: сейчас — выгрузка
 * в Word, дальше при необходимости — счёт, договор, письмо.
 *
 * Правила:
 *   • пустые поля не попадают в документ — в карточке их может не быть;
 *   • реквизиты берутся из полей, а не из примечаний: примечание — заметка
 *     менеджера, в документе ему места нет;
 *   • у ИП нет КПП, вместо ОГРН — ОГРНИП, руководитель — сам предприниматель.
 */

/** Поля карточки, которые могут быть пустыми: null/undefined и пробелы — пусто. */
function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

/** ИП определяем по типу, а если он не заполнен — по составу реквизитов. */
function isIp(client = {}) {
  if (client.client_type === 'ip') return true;
  if (client.client_type === 'ooo') return false;
  return Boolean(text(client.ogrnip)) && !text(client.kpp);
}

/**
 * Названия организации для шапки документа.
 * full — как в договоре, short — как в обиходе (если отличается).
 */
function officeTitle(client = {}) {
  const name = text(client.name);
  const fullName = text(client.full_name);
  const ip = isIp(client);

  let full = fullName || name;
  // В карточке РУАТ полное имя латиницей только в full_name_en — его не берём.
  if (!full && ip) full = `Индивидуальный предприниматель ${name}`.trim();

  const short = name && name !== full ? name : '';
  return { full, short };
}

/** «ИНН / КПП» одной строкой — так это печатают в карточках предприятий. */
function innRow(client, ip) {
  const inn = text(client.inn);
  const kpp = ip ? '' : text(client.kpp);
  if (inn && kpp) return `${inn} / ${kpp}`;
  return inn || kpp;
}

/**
 * Строки таблицы реквизитов: [{ label, value }] в порядке печатной карточки.
 * Значения могут быть многострочными (bank_details) — переносы сохраняем.
 */
function clientRequisites(client = {}) {
  const ip = isIp(client);
  const rows = [];
  const push = (label, value) => {
    const prepared = String(value ?? '')
      .split('\n')
      .map(line => text(line))
      .filter(Boolean)
      .join('\n');
    if (prepared) rows.push({ label, value: prepared });
  };

  push('ИНН / КПП', innRow(client, ip));
  push('ОГРН', ip ? '' : client.ogrn);
  push('ОГРНИП', ip ? client.ogrnip : '');
  push('ОКПО', client.okpo);
  push('ОКВЭД', client.okved);

  const legal = text(client.legal_address) || text(client.address);
  const actual = text(client.address);
  push('Юридический адрес', legal);
  push('Почтовый адрес', client.postal_address);
  if (actual && actual !== legal) push('Фактический адрес', actual);

  push('Банк', client.bank_name);
  push('Расчётный счёт', client.bank_account);
  push('Корреспондентский счёт', client.corr_account);
  push('БИК', client.bik);

  push('Телефон', client.phone);
  push('E-mail', client.email);
  push('Сайт', client.site);

  const director = text(client.director);
  const position = text(client.director_position) || (ip ? 'Индивидуальный предприниматель' : 'Руководитель');
  const basis = text(client.director_basis);
  if (director) {
    const basisText = basis ? `, действует на основании ${basis}` : '';
    push('Руководитель', ip ? director : `${position}: ${director}${basisText}`);
  }

  push('Дополнительные сведения', client.bank_details);
  return rows;
}

/**
 * Имя файла для скачивания: «Реквизиты ООО Вологодские машины.docx».
 * Кавычки и запрещённые в именах символы убираем — файл должен открыться
 * и в Windows, и в почте.
 */
function requisitesFileName(client = {}) {
  const { short, full } = officeTitle(client);
  const base = (short || full || text(client.name) || 'контрагента')
    .replace(/[«»"']/g, '')
    .replace(/[\\/:*?<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `Реквизиты ${base || 'контрагента'}.docx`;
}

module.exports = { clientRequisites, officeTitle, requisitesFileName, isIp, text };
