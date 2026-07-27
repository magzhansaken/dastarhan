import { calcPrice, fmtKzt, plural, priceCaption, PLANS, EXTRA_TERMINAL_PRICE } from './calc.mjs';
let pass=0, fail=0;
const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`))};

// базовый случай: 1 точка, 1 касса, помесячно
let r = calcPrice('BUSINESS', 1, 1, false);
eq('1 точка 1 касса Бизнес = 18 000', r.monthly, 18000_00);
eq('доп. касс нет', r.extraTerminals, 0);
eq('скидки нет', r.discount, 0);

// первая касса включена, вторая — доплата
r = calcPrice('BUSINESS', 1, 2, false);
eq('вторая касса +4 000', r.monthly, 18000_00 + 4000_00);
eq('доп. касса 1', r.extraTerminals, 1);

// 3 точки по 2 кассы
r = calcPrice('BUSINESS', 3, 2, false);
eq('3 точки × 18 000', r.planLine, 54000_00);
eq('3 доп. кассы × 4 000', r.terminalsLine, 12000_00);
eq('итого 66 000', r.monthly, 66000_00);

// годовая скидка 20%
r = calcPrice('BUSINESS', 1, 1, true);
eq('год: полная 216 000', r.monthly * 12, 216000_00);
eq('скидка 20% = 43 200', r.discount, 43200_00);
eq('к оплате 172 800', r.payNow, 172800_00);
eq('эффективно в месяц 14 400', r.perMonthEffective, 14400_00);

// тарифы
eq('Старт 12 000', calcPrice('START',1,1,false).monthly, 12000_00);
eq('Сеть 26 000', calcPrice('NETWORK',1,1,false).monthly, 26000_00);

// защита от мусора
eq('0 точек → считается как 1', calcPrice('START',0,1,false).monthly, 12000_00);
eq('0 касс → считается как 1', calcPrice('START',1,0,false).extraTerminals, 0);
eq('дробные округляются вниз', calcPrice('START',2.9,1,false).planLine, 24000_00);
let threw=false; try { calcPrice('XXX',1,1,false) } catch { threw=true }
eq('неизвестный тариф → ошибка', threw, true);

// формат денег
eq('формат 12 000 ₸', fmtKzt(12000_00), '12 000 ₸');
eq('формат 172 800 ₸', fmtKzt(172800_00), '172 800 ₸');
eq('без неразрывных пробелов', fmtKzt(1000000_00).includes('\u00A0'), false);

// склонения (русский язык — частая ошибка на сайтах)
eq('1 точка', plural(1,'точка','точки','точек'), 'точка');
eq('2 точки', plural(2,'точка','точки','точек'), 'точки');
eq('5 точек', plural(5,'точка','точки','точек'), 'точек');
eq('11 точек (не одна!)', plural(11,'точка','точки','точек'), 'точек');
eq('21 точка', plural(21,'точка','точки','точек'), 'точка');
eq('114 точек', plural(114,'точка','точки','точек'), 'точек');
eq('подпись помесячно', priceCaption(3,2,false), '3 точки, 2 кассы на точке · помесячно');
eq('подпись за год', priceCaption(1,1,true), '1 точка, 1 касса на точке · оплата за год');

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);
