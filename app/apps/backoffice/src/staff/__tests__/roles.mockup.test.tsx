import React from 'react';
import { renderToString } from 'react-dom/server';
import { RoleEditor, StaffList } from '../StaffScreens.tsx';
import { PERMISSIONS, PERMISSION_GROUPS, PERMISSION_STATE_LABELS, PERMISSION_HINTS,
  ROLE_PRESETS, permissionsSummary, diffFromPreset } from '../../../../../packages/shared/src/permissions.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,90)}`))};
const clean=(h:string)=>h.replace(/<!-- -->/g,'');
const allKeys = Object.keys(PERMISSIONS) as any[];

// ═══ ЧЕТЫРЕ СОСТОЯНИЯ — модель QuickResto, подписи из макета ═══
eq('ровно четыре состояния', Object.keys(PERMISSION_STATE_LABELS).length, 4);
eq('«Разрешено — просто работает»', [PERMISSION_STATE_LABELS.allowed.short, PERMISSION_STATE_LABELS.allowed.hint], ['Разрешено','просто работает']);
eq('«Своим PIN — подтверждает своим кодом»', PERMISSION_STATE_LABELS.self_pin.hint, 'подтверждает своим кодом');
eq('«PIN старшего — нужен код менеджера»', PERMISSION_STATE_LABELS.elevated_pin.hint, 'нужен код менеджера');
eq('«Запрещено — раздел не показывается»', PERMISSION_STATE_LABELS.denied.hint, 'раздел не показывается');

// ═══ ШЕСТЬ РАЗДЕЛОВ — названия из макета ═══
eq('шесть разделов прав', PERMISSION_GROUPS.length, 6);
eq('названия разделов из макета', PERMISSION_GROUPS.map(g=>g.name),
   ['Кассовые операции','Работа с заказом','Гости и CRM','Склад','Финансы','Администрирование']);
eq('все права разложены по группам', PERMISSION_GROUPS.flatMap(g=>g.keys).length, allKeys.length);

// ═══ ПОЯСНЕНИЯ К ПРАВАМ ═══
eq('пояснение есть у каждого права', allKeys.filter(k => !PERMISSION_HINTS[k]), []);
eq('«блюдо уже готовится»', PERMISSION_HINTS['order.item.remove'], 'блюдо уже готовится');
eq('«слепой пересчёт»', PERMISSION_HINTS['stock.inventory'], 'слепой пересчёт');
eq('«налог 3% и чистая»', PERMISSION_HINTS['finance.view'], 'налог 3% и чистая');
eq('«вынос денег из кассы»', PERMISSION_HINTS['cash.out'], 'вынос денег из кассы');

// ═══ СВОДКА ПО РОЛИ — из макета «N из M открыто · K скрыто» ═══
const s = permissionsSummary(ROLE_PRESETS.CASHIER.permissions, allKeys);
eq('сумма состояний = всего прав', s.open + s.pin + s.hidden, s.total);
eq('у владельца всё открыто', permissionsSummary(ROLE_PRESETS.OWNER.permissions, allKeys).hidden, 0);
eq('у курьера открыто мало', permissionsSummary(ROLE_PRESETS.COURIER.permissions, allKeys).open <= 5, true);

// отличие от пресета
eq('пресет сам от себя не отличается', diffFromPreset(ROLE_PRESETS.CASHIER.permissions, ROLE_PRESETS.CASHIER.permissions, allKeys), 0);
const modified = { ...ROLE_PRESETS.CASHIER.permissions, 'finance.view': 'allowed' as const };
eq('одно изменение поймано', diffFromPreset(modified, ROLE_PRESETS.CASHIER.permissions, allKeys), 1);

// ═══ ЖИВОЙ РЕНДЕР ═══
const h = clean(renderToString(<RoleEditor roleName="Кассир"
  permissions={ROLE_PRESETS.CASHIER.permissions} presetKey="CASHIER"
  onPreset={()=>{}} onChange={()=>{}} onSave={()=>{}} dirty={false} />));
eq('подзаголовок «прав в разделах»', h.includes('прав в 6 разделах'), true);
eq('«четыре состояния у каждого права»', h.includes('четыре состояния у каждого права'), true);
eq('сводка открыто/скрыто', h.includes('открыто') && h.includes('скрыто'), true);
eq('«пресет без изменений»', h.includes('пресет без изменений'), true);
eq('пояснения к правам видны', h.includes('блюдо уже готовится'), true);
eq('все четыре подписи состояний', ['Разрешено','Своим PIN','PIN старшего','Запрещено'].every(x=>h.includes(x)), true);
eq('названия разделов на экране', h.includes('Кассовые операции') && h.includes('Гости и CRM'), true);

// изменённая роль
const h2 = clean(renderToString(<RoleEditor roleName="Кассир"
  permissions={modified} presetKey="CASHIER"
  onPreset={()=>{}} onChange={()=>{}} onSave={()=>{}} dirty={true} />));
eq('счётчик изменений', h2.includes('изменено прав: 1'), true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);
