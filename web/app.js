(function () {
  "use strict";

  const HOUR_START = 8;
  const HOUR_END = 22;
  const HOUR_H = 48;
  const STORE_KEY = "dbr-picks-v1";
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const data = window.__DEMO__;
  if (!data || !Array.isArray(data.events)) {
    document.body.innerHTML =
      '<p style="padding:2rem;color:#fca5a5">DEMO data missing. Rebuild with build.py.</p>';
    return;
  }

  const locations = data.locations || {};
  const travel = data.travel_minutes || {};
  const buffer = Number(data.buffer_minutes || 10);
  let picks = loadPicks();
  let dayFilter = "all";
  let conflicts = [];

  function loadPicks() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
    } catch (_) {
      return {};
    }
  }
  function savePicks() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(picks));
    } catch (_) {}
  }

  function parseLocal(iso) {
    // Treat as America/New_York wall time without shifting
    const m = String(iso).match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/
    );
    if (!m) return new Date(iso);
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  }

  function fmtTime(d) {
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }
  function fmtDay(d) {
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
  function ymd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function minutesBetween(a, b) {
    return Math.round((b - a) / 60000);
  }
  function overlaps(a, b) {
    return a.start < b.end && b.start < a.end;
  }
  function sharesWho(a, b) {
    const wa = new Set(a.who || []);
    return (b.who || []).some((w) => wa.has(w));
  }
  function travelKey(a, b) {
    if (!a || !b || a === "remote" || b === "remote" || a === b) return null;
    const k1 = `${a}|${b}`;
    const k2 = `${b}|${a}`;
    if (travel[k1] != null) return travel[k1];
    if (travel[k2] != null) return travel[k2];
    return null;
  }
  function locName(id) {
    return (locations[id] && locations[id].name) || id || "—";
  }
  function eventById(id) {
    return enriched.find((e) => e.id === id);
  }
  function isDropped(id) {
    for (const cid of Object.keys(picks)) {
      const p = picks[cid];
      if (p && p.dropped === id) return true;
    }
    return false;
  }

  const enriched = data.events
    .map((e) => {
      const start = parseLocal(e.start);
      const end = parseLocal(e.end);
      return {
        ...e,
        start,
        end,
        day: ymd(start),
        mins: Math.max(15, minutesBetween(start, end)),
      };
    })
    .sort((a, b) => a.start - b.start);

  const weekStart = parseLocal(data.week_start + "T00:00:00");
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  function detectConflicts() {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < enriched.length; i++) {
      for (let j = i + 1; j < enriched.length; j++) {
        const a = enriched[i];
        const b = enriched[j];
        if (!sharesWho(a, b)) continue;

        let type = null;
        let why = "";
        let severity = 0;

        if (overlaps(a, b)) {
          type = "overlap";
          severity = 3;
          const ticketish =
            a.category === "ticket" ||
            b.category === "ticket" ||
            a.calendar === "Tickets" ||
            b.calendar === "Tickets";
          if (ticketish) {
            type = "ticket";
            why = `Ticket/event clash: “${a.title}” and “${b.title}” overlap for ${(a.who || []).filter((w) => (b.who || []).includes(w)).join(", ") || "attendee"}.`;
          } else {
            why = `Hard overlap (${fmtTime(a.start)}–${fmtTime(a.end)} vs ${fmtTime(b.start)}–${fmtTime(b.end)}) for shared attendee.`;
          }
        } else {
          // travel squeeze: a ends before b starts (or reverse)
          let first = a;
          let second = b;
          if (b.end <= a.start) {
            first = b;
            second = a;
          } else if (!(a.end <= b.start)) {
            continue;
          }
          const gap = minutesBetween(first.end, second.start);
          if (gap < 0 || gap > 180) continue;
          const need = travelKey(first.location_id, second.location_id);
          if (need == null) continue;
          const required = need + buffer;
          if (gap < required) {
            type = "squeeze";
            severity = 2;
            why = `Travel squeeze: ${locName(first.location_id)} → ${locName(second.location_id)} needs ~${need} min + ${buffer} min buffer (${required} min), but only ${gap} min between events.`;
          }
        }

        if (!type) continue;
        const ids = [a.id, b.id].sort();
        const cid = `${type}:${ids[0]}:${ids[1]}`;
        if (seen.has(cid)) continue;
        seen.add(cid);
        out.push({
          id: cid,
          type,
          severity,
          a,
          b,
          why,
          day: a.day < b.day ? a.day : b.day,
        });
      }
    }
    out.sort((x, y) => y.severity - x.severity || x.a.start - y.a.start);
    return out;
  }

  function conflictIdsForEvent(eid) {
    const types = {};
    for (const c of conflicts) {
      if (c.a.id === eid || c.b.id === eid) {
        types[c.type] = true;
      }
    }
    return types;
  }

  function tickClock() {
    const now = new Date();
    const el = document.getElementById("clockPill");
    if (el) {
      el.textContent = now.toLocaleString("en-US", {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      }) + " ET";
    }
  }

  function renderStats() {
    const open = conflicts.filter((c) => !picks[c.id]).length;
    const resolved = conflicts.filter((c) => picks[c.id]).length;
    const overlaps = conflicts.filter((c) => c.type === "overlap" || c.type === "ticket").length;
    const squeezes = conflicts.filter((c) => c.type === "squeeze").length;
    const activeEvents = enriched.filter((e) => !isDropped(e.id)).length;

    const weekHtml = `
      <div class="stat info"><div class="k">Events</div><div class="v">${activeEvents}</div></div>
      <div class="stat danger"><div class="k">Open conflicts</div><div class="v">${open}</div></div>
      <div class="stat warn"><div class="k">Travel squeezes</div><div class="v">${squeezes}</div></div>
      <div class="stat ok"><div class="k">Resolved picks</div><div class="v">${resolved}</div></div>`;
    const w = document.getElementById("weekStats");
    if (w) w.innerHTML = weekHtml;

    const cHtml = `
      <div class="stat danger"><div class="k">Overlaps / tickets</div><div class="v">${overlaps}</div></div>
      <div class="stat warn"><div class="k">Travel squeezes</div><div class="v">${squeezes}</div></div>
      <div class="stat info"><div class="k">Still open</div><div class="v">${open}</div></div>
      <div class="stat ok"><div class="k">Picked</div><div class="v">${resolved}</div></div>`;
    const c = document.getElementById("conflictStats");
    if (c) c.innerHTML = cHtml;
  }

  function renderDayFilters() {
    const el = document.getElementById("dayFilters");
    if (!el) return;
    const chips = [
      `<button type="button" class="chip ${dayFilter === "all" ? "on" : ""}" data-day="all">All days</button>`,
    ];
    weekDays.forEach((d, i) => {
      const key = ymd(d);
      chips.push(
        `<button type="button" class="chip ${dayFilter === key ? "on" : ""}" data-day="${key}">${DAYS[i]} ${d.getDate()}</button>`
      );
    });
    el.innerHTML = chips.join("");
    el.querySelectorAll(".chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        dayFilter = btn.getAttribute("data-day");
        renderTimeline();
        renderDayFilters();
      });
    });
  }

  function renderTimeline() {
    const label = document.getElementById("weekLabel");
    if (label) {
      const a = weekDays[0];
      const b = weekDays[6];
      label.textContent = `Week of ${fmtDay(a)} – ${fmtDay(b)} · DEMO`;
    }

    const root = document.getElementById("timeline");
    if (!root) return;

    const hours = [];
    for (let h = HOUR_START; h <= HOUR_END; h++) hours.push(h);
    const visibleDays = weekDays.filter((d) => dayFilter === "all" || ymd(d) === dayFilter);
    const cols = visibleDays.length;

    root.style.gridTemplateColumns = `72px repeat(${cols}, minmax(140px, 1fr))`;
    root.innerHTML = "";

    // header row
    const corner = document.createElement("div");
    corner.className = "tl-head";
    corner.textContent = "ET";
    root.appendChild(corner);

    const todayKey = ymd(new Date());
    visibleDays.forEach((d, i) => {
      const h = document.createElement("div");
      h.className = "tl-head" + (ymd(d) === todayKey ? " today" : "");
      h.textContent = `${DAYS[weekDays.findIndex((x) => ymd(x) === ymd(d))]} ${d.getMonth() + 1}/${d.getDate()}`;
      root.appendChild(h);
    });

    // hour rows
    hours.forEach((h) => {
      const labelCell = document.createElement("div");
      labelCell.className = "tl-hour";
      const ampm = h >= 12 ? "PM" : "AM";
      const hr = ((h + 11) % 12) + 1;
      labelCell.textContent = `${hr} ${ampm}`;
      root.appendChild(labelCell);

      visibleDays.forEach((d) => {
        const cell = document.createElement("div");
        cell.className = "tl-cell";
        cell.dataset.day = ymd(d);
        cell.dataset.hour = String(h);
        root.appendChild(cell);
      });
    });

    // overlay events per day column using absolute positioning inside a relative wrapper
    // Rebuild with day columns that span hours
    // Simpler approach: place events absolutely relative to timeline using grid math
    const gridTop = 40; // approx header — we'll use a dedicated layer

    // Rebuild structure with day columns for absolute events
    root.innerHTML = "";
    root.style.display = "grid";
    root.style.gridTemplateColumns = `72px repeat(${cols}, minmax(140px, 1fr))`;

    const headCorner = document.createElement("div");
    headCorner.className = "tl-head";
    headCorner.textContent = "ET";
    root.appendChild(headCorner);

    visibleDays.forEach((d) => {
      const h = document.createElement("div");
      const idx = weekDays.findIndex((x) => ymd(x) === ymd(d));
      h.className = "tl-head" + (ymd(d) === todayKey ? " today" : "");
      h.textContent = `${DAYS[idx]} ${d.getMonth() + 1}/${d.getDate()}`;
      root.appendChild(h);
    });

    // left hour labels + day columns as one tall cell each
    const hoursCol = document.createElement("div");
    hoursCol.style.display = "flex";
    hoursCol.style.flexDirection = "column";
    hours.forEach((h) => {
      const lab = document.createElement("div");
      lab.className = "tl-hour";
      const ampm = h >= 12 ? "PM" : "AM";
      const hr = ((h + 11) % 12) + 1;
      lab.textContent = `${hr} ${ampm}`;
      hoursCol.appendChild(lab);
    });
    root.appendChild(hoursCol);

    visibleDays.forEach((d) => {
      const col = document.createElement("div");
      col.className = "day-col";
      col.style.position = "relative";
      col.style.height = `${hours.length * HOUR_H}px`;
      col.style.borderRight = "1px solid var(--line)";
      col.style.background =
        "repeating-linear-gradient(to bottom, rgba(11,18,32,.35) 0, rgba(11,18,32,.35) 47px, rgba(36,48,73,.7) 47px, rgba(36,48,73,.7) 48px)";

      const dayKey = ymd(d);
      const dayEvents = enriched.filter((e) => e.day === dayKey);
      // lane packing for overlapping visuals
      const lanes = [];
      dayEvents.forEach((e) => {
        let lane = 0;
        while (
          lanes.some(
            (L) =>
              L.lane === lane &&
              !(e.end <= L.start || e.start >= L.end)
          )
        ) {
          lane++;
        }
        lanes.push({ lane, start: e.start, end: e.end, id: e.id });
        e._lane = lane;
      });
      const maxLane = Math.max(0, ...dayEvents.map((e) => e._lane || 0)) + 1;

      dayEvents.forEach((e) => {
        const startMin = e.start.getHours() * 60 + e.start.getMinutes();
        const endMin = e.end.getHours() * 60 + e.end.getMinutes();
        const topMin = HOUR_START * 60;
        const top = ((startMin - topMin) / 60) * HOUR_H;
        const height = Math.max(18, ((endMin - startMin) / 60) * HOUR_H - 2);
        if (endMin < topMin || startMin > HOUR_END * 60) return;

        const lane = e._lane || 0;
        const widthPct = 100 / maxLane;
        const leftPct = lane * widthPct;

        const el = document.createElement("button");
        el.type = "button";
        el.className = `evt ${e.category || "work"}`;
        if (isDropped(e.id)) el.classList.add("dropped");
        const ctypes = conflictIdsForEvent(e.id);
        if (ctypes.overlap || ctypes.ticket) el.classList.add("conflict-overlap");
        else if (ctypes.squeeze) el.classList.add("conflict-squeeze");

        el.style.top = `${Math.max(0, top)}px`;
        el.style.height = `${height}px`;
        el.style.left = `calc(${leftPct}% + 3px)`;
        el.style.width = `calc(${widthPct}% - 6px)`;
        el.style.right = "auto";

        el.innerHTML = `<span class="et">${escapeHtml(shortTitle(e.title))}</span><span class="es">${fmtTime(e.start)} · ${escapeHtml(locName(e.location_id))}</span>`;
        el.title = e.title;
        el.addEventListener("click", () => showEventModal(e));
        col.appendChild(el);
      });

      root.appendChild(col);
    });
  }

  function shortTitle(t) {
    return String(t).replace(/^EXAMPLE\s*·\s*/i, "");
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showEventModal(e) {
    closeModal();
    const bd = document.createElement("div");
    bd.className = "modal-backdrop";
    bd.id = "modal";
    const ctypes = conflictIdsForEvent(e.id);
    const flags = Object.keys(ctypes)
      .map((t) => `<span class="badge ${t === "ticket" ? "ticket" : t}">${t}</span>`)
      .join(" ");
    bd.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${escapeHtml(e.title)}</h3>
        <p><strong>${fmtDay(e.start)}</strong> · ${fmtTime(e.start)}–${fmtTime(e.end)}</p>
        <p>${escapeHtml(locName(e.location_id))} · ${escapeHtml(e.calendar)} · ${(e.who || []).join(", ")}</p>
        <p>${flags || '<span class="badge done">clear</span>'}${isDropped(e.id) ? ' <span class="badge overlap">dropped by pick</span>' : ""}</p>
        <div class="row">
          <button type="button" class="btn ghost" id="modalClose">Close</button>
          <a class="btn primary" href="#conflicts">View conflicts</a>
        </div>
      </div>`;
    document.body.appendChild(bd);
    bd.addEventListener("click", (ev) => {
      if (ev.target === bd) closeModal();
    });
    document.getElementById("modalClose").addEventListener("click", closeModal);
  }
  function closeModal() {
    const m = document.getElementById("modal");
    if (m) m.remove();
  }

  function renderConflicts() {
    const list = document.getElementById("conflictList");
    const empty = document.getElementById("conflictEmpty");
    if (!list) return;
    list.innerHTML = "";

    if (!conflicts.length) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    conflicts.forEach((c) => {
      const pick = picks[c.id];
      const card = document.createElement("article");
      card.className = "pick-card" + (pick ? " resolved" : "");
      card.id = "conflict-" + c.id.replace(/[^a-z0-9:-]/gi, "_");

      const badgeClass =
        c.type === "squeeze" ? "squeeze" : c.type === "ticket" ? "ticket" : "overlap";
      const badgeLabel =
        c.type === "squeeze"
          ? "Travel squeeze"
          : c.type === "ticket"
            ? "Ticket clash"
            : "Overlap";

      const aPicked = pick && pick.kept === c.a.id;
      const bPicked = pick && pick.kept === c.b.id;

      card.innerHTML = `
        <div class="pick-head">
          <div>
            <h3 class="pick-title">Pick one</h3>
            <p class="pick-meta">${fmtDay(c.a.start)} · shared: ${(c.a.who || [])
              .filter((w) => (c.b.who || []).includes(w))
              .join(", ") || "—"}</p>
          </div>
          <span class="badge ${pick ? "done" : badgeClass}">${pick ? "Resolved" : badgeLabel}</span>
        </div>
        <div class="why"><strong>Why:</strong> ${escapeHtml(c.why)}</div>
        <div class="pair-grid">
          <button type="button" class="opt ${aPicked ? "picked" : ""} ${bPicked ? "dropped-opt" : ""}" data-keep="${c.a.id}" data-drop="${c.b.id}" data-cid="${escapeHtml(c.id)}">
            <div class="ot">${escapeHtml(c.a.title)}</div>
            <div class="od">${fmtTime(c.a.start)}–${fmtTime(c.a.end)} · ${escapeHtml(locName(c.a.location_id))}<br/>${escapeHtml(c.a.calendar)}</div>
          </button>
          <div class="vs">VS</div>
          <button type="button" class="opt ${bPicked ? "picked" : ""} ${aPicked ? "dropped-opt" : ""}" data-keep="${c.b.id}" data-drop="${c.a.id}" data-cid="${escapeHtml(c.id)}">
            <div class="ot">${escapeHtml(c.b.title)}</div>
            <div class="od">${fmtTime(c.b.start)}–${fmtTime(c.b.end)} · ${escapeHtml(locName(c.b.location_id))}<br/>${escapeHtml(c.b.calendar)}</div>
          </button>
        </div>
        <div class="pick-actions">
          ${pick ? `<button type="button" class="btn ghost" data-clear="${escapeHtml(c.id)}">Undo pick</button>` : `<span class="hint" style="margin:0">Tap a card to keep it · the other is dropped locally</span>`}
        </div>`;

      list.appendChild(card);
    });

    list.querySelectorAll(".opt[data-keep]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cid = btn.getAttribute("data-cid");
        picks[cid] = {
          kept: btn.getAttribute("data-keep"),
          dropped: btn.getAttribute("data-drop"),
          at: new Date().toISOString(),
        };
        savePicks();
        refresh();
      });
    });
    list.querySelectorAll("[data-clear]").forEach((btn) => {
      btn.addEventListener("click", () => {
        delete picks[btn.getAttribute("data-clear")];
        savePicks();
        refresh();
      });
    });
  }

  function route() {
    const hash = (location.hash || "#week").replace(/^#/, "") || "week";
    const view = ["week", "conflicts", "about"].includes(hash) ? hash : "week";
    document.querySelectorAll(".view").forEach((v) => {
      const on = v.id === `view-${view}`;
      v.classList.toggle("active", on);
      v.hidden = !on;
    });
    document.querySelectorAll(".tab").forEach((t) => {
      const on = t.getAttribute("data-view") === view;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function refresh() {
    conflicts = detectConflicts();
    // Re-detect after drops may clear secondary conflicts — already filtered
    renderStats();
    renderDayFilters();
    renderTimeline();
    renderConflicts();
    const pill = document.getElementById("dataPill");
    if (pill) {
      pill.textContent = data.live ? "Live calendar" : "DEMO calendar";
      pill.classList.toggle("demo", !data.live);
    }
  }

  // shot mode: quiet animations
  if (/[?&]shot=1\b/.test(location.search)) {
    document.documentElement.style.setProperty("--shadow", "none");
  }

  window.addEventListener("hashchange", route);
  tickClock();
  setInterval(tickClock, 30000);
  refresh();
  route();
})();
