"""
Construye el catálogo unificado de la curaduría y las imágenes web.

    python scripts/construir_catalogo.py

Lee (sin modificar nada):

  1. ../legacy/datos/bafweek.json + ../legacy/assets/baf/…
     → capa «fba-2003-2006»: Fashion Buenos Aires 2003–2006, el archivo
       histórico que ya está en INDI.
  2. ../INDI_AF_2016_DESCARGA/manifest.csv + images/
     → capa «bafweek-2016»: BAFWEEK 2016, ya importada en INDI.
  3. datos/bafweek/catalogo_descargas.csv (scripts/descargar_bafweek.py)
     → capas «bafweek-2026-oi» y «bafweek-2027-pv»: descargas nuevas.

Escribe:

  public/catalogo.json          lo que lee la aplicación
  public/fotos/<capa>/t/<id>.webp   miniatura (400 px de ancho)
  public/fotos/<capa>/v/<id>.webp   visor (lado mayor ≤ 1600 px)
  datos/catalogo.csv            el catálogo completo, para auditar
  datos/excluidas.csv           lo que no entra y por qué

Reglas:

  · Identificador estable por foto: el código de la fuente cuando existe
    (AF2016-001), la clave del archivo histórico (FBA-…) o un hash de la URL
    de origen (BAF26OI-…, BAF27PV-…). Nunca cambia entre corridas.
  · Duplicados: misma imagen (sha256) en cualquier capa → se conserva la
    primera (en el orden de las capas) y la otra va a excluidas.csv.
  · Archivos que no son imágenes válidas → excluidas.csv.
  · Las imágenes web se generan una vez: si ya existen, no se rehacen.
  · Nada se inventa: lo que la fuente no dice queda vacío.
"""
import csv
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

from PIL import Image, ImageOps

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROYECTO = os.path.dirname(RAIZ)
LEGACY = os.path.join(PROYECTO, 'legacy')
AF2016 = os.path.join(PROYECTO, 'INDI_AF_2016_DESCARGA')
NUEVAS = os.path.join(RAIZ, 'datos', 'bafweek')
PUBLICO = os.path.join(RAIZ, 'public')

ANCHO_T = 400
LADO_V = 1600

CAPAS = [
    {'id': 'fba-2003-2006', 'nombre': 'INDI · Fashion Buenos Aires 2003–2006', 'origen': 'indi',
     'descripcion': 'Archivo histórico ya publicado en INDI: desfiles de cinco ediciones de Fashion Buenos Aires.',
     'fuente': 'Archivo INDI (legacy/datos/bafweek.json)'},
    {'id': 'bafweek-2016', 'nombre': 'INDI · BAFWEEK 2016', 'origen': 'indi',
     'descripcion': 'Desfiles de BAFWEEK 2016 recuperados de bafweek.com.ar vía Internet Archive; ya importados en INDI.',
     'fuente': 'BAFWEEK / Internet Archive (INDI_AF_2016_DESCARGA)'},
    {'id': 'bafweek-2026-oi', 'nombre': 'Nueva · BAFWEEK Otoño-Invierno 2026', 'origen': 'nueva',
     'descripcion': 'Descarga nueva de bafweek.com.ar/bafweek-otono-invierno-2026/.',
     'fuente': 'bafweek.com.ar'},
    {'id': 'bafweek-2027-pv', 'nombre': 'Nueva · BAFWEEK Primavera-Verano 2027', 'origen': 'nueva',
     'descripcion': 'Descarga nueva de bafweek.com.ar/primavera-verano-2027/ (una página por marca).',
     'fuente': 'bafweek.com.ar'},
]

MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']


