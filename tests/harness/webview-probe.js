/**
 * Zoom-anchor probe for the REAL preview (issue #1).
 *
 * Paste this whole file into the preview webview's DevTools console, then use
 * the preview normally:
 *
 *     Command Palette -> "Developer: Open Webview Developer Tools"
 *     (VS Code also has Help -> Toggle Developer Tools; pick the webview target)
 *
 * It is passive: it does not change the app. Per gesture it measures the
 * content point that was under the pointer (a text caret, or the fractional
 * position inside an element when there is no text, e.g. a PDF canvas) and
 * reports how far that point ended up from where the pointer anchor says it
 * must be — i.e. `error` ~ 0 means the zoom landed where you clicked.
 *
 *     __ovpProbe.report()   -> print a table + a copyable JSON block
 *     __ovpProbe.reset()    -> clear the collected events
 *     __ovpProbe.last()     -> the last event as an object
 *
 * Double-click and Ctrl+wheel as usual; each gesture appends one event. The
 * app's own `[ovp:...]` console lines are captured alongside, so one JSON
 * block carries both the independent measurement and the app's self-report.
 */
(() => {
  if (window.__ovpProbe && window.__ovpProbe.report) {
    window.__ovpProbe.report();
    return;
  }

  const state = { events: [], beacons: [] };
  window.__ovpProbe = state;

  const round1 = (v) => Math.round(v * 10) / 10;
  const container = () => document.getElementById('container');
  const zoomNow = () => {
    const c = container();
    const z = c ? parseFloat(getComputedStyle(c).zoom) : 1;
    return Number.isFinite(z) && z > 0 ? z : 1;
  };

  // --- the content point under a screen point -----------------------------
  function probe(x, y) {
    const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
    const node = r && r.startContainer;
    if (node && node.nodeType === 3 && node.data.trim()) {
      const start = r.startOffset;
      for (const off of [start, start - 1, start + 1]) {
        if (off < 0 || off >= node.data.length) {
          continue;
        }
        const rr = document.createRange();
        rr.setStart(node, off);
        rr.setEnd(node, off + 1);
        const rc = rr.getClientRects()[0];
        if (rc) {
          return { kind: 'caret', node, offset: off, x: rc.left, y: rc.top };
        }
      }
    }
    const el = document.elementFromPoint(x, y);
    const c = container();
    if (el && c && c.contains(el)) {
      const rc = el.getBoundingClientRect();
      if (rc.width > 2 && rc.height > 2) {
        const fx = (x - rc.left) / rc.width;
        const fy = (y - rc.top) / rc.height;
        return { kind: 'box', el, fx, fy, x: rc.left + fx * rc.width, y: rc.top + fy * rc.height };
      }
    }
    return null;
  }

  function where(p) {
    if (!p) {
      return null;
    }
    if (p.kind === 'caret') {
      if (!p.node.isConnected) {
        return null;
      }
      const rr = document.createRange();
      rr.setStart(p.node, p.offset);
      rr.setEnd(p.node, Math.min(p.offset + 1, p.node.data.length));
      const rc = rr.getClientRects()[0];
      return rc ? { x: rc.left, y: rc.top } : null;
    }
    if (!p.el.isConnected) {
      return null;
    }
    const rc = p.el.getBoundingClientRect();
    return { x: rc.left + p.fx * rc.width, y: rc.top + p.fy * rc.height };
  }

  // --- capture the app's beacons so one report carries both views ----------
  const origLog = console.log;
  console.log = function (...args) {
    try {
      if (typeof args[0] === 'string' && args[0].indexOf('[ovp:') === 0) {
        state.beacons.push(args.slice(0, 2).map((a) => {
          try { return JSON.parse(JSON.stringify(a)); } catch (e) { return String(a); }
        }));
      }
    } catch (e) { /* never break the app's logging */ }
    return origLog.apply(console, args);
  };

  // --- double-click: measure the same content point before and after -------
  let pending = null;
  window.addEventListener(
    'dblclick',
    (e) => {
      pending = {
        kind: 'dblclick',
        pointer: [e.clientX, e.clientY],
        zoom0: zoomNow(),
        point: probe(e.clientX, e.clientY),
      };
    },
    true
  );
  window.addEventListener(
    'dblclick',
    (e) => {
      if (!pending || pending.kind !== 'dblclick') {
        return;
      }
      const p = pending;
      pending = null;
      const zoom1 = zoomNow();
      const now = where(p.point);
      const ratio = p.zoom0 > 0 ? zoom1 / p.zoom0 : 1;
      // Which leg was this? The app's own beacon (captured above) says so. On
      // the restore leg the pointer's content point is EXPECTED to change —
      // the view returns to the region the zoom-in started from — so it must
      // not be reported as an anchoring error.
      let lastBeacon = null;
      for (let i = state.beacons.length - 1; i >= 0; i--) {
        if (state.beacons[i][0] === '[ovp:dblclick]') {
          lastBeacon = state.beacons[i][1];
          break;
        }
      }
      const isRestore = !!(lastBeacon && lastBeacon.leg === 'out');
      // The captured position is the PRE-zoom one, so where the point must end
      // up is pointer + (captured - pointer) * ratio: it legitimately moves by
      // d*(ratio-1) for a point d px from the pointer. (Using the post-zoom
      // position here instead would bake in a constant d*(1-ratio) fake error.)
      const expected = p.point
        ? {
            x: p.pointer[0] + (p.point.x - p.pointer[0]) * ratio,
            y: p.pointer[1] + (p.point.y - p.pointer[1]) * ratio,
          }
        : null;
      state.events.push({
        kind: isRestore ? 'dblclick-restore' : 'dblclick',
        pointer: p.pointer,
        probe: p.point ? p.point.kind : null,
        zoom: [round1(p.zoom0), round1(zoom1)],
        error: isRestore || !(expected && now) ? null : [round1(now.x - expected.x), round1(now.y - expected.y)],
        appResidual: lastBeacon && lastBeacon.residual ? lastBeacon.residual : null,
        note: isRestore
          ? 'restore leg: the pointer content point is expected to change (the view goes back to the pre-zoom region) — judge the view/zoom, not this'
          : 'error = how far the clicked content point ended from the pointer (0 = anchored); should match the beacon residual',
      });
      origLog.call(console, '[ovpProbe]', state.events[state.events.length - 1]);
    },
    false
  );

  // --- ctrl+wheel: the middle of the pane must stay in the middle ---------
  let wheel = null;
  window.addEventListener(
    'wheel',
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) {
        return;
      }
      if (!wheel) {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        wheel = { kind: 'wheel', center: [cx, cy], zoom0: zoomNow(), point: probe(cx, cy) };
      }
      if (wheel.timer) {
        clearTimeout(wheel.timer);
      }
      wheel.timer = setTimeout(() => {
        const w = wheel;
        wheel = null;
        const now = where(w.point);
        state.events.push({
          kind: 'wheel',
          center: w.center,
          probe: w.point ? w.point.kind : null,
          zoom: [round1(w.zoom0), round1(zoomNow())],
          error: now ? [round1(now.x - w.center[0]), round1(now.y - w.center[1])] : null,
          note: 'error = how far the content point at the pane centre ended from the centre (0 = centred zoom)',
        });
        origLog.call(console, '[ovpProbe]', state.events[state.events.length - 1]);
      }, 260);
    },
    true
  );

  state.report = function report() {
    const rows = state.events.map((ev) =>
      ev.kind === 'dblclick'
        ? ['dblclick', 'pointer ' + ev.pointer.join(','), 'probe ' + ev.probe,
           'zoom ' + ev.zoom[0] + '->' + ev.zoom[1],
           'error ' + (ev.error ? ev.error.join(', ') + ' px' : 'n/a')].join(' | ')
        : ['wheel', 'centre ' + ev.center.map((v) => Math.round(v)).join(','), 'probe ' + ev.probe,
           'zoom ' + ev.zoom[0] + '->' + ev.zoom[1],
           'error ' + (ev.error ? ev.error.join(', ') + ' px' : 'n/a')].join(' | ')
    );
    origLog.call(console, '[ovpProbe] ' + state.events.length + ' gesture(s):\n  ' + (rows.join('\n  ') || '(none yet - use the preview, then call report() again)'));
    const dump = { build: (window.__OVP_BUILD__ && window.__OVP_BUILD__.bundle) || '?', ua: navigator.userAgent, events: state.events, beacons: state.beacons };
    try {
      copy(JSON.stringify(dump, null, 1));
      origLog.call(console, '[ovpProbe] JSON copied to the clipboard (paste it into issue #1).');
    } catch (e) {
      origLog.call(console, '[ovpProbe] JSON:', dump);
    }
    return dump;
  };
  state.reset = function reset() {
    state.events.length = 0;
    state.beacons.length = 0;
    origLog.call(console, '[ovpProbe] cleared');
  };
  state.last = () => state.events[state.events.length - 1] || null;

  origLog.call(console,
    '[ovpProbe] ready (build ' + ((window.__OVP_BUILD__ && window.__OVP_BUILD__.bundle) || '?') + ')\n' +
    '  double-click and Ctrl+wheel as usual, then call __ovpProbe.report()');
})();
