// apps/pos/src/ui/viewmodels.ts
// Чистые view-model'и экранов кассы — логика отделена от React и тестируема.
// Каждое решение — из анализа касс 5 конкурентов (скриншоты QR/Paloma, статьи Poster).

export type Money = number; // тиыны

// ═══════════════ ДЕНЬГИ НА ЭКРАНЕ ═══════════════

/** 1 234 567 тиын → «12 345,67 ₸»; целые тенге без копеек: «12 345 ₸». */
export function formatMoney(t: Money): string {
  const tenge = Math.trunc(t / 100);
  const tiyn = Math.abs(t % 100);
  const s = Math.abs(tenge).toLocaleString('ru-RU').replace(/\u00A0/g, ' ');
  const sign = t < 0 ? '−' : '';
  return tiyn ? `${sign}${s},${String(tiyn).padStart(2, '0')} ₸` : `${sign}${s} ₸`;
}

// ═══════════════ PIN-ЭКРАН ═══════════════

export interface PinVm { digits: string; error?: string }

export function pinPress(vm: PinVm, key: string): PinVm {
  if (key === 'del') return { digits: vm.digits.slice(0, -1) };
  if (!/^\d$/.test(key) || vm.digits.length >= 6) return vm;
  return { digits: vm.digits + key };
}
export function pinReady(vm: PinVm): boolean { return vm.digits.length >= 4; }

// ═══════════════ КАТАЛОГ (экран заказа) ═══════════════

export interface CatalogItem {
  productId: string; name: string; price: Money; categoryId: string;
  stop?: { remaining: number | null }; // из стоп-листа
}

/** Фильтр каталога: категория + поиск (по подстроке, регистронезависимо,
 *  ё=е). Поиск перекрывает категорию (Poster: поиск всегда сквозной). */
export function filterCatalog(items: CatalogItem[], categoryId: string | null, query: string): CatalogItem[] {
  const q = query.trim().toLowerCase().replace(/ё/g, 'е');
  if (q) return items.filter((i) => i.name.toLowerCase().replace(/ё/g, 'е').includes(q));
  if (categoryId) return items.filter((i) => i.categoryId === categoryId);
  return items;
}

/** Бейдж плитки: стоп-лист полный → «СТОП» (плитка неактивна),
 *  с остатком → «3 порции» (жёлтый), иначе ничего. */
export function tileBadge(i: CatalogItem): { kind: 'stop' | 'low' | null; text?: string } {
  if (!i.stop) return { kind: null };
  if (i.stop.remaining === null) return { kind: 'stop', text: 'СТОП' };
  return { kind: 'low', text: `${i.stop.remaining}` };
}

// ═══════════════ ЭКРАН ОПЛАТЫ ═══════════════
// Paloma показывает фиксированные купюры; мы умнее: предлагаем купюры,
// РЕЛЕВАНТНЫЕ сумме чека (номиналы КЗ: 500/1000/2000/5000/10000/20000 тг).

const KZT_NOTES: Money[] = [500_00, 1000_00, 2000_00, 5000_00, 10000_00, 20000_00];

/** Быстрые кнопки «Получено»: точная сумма (без сдачи) + ближайшие купюры
 *  и их разумные комбинации сверху. Максимум 4 кнопки. */
export function quickTenderOptions(due: Money): Money[] {
  const out: Money[] = [due]; // «без сдачи»
  for (const n of KZT_NOTES) {
    if (n >= due && !out.includes(n)) { out.push(n); }
    if (out.length >= 4) break;
  }
  // если чек больше самой крупной купюры — кратные 10 000 сверх суммы
  if (out.length < 4) {
    let step = 10000_00;
    let v = Math.ceil(due / step) * step;
    while (out.length < 4) {
      if (!out.includes(v)) out.push(v);
      v += step;
    }
  }
  return out.slice(0, 4);
}

export interface PaymentVm {
  due: Money;          // остаток к оплате
  kind: 'CASH' | 'CARD' | 'KASPI_QR';
  tendered: Money;     // введено «получено» (для CASH)
}

export function paymentChange(vm: PaymentVm): Money {
  return vm.kind === 'CASH' ? Math.max(0, vm.tendered - vm.due) : 0;
}
export function paymentValid(vm: PaymentVm): boolean {
  if (vm.due <= 0) return false;
  if (vm.kind === 'CASH') return vm.tendered >= vm.due;
  return true; // безнал всегда ровно в остаток
}

/** Numpad «Получено»: цифры набирают ТЕНГЕ (тиыны кассиру не нужны). */
export function tenderPress(tenderedTenge: number, key: string): number {
  if (key === 'del') return Math.trunc(tenderedTenge / 10);
  if (key === 'C') return 0;
  if (!/^\d$/.test(key)) return tenderedTenge;
  const next = tenderedTenge * 10 + Number(key);
  return next > 99_999_999 ? tenderedTenge : next;
}

// ═══════════════ ИНДИКАТОР ОФЛАЙНА ═══════════════
// Poster подаёт офлайн как фичу — мы показываем состояние честно и спокойно.

export function syncStatusLabel(online: boolean, unsyncedCount: number): { text: string; tone: 'ok' | 'warn' } {
  if (online && unsyncedCount === 0) return { text: 'В сети', tone: 'ok' };
  if (online) return { text: `Отправка… ${unsyncedCount}`, tone: 'ok' };
  return { text: `Офлайн · ${unsyncedCount} в очереди`, tone: 'warn' };
}

// ═══════════════ НАВИГАЦИЯ ≤6 КАСАНИЙ ═══════════════
// Контроль обещания мастер-плана: PIN(1) → [зал: стол(2)] → плитка(3) →
// Оплата(4) → способ(5) → Готово(6). Быстрый заказ без зала: 5 касаний.

export const TAP_BUDGET = {
  quickSale: ['плитка товара', 'Оплата', 'способ/купюра', 'Готово'],           // 4
  tableSale: ['стол', 'плитка товара', 'Оплата', 'способ/купюра', 'Готово'],   // 5
} as const;
