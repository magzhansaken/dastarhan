// apps/pos/src/print/escpos.ts
// ДРАЙВЕР ПЕЧАТИ ESC/POS — P0-1 плана «всё лучше».
// Анализ рынка: Paloma печатает на «любых Windows» (Rongta, Xprinter),
// Poster — автопоиск + Xprinter/Epson, QR — 4 вида документов (чек, пречек,
// чек повара, чек курьеру). Все молчат о главной инженерной проблеме КЗ:
// казахские буквы (ә қ ң ғ ө ұ ү һ і) ОТСУТСТВУЮТ в CP866 термопринтеров.
// Наше решение: CP866 + документированный фолбэк-маппинг каз. букв на
// ближайшие печатаемые (стандарт индустрии для ESC/POS; растр — в v2).
// Архитектура: ЧИСТЫЙ генератор байтов (тестируем без принтера) +
// транспорт (TCP 9100 / USB) отдельно.

export type Money = number;

// ═══════════════ КОДИРОВКА CP866 + КАЗАХСКИЙ ФОЛБЭК ═══════════════

// Казахские буквы → ближайшие кириллические/латинские (есть в CP866)
const KK_FALLBACK: Record<string, string> = {
  'ә':'а','Ә':'А','ғ':'г','Ғ':'Г','қ':'к','Қ':'К','ң':'н','Ң':'Н',
  'ө':'о','Ө':'О','ұ':'у','Ұ':'У','ү':'у','Ү':'У','һ':'х','Һ':'Х',
  'і':'i','І':'I',
};

/** UTF-строка → байты CP866. Неизвестное → '?', казахское → фолбэк. */
export function toCp866(s: string): Uint8Array {
  const out: number[] = [];
  for (let ch of s) {
    if (KK_FALLBACK[ch]) ch = KK_FALLBACK[ch];
    const c = ch.codePointAt(0)!;
    if (c < 0x80) { out.push(c); continue; }              // ASCII
    if (c >= 0x410 && c <= 0x43F) { out.push(c - 0x410 + 0x80); continue; } // А-Яа-п → 80-AF
    if (c >= 0x440 && c <= 0x44F) { out.push(c - 0x440 + 0xE0); continue; } // р-я → E0-EF
    if (c === 0x401) { out.push(0xF0); continue; } // Ё
    if (c === 0x451) { out.push(0xF1); continue; } // ё
    if (c === 0x2116) { out.push(0xFC); continue; } // №
    if (c === 0x20B8) { out.push(0xE2, 0xA3); continue; } // ₸ → «тг» (т=0xE2, г=0xA3)
    out.push(0x3F); // ?
  }
  return Uint8Array.from(out);
}

// ═══════════════ КОМАНДЫ ESC/POS ═══════════════

const ESC = 0x1b, GS = 0x1d;

export const CMD = {
  init: () => Uint8Array.from([ESC, 0x40]),
  /** Кодовая страница CP866 = page 17 у Epson/Xprinter */
  codepage866: () => Uint8Array.from([ESC, 0x74, 17]),
  align: (a: 'left' | 'center' | 'right') =>
    Uint8Array.from([ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2]),
  bold: (on: boolean) => Uint8Array.from([ESC, 0x45, on ? 1 : 0]),
  /** Двойная высота+ширина для итога */
  doubleSize: (on: boolean) => Uint8Array.from([GS, 0x21, on ? 0x11 : 0x00]),
  feed: (n = 1) => Uint8Array.from([ESC, 0x64, n]),
  /** Частичная резка */
  cut: () => Uint8Array.from([GS, 0x56, 0x41, 0x03]),
  /** Импульс денежного ящика (pin 2) — Poster «как подключить ящик» */
  drawerPulse: () => Uint8Array.from([ESC, 0x70, 0x00, 0x19, 0xFA]),
  /** QR-код (ссылка ОФД на чеке — требование фискализации КЗ) */
  qr: (data: string): Uint8Array => {
    const d = new TextEncoder().encode(data);
    const len = d.length + 3;
    const store = [GS, 0x28, 0x6B, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...d];
    return Uint8Array.from([
      GS, 0x28, 0x6B, 4, 0, 0x31, 0x41, 0x32, 0x00,  // модель 2
      GS, 0x28, 0x6B, 3, 0, 0x31, 0x43, 0x06,        // размер 6
      GS, 0x28, 0x6B, 3, 0, 0x31, 0x45, 0x31,        // коррекция M
      ...store,
      GS, 0x28, 0x6B, 3, 0, 0x31, 0x51, 0x30,        // печать
    ]);
  },
};

