# INDI — Curaduría fotográfica

Herramienta web estática para revisar las fotografías del archivo de INDI y
de las nuevas ediciones de BAFWEEK, elegir cuáles conservar y compartir esas
decisiones en un CSV. No tiene backend, base de datos ni usuarios: el CSV es
el mecanismo para guardar y pasar el trabajo de una persona a otra.

No toca el sitio WordPress de INDI ni su plugin: lee sus archivos de origen
y genera su propio catálogo.

## Flujo

**Curar:** abrir la web → elegir capa, año o marca → revisar → marcar
«Conservar» → **Exportar CSV**.

**Continuar una curaduría:** abrir la web → **Importar CSV** → se recuperan
las selecciones (por el `id` de cada foto) → seguir → exportar de nuevo.

- **Tarjetas:** miniatura, marca, año, capa, id y la casilla «Conservar».
- **Visor:** clic en la foto. Teclado: `←` `→` navegar · `Espacio`
  conservar / quitar · `Enter` conservar y pasar a la siguiente · `Esc`
  cerrar. En el teléfono, «Conservar y siguiente».
- **Filtros combinables:** capa o edición, año, marca, conservadas / no
  conservadas, y búsqueda por nombre de archivo o id. Quedan en la URL, así
  que un enlace comparte una vista filtrada.
- **«Conservar visibles» / «Quitar visibles»:** aplican a lo que dejan ver
  los filtros (piden confirmación si son más de 50).
- **Selección:** se guarda también en el navegador (por si se cierra la
  pestaña), pero lo que se comparte es el CSV.

## Capas

| Capa | Fotos | Origen | De dónde sale |
|---|---|---|---|
| `fba-2003-2006` · INDI · Fashion Buenos Aires 2003–2006 | 101 | INDI (existente) | `../legacy/datos/bafweek.json` + `../legacy/assets/baf/` |
| `bafweek-2016` · INDI · BAFWEEK 2016 | 902 | INDI (existente) | `../INDI_AF_2016_DESCARGA/` (manifiesto) |
| `bafweek-2026-oi` · Nueva · BAFWEEK Otoño-Invierno 2026 | 134 | descarga nueva | https://bafweek.com.ar/bafweek-otono-invierno-2026/ |
| `bafweek-2027-pv` · Nueva · BAFWEEK Primavera-Verano 2027 | 545 | descarga nueva | https://bafweek.com.ar/primavera-verano-2027/ |

La columna `origen_capa` (`indi` / `nueva`) distingue lo que ya está en INDI
de lo descargado ahora. Lo que no entra está en `datos/excluidas.csv`, con el
motivo: registros repetidos del archivo histórico, un archivo de 2016 que no
es una imagen (`AF2016-477`, una página de Internet Archive guardada como
.jpg), una imagen de 2016 duplicada (`AF2016-784` = `AF2016-783`) y 16
fotos que la página de Luz Ballestero publica dos veces (copias `…-1.jpg`).

Total: **1682 fotografías** (1003 de INDI + 679 nuevas). Una misma marca
escrita distinto según la fuente («De Crisci» / «DeCrisci») se agrupa en el
filtro sin cambiar el dato; «Luz Ballestero» (PV 2027) y «Luz Ballesteros»
(OI 2026) quedan separadas porque no hay cómo confirmar que son la misma.

## El CSV

Exportar genera una fila por foto (o sólo las conservadas), UTF-8 con BOM
para que Excel muestre bien los acentos:

| Columna | Qué es |
|---|---|
| `id` | Identificador estable (la clave para importar) |
| `conservar` | `true` / `false` |
| `capa`, `capa_nombre`, `origen_capa` | Procedencia |
| `edicion`, `temporada`, `anio`, `marca` | Lo que dice la fuente |
| `archivo_original` | Nombre del archivo en la fuente |
| `ruta_web` | URL de la foto en esta web |
| `url_origen`, `url_pagina`, `fuente` | De dónde viene |
| resto | Metadatos adicionales: `sha256`, `id_indi`, `sede`, `nota_fuente`, `confianza`, `carpeta_subida`, `fecha_en_nombre_archivo`, `exif_*`… |

Importar acepta ese mismo CSV (o cualquiera con una columna `id`; separador
`,` o `;`; `conservar` en `true/false`, `sí/no`, `1/0` o `x`). Los ids que no
están en el catálogo se informan y se ignoran. Importar **reemplaza** la
selección actual (pide confirmación si había una).

### Identificadores

- `FBA-06-2003-09-anita-micheletti`: edición + diseñador del archivo
  histórico (en INDI: `baf:fba-06-2003-09/anita-micheletti`).
- `AF2016-001`: el `codigo` del manifiesto de 2016 (en INDI: `af:AF2016-001`).
- `BAF2026-OI-…`, `BAF2027-PV-…`: hash de la URL de la imagen en
  bafweek.com.ar. Mientras la URL no cambie, el id tampoco.

