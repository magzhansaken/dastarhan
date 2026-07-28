const isValidBin=(v)=>/^\d{12}$/.test(v.replace(/\s/g,''));
function normalizePhone(raw){const d=raw.replace(/\D/g,'');
 if(d.length===11&&(d[0]==='7'||d[0]==='8'))return '+7'+d.slice(1);
 if(d.length===10)return '+7'+d; return null;}
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g}`))};
eq('БИН 12 цифр', isValidBin('123456789012'), true);
eq('БИН с пробелами', isValidBin('1234 5678 9012'), true);
eq('11 цифр не БИН', isValidBin('12345678901'), false);
eq('8 707 → +7707', normalizePhone('8 707 214 88 30'), '+77072148830');
eq('+7 707 остаётся', normalizePhone('+7 707 214 88 30'), '+77072148830');
eq('10 цифр без кода', normalizePhone('7072148830'), '+77072148830');
eq('короткий номер отклоняется', normalizePhone('12345'), null);
console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);
