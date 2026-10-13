import { useEffect, useRef } from 'react';
import type { Foto } from './tipos';

/** Nombres legibles de los metadatos adicionales. */
const ETIQUETAS: Record<string, string> = {
  id_indi: 'Id en INDI',
  sede: 'Sede',
  fecha_edicion: 'Fechas de la edición',
  archivo_origen: 'Archivo de origen',
  nota_fuente: 'Nota de la fuente',
  url_original: 'URL original',
  confianza: 'Confianza',
  orden_en_pagina: 'Orden en la página',
  carpeta_subida: 'Carpeta de subida',
  fecha_en_nombre_archivo: 'Fecha en el nombre del archivo',
  exif_artista: 'Autor (EXIF)',
  exif_copyright: 'Copyright (EXIF)',
  exif_fecha: 'Fecha (EXIF)',
};

interface Props {
  fotos: Foto[];
  indice: number;
  capaNombre: Map<string, string>;
  conservadas: Set<string>;
  onAlternar: (id: string, valor?: boolean) => void;
  onIr: (i: number) => void;
  onCerrar: () => void;
}

/**
 * Visor ampliado. Teclado: ← → anterior / siguiente · Espacio conservar /
 * quitar · Enter conservar y pasar a la siguiente · Esc cerrar.
 */
export function Visor({ fotos, indice, capaNombre, conservadas, onAlternar, onIr, onCerrar }: Props) {
  const f = fotos[indice];
  const caja = useRef<HTMLDivElement>(null);
  const si = conservadas.has(f.id);
  const hay = (i: number) => i >= 0 && i < fotos.length;

  useEffect(() => { caja.current?.focus(); }, []);

  // Precarga la siguiente imagen.
  useEffect(() => {
    if (hay(indice + 1)) { const im = new Image(); im.src = fotos[indice + 1].v; }
  }, [indice, fotos]); // eslint-disable-line react-hooks/exhaustive-deps

  function tecla(e: React.KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' && e.key === ' ') return; // el checkbox maneja su espacio
    if (e.key === 'Escape') { e.preventDefault(); onCerrar(); }
    else if (e.key === 'ArrowRight' && hay(indice + 1)) { e.preventDefault(); onIr(indice + 1); }
    else if (e.key === 'ArrowLeft' && hay(indice - 1)) { e.preventDefault(); onIr(indice - 1); }
    else if (e.key === ' ' && t.tagName !== 'BUTTON') { e.preventDefault(); onAlternar(f.id); }
    else if (e.key === 'Enter' && t.tagName !== 'BUTTON') { e.preventDefault(); onAlternar(f.id, true); if (hay(indice + 1)) onIr(indice + 1); }
    else if (e.key === 'Tab') {
      // Foco atrapado dentro del visor.
      const foco = caja.current?.querySelectorAll<HTMLElement>('button, input, a[href]');
      if (!foco || !foco.length) return;
      const primero = foco[0], ultimo = foco[foco.length - 1];
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    }
  }

  const datos: [string, string][] = [
    ['Capa', capaNombre.get(f.capa) || f.capa],
    ['Edición', f.edicion],
    ['Temporada', f.temporada],
    ['Año', f.anio ? String(f.anio) : ''],
    ['Archivo', f.archivo],
    ['Id', f.id],
    ['Tamaño original', f.w && f.h ? `${f.w} × ${f.h} px` : ''],
    ...Object.entries(f.extra).filter(([k, v]) => v && k !== 'sha256').map(([k, v]) => [ETIQUETAS[k] || k.replace(/_/g, ' '), v] as [string, string]),
  ];

  return (
    <div className="visor" role="dialog" aria-modal="true" aria-label={`${f.marca || 'Sin marca'} · ${indice + 1} de ${fotos.length}`} onKeyDown={tecla} onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className="visor__caja" ref={caja} tabIndex={-1}>
        <figure className="visor__figura">
          <img key={f.id} src={f.v} alt={`${f.marca || 'Sin marca identificada'}, ${f.edicion}`} />
        </figure>
        <aside className="visor__panel">
          <div className="visor__barra">
            <span>{indice + 1} de {fotos.length.toLocaleString('es-AR')}</span>
            <button type="button" onClick={() => onIr(indice - 1)} disabled={!hay(indice - 1)} aria-label="Anterior">←</button>
            <button type="button" onClick={() => onIr(indice + 1)} disabled={!hay(indice + 1)} aria-label="Siguiente">→</button>
            <button type="button" onClick={onCerrar} aria-label="Cerrar">✕</button>
          </div>
          <h2>{f.marca || 'Sin marca identificada'}</h2>
          <label className={'visor__check' + (si ? ' es-conservada' : '')}>
            <input type="checkbox" checked={si} onChange={() => onAlternar(f.id)} />
            Conservar
          </label>
          <button type="button" className="primario visor__siguiente" onClick={() => { onAlternar(f.id, true); if (hay(indice + 1)) onIr(indice + 1); }}>
            Conservar y siguiente
          </button>
          <dl>
            {datos.filter(([, v]) => v).map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{/^https?:\/\//.test(v) ? <a href={v} target="_blank" rel="noopener noreferrer">{v}</a> : v}</dd></div>
            ))}
            {f.url_origen && <div><dt>Origen</dt><dd><a href={f.url_origen} target="_blank" rel="noopener noreferrer">Imagen en la fuente</a>{f.url_pagina && <> · <a href={f.url_pagina} target="_blank" rel="noopener noreferrer">página</a></>}</dd></div>}
            {f.fuente && <div><dt>Fuente</dt><dd>{f.fuente}</dd></div>}
          </dl>
          <p className="visor__teclas">← → navegar · Espacio conservar / quitar · Enter conservar y seguir · Esc cerrar</p>
        </aside>
      </div>
    </div>
  );
}
