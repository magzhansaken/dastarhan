// Расшифровка кодов Webkassa
const ERRORS = {
  '-1':  { text:'Модуль печати не запущен', who:'cashier', retriable:true },
  '17':  { text:'Не оплачена лицензия Webkassa', who:'owner', retriable:false },
  '94':  { text:'Не оплачен ОФД', who:'owner', retriable:false },
  '115': { text:'Нет связи с Webkassa', who:'cashier', retriable:true },
  '2':   { text:'Смена в кассе не открыта', who:'cashier', retriable:true },
  '3':   { text:'Смена превысила 24 часа', who:'cashier', retriable:true },
};
function explain(code, raw) {
  const k = code ? ERRORS[String(code)] : null;
  if (k) return { ...k, code };
  return { text: raw || 'Касса не приняла чек', who:'owner', retriable:true, code: code ?? null };
}
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g}`))};

eq('модуль не запущен — чинит кассир', explain('-1').who, 'cashier');
eq('и повтор поможет', explain('-1').retriable, true);
eq('лицензия — зовём владельца', explain('17').who, 'owner');
eq('и повтор бесполезен', explain('17').retriable, false);
eq('ОФД не оплачен — владелец', explain('94').who, 'owner');
eq('нет связи — кассир, повторяем', explain('115').retriable, true);
eq('смена 24 часа — кассир закроет', explain('3').who, 'cashier');
eq('незнакомый код не выдумываем', explain('999','Timeout').text, 'Timeout');
eq('незнакомый — на всякий повторяем', explain('999').retriable, true);
eq('без кода — общее сообщение', explain(null).text, 'Касса не приняла чек');

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);
