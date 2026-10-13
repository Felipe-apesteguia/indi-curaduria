/** Una capa: un conjunto de fotografías con una misma procedencia. */
export interface Capa {
  id: string;
  nombre: string;
  /** «indi» = ya está en el archivo de INDI; «nueva» = descarga nueva. */
  origen: 'indi' | 'nueva';
  descripcion: string;
  fuente: string;
  n: number;
}

export interface Foto {
  /** Identificador estable: la clave que une la foto con el CSV. */
  id: string;
  capa: string;
  edicion: string;
  temporada: string;
  anio: number | null;
  marca: string;
  /** Nombre del archivo original en la fuente. */
  archivo: string;
  /** Miniatura y versión del visor (rutas relativas al sitio). */
  t: string;
  v: string;
  w: number;
  h: number;
  url_origen: string;
  url_pagina: string;
  fuente: string;
  /** Otros metadatos disponibles (van tal cual al CSV). */
  extra: Record<string, string>;
}

export interface Catalogo {
  generado: string;
  capas: Capa[];
  fotos: Foto[];
}

export type Estado = 'todas' | 'conservadas' | 'no-conservadas';

export interface Filtros {
  capa: string;
  anio: string;
  marca: string;
  estado: Estado;
  texto: string;
}
