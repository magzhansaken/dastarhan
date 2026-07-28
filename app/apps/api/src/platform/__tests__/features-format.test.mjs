function toFeatureList(m) {
  if (Array.isArray(m)) return m;
  if (m && typeof m === 'object') return Object.entries(m).filter(([,v])=>v===true).map(([k])=>k);
  return [];
}
let p=0,f=0;
const eq=(n,g,w)=>{const o=JSON.stringify(g)===JSON.stringify(w);o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${JSON.stringify(g)}`))};
eq('массив остаётся массивом', toFeatureList(['pos','stock']), ['pos','stock']);
eq('объект превращается в список', toFeatureList({ai:true,loyalty:true,delivery:true}), ['ai','loyalty','delivery']);
eq('выключенные отбрасываются', toFeatureList({ai:true,loyalty:false}), ['ai']);
eq('null даёт пустой список', toFeatureList(null), []);
eq('пустой объект', toFeatureList({}), []);
console.log(`\nИТОГ: ${p} прошло, ${f} упало`); process.exit(f?1:0);
