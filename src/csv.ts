import type { Capa, Foto } from './tipos';

/* ------------------------------ escribir ------------------------------ */

function celda(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Columnas fijas, en este orden; después, los metadatos adicionales. */
export const COLUMNAS = [
  'id', 'conservar', 'capa', 'capa_nombre', 'origen_capa', 'edicion', 'temporada', 'anio', 'marca',
  'archivo_original', 'ruta_web', 'url_origen', 'url_pagina', 'fuente',
] as const;

/**
 * CSV con una fila por foto. base: URL absoluta del sitio, para que
 * «ruta_web» sirva fuera de la aplicación.
 */
export function exportarCsv(fotos: Foto[], capas: Capa[], conservadas: Set<string>, base: string): string {
  const porId = new Map(capas.map((c) => [c.id, c]));
  const extras = Array.from(new Set(fotos.flatMap((f) => Object.keys(f.extra)))).sort();
  const filas = [[...COLUMNAS, ...extras].join(',')];
  for (const f of fotos) {
    const c = porId.get(f.capa);
    const fija = [
      f.id, conservadas.has(f.id) ? 'true' : 'false', f.capa, c?.nombre ?? '', c?.origen ?? '', f.edicion,
      f.temporada, f.anio ?? '', f.marca, f.archivo, new URL(f.v, base).href, f.url_origen, f.url_pagina, f.fuente,
    ];
    filas.push([...fija, ...extras.map((k) => f.extra[k] ?? '')].map(celda).join(','));
  }
  // BOM: Excel abre bien los acentos.
  return '﻿' + filas.join('\r\n') + '\r\n';
}

/* ------------------------------- leer ------------------------------- */

/** Parser de CSV (RFC 4180): comillas, comillas dobles, saltos dentro de celdas; «,» o «;». */
export function parsearCsv(texto: string): string[][] {
  texto = texto.replace(/^﻿/, '');
  const primera = texto.slice(0, texto.search(/\r?\n|$/));
  const sep = (primera.match(/;/g) || []).length > (primera.match(/,/g) || []).length ? ';' : ',';
  const filas: string[][] = [];
  let fila: string[] = [], campo = '', comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false;
      } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => f.some((x) => x.trim() !== ''));
}

const VERDADERO = /^(true|verdadero|1|si|sí|s|x|yes|y|conservar)$/i;
const FALSO = /^(false|falso|0|no|n|)$/i;

export interface ResultadoImportacion {
  conservadas: Set<string>;
  filas: number;
  reconocidas: number;
  desconocidas: string[];
  sinValor: number;
  error?: string;
}

/**
 * Lee un CSV exportado (o cualquiera con columna «id»). Devuelve las fotos
 * a conservar. Sin columna «conservar» (por ejemplo, una lista de ids),
 * toda fila cuenta como conservada.
 */
export function importarCsv(texto: string, idsValidos: Set<string>): ResultadoImportacion {
  const filas = parsearCsv(texto);
  const r: ResultadoImportacion = { conservadas: new Set(), filas: 0, reconocidas: 0, desconocidas: [], sinValor: 0 };
  if (!filas.length) return { ...r, error: 'El archivo está vacío.' };
  const cab = filas[0].map((x) => x.trim().toLowerCase());
  const iId = cab.indexOf('id');
  const iCons = cab.indexOf('conservar');
  if (iId === -1) return { ...r, error: 'El CSV no tiene una columna «id».' };
  for (const f of filas.slice(1)) {
    const id = (f[iId] || '').trim();
    if (!id) continue;
    r.filas++;
    if (!idsValidos.has(id)) { r.desconocidas.push(id); continue; }
    r.reconocidas++;
    const v = iCons === -1 ? 'true' : (f[iCons] || '').trim();
    if (VERDADERO.test(v)) r.conservadas.add(id);
    else if (!FALSO.test(v)) r.sinValor++;
  }
  return r;
}
