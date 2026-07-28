// Правила возврата
const REASONS = {
  quality:       { toStock:false },
  wrong_order:   { toStock:false },
  guest_refused: { toStock:true },
  cashier_error: { toStock:true },
  other:         { toStock:false },
};
const canRefund = (amount, paid) => amount <= paid;
const available = (qty, refunded) => qty - refunded;
const needsApproval = (hoursAgo) => hoursAgo > 24;
function suspicious(byUser, total) {
  if (byUser.length < 2) return null;
  const top = byUser[0];
  return top.count > total * 0.5
    ? { name: top.name, share: Math.round(top.count/total*100) } : null;
}
let p=0,f=0;const eq=(n,g,w)=>{const o=JSON.stringify(g)===JSON.stringify(w);o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${JSON.stringify(g)}`))};

eq('гость передумал — на склад', REASONS.guest_refused.toStock, true);
eq('претензия к качеству — не на склад', REASONS.quality.toStock, false);
eq('ошибка кассира — на склад', REASONS.cashier_error.toStock, true);
eq('принесли не то — не на склад', REASONS.wrong_order.toStock, false);

eq('возврат в пределах оплаты', canRefund(500000, 650000), true);
eq('возврат больше оплаты запрещён', canRefund(800000, 650000), false);
eq('возврат равен оплате', canRefund(650000, 650000), true);

eq('доступно к возврату', available(3, 1), 2);
eq('всё возвращено', available(2, 2), 0);

eq('свежий чек без одобрения', needsApproval(2), false);
eq('вчерашний требует одобрения', needsApproval(30), true);

eq('один делает 70% возвратов',
  suspicious([{name:'Ербол',count:7},{name:'Айгуль',count:3}], 10),
  {name:'Ербол', share:70});
eq('равномерно — нет подозрений',
  suspicious([{name:'A',count:5},{name:'B',count:5}], 10), null);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);
