import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Catalogo, Estado, Filtros, Foto } from './tipos';
import { exportarCsv, importarCsv } from './csv';
import { Visor } from './Visor';

const LOTE = 120;
const CLAVE_LOCAL = 'indi-curaduria:conservadas:v1';
const VACIOS: Filtros = { capa: '', anio: '', marca: '', estado: 'todas', texto: '' };

/** «De Crisci» y «DeCrisci» son la misma marca para filtrar (no se cambia el dato). */
export function claveMarca(m: string): string {
  return m.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function leerFiltrosUrl(): Filtros {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  const estado = p.get('estado');
  return {
    capa: p.get('capa') || '',
    anio: p.get('anio') || '',
    marca: p.get('marca') || '',
    estado: estado === 'conservadas' || estado === 'no-conservadas' ? estado : 'todas',
    texto: p.get('q') || '',
  };
}

function escribirFiltrosUrl(f: Filtros) {
  const p = new URLSearchParams();
  if (f.capa) p.set('capa', f.capa);
  if (f.anio) p.set('anio', f.anio);
  if (f.marca) p.set('marca', f.marca);
  if (f.estado !== 'todas') p.set('estado', f.estado);
  if (f.texto) p.set('q', f.texto);
  const h = p.toString();
  history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
}

function leerLocal(): Set<string> {
  try {
    const v = localStorage.getItem(CLAVE_LOCAL);
    return new Set(v ? (JSON.parse(v) as string[]) : []);
  } catch {
    return new Set();
  }
}

function descargar(nombre: string, contenido: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const n = (x: number) => x.toLocaleString('es-AR');

export function App() {
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [error, setError] = useState('');
  const [conservadas, setConservadas] = useState<Set<string>>(leerLocal);
  const [filtros, setFiltros] = useState<Filtros>(leerFiltrosUrl);
  const [limite, setLimite] = useState(LOTE);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [aviso, setAviso] = useState('');
  const archivo = useRef<HTMLInputElement>(null);
  const centinela = useRef<HTMLDivElement>(null);
  const ultimaTarjeta = useRef<string | null>(null);

  useEffect(() => {
    fetch('catalogo.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((d: Catalogo) => setCat(d))
      .catch((e) => setError('No se pudo cargar el catálogo (' + e.message + ').'));
  }, []);

  // La selección se guarda también en este navegador, por si se cierra la
  // pestaña antes de exportar. El CSV sigue siendo la forma de compartirla.
  useEffect(() => {
    try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify([...conservadas])); } catch { /* sin almacenamiento */ }
  }, [conservadas]);

  useEffect(() => { escribirFiltrosUrl(filtros); setLimite(LOTE); }, [filtros]);

  /* ----------------------------- opciones de filtro ----------------------------- */

  const fotosCapa = useMemo(() => (cat ? cat.fotos.filter((f) => !filtros.capa || f.capa === filtros.capa) : []), [cat, filtros.capa]);

  const anios = useMemo(() => {
    const c = new Map<string, number>();
    fotosCapa.forEach((f) => { const k = f.anio ? String(f.anio) : ''; if (k) c.set(k, (c.get(k) || 0) + 1); });
    return [...c.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [fotosCapa]);

  const marcas = useMemo(() => {
    const porClave = new Map<string, { nombres: Map<string, number>; n: number }>();
    fotosCapa.forEach((f) => {
      if (filtros.anio && String(f.anio) !== filtros.anio) return;
      const k = claveMarca(f.marca || '');
      const x = porClave.get(k) || { nombres: new Map(), n: 0 };
      x.n++;
      x.nombres.set(f.marca || 'Sin identificar', (x.nombres.get(f.marca || 'Sin identificar') || 0) + 1);
      porClave.set(k, x);
    });
    return [...porClave.entries()]
      .map(([k, x]) => ({ clave: k, nombre: [...x.nombres.entries()].sort((a, b) => b[1] - a[1])[0][0], variantes: [...x.nombres.keys()], n: x.n }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [fotosCapa, filtros.anio]);

  /* ------------------------------- fotos visibles ------------------------------- */

  const visibles = useMemo(() => {
    if (!cat) return [];
    const q = filtros.texto.trim().toLowerCase();
    return fotosCapa.filter((f) =>
      (!filtros.anio || String(f.anio) === filtros.anio) &&
      (!filtros.marca || claveMarca(f.marca || '') === filtros.marca) &&
      (filtros.estado === 'todas' || (filtros.estado === 'conservadas') === conservadas.has(f.id)) &&
      (!q || f.id.toLowerCase().includes(q) || f.archivo.toLowerCase().includes(q)),
    );
  }, [cat, fotosCapa, filtros, conservadas]);

  // Carga progresiva: más tarjetas al acercarse al final.
  useEffect(() => {
    const el = centinela.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) setLimite((l) => l + LOTE); }, { rootMargin: '1200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [cat, visibles.length]);

  /* -------------------------------- acciones -------------------------------- */

  const alternar = useCallback((id: string, valor?: boolean) => {
    setConservadas((s) => {
      const nuevo = new Set(s);
      const v = valor ?? !nuevo.has(id);
      if (v) nuevo.add(id); else nuevo.delete(id);
      return nuevo;
    });
  }, []);

  const cambiar = (k: keyof Filtros, v: string) => setFiltros((f) => ({ ...f, [k]: v, ...(k === 'capa' ? { anio: '', marca: '' } : {}), ...(k === 'anio' ? { marca: '' } : {}) }));

  function marcarVisibles(v: boolean) {
    if (visibles.length > 50 && !confirm(`¿${v ? 'Conservar' : 'Quitar'} las ${n(visibles.length)} fotografías visibles?`)) return;
    setConservadas((s) => {
      const nuevo = new Set(s);
      visibles.forEach((f) => (v ? nuevo.add(f.id) : nuevo.delete(f.id)));
      return nuevo;
    });
  }

  function exportar(soloConservadas: boolean) {
    if (!cat) return;
    const lista = soloConservadas ? cat.fotos.filter((f) => conservadas.has(f.id)) : cat.fotos;
    const fecha = new Date().toISOString().slice(0, 10);
    descargar(`indi-curaduria-${soloConservadas ? 'conservadas' : 'todas'}-${fecha}.csv`, exportarCsv(lista, cat.capas, conservadas, location.href.split('#')[0]));
    setAviso(`Exportadas ${n(lista.length)} fotografías${soloConservadas ? ' conservadas' : ''}.`);
  }

  async function importar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !cat) return;
    const r = importarCsv(await file.text(), new Set(cat.fotos.map((f) => f.id)));
    if (r.error) { setAviso('No se pudo importar: ' + r.error); return; }
    if (conservadas.size && !confirm(`El CSV trae ${n(r.conservadas.size)} fotografías para conservar. ¿Reemplazar la selección actual (${n(conservadas.size)})?`)) return;
    setConservadas(r.conservadas);
    setAviso(
      `Importado «${file.name}»: ${n(r.reconocidas)} de ${n(r.filas)} filas reconocidas, ${n(r.conservadas.size)} para conservar.` +
      (r.desconocidas.length ? ` ${n(r.desconocidas.length)} ids no están en el catálogo (se ignoraron).` : '') +
      (r.sinValor ? ` ${n(r.sinValor)} filas con «conservar» ilegible (quedan sin conservar).` : ''),
    );
  }

  const abrir = (i: number, id: string) => { ultimaTarjeta.current = id; setAbierta(i); };
  const cerrar = () => {
    setAbierta(null);
    const id = ultimaTarjeta.current;
    if (id) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-abrir="${CSS.escape(id)}"]`)?.focus());
  };

  if (error) return <p className="estado">{error}</p>;
  if (!cat) return <p className="estado">Cargando el catálogo…</p>;

  const capaNombre = new Map(cat.capas.map((c) => [c.id, c.nombre]));
  const conservadasVisibles = visibles.filter((f) => conservadas.has(f.id)).length;
  const hayFiltros = JSON.stringify(filtros) !== JSON.stringify(VACIOS);

  return (
    <div className="app">
      <header className="cabecera">
        <div className="cabecera__titulo">
          <h1>INDI — Curaduría fotográfica</h1>
          <p className="cifras" aria-live="polite">
            <span><b>{n(cat.fotos.length)}</b> fotografías</span>
            <span><b>{n(conservadas.size)}</b> conservadas</span>
            {hayFiltros && <span><b>{n(visibles.length)}</b> visibles · {n(conservadasVisibles)} conservadas</span>}
          </p>
        </div>
        <div className="acciones">
          <button type="button" onClick={() => archivo.current?.click()}>Importar CSV</button>
          <input ref={archivo} type="file" accept=".csv,text/csv" hidden onChange={importar} />
          <button type="button" onClick={() => exportar(false)}>Exportar CSV · todas</button>
          <button type="button" className="primario" onClick={() => exportar(true)} disabled={!conservadas.size}>Exportar CSV · conservadas</button>
        </div>
      </header>

      <section className="filtros" aria-label="Filtros">
        <label>Capa / edición
          <select value={filtros.capa} onChange={(e) => cambiar('capa', e.target.value)}>
            <option value="">Todas las capas ({n(cat.fotos.length)})</option>
            {cat.capas.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({n(c.n)})</option>)}
          </select>
        </label>
        <label>Año
          <select value={filtros.anio} onChange={(e) => cambiar('anio', e.target.value)}>
            <option value="">Todos</option>
            {anios.map(([a, c]) => <option key={a} value={a}>{a} ({n(c)})</option>)}
          </select>
        </label>
        <label>Marca
          <select value={filtros.marca} onChange={(e) => cambiar('marca', e.target.value)}>
            <option value="">Todas ({n(marcas.length)})</option>
            {marcas.map((m) => <option key={m.clave} value={m.clave} title={m.variantes.join(' · ')}>{m.nombre} ({n(m.n)})</option>)}
          </select>
        </label>
        <fieldset className="estado-filtro">
          <legend>Selección</legend>
          {(['todas', 'conservadas', 'no-conservadas'] as Estado[]).map((e) => (
            <label key={e}><input type="radio" name="estado" checked={filtros.estado === e} onChange={() => cambiar('estado', e)} />
              {e === 'todas' ? 'Todas' : e === 'conservadas' ? 'Conservadas' : 'No conservadas'}</label>
          ))}
        </fieldset>
        <label className="buscar">Archivo o id
          <input type="search" value={filtros.texto} placeholder="AF2016-012, IMG_8986…" onChange={(e) => cambiar('texto', e.target.value)} />
        </label>
        <div className="filtros__acciones">
          {hayFiltros && <button type="button" className="texto" onClick={() => setFiltros(VACIOS)}>Limpiar filtros</button>}
          <button type="button" className="texto" onClick={() => marcarVisibles(true)} disabled={!visibles.length}>Conservar visibles</button>
          <button type="button" className="texto" onClick={() => marcarVisibles(false)} disabled={!conservadasVisibles}>Quitar visibles</button>
        </div>
      </section>

      {aviso && <p className="aviso" role="status">{aviso} <button type="button" className="texto" onClick={() => setAviso('')}>Cerrar</button></p>}

      {visibles.length === 0 ? (
        <p className="estado">Ninguna fotografía coincide con los filtros.</p>
      ) : (
        <ul className="galeria">
          {visibles.slice(0, limite).map((f: Foto, i) => {
            const si = conservadas.has(f.id);
            return (
              <li key={f.id} className={'tarjeta' + (si ? ' es-conservada' : '')}>
                <button type="button" className="tarjeta__imagen" data-abrir={f.id} onClick={() => abrir(i, f.id)} aria-label={`Ampliar ${f.marca || 'sin marca'}, ${f.id}`}>
                  <img src={f.t} alt="" loading="lazy" decoding="async" width={300} height={Math.round((300 * f.h) / f.w) || 400} />
                </button>
                <div className="tarjeta__datos">
                  <p className="tarjeta__marca">{f.marca || <i>Sin marca identificada</i>}</p>
                  <p className="tarjeta__meta">{f.anio ?? 's/f'} · {capaNombre.get(f.capa)}</p>
                  <p className="tarjeta__id">{f.id}</p>
                </div>
                <label className="tarjeta__check">
                  <input type="checkbox" checked={si} onChange={() => alternar(f.id)} />
                  Conservar
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <div ref={centinela} className="centinela" aria-hidden="true" />
      {limite < visibles.length && <p className="estado">Mostrando {n(limite)} de {n(visibles.length)}…</p>}

      {abierta !== null && visibles[abierta] && (
        <Visor
          fotos={visibles}
          indice={abierta}
          capaNombre={capaNombre}
          conservadas={conservadas}
          onAlternar={alternar}
          onIr={(i) => { ultimaTarjeta.current = visibles[i].id; setAbierta(i); if (i >= limite) setLimite(i + LOTE); }}
          onCerrar={cerrar}
        />
      )}

      <footer className="pie">
        Catálogo generado el {new Date(cat.generado).toLocaleString('es-AR')}. La selección se guarda en este navegador; para compartirla, exportá el CSV.
      </footer>
    </div>
  );
}
