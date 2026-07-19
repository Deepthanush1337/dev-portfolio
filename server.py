#!/usr/bin/env python3
"""Simple static file server for local development.

GitHub data (repos + contribution calendar) is fetched client-side in
assets/js/main.js, so this server does nothing besides serving files.
"""

import http.server
import os
import socketserver
from pathlib import Path

PORT = 8081


class ThreadingHTTPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Never cache during local dev
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        print(format % args)


if __name__ == "__main__":
    os.chdir(Path(__file__).parent)
    with ThreadingHTTPServer(("0.0.0.0", PORT), Handler) as httpd:
        print(f"Serving at http://localhost:{PORT}")
        httpd.serve_forever()
