"""
Descarga las fotografías de dos ediciones de BAFWEEK para la curaduría de INDI.

    python scripts/descargar_bafweek.py            # descarga lo que falte
    python scripts/descargar_bafweek.py --listar   # sólo lista (no descarga)

Estructura del sitio (tema Salient / WPBakery, analizada el 12/10/2026):

  · Otoño-Invierno 2026 (/bafweek-otono-invierno-2026/): una grilla de
    portfolio donde CADA tarjeta es una foto. La marca es el <h3> de la
    tarjeta y el enlace .pretty_photo apunta a la imagen completa.
  · Primavera-Verano 2027 (/primavera-verano-2027/): una tarjeta por marca que
    lleva a /portfolio/<marca>/; ahí, una galería cuyas tarjetas enlazan a la
    imagen completa. La marca es el <h1> de esa página.

Reglas:

  · robots.txt se consulta antes de cada URL; entre pedidos hay una pausa
    (PAUSA segundos) y un User-Agent que identifica el proyecto.
  · Idempotente: si la imagen ya está en disco y figura en el catálogo con su
    sha256, no se vuelve a descargar.
  · Cada archivo se verifica con Pillow: una página de error guardada como
    .jpg no entra (ver AF2016-477 en la descarga de 2016).
  · No se infiere nada que la fuente no diga. La fecha y hora que traen los
    nombres de archivo de cámara (BAFW2026_0825_202325_…) se guardan en una
    columna aparte, rotulada como tal.

Salida (en datos/bafweek/, fuera del repositorio publicado):

  originales/<capa>/<marca>/<archivo_original>
  catalogo_descargas.csv     una fila por imagen
"""
import argparse
import csv
import hashlib
import io
import os
import re
import sys
import time
import unicodedata
import urllib.robotparser
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from PIL import Image, ExifTags

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.join(RAIZ, 'datos', 'bafweek')
CATALOGO = os.path.join(SALIDA, 'catalogo_descargas.csv')
UA = 'INDI-curaduria/1.0 (investigacion academica, Indumentaria Diseno e Industria, FADU-UBA)'
PAUSA = 1.2

EDICIONES = [
    {
        'capa': 'bafweek-2026-oi',
        'edicion': 'BAFWEEK Otoño-Invierno 2026',
        'temporada': 'Otoño-Invierno 2026',
        'url': 'https://bafweek.com.ar/bafweek-otono-invierno-2026/',
        'tipo': 'grilla',
    },
    {
        'capa': 'bafweek-2027-pv',
        'edicion': 'BAFWEEK Primavera-Verano 2027',
        'temporada': 'Primavera-Verano 2027',
        'url': 'https://bafweek.com.ar/primavera-verano-2027/',
        'tipo': 'portfolio',
    },
]

COLUMNAS = [
    'id', 'capa', 'edicion', 'temporada', 'anio', 'marca', 'orden',
    'url_edicion', 'url_pagina', 'url_imagen', 'archivo_original', 'ruta_local',
    'ancho', 'alto', 'bytes', 'mime', 'sha256',
    'fecha_en_nombre_archivo', 'carpeta_subida', 'exif_artista', 'exif_copyright', 'exif_fecha',
    'fuente', 'descargado', 'estado', 'error',
]

sesion = requests.Session()
sesion.headers['User-Agent'] = UA
robots = urllib.robotparser.RobotFileParser('https://bafweek.com.ar/robots.txt')
robots.read()


def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-') or 'sin-marca'


def pedir(url):
    if not robots.can_fetch(UA, url):
        raise RuntimeError('robots.txt no permite ' + url)
    for intento in range(4):
        try:
            r = sesion.get(url, timeout=60)
            if r.status_code in (429, 500, 502, 503, 504):
                raise requests.HTTPError(str(r.status_code))
            r.raise_for_status()
            time.sleep(PAUSA)
            return r
        except (requests.RequestException, requests.HTTPError) as e:
            espera = PAUSA * (2 ** (intento + 1))
            print(f'  reintento en {espera:.0f} s ({e})', file=sys.stderr)
            time.sleep(espera)
    raise RuntimeError('no se pudo descargar ' + url)


def sin_tamano(url):
    """…/foto-683x1024.png → …/foto.png (por si un enlace apunta a un recorte)."""
    return re.sub(r'-\d{2,4}x\d{2,4}(\.[a-z]+)$', r'\1', url, flags=re.I)


def listar(ed):
    """Lista de (marca, url_pagina, url_imagen) en el orden de la página."""
    s = BeautifulSoup(pedir(ed['url']).text, 'html.parser')
    fotos = []
    if ed['tipo'] == 'grilla':
        for it in s.select('.work-item'):
            a = it.select_one('a.pretty_photo[href]')
            h = it.select_one('h3')
            if a and re.search(r'\.(jpe?g|png|webp)$', a['href'], re.I):
                fotos.append((h.get_text(strip=True) if h else '', ed['url'], sin_tamano(urljoin(ed['url'], a['href']))))
    else:
        paginas = []
        for it in s.select('.work-item'):
            a = it.select_one('.work-info a[href]')
            if a and '/portfolio/' in a['href'] and a['href'] not in paginas:
                paginas.append(a['href'])
        for pag in paginas:
            p = BeautifulSoup(pedir(pag).text, 'html.parser')
            h1 = p.select_one('h1')
            marca = h1.get_text(strip=True) if h1 else ''
            vistos = set()
            for it in p.select('#portfolio-extra .work-item'):
                a = it.select_one('a[href]')
                if a and re.search(r'/wp-content/uploads/.*\.(jpe?g|png|webp)$', a['href'], re.I):
                    u = sin_tamano(urljoin(pag, a['href']))
                    if u not in vistos:
                        vistos.add(u)
                        fotos.append((marca, pag, u))
            print(f'  {marca}: {len(vistos)} fotos ({pag})')
    return fotos