export function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ═══════════════ РАСКЛАДКА СТРОК ═══════════════

/** Ширина: 58мм = 32 символа, 80мм = 48 (стандарт Xprinter/Rongta). */
export type PaperWidth = 32 | 48;

/** «Название слева — сумма справа», перенос длинных названий. */
export function lineLR(left: string, right: string, width: PaperWidth): string[] {
  const rw = right.length;
  const lw = width - rw - 1;
  const lines: string[] = [];
  let rest = left;
  while (rest.length > lw) {
    lines.push(rest.slice(0, lw));
    rest = rest.slice(lw);
  }
  lines.push(rest + ' '.repeat(Math.max(1, width - rest.length - rw)) + right);
  return lines;
}

export function divider(width: PaperWidth, ch = '-'): string {
  return ch.repeat(width);
}

export function center(s: string, width: PaperWidth): string {
  if (s.length >= width) return s.slice(0, width);
  const pad = Math.floor((width - s.length) / 2);
  return ' '.repeat(pad) + s;
}

export const fmtT = (t: Money) =>
  `${Math.trunc(t / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} тг`;

// ═══════════════ ШАБЛОН ФИСКАЛЬНОГО ЧЕКА ═══════════════
// Состав — объединение чеков с скриншотов QR/Paloma + требования КЗ:
// шапка (название, БИН, адрес) → позиции → итог крупно → оплаты/сдача →
// фискальная часть (№ чека, QR ОФД) → подвал (Рахмет!).

export interface ReceiptData {
  shopName: string; binIin: string; address: string;
  orderNumber: number; cashierName: string; at: string; // dd.MM.yyyy HH:mm
  items: { name: string; qty: number; price: Money; sum: Money }[];
  total: Money;
  payments: { name: string; amount: Money }[];
  change?: Money;
  fiscal?: { checkNumber: string; ofdUrl: string };
  lang?: 'ru' | 'kk';
  /** QR чаевых официанту (дизайн-ревизия): деньги идут напрямую
   *  сотруднику на Kaspi, минуя счёт заведения — в выручку не попадают
   *  и налогом заведения не облагаются. */
  tips?: { url: string; employeeName?: string };
}

const L = {
  receipt: { ru: 'ФИСКАЛЬНЫЙ ЧЕК', kk: 'ФИСКАЛДЫК ЧЕК' },
  order: { ru: 'Заказ', kk: 'Тапсырыс' },
  cashier: { ru: 'Кассир', kk: 'Кассир' },
  total: { ru: 'ИТОГО', kk: 'БАРЛЫГЫ' },
  change: { ru: 'Сдача', kk: 'Кайтарым' },
  thanks: { ru: 'Спасибо! Ждём вас снова', kk: 'Рахмет! Тагы келiниз' },
  bin: { ru: 'БИН/ИИН', kk: 'БСН/ЖСН' },
  tips: { ru: 'Понравилось обслуживание? Чаевые', kk: 'Кызмет унады ма? Шайпул' },
};

