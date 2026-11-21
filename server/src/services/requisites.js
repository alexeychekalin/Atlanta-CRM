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

/**
 * Должность в родительном падеже: «в лице генерального директора».
 *
 * В карточке должность записана именительным падежом («Генеральный директор»),
 * а в преамбуле нужен родительный. Склоняем по последнему слову (главному:
 * «директор», «управляющий»), прилагательные перед ним — тоже, если знаем.
 * Незнакомую должность оставляем как есть: лучше «в лице финансовый директор»,
 * чем выдуманное склонение.
 */
function positionGenitive(position) {
  const value = text(position);
  if (!value) return 'руководителя';
  const words = value.split(' ');

  const adjectives = {
    'генеральный': 'генерального', 'генеральная': 'генеральной',
    'исполнительный': 'исполнительного', 'исполнительная': 'исполнительной',
    'финансовый': 'финансового', 'коммерческий': 'коммерческого',
    'технический': 'технического', 'первый': 'первого',
    'заместитель': 'заместителя',
  };
  const nouns = {
    'директор': 'директора', 'управляющий': 'управляющего',
    'руководитель': 'руководителя', 'президент': 'президента',
    'председатель': 'председателя',
  };

  const last = words[words.length - 1].toLowerCase();
  const stem = nouns[last];
  if (!stem) return value;

  // «генеральный директор» → «генерального директора»: прилагательные перед
  // главным словом склоняем тем же числом, что и оно (единственное здесь)
  const head = words.slice(0, -1).map(word => {
    const lower = word.toLowerCase();
    if (adjectives[lower]) return adjectives[lower];
    return word;
  });
  return [...head, stem].join(' ');
}

/**
 * ФИО в родительном падеже для преамбулы: «Корчагина Виталия Владимировича».
 *
 * Склоняем осторожно: только те окончания, где ошибки не бывает (мужские
 * фамилии на -ин/-ов/-ев/-ский, имена на -ий/-й/-ь, отчества на -ич; женские
 * на -ая/-ова/-ина, -ия, -на). Всё остальное оставляем как есть — в договоре
 * лучше видимая несклонённая форма, чем придуманная.
 *
 * Склоняем только когда в карточке ФИО в именительном падеже: если там уже
 * «Корчагина Виталия Владимировича», функция вернёт его без изменений
 * (окончание -а у мужской фамилии на -ин/-ов не трогаем).
 */
function fioGenitive(fio) {
  const words = text(fio).split(' ').filter(Boolean);
  if (words.length === 0) return '';

  // ФИО уже в родительном падеже («Корчагина Виталия Владимировича»):
  // в карточках так иногда пишут сразу — второй раз не склоняем
  if (words.length > 1 && /(?:овича|евича|ича)$/i.test(words[words.length - 1])) {
    return words.join(' ');
  }

  // Пол определяем по отчеству: «-овна/-евна/-ична» — женщина,
  // «-ович/-евич/-ич» (в т.ч. уже склонённое «-овича») — мужчина. Фамилия
  // обманывает: «Корчагина» похожа на женскую, а «Корчагин Виталий
  // Владимирович» — мужчина. Без отчества смотрим на окончание фамилии.
  const patronymic = words.length > 2 ? words[words.length - 1] : '';
  const feminine = patronymic
    ? /(?:овна|евна|ична|инична)$/i.test(patronymic)
    : /(?:ова|ева|ёва|ина|ына|ая|яя|ская|цкая)$/i.test(words[0]);

  const surname = (() => {
    const word = words[0];
    const lower = word.toLowerCase();
    if (feminine) {
      if (/(ская|цкая)$/i.test(word)) return word.slice(0, -2) + 'ой';
      if (/(ова|ева|ёва|ина|ына)$/i.test(word)) return word.slice(0, -1) + 'ой';
      if (/ая$/.test(lower)) return word.slice(0, -2) + 'ой';
      return word;
    }
    if (/(ский|цкий)$/i.test(word)) return word.slice(0, -2) + 'ого';
    if (/(ой)$/i.test(word)) return word.slice(0, -2) + 'ого';
    if (/(ый)$/i.test(word)) return word.slice(0, -2) + 'ого';
    if (/(ов|ев|ёв|ин|ын)$/i.test(word)) return word + 'а';
    return word;
  })();

  const rest = words.slice(1).map((word, index) => {
    // отчество — последнее слово
    const isPatronymic = index === words.slice(1).length - 1 && words.length > 2;
    if (isPatronymic) {
      if (feminine && /на$/i.test(word)) return word.slice(0, -1) + 'ы';
      if (/ич$/i.test(word)) return word + 'а';
      return word;
    }
    if (feminine) {
      if (/(ия)$/i.test(word)) return word.slice(0, -1) + 'и';
      if (/[ая]$/i.test(word)) return word.slice(0, -1) + (/(га|ка|ха)$/i.test(word) ? 'и' : 'ы');
      if (/ь$/i.test(word)) return word.slice(0, -1) + 'и';
      return word;
    }
    // Виталий → Виталия (гласная не выпадает), Андрей → Андрея;
    // «Виталия» — уже родительный падеж, его не трогаем
    if (/ия$/i.test(word)) return word;
    if (/ий$/i.test(word)) return word.slice(0, -2) + 'ия';
    if (/ей$/i.test(word)) return word.slice(0, -1) + 'я';
    if (/й$/i.test(word)) return word.slice(0, -1) + 'я';
    if (/ь$/i.test(word)) return word.slice(0, -1) + 'я';
    if (/[ая]$/i.test(word)) return word.slice(0, -1) + 'ы';
    return word;
  });

  return [surname, ...rest].join(' ');
}

/**
 * Преамбула договора: «... в лице генерального директора ФИО,
 * действующего на основании Устава».
 *
 * Контрагент присылает её дословно (у «Воронежсельмаша» с 29.05.2026 — именно
 * такая формулировка), и юристы сверяют договор с письмом, а не с карточкой.
 * Поэтому функция ничего не выдумывает: собирает формулировку из полей
 * карточки в том же порядке и тем же падежом.
 *
 * @returns {{ text: string, role: string, director: string, basis: string } | null}
 *          null — в карточке нет руководителя, преамбулу не из чего собрать
 */
function contractPreamble(client = {}) {
  const director = text(client.director);
  if (!director) return null;

  const ip = isIp(client);
  // у ИП руководитель — сам предприниматель, должности нет
  const role = ip ? 'предпринимателя' : positionGenitive(client.director_position);
  const basis = text(client.director_basis) || (ip ? 'ОГРНИП' : 'Устава');
  const basisText = /^на основании/i.test(basis) ? basis : `на основании ${basis}`;

  const subject = officeTitle(client).full;
  // ФИО в договоре — в родительном падеже; функцию можно отключить полем
  const directorGenitive = fioGenitive(director) || director;
  return {
    text: `${subject}, в лице ${role} ${directorGenitive}, действующего ${basisText}`,
    director_genitive: directorGenitive,
    role,
    director,
    basis,
    subject,
  };
}

module.exports = {
  clientRequisites, officeTitle, requisitesFileName, isIp, text,
  contractPreamble, positionGenitive, fioGenitive,
};
