# Opcjonalny serwer dla edycji modułów. Do zwykłej gry wystarczy GRA.html.
from pathlib import Path
from functools import partial
import http.server, socketserver, sys
class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
port = int(sys.argv[1]) if len(sys.argv)>1 else 8000
handler = partial(NoCache, directory=str(Path(__file__).resolve().parent))
socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("127.0.0.1", port), handler) as httpd:
    print(f"Gra: http://localhost:{port}/   (Ctrl+C = stop)")
    httpd.serve_forever()
