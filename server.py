#!/usr/bin/env python3
"""Double-Booking Radar server — 127.0.0.1:4306. Serves live page + /api/demo-week."""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", 4306))


def rd(rel):
    with open(os.path.join(HERE, rel), encoding="utf-8") as f:
        return f.read()


def demo_js():
    p = os.path.join(HERE, "data", "demo-week.json")
    if os.path.isfile(p):
        return open(p, encoding="utf-8").read()
    return "null"


def page():
    html = rd("web/index.html")
    html = html.replace("/*__CSS__*/", rd("web/app.css"))
    html = html.replace("/*__DEMO__*/ null /*__/DEMO__*/", demo_js())
    html = html.replace(
        "/*__APP__*/", rd("web/app.js").replace("</script", "<\\/script")
    )
    return html


class H(BaseHTTPRequestHandler):
    def send(self, code, body, ctype):
        b = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        path = self.path.split("?")[0]
        try:
            if path in ("/", "/index.html", "/double-booking-radar.html"):
                self.send(200, page(), "text/html; charset=utf-8")
            elif path in ("/api/demo-week", "/api/week"):
                raw = demo_js()
                if raw == "null":
                    self.send(
                        404,
                        json.dumps({"error": "demo-week.json missing"}),
                        "application/json",
                    )
                    return
                self.send(200, raw, "application/json")
            elif path == "/health":
                self.send(
                    200,
                    json.dumps(
                        {"ok": True, "port": PORT, "app": "double-booking-radar"}
                    ),
                    "application/json",
                )
            else:
                self.send(404, "not found", "text/plain; charset=utf-8")
        except Exception as e:
            self.send(500, str(e), "text/plain; charset=utf-8")

    def log_message(self, fmt, *args):
        pass


def main():
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    print(f"Double-Booking Radar http://127.0.0.1:{PORT}/", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
