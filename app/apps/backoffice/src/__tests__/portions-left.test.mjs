function portionsLeft(lines,bal){let min=Infinity,sc=null;
 for(const l of lines){if(l.bruttoQty<=0)continue;
  const p=Math.floor((bal.get(l.componentId)??0)/l.bruttoQty);
  if(p<min){min=p;sc=l.componentId;}}
 return {portions:min===Infinity?0:Math.max(0,min),scarcest:sc};}
let p=0,f=0;const eq=(n,g,w)=>{const o=JSON.stringify(g)===JSON.stringify(w);o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${JSON.stringify(g)}`))};
const lines=[{componentId:'rice',bruttoQty:0.12},{componentId:'beef',bruttoQty:0.125}];
eq('хватит по дефицитному', portionsLeft(lines,new Map([['rice',20],['beef',1.5]])), {portions:12,scarcest:'beef'});
eq('рис в дефиците', portionsLeft(lines,new Map([['rice',0.5],['beef',10]])), {portions:4,scarcest:'rice'});
eq('пустой склад', portionsLeft(lines,new Map()), {portions:0,scarcest:'rice'});
eq('минус на остатке', portionsLeft(lines,new Map([['rice',-5],['beef',10]])), {portions:0,scarcest:'rice'});
console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);