export function buildReceipt(r: ReceiptData, width: PaperWidth = 32): Uint8Array {
  const lang = r.lang ?? 'ru';
  const parts: Uint8Array[] = [CMD.init(), CMD.codepage866()];
  const text = (s: string) => parts.push(toCp866(s + '\n'));

  parts.push(CMD.align('center'), CMD.bold(true));
  text(r.shopName);
  parts.push(CMD.bold(false));
  text(`${L.bin[lang]}: ${r.binIin}`);
  text(r.address);
  text(divider(width));
  parts.push(CMD.align('left'));
  text(`${L.order[lang]} №${r.orderNumber}  ${r.at}`);
  text(`${L.cashier[lang]}: ${r.cashierName}`);
  text(divider(width));

  for (const it of r.items) {
    // имя ×кол-во … сумма (перенос длинных имён)
    const qty = it.qty !== 1 ? ` x${it.qty}` : '';
    for (const ln of lineLR(it.name + qty, fmtT(it.sum), width)) text(ln);
  }
  text(divider(width));

  parts.push(CMD.bold(true), CMD.doubleSize(true));
  for (const ln of lineLR(L.total[lang], fmtT(r.total), width)) text(ln);
  parts.push(CMD.doubleSize(false), CMD.bold(false));

  for (const p of r.payments)
    for (const ln of lineLR(p.name, fmtT(p.amount), width)) text(ln);
  if (r.change && r.change > 0)
    for (const ln of lineLR(L.change[lang], fmtT(r.change), width)) text(ln);

  if (r.fiscal) {
    text(divider(width));
    parts.push(CMD.align('center'));
    text(`${L.receipt[lang]} №${r.fiscal.checkNumber}`);
    parts.push(CMD.qr(r.fiscal.ofdUrl));
    text('ofd.kz');
  }
  // Чаевые: отдельным блоком после фискальной части — гость видит QR
  // уже с закрытым чеком и решает сам.
  if (r.tips) {
    text(divider(width));
    parts.push(CMD.align('center'));
    text(L.tips[lang]);
    if (r.tips.employeeName) text(r.tips.employeeName);
    parts.push(CMD.qr(r.tips.url));
  }

  parts.push(CMD.align('center'));
  text('');
  text(L.thanks[lang]);
  parts.push(CMD.feed(3), CMD.cut());
  return concat(parts);
}

/** Пречек (пробный счёт) — без фискальной части, с пометкой (правило QR). */
export function buildPrecheck(r: Omit<ReceiptData, 'fiscal' | 'payments' | 'change'>, width: PaperWidth = 32): Uint8Array {
  const parts: Uint8Array[] = [CMD.init(), CMD.codepage866(), CMD.align('center'), CMD.bold(true)];
  const text = (s: string) => parts.push(toCp866(s + '\n'));
  text('*** ПРЕДВАРИТЕЛЬНЫЙ СЧЕТ ***');
  text('НЕ ЯВЛЯЕТСЯ ФИСКАЛЬНЫМ ЧЕКОМ');
  parts.push(CMD.bold(false));
  text(divider(width));
  parts.push(CMD.align('left'));
  for (const it of r.items)
    for (const ln of lineLR(it.name + (it.qty !== 1 ? ` x${it.qty}` : ''), fmtT(it.sum), width)) text(ln);
  text(divider(width));
  parts.push(CMD.bold(true));
  for (const ln of lineLR('ИТОГО', fmtT(r.total), width)) text(ln);
  parts.push(CMD.bold(false), CMD.feed(3), CMD.cut());
  return concat(parts);
}

// ═══════════════ ТРАНСПОРТ ═══════════════
// TCP 9100 (сетевые Xprinter/Rongta — большинство в КЗ) + абстракция для
// USB (Tauri: serialport; Capacitor: USB-OTG плагин). Poster-паттерн:
// автопоиск = скан 9100 порта в подсети.

export interface PrinterTransport { send(bytes: Uint8Array): Promise<void> }

export class TcpPrinter implements PrinterTransport {
  host: string; port: number;
  constructor(host: string, port = 9100) { this.host = host; this.port = port; }
  async send(bytes: Uint8Array): Promise<void> {
    // В Tauri/Node: net.Socket; в браузере dev — заглушка
    const net = await import('node:net');
    await new Promise<void>((res, rej) => {
      const sock = net.createConnection({ host: this.host, port: this.port }, () => {
        sock.write(bytes, (e) => (e ? rej(e) : sock.end(res)));
      });
      sock.on('error', rej);
      sock.setTimeout(4000, () => { sock.destroy(); rej(new Error('PRINTER_TIMEOUT')); });
    });
  }
}