## Datos: cómo se generan

Requisitos: Python 3.10+ con `requests`, `beautifulsoup4` y `Pillow`.

```bash
# 1. Descargar (o completar) las ediciones nuevas de BAFWEEK.
python scripts/descargar_bafweek.py            # --listar: sólo cuenta, no descarga
# 2. Unificar las cuatro capas y generar las imágenes web.
python scripts/construir_catalogo.py
```

**Descarga** (`scripts/descargar_bafweek.py`):

- Respeta `robots.txt` (hoy no restringe nada), se identifica con un
  User-Agent propio y hace una pausa entre pedidos, con reintentos.
- Otoño-Invierno 2026 es una grilla donde cada tarjeta es una foto (marca =
  título de la tarjeta). Primavera-Verano 2027 tiene una página por marca
  (`/portfolio/…`); la marca es el título de esa página. Pucheta Paz está
  publicada en `/portfolio/maria-cher-2/`: vale el título, no la URL.
- Es idempotente: lo que ya está descargado y en el catálogo no se vuelve a
  pedir. Cada archivo se verifica como imagen y se registra su sha256.
- Guarda los originales en `datos/bafweek/originales/<capa>/<marca>/` (fuera
  del repositorio) y `datos/bafweek/catalogo_descargas.csv`.

**Metadatos de las fotos nuevas** (sólo lo que da la fuente):

- `marca`, `temporada` y `edicion`: de la página.
- `anio`: el año de la carpeta de subida del sitio (`/uploads/2026/09/`), que
  es cuando se publicó. Ojo: las dos ediciones son de 2026, aunque una se
  llame «Primavera-Verano **2027**»; la temporada está en su columna.
- `fecha_en_nombre_archivo`: la fecha y hora que traen los nombres de cámara
  (`BAFW2026_0825_202325_…` → 2026-08-25 20:23:25), en una columna aparte
  porque se deduce del nombre.
- `exif_*`: autor, copyright y fecha si la imagen los trae.
- No se deduce el fotógrafo del sufijo del nombre de archivo.

**Catálogo** (`scripts/construir_catalogo.py`):

- No modifica ningún archivo de origen.
- Duplicados entre capas por sha256: entra el primero y el resto va a
  `datos/excluidas.csv`.
- Genera `public/fotos/<capa>/t/<id>.webp` (miniatura, 400 px de ancho) y
  `v/<id>.webp` (visor, lado mayor ≤ 1600 px), una sola vez cada una.
- Escribe `public/catalogo.json` (lo que lee la app), `datos/catalogo.csv` y
  `datos/excluidas.csv`.

## Desarrollo

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # pruebas del CSV (exportar / importar)
npm run build        # dist/
python scripts/servir_como_pages.py   # dist/ bajo /indi-curaduria/, como Pages
node pruebas/e2e.cjs                  # prueba de punta a punta (Playwright)
```

React 19 + Vite + TypeScript. `base: './'` en `vite.config.ts`: la misma build
funciona en `https://<usuario>.github.io/<repositorio>/` o en un dominio
propio. La galería carga de a 120 tarjetas y suma más al bajar; las
miniaturas usan `loading="lazy"`.

## Publicar en GitHub Pages

1. Crear un repositorio en GitHub (por ejemplo `indi-curaduria`) y subir este
   proyecto a la rama `main`.
2. En el repositorio: **Settings → Pages → Build and deployment → Source:
   GitHub Actions**.
3. Cada push a `main` corre `.github/workflows/pages.yml` (instala, prueba,
   compila y publica). La dirección queda en la pestaña *Actions* y en
   Settings → Pages.

### Peso

Se publican sólo las versiones web: unos 100 KB por foto entre miniatura y
visor, unos 200 MB para ~1900 fotos. Está dentro de los límites de GitHub
Pages (sitio de hasta 1 GB; ningún archivo de más de 100 MB). Los
originales no se suben.
Si el archivo creciera mucho más, la alternativa gratuita y sin backend es
mover `public/fotos/` a un repositorio aparte o a un bucket público (por
ejemplo Cloudflare R2) y cambiar las rutas `t`/`v` del catálogo por URLs
absolutas.

### Visibilidad

Con una cuenta gratuita, GitHub Pages necesita un repositorio **público**.
Con GitHub Pro o Team se puede publicar desde uno privado, pero el sitio
igual queda público; las páginas con control de acceso son de GitHub
Enterprise Cloud. La página
lleva `noindex` para que no la indexen los buscadores, pero cualquiera con el
enlace la puede ver. Las fotografías son de BAFWEEK, Fashion Buenos Aires y
sus fotógrafos: esta herramienta es para trabajo interno de curaduría.
