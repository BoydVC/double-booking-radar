#!/usr/bin/env python3
"""Inline web/ + data/demo-week.json into one offline file: dist/double-booking-radar.html."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def rd(rel):
    with open(os.path.join(HERE, rel), encoding="utf-8") as f:
        return f.read()


def main():
    demo_path = os.path.join(HERE, "data", "demo-week.json")
    with open(demo_path, encoding="utf-8") as f:
        demo = json.load(f)
    demo_js = json.dumps(demo, ensure_ascii=False)
    html = rd("web/index.html")
    html = html.replace("/*__CSS__*/", rd("web/app.css"))
    html = html.replace("/*__DEMO__*/ null /*__/DEMO__*/", demo_js)
    app = rd("web/app.js").replace("</script", "<\\/script")
    html = html.replace("/*__APP__*/", app)
    os.makedirs(os.path.join(HERE, "dist"), exist_ok=True)
    out = os.path.join(HERE, "dist", "double-booking-radar.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    n = len(demo.get("events", []))
    print(f"built {out} ({os.path.getsize(out):,} bytes) · events={n} · DEMO")


if __name__ == "__main__":
    main()
