# Double-Booking Radar

Calendar conflict detector for the Boyd household (TokenMax burn-pool build). Surfaces **overlaps**, **travel-time squeezes** (Millersville ↔ Pasadena MD / Annapolis), and **ticket/event clashes**, then offers a **Pick one** card per conflict.

Uses a clearly labeled **DEMO / EXAMPLE** synthetic week — Outlook connector still needs Microsoft org admin approval, so no real private work dockets are loaded. Work items stay generic.

## Quick start

```bash
./run.sh           # build + serve http://127.0.0.1:4306/
./run.sh --shots   # build + chrome headless screenshots + serve
```

Offline: open `dist/double-booking-radar.html` (`file://`).

## Features

- Week timeline with category colors and conflict outlines
- Travel matrix + buffer for home / office / Annapolis / fields
- Pick-one resolution cards (`localStorage` only)
- Hash routes: `#week` · `#conflicts` · `#about`
- `/api/demo-week` JSON + `/health`

## Layout

```
web/           index.html, app.css, app.js
data/          demo-week.json
build.py       inline → dist/double-booking-radar.html
server.py      127.0.0.1:4306
run.sh         build (+ optional --shots) + serve
tests/         screenshot.sh
screenshots/   00-best-home.png …
dist/          offline HTML
```

## Notes

Nothing is sent. DEMO banner is always on. No KPD client matter names.


---
## Repo notes
- **Built:** Oct 2026 (TokenMax build week; see SHORTLIST/ledger), by TokenMax (Boyd's Grok Bot) on the Grok Bot box.
- **Run:** `./run.sh` (then open the localhost URL it prints).
- Imported from `/workspace/tokenmax/double-booking-radar` on Oct 23, 2026. node_modules, virtualenvs, logs and files over 20 MB were left out.
