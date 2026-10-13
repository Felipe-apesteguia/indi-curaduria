import { describe, expect, it } from 'vitest';
import { exportarCsv, importarCsv, parsearCsv } from './csv';
import type { Capa, Foto } from './tipos';

const capas: Capa[] = [{ id: 'c1', nombre: 'Capa, uno', origen: 'nueva', descripcion: '', fuente: '', n: 2 }];
const foto = (id: string, marca: string): Foto => ({
  id, capa: 'c1', edicion: 'Ed', temporada: 'PV', anio: 2026, marca, archivo: id + '.jpg',
  t: 'fotos/c1/t/' + id + '.webp', v: 'fotos/c1/v/' + id + '.webp', w: 10, h: 20,
  url_origen: 'https://x/' + id, url_pagina: 'https://x', fuente: 'x', extra: { sha256: 'abc' },
});

describe('csv', () => {
  it('ida y vuelta: exportar e importar recupera la selección', () => {
    const fotos = [foto('A-1', 'Marca "con" comillas, y coma'), foto('A-2', 'Línea\nnueva')];
    const csv = exportarCsv(fotos, capas, new Set(['A-2']), 'https://ejemplo.github.io/indi/');
    expect(csv.startsWith('﻿id,conservar,')).toBe(true);
    const r = importarCsv(csv, new Set(['A-1', 'A-2']));
    expect(r.error).toBeUndefined();
    expect(r.filas).toBe(2);
    expect([...r.conservadas]).toEqual(['A-2']);
    const filas = parsearCsv(csv);
    expect(filas[1][8]).toBe('Marca "con" comillas, y coma');
    expect(filas[2][8]).toBe('Línea\nnueva');
    expect(filas[1][10]).toBe('https://ejemplo.github.io/indi/fotos/c1/v/A-1.webp');
  });

  it('tolera «;», mayúsculas, sí/no y ids desconocidos', () => {
    const r = importarCsv('ID;Conservar\nA-1;Sí\nA-2;no\nZZZ;true\nA-3;quizás\n', new Set(['A-1', 'A-2', 'A-3']));
    expect([...r.conservadas]).toEqual(['A-1']);
    expect(r.desconocidas).toEqual(['ZZZ']);
    expect(r.sinValor).toBe(1);
  });

  it('sin columna «conservar», cada id cuenta como conservado', () => {
    const r = importarCsv('id\nA-1\n', new Set(['A-1']));
    expect([...r.conservadas]).toEqual(['A-1']);
  });

  it('sin columna id, error claro', () => {
    expect(importarCsv('foo,bar\n1,2', new Set()).error).toMatch(/id/);
  });
});