def exif(img):
    r = {'artista': '', 'copyright': '', 'fecha': ''}
    try:
        e = img.getexif()
        nombres = {v: k for k, v in ExifTags.TAGS.items()}
        r['artista'] = str(e.get(nombres['Artist'], '') or '').strip()
        r['copyright'] = str(e.get(nombres['Copyright'], '') or '').strip()
        sub = e.get_ifd(0x8769) if hasattr(e, 'get_ifd') else {}
        r['fecha'] = str(sub.get(nombres['DateTimeOriginal'], '') or e.get(nombres['DateTime'], '') or '').strip()
    except Exception:
        pass
    return r


def fecha_en_nombre(nombre):
    m = re.search(r'BAFW(\d{4})_(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})', nombre)
    if not m:
        return ''
    try:
        return datetime(*map(int, m.groups())).strftime('%Y-%m-%d %H:%M:%S')
    except ValueError:
        return ''


def leer_catalogo():
    if not os.path.exists(CATALOGO):
        return {}
    with open(CATALOGO, encoding='utf-8-sig', newline='') as f:
        return {r['url_imagen']: r for r in csv.DictReader(f)}


def guardar_catalogo(filas):
    os.makedirs(SALIDA, exist_ok=True)
    tmp = CATALOGO + '.tmp'
    with open(tmp, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=COLUMNAS)
        w.writeheader()
        for r in filas:
            w.writerow({k: r.get(k, '') for k in COLUMNAS})
    os.replace(tmp, CATALOGO)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--listar', action='store_true', help='sólo listar, sin descargar')
    args = ap.parse_args()

    previo = leer_catalogo()
    filas, shas = [], {}
    for r in previo.values():
        if r.get('sha256'):
            shas.setdefault(r['sha256'], r['id'])

    for ed in EDICIONES:
        print(f"== {ed['edicion']}")
        fotos = listar(ed)
        print(f'   {len(fotos)} fotos en la página')
        if args.listar:
            continue
        for orden, (marca, pagina, url) in enumerate(fotos, 1):
            fid = ed['capa'].upper().replace('BAFWEEK-', 'BAF') + '-' + hashlib.sha1(url.encode()).hexdigest()[:10]
            nombre = os.path.basename(urlparse(url).path)
            rel = os.path.join('originales', ed['capa'], slug(marca), nombre).replace('\\', '/')
            ruta = os.path.join(SALIDA, rel)
            fila = dict(previo.get(url, {}))
            fila.update({
                'id': fid, 'capa': ed['capa'], 'edicion': ed['edicion'], 'temporada': ed['temporada'],
                'marca': marca, 'orden': orden, 'url_edicion': ed['url'], 'url_pagina': pagina,
                'url_imagen': url, 'archivo_original': nombre, 'ruta_local': rel,
                'fecha_en_nombre_archivo': fecha_en_nombre(nombre),
                'carpeta_subida': '/'.join(re.findall(r'/uploads/(\d{4})/(\d{2})/', url)[0]) if '/uploads/' in url else '',
                'fuente': 'bafweek.com.ar',
            })
            # Año: el de la carpeta de subida del sitio (dato de la fuente).
            fila['anio'] = fila['carpeta_subida'][:4]

            if previo.get(url, {}).get('estado') == 'descargada' and os.path.exists(ruta):
                filas.append(fila)
                continue
            try:
                r = pedir(url)
                datos = r.content
                img = Image.open(io.BytesIO(datos))
                img.verify()
                img = Image.open(io.BytesIO(datos))
                sha = hashlib.sha256(datos).hexdigest()
                ex = exif(img)
                fila.update({
                    'ancho': img.width, 'alto': img.height, 'bytes': len(datos),
                    'mime': Image.MIME.get(img.format, r.headers.get('Content-Type', '')),
                    'sha256': sha, 'exif_artista': ex['artista'], 'exif_copyright': ex['copyright'],
                    'exif_fecha': ex['fecha'], 'descargado': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                })
                if sha in shas and shas[sha] != fid:
                    fila.update({'estado': 'duplicada', 'error': 'misma imagen que ' + shas[sha]})
                else:
                    os.makedirs(os.path.dirname(ruta), exist_ok=True)
                    with open(ruta, 'wb') as f:
                        f.write(datos)
                    shas[sha] = fid
                    fila.update({'estado': 'descargada', 'error': ''})
                print(f"   {orden:>3} {marca[:24]:<24} {nombre[:60]} {fila['estado']}")
            except Exception as e:
                fila.update({'estado': 'error', 'error': str(e)[:200]})
                print(f'   {orden:>3} {marca[:24]:<24} {nombre[:60]} ERROR {e}', file=sys.stderr)
            filas.append(fila)
            guardar_catalogo(filas + [v for k, v in previo.items() if k not in {x['url_imagen'] for x in filas}])

    if not args.listar:
        guardar_catalogo(filas)
        est = {}
        for r in filas:
            est[(r['capa'], r['estado'])] = est.get((r['capa'], r['estado']), 0) + 1
        for k, v in sorted(est.items()):
            print(f'{k[0]:<18} {k[1]:<12} {v}')


if __name__ == '__main__':
    main()
