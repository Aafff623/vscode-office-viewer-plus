/**
 * Zoom-anchor probe for the REAL preview (issue #1).
 *
 * Paste this whole file into the preview webview's DevTools console, then use
 * the preview normally:
 *
 *     Command Palette -> "Developer: Open Webview Developer Tools"
 *     (VS Code also has Help -> Toggle Developer Tools; pick the webview target)
 *
 * It does not change the app's zoom or scroll. On installation it briefly
 * adds a hidden marker to detect the browser's CSS zoom rectangle semantics.
 * Per gesture it measures the
 * content point that was under the pointer (a text caret, or the fractional
 * position inside an element when there is no text, e.g. a PDF canvas) and
 * reports how far that point ended up from where the pointer anchor says it
 * must be — i.e. `error` ~ 0 means the zoom landed where you clicked.
 *
 *     __ovpProbe.report()   -> print a table + a copyable JSON block
 *     __ovpProbe.reset()    -> clear the collected events
 *     __ovpProbe.last()     -> the last event as an object
 *
 * Double-click and Ctrl+wheel as usual; each gesture appends one event. A
 * double-click keeps `immediateError` and updates `error` after two animation
 * frames, so scrolling/layout after the event is included in the result.
 * `sampling` says whether that delayed measurement has completed. The app's
 * own `[ovp:...]` console lines are captured alongside, so one JSON
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

  // Electron can disable StandardizedBrowserZoom: its rectangles then omit
  // effective CSS zoom even though pointer coordinates use screen CSS pixels.
  // Calibrate this independently of the app and UA. A near-zero error in raw
  // rectangle units can otherwise agree with the app while the view drifts.
  state.geometry = (() => {
    const marker = document.createElement('div');
    marker.style.cssText = 'all:initial!important;position:fixed!important;left:0!important;top:0!important;' +
      'display:block!important;width:40px!important;height:1px!important;padding:0!important;border:0!important;' +
      'margin:0!important;transform:none!important;visibility:hidden!important;pointer-events:none!important;zoom:1!important;';
    let width1 = 0, width2 = 0;
    try {
      document.documentElement.appendChild(marker);
      width1 = marker.getBoundingClientRect().width;
      marker.style.setProperty('zoom', '2', 'important');
      width2 = marker.getBoundingClientRect().width;
    } finally {
      marker.remove();
    }
    const ratio = width1 > 0 ? width2 / width1 : 0;
    return { mode: Math.abs(ratio - 2) < 0.05 ? 'standard' : Math.abs(ratio - 1) < 0.05 ? 'legacy' : 'unknown',
      markerWidths: [width1, width2], widthRatio: ratio };
  })();
  function screenRect(rect, element) {
    if (!rect || state.geometry.mode === 'unknown') return null;
    let scale = 1;
    if (state.geometry.mode === 'legacy') {
      for (let el = element; el; el = el.parentElement) {
        const value = getComputedStyle(el).zoom;
        const parsed = parseFloat(value) / (value.endsWith('%') ? 100 : 1);
        if (Number.isFinite(parsed) && parsed > 0) scale *= parsed;
      }
    }
    return { left: rect.left * scale, top: rect.top * scale, width: rect.width * scale, height: rect.height * scale };
  }

  // --- the content point under a screen point -----------------------------
  function probe(x, y) {
    const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
    const node = r && r.startContainer;
    if (node && node.nodeType === 3 && node.data.trim() && container()?.contains(node)) {
      const start = r.startOffset;
      for (const off of [start, start - 1, start + 1]) {
        if (off < 0 || off >= node.data.length) {
          continue;
        }
        const rr = document.createRange();
        rr.setStart(node, off);
        rr.setEnd(node, off + 1);
        const rc = screenRect(rr.getClientRects()[0], node.parentElement);
        if (rc) {
          return { kind: 'caret', node, offset: off, x: rc.left, y: rc.top };
        }
      }
    }
    const el = document.elementFromPoint(x, y);
    const c = container();
    if (el && c && c.contains(el)) {
      const rc = screenRect(el.getBoundingClientRect(), el);
      if (rc && rc.width > 2 && rc.height > 2) {
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
      const rc = screenRect(rr.getClientRects()[0], p.node.parentElement);
      return rc ? { x: rc.left, y: rc.top } : null;
    }
    if (!p.el.isConnected) {
      return null;
    }
    const rc = screenRect(p.el.getBoundingClientRect(), p.el);
    return rc ? { x: rc.left + p.fx * rc.width, y: rc.top + p.fy * rc.height } : null;
  }

  function anchorError(point, anchor, zoom0, zoom1) {
    const now = where(point);
    if (!point || !now) {
      return null;
    }
    // A text probe is a glyph corner, which can be several pixels away from
    // the requested anchor. That offset must scale along with the content.
    const ratio = zoom1 / zoom0;
    return [
      round1(now.x - (anchor[0] + (point.x - anchor[0]) * ratio)),
      round1(now.y - (anchor[1] + (point.y - anchor[1]) * ratio)),
    ];
  }

  let deferred = null;
  function cancelDeferredSample() {
    if (deferred) {
      cancelAnimationFrame(deferred.frame);
      deferred.event.sampling = 'interrupted';
      deferred = null;
    }
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
      cancelDeferredSample();
      pending = {
        kind: 'dblclick',
        pointer: [e.clientX, e.clientY],
        zoom0: zoomNow(),
        point: probe(e.clientX, e.clientY),
        beaconStart: state.beacons.length,
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
      // Which leg was this? The app's own beacon (captured above) says so. On
      // the restore leg the pointer's content point is EXPECTED to change —
      // the view returns to the region the zoom-in started from — so it must
      // not be reported as an anchoring error.
      let lastBeacon = null;
      for (let i = state.beacons.length - 1; i >= p.beaconStart; i--) {
        if (state.beacons[i][0] === '[ovp:dblclick]') {
          lastBeacon = state.beacons[i][1];
          break;
        }
      }
      const isRestore = !!(lastBeacon && lastBeacon.leg === 'out');
      const immediateError = isRestore ? null : anchorError(p.point, p.pointer, p.zoom0, zoom1);
      const event = {
        kind: isRestore ? 'dblclick-restore' : 'dblclick',
        pointer: p.pointer,
        probe: p.point ? p.point.kind : null,
        zoom: [round1(p.zoom0), round1(zoom1)],
        error: immediateError,
        immediateError,
        sampling: 'pending',
        appResidual: lastBeacon && lastBeacon.residual ? lastBeacon.residual : null,
        note: isRestore
          ? 'restore leg: the pointer content point is expected to change (the view goes back to the pre-zoom region) — judge the view/zoom, not this'
          : 'error = anchor error after two animation frames (0 = anchored); immediateError can be compared with the synchronous beacon residual',
      };
      state.events.push(event);
      const sample = { event, frame: 0 };
      deferred = sample;
      sample.frame = requestAnimationFrame(() => {
        sample.frame = requestAnimationFrame(() => {
          deferred = null;
          const settledZoom = zoomNow();
          event.zoom[1] = round1(settledZoom);
          event.error = isRestore ? null : anchorError(p.point, p.pointer, p.zoom0, settledZoom);
          event.sampling = 'settled';
          origLog.call(console, '[ovpProbe]', event);
        });
      });
    },
    false
  );

  // --- ctrl+wheel: the middle of the pane must stay in the middle ---------
  let wheel = null;
  window.addEventListener(
    'wheel',
    (e) => {
      cancelDeferredSample();
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
        const zoom1 = zoomNow();
        state.events.push({
          kind: 'wheel',
          center: w.center,
          probe: w.point ? w.point.kind : null,
          zoom: [round1(w.zoom0), round1(zoom1)],
          error: anchorError(w.point, w.center, w.zoom0, zoom1),
          note: 'error = anchor error at the pane centre, including the scaled glyph offset (0 = centred zoom)',
        });
        origLog.call(console, '[ovpProbe]', state.events[state.events.length - 1]);
      }, 260);
    },
    true
  );

  state.report = function report() {
    const rows = state.events.map((ev) =>
      ev.kind !== 'wheel'
        ? [ev.kind, 'pointer ' + ev.pointer.join(','), 'probe ' + ev.probe,
           'zoom ' + ev.zoom[0] + '->' + ev.zoom[1],
           'error ' + (ev.error ? ev.error.join(', ') + ' px' : 'n/a'),
           'sampling ' + ev.sampling].join(' | ')
        : ['wheel', 'centre ' + ev.center.map((v) => Math.round(v)).join(','), 'probe ' + ev.probe,
           'zoom ' + ev.zoom[0] + '->' + ev.zoom[1],
           'error ' + (ev.error ? ev.error.join(', ') + ' px' : 'n/a')].join(' | ')
    );
    origLog.call(console, '[ovpProbe] ' + state.events.length + ' gesture(s):\n  ' + (rows.join('\n  ') || '(none yet - use the preview, then call report() again)'));
    const dump = { build: (window.__OVP_BUILD__ && window.__OVP_BUILD__.bundle) || '?', ua: navigator.userAgent, geometry: state.geometry, events: state.events, beacons: state.beacons };
    try {
      copy(JSON.stringify(dump, null, 1));
      origLog.call(console, '[ovpProbe] JSON copied to the clipboard (paste it into issue #1).');
    } catch (e) {
      origLog.call(console, '[ovpProbe] JSON:', dump);
    }
    return dump;
  };
  state.reset = function reset() {
    cancelDeferredSample();
    pending = null;
    if (wheel) {
      clearTimeout(wheel.timer);
      wheel = null;
    }
    state.events.length = 0;
    state.beacons.length = 0;
    origLog.call(console, '[ovpProbe] cleared');
  };
  state.last = () => state.events[state.events.length - 1] || null;

  origLog.call(console,
    '[ovpProbe] ready (build ' + ((window.__OVP_BUILD__ && window.__OVP_BUILD__.bundle) || '?') + ', rectangle mode ' + state.geometry.mode + ')\n' +
    '  double-click and Ctrl+wheel as usual, then call __ovpProbe.report()');
})();
