// Prueba de punta a punta contra la build servida como GitHub Pages.
//   npm run build && python scripts/servir_como_pages.py &   node pruebas/e2e.cjs [url] [carpeta-capturas]
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(process.env.APPDATA || '', 'npm/node_modules/@playwright/cli/node_modules/playwright'));

const URL = process.argv[2] || 'http://localhost:8765/indi-curaduria/';
const OUT = process.argv[3] || path.join(__dirname, 'capturas');
fs.mkdirSync(OUT, { recursive: true });
let ok = 0, mal = 0;
const t = (n, c, d) => { if (c) { ok++; console.log('OK   ' + n); } else { mal++; console.log('FALLA ' + n + ' ' + (d ?? '')); } };

(async () => {
  const b = await chromium.launch(process.env.LOCALAPPDATA ? { executablePath: path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1234/chrome-win64/chrome.exe') } : {});
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const fallidas = [];
  p.on('response', (r) => { if (r.status() >= 400) fallidas.push(r.status() + ' ' + r.url()); });

  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForSelector('.tarjeta');
  const cat = await p.evaluate(() => fetch('catalogo.json').then((r) => r.json()));
  const total = cat.fotos.length;
  t('carga el catálogo y muestra el título', (await p.textContent('h1')) === 'INDI — Curaduría fotográfica');
  t('indicador de total = catálogo', (await p.textContent('.cifras')).includes(total.toLocaleString('es-AR')), await p.textContent('.cifras'));
  await p.screenshot({ path: path.join(OUT, '1440-inicio.png') });

  // Imágenes: la primera de cada capa, miniatura y visor, cargan.
  for (const c of cat.capas) {
    const f = cat.fotos.find((x) => x.capa === c.id);
    const r = await p.evaluate(async (f) => {
      const carga = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i.naturalWidth); i.onerror = () => ok(0); i.src = src; });
      return [await carga(f.t), await carga(f.v)];
    }, f);
    t(`capa ${c.id}: miniatura y visor cargan (${c.n} fotos)`, r[0] > 0 && r[1] > 0, JSON.stringify(r));
  }

  // Filtros combinables.
  const nVisibles = () => p.$$eval('.tarjeta', (l) => l.length);
  const cifra = async () => (await p.textContent('.cifras')).replace(/\s+/g, ' ');
  const capa = cat.capas[cat.capas.length - 1];
  await p.selectOption('select >> nth=0', capa.id);
  await p.waitForTimeout(300);
  t('filtro capa: muestra sólo esa capa', (await cifra()).includes(capa.n.toLocaleString('es-AR') + ' visibles'), await cifra());
  const marcaOpt = await p.$$eval('select >> nth=2', (s) => [...s[0].options].slice(1, 3).map((o) => [o.value, o.textContent]));
  await p.selectOption('select >> nth=2', marcaOpt[0][0]);
  await p.waitForTimeout(300);
  const nMarca = +marcaOpt[0][1].match(/\((\d+)\)/)[1];
  t('filtro marca combinado con capa', (await nVisibles()) === Math.min(nMarca, 120), marcaOpt[0][1] + ' → ' + (await nVisibles()));
  t('los filtros quedan en la URL', /capa=.*marca=/.test(await p.evaluate(() => location.hash)));

  // Seleccionar con el checkbox de las dos primeras tarjetas.
  const ids = await p.$$eval('.tarjeta .tarjeta__id', (l) => l.slice(0, 3).map((x) => x.textContent));
  await p.click('.tarjeta >> nth=0 >> input[type=checkbox]');
  await p.click('.tarjeta >> nth=1 >> input[type=checkbox]');
  t('checkbox: 2 conservadas', (await cifra()).includes('2 conservadas'), await cifra());

  // Visor: abrir la tercera, Enter = conservar y siguiente; ←; Espacio; Esc.
  await p.click('.tarjeta >> nth=2 >> .tarjeta__imagen');
  await p.waitForSelector('.visor img');
  const visorImg = await p.$eval('.visor img', (i) => new Promise((ok) => (i.complete ? ok(i.naturalWidth) : (i.onload = () => ok(i.naturalWidth)))));
  t('visor: abre la imagen ampliada', visorImg > 0, visorImg);
  await p.screenshot({ path: path.join(OUT, '1440-visor.png') });
  await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  t('visor: Enter conserva y pasa a la siguiente', (await cifra()).includes('3 conservadas') && /^4 de/.test(await p.textContent('.visor__barra span')), await p.textContent('.visor__barra span'));
  await p.keyboard.press('ArrowLeft');
  await p.keyboard.press(' ');
  await p.waitForTimeout(200);
  t('visor: ← y Espacio quitan la anterior', (await cifra()).includes('2 conservadas'), await cifra());
  await p.keyboard.press(' ');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  t('visor: Esc cierra y devuelve el foco a la tarjeta', !(await p.$('.visor')) && (await p.evaluate(() => document.activeElement?.getAttribute('data-abrir'))) !== null);

  // Filtro por estado y por texto.
  await p.check('input[name=estado] >> nth=1');
  await p.waitForTimeout(200);
  t('filtro «conservadas»', (await nVisibles()) === 3, await nVisibles());
  await p.click('text=Limpiar filtros');
  await p.fill('input[type=search]', ids[0]);
  await p.waitForTimeout(200);
  t('búsqueda por id', (await nVisibles()) === 1 && (await p.textContent('.tarjeta__id')) === ids[0]);
  await p.click('text=Limpiar filtros');

  // Exportar todas y sólo conservadas.
  const [d1] = await Promise.all([p.waitForEvent('download'), p.click('text=Exportar CSV · todas')]);
  const csvTodas = fs.readFileSync(await d1.path(), 'utf8');
  const filas = csvTodas.replace(/^﻿/, '').trim().split(/\r\n/);
  t('exportar todas: una fila por foto + encabezado', filas.length === total + 1, filas.length);
  t('exportar: columnas mínimas', /^id,conservar,capa,capa_nombre,origen_capa,edicion,temporada,anio,marca,archivo_original,ruta_web,url_origen,url_pagina,fuente/.test(filas[0]), filas[0].slice(0, 160));
  t('exportar: 3 true', filas.filter((l) => l.split(',')[1] === 'true').length === 3);
  t('exportar: ruta_web absoluta al sitio', filas[1].includes(URL + 'fotos/'), filas[1].slice(0, 200));
  const [d2] = await Promise.all([p.waitForEvent('download'), p.click('text=Exportar CSV · conservadas')]);
  const csvSel = fs.readFileSync(await d2.path(), 'utf8');
  t('exportar conservadas: 3 filas', csvSel.trim().split(/\r\n/).length === 4);
  const rutaCsv = path.join(OUT, 'curaduria-prueba.csv');
  fs.writeFileSync(rutaCsv, csvTodas);

  // Otra persona: navegador limpio, importa el CSV y sigue.
  const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errs.push(e.message));
  await p2.goto(URL, { waitUntil: 'networkidle' });
  await p2.waitForSelector('.tarjeta');
  t('navegador limpio: 0 conservadas', (await p2.textContent('.cifras')).includes('0 conservadas'));
  await p2.setInputFiles('input[type=file]', rutaCsv);
  await p2.waitForSelector('.aviso');
  t('importar: recupera las 3 selecciones', (await p2.textContent('.cifras')).includes('3 conservadas'), await p2.textContent('.aviso'));
  t('importar: informa filas reconocidas', /reconocidas/.test(await p2.textContent('.aviso')));
  await p2.check('input[name=estado] >> nth=1');
  await p2.waitForTimeout(200);
  const recuperadas = await p2.$$eval('.tarjeta__id', (l) => l.map((x) => x.textContent).sort());
  t('importar: son las mismas fotos', JSON.stringify(recuperadas) === JSON.stringify([ids[0], ids[1], ids[2]].sort()), recuperadas.join(','));
  await p2.click('.tarjeta >> nth=0 >> input[type=checkbox]');
  const [d3] = await Promise.all([p2.waitForEvent('download'), p2.click('text=Exportar CSV · conservadas')]);
  t('seguir y re-exportar: 2 conservadas', fs.readFileSync(await d3.path(), 'utf8').trim().split(/\r\n/).length === 3);
  await p2.reload({ waitUntil: 'networkidle' });
  t('la selección sobrevive a recargar la página', (await p2.textContent('.cifras')).includes('2 conservadas'));

  // Rendimiento: tarjetas en pantalla y carga progresiva.
  await p2.click('input[name=estado] >> nth=0');
  const n0 = await p2.$$eval('.tarjeta', (l) => l.length);
  await p2.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p2.waitForTimeout(800);
  const n1 = await p2.$$eval('.tarjeta', (l) => l.length);
  t('carga progresiva: 120 y suma al bajar', n0 === 120 && n1 > n0, n0 + ' → ' + n1);

  // Móvil.
  const pm = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await pm.goto(URL, { waitUntil: 'networkidle' });
  await pm.waitForSelector('.tarjeta');
  t('móvil: sin desborde horizontal', await pm.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await pm.screenshot({ path: path.join(OUT, '390-inicio.png') });
  await pm.tap('.tarjeta >> nth=0 >> .tarjeta__imagen');
  await pm.waitForSelector('.visor img');
  await pm.waitForTimeout(500);
  await pm.screenshot({ path: path.join(OUT, '390-visor.png') });
  await pm.tap('.visor__siguiente');
  t('móvil: «Conservar y siguiente»', /^2 de/.test(await pm.textContent('.visor__barra span')));

  t('sin errores de JS', !errs.length, JSON.stringify(errs.slice(0, 3)));
  t('sin recursos rotos (4xx/5xx)', !fallidas.length, fallidas.slice(0, 5).join(' | '));
  console.log(`\n${ok} correctas, ${mal} fallas`);
  await b.close();
  process.exit(mal ? 1 : 0);
})();
