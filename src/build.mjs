#!/usr/bin/env node
// apps/website/build.mjs — сборка статического сайта из двуязычных шаблонов.
// Шаблон содержит ⟦русский|қазақша⟧ — генератор раскладывает на две версии:
//   dist/index.html      (ru, ROOT = '')
//   dist/kk/index.html   (kk, ROOT = '../')
// Так у каждого языка свой URL и свой <html lang> — полноценный SEO,
// в отличие от переключения языка на JS (поисковик видит только один).

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SRC = dirname(new URL(import.meta.url).pathname);
const DIST = join(SRC, 'dist');

/** ⟦ru|kk⟧ → нужный язык. Скобки ⟦⟧ не встречаются в текстах — кавычки-ёлочки внутри контента больше не ломают разбор (поймано проверкой). */
export function pickLang(html, lang) {
  return html.replace(/⟦([^⟦⟧]*?)\|([^⟦⟧]*?)⟧/g, (_, ru, kk) => (lang === 'kk' ? kk : ru));
}

/** Проверка: не осталось ли неразобранных двуязычных блоков. */
export function findUnresolved(html) {
  return (html.match(/⟦[^⟦⟧]*⟧/g) || []).slice(0, 5);
}

/** Проверка: все ли блоки имеют обе версии (нет пустой стороны). */
export function findEmptySides(tpl) {
  const bad = [];
  for (const m of tpl.matchAll(/⟦([^⟦⟧]*?)\|([^⟦⟧]*?)⟧/g)) {
    if (!m[1].trim() || !m[2].trim()) bad.push(m[0].slice(0, 60));
  }
  return bad;
}

function render(tplPath, lang, outPath, canon) {
  const tpl = readFileSync(tplPath, 'utf8');
  let html = pickLang(tpl, lang);
  html = html
    .replaceAll('{{LANG}}', lang)
    .replaceAll('{{ROOT}}', lang === 'kk' ? '../' : '')
    .replaceAll('{{CANON}}', canon)
    .replaceAll('{{RU_ON}}', lang === 'ru' ? 'on' : '')
    .replaceAll('{{KK_ON}}', lang === 'kk' ? 'on' : '');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);
  return html.length;
}

// ── страницы: [шаблон, имя в dist, canonical] ──
const PAGES = [
  ['_index.template.html', 'index.html', '/'],
  ['_pricing.template.html', 'pricing.html', '/pricing.html'],
];

// вертикали генерируются из одного шаблона с подстановкой данных
export const PAGES_SIMPLE = [
  { slug: 'integrations', ru: 'Интеграции: Webkassa, Kaspi, re:Kassa, Wolt', kk: 'Интеграциялар: Webkassa, Kaspi, re:Kassa, Wolt' },
  { slug: 'partners', ru: 'Партнёрам — комиссия каждый месяц', kk: 'Серіктестерге — ай сайынғы комиссия' },
  { slug: 'demo', ru: 'Живое демо кассы в браузере', kk: 'Браузердегі тірі касса демосы' },
  { slug: 'register', ru: 'Создать аккаунт — 14 дней бесплатно', kk: 'Аккаунт жасау — 14 күн тегін' },
];

export const VERTICALS = [
  { slug: 'cafe', ru: 'Кафе и ресторан', kk: 'Кафе және мейрамхана' },
  { slug: 'fastfood', ru: 'Фастфуд и столовая', kk: 'Фастфуд және асхана' },
  { slug: 'shop', ru: 'Магазин', kk: 'Дүкен' },
  { slug: 'billiard', ru: 'Бильярд и караоке', kk: 'Бильярд және караоке' },
  { slug: 'salon', ru: 'Салон красоты', kk: 'Сұлулық салоны' },
];

function main() {
  if (existsSync(DIST)) rmSync(DIST, { recursive: true });
  mkdirSync(DIST, { recursive: true });
  cpSync(join(SRC, 'css'), join(DIST, 'css'), { recursive: true });
  cpSync(join(SRC, 'js'), join(DIST, 'js'), { recursive: true });

  let total = 0;
  for (const [tpl, out, canon] of PAGES) {
    const p = join(SRC, tpl);
    if (!existsSync(p)) continue;
    total += render(p, 'ru', join(DIST, out), canon);
    total += render(p, 'kk', join(DIST, 'kk', out), '/kk' + canon);
    console.log(`  ✓ ${out} (ru + kk)`);
  }

  // вертикали
  const vtpl = join(SRC, '_vertical.template.html');
  if (existsSync(vtpl)) {
    const raw = readFileSync(vtpl, 'utf8');
    for (const v of VERTICALS) {
      for (const lang of ['ru', 'kk']) {
        let html = pickLang(raw, lang);
        html = html
          .replaceAll('{{LANG}}', lang)
          .replaceAll('{{ROOT}}', lang === 'kk' ? '../../' : '../')
          .replaceAll('{{CANON}}', `${lang === 'kk' ? '/kk' : ''}/pages/${v.slug}.html`)
          .replaceAll('{{RU_ON}}', lang === 'ru' ? 'on' : '')
          .replaceAll('{{KK_ON}}', lang === 'kk' ? 'on' : '')
          .replaceAll('{{SLUG}}', v.slug)
          .replaceAll('{{TITLE}}', lang === 'kk' ? v.kk : v.ru);
        // блоки, специфичные для вертикали: <v-cafe>…</v-cafe> оставляем только свой
        html = html.replace(/<v-(\w+)>([\s\S]*?)<\/v-\1>/g, (_, slug, body) => (slug === v.slug ? body : ''));
        const out = join(DIST, lang === 'kk' ? 'kk' : '', 'pages', `${v.slug}.html`);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, html);
        total += html.length;
      }
      console.log(`  ✓ pages/${v.slug}.html (ru + kk)`);
    }
  }

  // вспомогательные страницы: интеграции, партнёрам, демо, регистрация
  const ptpl = join(SRC, '_page.template.html');
  if (existsSync(ptpl)) {
    const raw = readFileSync(ptpl, 'utf8');
    for (const p of PAGES_SIMPLE) {
      for (const lang of ['ru', 'kk']) {
        let html = pickLang(raw, lang);
        html = html
          .replaceAll('{{LANG}}', lang)
          .replaceAll('{{ROOT}}', lang === 'kk' ? '../../' : '../')
          .replaceAll('{{CANON}}', `${lang === 'kk' ? '/kk' : ''}/pages/${p.slug}.html`)
          .replaceAll('{{RU_ON}}', lang === 'ru' ? 'on' : '')
          .replaceAll('{{KK_ON}}', lang === 'kk' ? 'on' : '')
          .replaceAll('{{SLUG}}', p.slug)
          .replaceAll('{{TITLE}}', lang === 'kk' ? p.kk : p.ru);
        html = html.replace(/<v-(\w+)>([\s\S]*?)<\/v-\1>/g, (_, slug, body) => (slug === p.slug ? body : ''));
        const out = join(DIST, lang === 'kk' ? 'kk' : '', 'pages', `${p.slug}.html`);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, html);
        total += html.length;
      }
      console.log(`  ✓ pages/${p.slug}.html (ru + kk)`);
    }
  }

  console.log(`\nСобрано в ${DIST}, суммарно ${Math.round(total / 1024)} КБ`);
}

if (process.argv[1] && process.argv[1].endsWith('build.mjs')) main();
