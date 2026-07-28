// Проверка стратегии повторов фискализации
const RETRY_MINUTES = [1, 5, 15, 60, 180];
const nextDelay = (attempts) => RETRY_MINUTES[Math.min(attempts, RETRY_MINUTES.length - 1)];

let p=0,f=0;
const eq=(n,g,w)=>{const o=JSON.stringify(g)===JSON.stringify(w);o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g} ≠ ${w}`))};

eq('первый повтор через минуту', nextDelay(0), 1);
eq('второй через 5 минут', nextDelay(1), 5);
eq('третий через 15', nextDelay(2), 15);
eq('четвёртый через час', nextDelay(3), 60);
eq('дальше каждые 3 часа', nextDelay(10), 180);

// суммарное время до последней частой попытки
const total = RETRY_MINUTES.slice(0,4).reduce((a,b)=>a+b,0);
eq('за первые 4 попытки проходит 81 мин', total, 81);

// не долбим ОФД чаще раза в минуту
eq('минимальная пауза не меньше минуты', Math.min(...RETRY_MINUTES) >= 1, true);

// логическая ошибка не ретраится
const decide = (retriable) => retriable === false ? 'ERROR' : 'QUEUED';
eq('неверные данные → ERROR без повторов', decide(false), 'ERROR');
eq('сеть упала → QUEUED с повтором', decide(true), 'QUEUED');
eq('провайдер не сказал → повторяем', decide(undefined), 'QUEUED');

console.log(`\nИТОГ: ${p} прошло, ${f} упало`);
process.exit(f?1:0);
