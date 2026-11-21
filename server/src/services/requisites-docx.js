/**
 * Выгрузка реквизитов клиента в Word (.docx).
 *
 * Менеджеры отправляют контрагентам карточку предприятия, бухгалтерия —
 * в договоры и счета. Раньше реквизиты копировали из карточки вручную,
 * теперь их можно скачать одним файлом из CRM.
 *
 * Документ — обычный A4: шапка с наименованием, таблица «поле → значение»,
 * подпись руководителя и отметка о том, когда файл сформирован. Данные берутся
 * из services/requisites.js — того же набора, что показывается в карточке.
 */
const {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  VerticalAlign,
  convertMillimetersToTwip,
} = require('docx');
const {
  clientRequisites, officeTitle, requisitesFileName, isIp, text, contractPreamble,
} = require('./requisites');

const ACCENT = '1F4E79';       // фирменный синий
const MUTED = '6B7280';
const LABEL = '44546A';
const LINE = 'D0D7E2';
const FILL = 'F2F5F9';

const FONT = 'Arial';
const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const tableBorders = {
  top: border, bottom: border, left: border, right: border,
  insideHorizontal: border, insideVertical: border,
};

/** Значение в ячейку: переносы строк — отдельными абзацами. */
function valueParagraphs(value) {
  return String(value).split('\n').map(line => new Paragraph({
    spacing: { before: 0, after: 0 },
    children: [new TextRun({ text: line, size: 22, font: FONT })],
  }));
}

function requisitesTable(rows) {
  const body = rows.map(({ label, value }) => new TableRow({
    children: [
      new TableCell({
        width: { size: 32, type: WidthType.PERCENTAGE },
        shading: { fill: FILL },
        margins: { top: 90, bottom: 90, left: 140, right: 140 },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          spacing: { before: 0, after: 0 },
          children: [new TextRun({ text: label, bold: true, size: 20, color: LABEL, font: FONT })],
        })],
      }),
      new TableCell({
        width: { size: 68, type: WidthType.PERCENTAGE },
        margins: { top: 90, bottom: 90, left: 140, right: 140 },
        verticalAlign: VerticalAlign.CENTER,
        children: valueParagraphs(value),
      }),
    ],
  }));

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders,
    rows: body,
  });
}

/** Подпись: руководитель ООО или сам предприниматель. */
function signatureBlock(client) {
  const director = text(client.director);
  if (!director) return [];

  const ip = isIp(client);
  const role = ip
    ? 'Индивидуальный предприниматель'
    : (text(client.director_position) || 'Руководитель');

  const lines = [
    new Paragraph({
      spacing: { before: 520, after: 120 },
      children: [new TextRun({ text: `${role}  ________________________  / ${director} /`,
        size: 22, font: FONT })],
    }),
  ];
  // печать у ИП необязательна — «М.П.» оставляем только организациям
  if (!ip) {
    lines.push(new Paragraph({
      spacing: { before: 0, after: 0 },
      children: [new TextRun({ text: 'М.П.', size: 20, color: MUTED, font: FONT })],
    }));
  }
  return lines;
}

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()}`;
}

/**
 * Собрать документ реквизитов.
 *
 * @param {object} client   строка clients из базы (или объект с теми же полями)
 * @param {object} [options]
 * @param {Date}   [options.date]  дата в подвале — для тестов
 * @returns {Promise<Buffer>} готовый .docx
 */
async function buildRequisitesDocx(client = {}, options = {}) {
  const { full, short } = officeTitle(client);
  const rows = clientRequisites(client);
  // телефон и сайт есть почти у всех, но карточкой предприятия они не являются:
  // без ИНН, адреса или счёта выгружать нечего
  const legal = ['inn', 'kpp', 'ogrn', 'ogrnip', 'legal_address', 'bank_account', 'director'];
  if (rows.length === 0 || !legal.some(field => text(client[field]))) {
    throw new Error('у клиента не заполнены реквизиты — выгружать нечего');
  }

  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 120 },
      children: [new TextRun({ text: 'РЕКВИЗИТЫ', bold: true, size: 32, color: ACCENT, font: FONT,
        characterSpacing: 40 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: short ? 60 : 260 },
      children: [new TextRun({ text: full, bold: true, size: 24, font: FONT })],
    }),
  ];

  if (short) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 260 },
      children: [new TextRun({ text: short, size: 20, color: MUTED, font: FONT })],
    }));
  }

  children.push(requisitesTable(rows));

  // Готовая преамбула договора: бухгалтерия и юристы копируют её в договор
  // как есть, поэтому она идёт отдельным блоком после таблицы
  const preamble = contractPreamble(client);
  if (preamble) {
    children.push(new Paragraph({
      spacing: { before: 320, after: 100 },
      children: [new TextRun({ text: 'Преамбула для договора', bold: true, size: 20, color: LABEL, font: FONT })],
    }));
    children.push(new Paragraph({
      spacing: { before: 0, after: 0 },
      children: [new TextRun({ text: preamble.text, size: 22, font: FONT })],
    }));
  }

  children.push(...signatureBlock(client));
  children.push(new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing: { before: 360, after: 0 },
    children: [new TextRun({
      text: `Сформировано в CRM «Атланта» ${formatDate(options.date)}`,
      size: 16, color: '9AA5B1', font: FONT,
    })],
  }));

  const doc = new Document({
    creator: 'CRM «Атланта»',
    title: `Реквизиты ${short || full}`.trim(),
    description: 'Карточка предприятия, сформированная из CRM',
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 22 },
          paragraph: { spacing: { line: 264 } },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: {
            width: convertMillimetersToTwip(210),
            height: convertMillimetersToTwip(297),
          },
          margin: {
            top: convertMillimetersToTwip(18),
            right: convertMillimetersToTwip(18),
            bottom: convertMillimetersToTwip(18),
            left: convertMillimetersToTwip(22),
          },
        },
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

module.exports = { buildRequisitesDocx, requisitesFileName, formatDate };
