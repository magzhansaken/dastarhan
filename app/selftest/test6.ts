import { normalizePhoneKz, bonusAccrual, bonusPayable, bonusToExpire,
  walletPay, walletTopup, walletDebt, discountActiveAt, bestDiscount, applyDiscount,
  nPlusGift, giftFromSum, checkPromoCode, promoDiscount, useSubscription, LoyaltyError } from './loy.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`))};
const throws=(n:string,fn:()=>void,code:string)=>{try{fn();fail++;console.log(`  ✗ ${n}: не бросил`);}catch(e){(e as LoyaltyError).code===code?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: код ${(e as any).code}`));}};

// ═══ Телефон КЗ — все народные форматы к одному ═══
eq('8-707…', normalizePhoneKz('8 707 123 45 67'), '+77071234567');
eq('+7 707…', normalizePhoneKz('+7 (707) 123-45-67'), '+77071234567');
eq('707…', normalizePhoneKz('7071234567'), '+77071234567');
throws('короткий номер', ()=>normalizePhoneKz('12345'), 'BAD_PHONE');

// ═══ Бонусы ═══
const prog = { accrualPct: 5, maxPayPct: 50 };
// чек 10 000 тг, из них 2 000 бонусами → начисление 5% ТОЛЬКО на 8 000 живых
eq('начисление на живые деньги', bonusAccrual(800_000, prog), 40_000);
eq('% группы перекрывает базовый', bonusAccrual(800_000, prog, 10), 80_000);
// лимит оплаты: чек 10 000, баланс 8 000, лимит 50% → потратить можно 5 000
eq('лимит 50% чека', bonusPayable(1_000_000, 800_000, prog), 500_000);
eq('баланс меньше лимита', bonusPayable(1_000_000, 300_000, prog), 300_000);
// сгорание FIFO
const exp = bonusToExpire([
  { amount: 500, expiresAt: new Date('2026-06-01'), spent: 200 },
  { amount: 300, expiresAt: new Date('2026-12-01'), spent: 0 },
  { amount: 400, expiresAt: null, spent: 0 },
], new Date('2026-07-19'));
eq('сгорает только истёкший остаток', exp, 300);

// ═══ Кошелёк: депозит + долг («запиши на меня») ═══
let w = { balance: 100_000, creditLimit: 500_000 };
w = walletPay(w, 400_000);
eq('ушёл в долг −3000тг', w.balance, -300_000);
eq('долг виден', walletDebt(w), 300_000);
throws('лимит долга защищает', ()=>walletPay(w, 300_000), 'CREDIT_EXCEEDED');
w = walletTopup(w, 350_000);
eq('погашение долга + остаток', w.balance, 50_000);
eq('долга нет', walletDebt(w), 0);

// ═══ Happy hours (Paloma временная скидка) ═══
const hh = { id:'hh', pct:20, daysMask:0b0011111, fromMin:15*60, toMin:18*60 }; // Пн-Пт 15:00-18:00
eq('среда 16:00 — активна', discountActiveAt(hh, new Date('2026-07-15T16:00:00')), true);
eq('среда 19:00 — нет', discountActiveAt(hh, new Date('2026-07-15T19:00:00')), false);
eq('суббота 16:00 — нет', discountActiveAt(hh, new Date('2026-07-18T16:00:00')), false);
// окно через полночь (бар: 22:00-02:00)
const night = { id:'n', pct:10, daysMask:127, fromMin:22*60, toMin:2*60 };
eq('23:30 — в ночном окне', discountActiveAt(night, new Date('2026-07-15T23:30:00')), true);
eq('01:00 — в ночном окне', discountActiveAt(night, new Date('2026-07-16T01:00:00')), true);
eq('12:00 — вне', discountActiveAt(night, new Date('2026-07-15T12:00:00')), false);

// лучшая скидка, не сумма
eq('берётся максимальная', bestDiscount([{id:'a',pct:5},{id:'b',pct:15},{id:'c',pct:10}]), {id:'b',pct:15});
eq('пусто → null', bestDiscount([]), null);
eq('применение 15% к 10 000', applyDiscount(1_000_000, 15), {discount:150_000, final:850_000});

// ═══ Акции ═══
// 3-й кофе бесплатно: купил 7 → 2 подарка
eq('N+1: 7 кофе → 2 в подарок', nPlusGift(7, 3, 150_000), {gifts:2, discount:300_000});
throws('N<2 запрещено', ()=>nPlusGift(5, 1, 100), 'BAD_N');
eq('подарок от суммы: дотянул', giftFromSum(2_000_000, 1_500_000), true);
eq('подарок от суммы: не дотянул', giftFromSum(1_000_000, 1_500_000), false);

// промокод расходуемый
const pc = { code:'PLOV20', pct:20, maxUses:100, usedCount:99,
  validFrom:new Date('2026-01-01'), validTo:new Date('2026-12-31') };
checkPromoCode(pc, ' plov20 ', new Date('2026-07-19')); pass++; console.log('  ✓ код валиден (регистр/пробелы)');
eq('скидка промокода 20%', promoDiscount(pc, 500_000), 100_000);
throws('исчерпан', ()=>checkPromoCode({...pc, usedCount:100}, 'PLOV20', new Date('2026-07-19')), 'PROMO_USED_UP');
throws('истёк', ()=>checkPromoCode(pc, 'PLOV20', new Date('2027-01-01')), 'PROMO_EXPIRED');
throws('не найден', ()=>checkPromoCode(pc, 'DRUGOI', new Date('2026-07-19')), 'PROMO_NOT_FOUND');
// фикс-сумма не больше чека
eq('фикс-скидка не глубже чека', promoDiscount({code:'X', amount:900, usedCount:0}, 500), 500);

// абонемент
let sub = { remaining: 2 };
sub = useSubscription(sub); sub = useSubscription(sub);
eq('абонемент исчерпан до 0', sub.remaining, 0);
throws('пустой абонемент', ()=>useSubscription(sub), 'SUB_EMPTY');

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);
