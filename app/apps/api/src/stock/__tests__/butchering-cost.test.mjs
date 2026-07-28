// Распределение себестоимости по коэффициентам ценности
function distribute(totalCost, outputs) {
  const weights = outputs.map(o => o.qty * o.ratio);
  const sum = weights.reduce((s,w)=>s+w,0);
  let done = 0;
  return outputs.map((o,i) => {
    const share = i === outputs.length-1 ? totalCost - done : Math.round(totalCost * weights[i]/sum);
    done += share;
    return { ...o, cost: share, unitCost: Math.round(share/o.qty) };
  });
}
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g} ≠ ${w}`))};

// Туша конины 40 кг по 2800 ₸ = 112 000 ₸
const outs = distribute(11200000, [
  { name:'Вырезка', qty: 6, ratio: 3.0 },
  { name:'Мякоть',  qty: 20, ratio: 1.5 },
  { name:'Кости',   qty: 10, ratio: 0.3 },
]);
eq('сумма частей = стоимости сырья', outs.reduce((s,o)=>s+o.cost,0), 11200000);
eq('вырезка дороже мякоти за кг', outs[0].unitCost > outs[1].unitCost, true);
eq('кости дешевле всех', outs[2].unitCost < outs[1].unitCost, true);
console.log(`     вырезка ${Math.trunc(outs[0].unitCost/100)} ₸/кг, мякоть ${Math.trunc(outs[1].unitCost/100)}, кости ${Math.trunc(outs[2].unitCost/100)}`);

// округление не теряет копейки
const odd = distribute(10000033, [{qty:3,ratio:1},{qty:3,ratio:1},{qty:3,ratio:1}]);
eq('копейки не теряются', odd.reduce((s,o)=>s+o.cost,0), 10000033);

// потери
const loss = (inQ, outQ) => +(((inQ-outQ)/inQ)*100).toFixed(1);
eq('потери 10% при 40→36', loss(40,36), 10);
eq('потери 0 при полном выходе', loss(40,40), 0);
console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);
