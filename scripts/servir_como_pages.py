"""
Sirve dist/ bajo /indi-curaduria/, como GitHub Pages sirve un sitio de
proyecto (https://<usuario>.github.io/indi-curaduria/). Para probar rutas.

    npm run build && python scripts/servir_como_pages.py   → http://localhost:8765/indi-curaduria/
"""
import http.server
import os
import sys

PREFIJO = '/indi-curaduria'
DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'dist')


class Manejador(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=DIST, **k)

    def translate_path(self, path):
        if not path.startswith(PREFIJO + '/'):
            return os.path.join(DIST, '__no_existe__')  # 404 fuera del prefijo, como Pages
        return super().translate_path(path[len(PREFIJO):])

    def log_message(self, *a):
        pass


puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
print(f'http://localhost:{puerto}{PREFIJO}/')
http.server.ThreadingHTTPServer(('127.0.0.1', puerto), Manejador).serve_forever()