def sha_archivo(ruta):
    h = hashlib.sha256()
    with open(ruta, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def leer_csv(ruta):
    with open(ruta, encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


# ------------------------------------------------------------------ fuentes

def fuente_fba():
    d = json.load(open(os.path.join(LEGACY, 'datos', 'bafweek.json'), encoding='utf-8'))
    for e in d['ediciones']:
        anio = int(e['inicio'][:4])
        mes = MESES[int(e['inicio'][5:7]) - 1]
        edicion = f"Fashion Buenos Aires · {e['nro']} edición ({mes} {anio})"
        for i, x in enumerate(e.get('desfiles') or [], 1):
            yield {
                'id': f"FBA-{e['id'][4:]}-{x['slug']}",
                'capa': 'fba-2003-2006', 'edicion': edicion, 'temporada': e.get('temporada', ''),
                'anio': anio, 'marca': x.get('disenador', ''),
                'archivo': os.path.basename(x.get('origen') or x['img']),
                'ruta': os.path.join(LEGACY, x['img']),
                'url_origen': '', 'url_pagina': '', 'fuente': d.get('fuente', ''),
                'extra': {
                    'id_indi': f"baf:{e['id']}/{x['slug']}",
                    'sede': e.get('sede', ''),
                    'fecha_edicion': f"{e['inicio']} a {e['fin']}",
                    'archivo_origen': x.get('origen', ''),
                },
            }


def fuente_2016():
    for r in leer_csv(os.path.join(AF2016, 'manifest.csv')):
        yield {
            'id': r['codigo'], 'capa': 'bafweek-2016', 'edicion': 'BAFWEEK 2016',
            'temporada': '', 'anio': int(r['anio']) if r['anio'].isdigit() else None,
            'marca': r['marca'], 'archivo': r['archivo_original'],
            'ruta': os.path.join(AF2016, r['archivo_local']),
            'url_origen': r['url_wayback'] or r['url_original'], 'url_pagina': r['pagina_fuente'],
            'fuente': r['fuente'], 'sha_declarado': r['sha256'],
            'extra': {
                'id_indi': 'af:' + r['codigo'],
                'nota_fuente': r['descripcion'],
                'url_original': r['url_original'],
                'confianza': r['confianza'],
            },
        }


def fuente_nuevas():
    ruta = os.path.join(NUEVAS, 'catalogo_descargas.csv')
    if not os.path.exists(ruta):
        print('  (todavía no hay descargas nuevas: corré scripts/descargar_bafweek.py)')
        return
    for r in leer_csv(ruta):
        if r['estado'] != 'descargada':
            yield {'id': r['id'], 'capa': r['capa'], 'excluir': f"{r['estado']}: {r['error']}", 'archivo': r['archivo_original'], 'marca': r['marca']}
            continue
        yield {
            'id': r['id'], 'capa': r['capa'], 'edicion': r['edicion'], 'temporada': r['temporada'],
            'anio': int(r['anio']) if r['anio'].isdigit() else None, 'marca': r['marca'],
            'archivo': r['archivo_original'], 'ruta': os.path.join(NUEVAS, r['ruta_local']),
            'url_origen': r['url_imagen'], 'url_pagina': r['url_pagina'], 'fuente': r['fuente'],
            'sha_declarado': r['sha256'],
            'extra': {
                'orden_en_pagina': r['orden'],
                'carpeta_subida': r['carpeta_subida'],
                'fecha_en_nombre_archivo': r['fecha_en_nombre_archivo'],
                'exif_artista': r['exif_artista'],
                'exif_copyright': r['exif_copyright'],
                'exif_fecha': r['exif_fecha'],
            },
        }


# ------------------------------------------------------------------ imágenes

def derivar(ruta, capa, fid):
    """Miniatura y versión de visor (una sola vez). Devuelve (t, v, ancho, alto)."""
    t_rel = f'fotos/{capa}/t/{fid}.webp'
    v_rel = f'fotos/{capa}/v/{fid}.webp'
    t_abs, v_abs = os.path.join(PUBLICO, t_rel), os.path.join(PUBLICO, v_rel)
    with Image.open(ruta) as im:
        im = ImageOps.exif_transpose(im)
        ancho, alto = im.size
        if os.path.exists(t_abs) and os.path.exists(v_abs):
            return t_rel, v_rel, ancho, alto
        if im.mode not in ('RGB', 'L'):
            fondo = Image.new('RGB', im.size, (255, 255, 255))
            fondo.paste(im.convert('RGBA'), mask=im.convert('RGBA').split()[-1])
            im = fondo
        else:
            im = im.convert('RGB')
        os.makedirs(os.path.dirname(t_abs), exist_ok=True)
        os.makedirs(os.path.dirname(v_abs), exist_ok=True)
        v = im.copy()
        v.thumbnail((LADO_V, LADO_V), Image.LANCZOS)
        v.save(v_abs, 'WEBP', quality=80, method=5)
        t = im.copy()
        t.thumbnail((ANCHO_T, ANCHO_T * 3), Image.LANCZOS)
        t.save(t_abs, 'WEBP', quality=72, method=5)
    return t_rel, v_rel, ancho, alto


# ------------------------------------------------------------------ principal

def main():
    fotos, excluidas, ids, shas = [], [], set(), {}
    for fuente in (fuente_fba, fuente_2016, fuente_nuevas):
        print('==', fuente.__name__)
        for f in fuente():
            def excluir(motivo):
                excluidas.append({'id': f['id'], 'capa': f['capa'], 'marca': f.get('marca', ''), 'archivo': f.get('archivo', ''), 'motivo': motivo})
            if f.get('excluir'):
                excluir(f['excluir']); continue
            if f['id'] in ids:
                excluir('id repetido'); continue
            if not os.path.exists(f['ruta']):
                excluir('no se encontró el archivo: ' + f['ruta']); continue
            try:
                with Image.open(f['ruta']) as im:
                    im.verify()
            except Exception:
                excluir('el archivo no es una imagen válida'); continue
            sha = sha_archivo(f['ruta'])
            if f.get('sha_declarado') and f['sha_declarado'].lower() != sha:
                excluir('sha256 distinto del declarado en la fuente'); continue
            if sha in shas:
                excluir('misma imagen que ' + shas[sha]); continue
            shas[sha] = f['id']
            ids.add(f['id'])
            t, v, w, h = derivar(f['ruta'], f['capa'], f['id'])
            f['extra']['sha256'] = sha
            fotos.append({
                'id': f['id'], 'capa': f['capa'], 'edicion': f['edicion'], 'temporada': f['temporada'],
                'anio': f['anio'], 'marca': f['marca'], 'archivo': f['archivo'], 't': t, 'v': v, 'w': w, 'h': h,
                'url_origen': f['url_origen'], 'url_pagina': f['url_pagina'], 'fuente': f['fuente'],
                'extra': {k: str(x) for k, x in f['extra'].items() if x not in (None, '')},
            })
            if len(fotos) % 100 == 0:
                print(f'   {len(fotos)} fotos…')

    capas = []
    for c in CAPAS:
        nc = sum(1 for f in fotos if f['capa'] == c['id'])
        if nc:
            capas.append({**c, 'n': nc})

    os.makedirs(PUBLICO, exist_ok=True)
    cat = {'generado': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'capas': capas, 'fotos': fotos}
    with open(os.path.join(PUBLICO, 'catalogo.json'), 'w', encoding='utf-8') as fh:
        json.dump(cat, fh, ensure_ascii=False, separators=(',', ':'))

    extras = sorted({k for f in fotos for k in f['extra']})
    cols = ['id', 'capa', 'origen_capa', 'edicion', 'temporada', 'anio', 'marca', 'archivo', 'miniatura', 'visor', 'ancho', 'alto', 'url_origen', 'url_pagina', 'fuente'] + extras
    origen = {c['id']: c['origen'] for c in CAPAS}
    with open(os.path.join(RAIZ, 'datos', 'catalogo.csv'), 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for f in fotos:
            w.writerow([f['id'], f['capa'], origen[f['capa']], f['edicion'], f['temporada'], f['anio'] or '', f['marca'], f['archivo'],
                        f['t'], f['v'], f['w'], f['h'], f['url_origen'], f['url_pagina'], f['fuente']] + [f['extra'].get(k, '') for k in extras])
    with open(os.path.join(RAIZ, 'datos', 'excluidas.csv'), 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=['id', 'capa', 'marca', 'archivo', 'motivo'])
        w.writeheader()
        w.writerows(excluidas)

    print()
    for c in capas:
        print(f"{c['id']:<18} {c['n']:>5}")
    print(f"{'total':<18} {len(fotos):>5}   excluidas: {len(excluidas)}")
    for x in excluidas:
        print('  -', x['id'], x['motivo'])


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
