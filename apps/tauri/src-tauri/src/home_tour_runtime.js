/*
 * Owner 2026-10-06: the Home pane walkthrough overlay, injected into the FUMBBL webview (WebviewBuilder
 * initialization_script in fumbbl_home.rs, main frame only). Spec: docs/artifact-orchestration/spec-home-pane-tour.md.
 *
 * Compiled in with the shell's `fumbbl-home` cargo feature (a default feature: every edition since 10-06).
 *
 * INERT until the host calls it: defining window.__sfTour draws nothing, reads nothing and listens to nothing. The host
 * calls show(step) / clear() through fumbbl_home_tour (eval of a validated `window.__sfTour.<fn>(<json>)`), and report()
 * after a page load while a tour runs. It never reads or writes cookies, storage, form fields or credentials; the only
 * site element it ever clicks is the Blackbox Trophy page's own "Rules" tab (payload.clicks). Every payload string is set
 * with textContent. The overlay lives in a closed shadow root so the site's CSS and ours never mix.
 *
 * Site -> host: location.assign(origin + '/__sf-tour__#sf-tour:<button>.<step>'), which the shell's on_navigation
 * recognises, DENIES and turns into a `fumbbl-home:tour` event. (A bare location.hash change would be a same-document
 * navigation, for which WebView2 raises no NavigationStarting, so the shell would never see it.)
 *
 * arrowBetween / placeCard are a copy of src/game/homeTourGeometry.ts (test/homeTour.test.ts checks they agree).
 */
(function () {
  'use strict';
  if (window.__sfTour) return;

  var ARROW_GAP = 8;
  var CARD_MARGIN = 24;
  var EVENT_PATH = '/__sf-tour__';
  var HASH_PREFIX = '#sf-tour:';

  // --- geometry (copy of homeTourGeometry.ts) -------------------------------------------------------------------------
  function center(r) {
    return [r.x + r.width / 2, r.y + r.height / 2];
  }
  function rayExit(r, tx, ty) {
    var c = center(r);
    var dx = tx - c[0];
    var dy = ty - c[1];
    if (dx === 0 && dy === 0) return [c[0], c[1]];
    var sx = dx === 0 ? Infinity : r.width / 2 / Math.abs(dx);
    var sy = dy === 0 ? Infinity : r.height / 2 / Math.abs(dy);
    var s = Math.min(sx, sy, 1);
    return [c[0] + dx * s, c[1] + dy * s];
  }
  function overlaps(a, b, margin) {
    return a.x - margin < b.x + b.width && b.x < a.x + a.width + margin && a.y - margin < b.y + b.height && b.y < a.y + a.height + margin;
  }
  function arrowBetween(card, target) {
    var tc = center(target);
    var cc = center(card);
    var p1 = rayExit(card, tc[0], tc[1]);
    var pe = rayExit(target, cc[0], cc[1]);
    var len = Math.hypot(pe[0] - p1[0], pe[1] - p1[1]);
    if (overlaps(card, target, 0) || len <= ARROW_GAP * 2) {
      return { x1: p1[0], y1: p1[1], x2: pe[0], y2: pe[1], visible: false };
    }
    var k = (len - ARROW_GAP) / len;
    return { x1: p1[0], y1: p1[1], x2: p1[0] + (pe[0] - p1[0]) * k, y2: p1[1] + (pe[1] - p1[1]) * k, visible: true };
  }
  function placeCard(viewport, card, targets, placement) {
    var w = Math.min(card.width, Math.max(0, viewport.width - 2 * CARD_MARGIN));
    var h = Math.min(card.height, Math.max(0, viewport.height - 2 * CARD_MARGIN));
    var x = Math.max(CARD_MARGIN, (viewport.width - w) / 2);
    if (placement === 'corner') {
      return { x: Math.max(CARD_MARGIN, viewport.width - w - CARD_MARGIN), y: Math.max(CARD_MARGIN, viewport.height - h - CARD_MARGIN) };
    }
    if (placement === 'upper-right') {
      return { x: Math.max(CARD_MARGIN, viewport.width - w - CARD_MARGIN), y: Math.max(CARD_MARGIN, (viewport.height - h) / 2 - h * 0.75) };
    }
    var candidates = [
      Math.max(CARD_MARGIN, (viewport.height - h) / 2),
      Math.max(CARD_MARGIN, viewport.height - h - CARD_MARGIN),
      CARD_MARGIN,
    ];
    var best = candidates[0];
    var bestCover = Infinity;
    for (var i = 0; i < candidates.length; i += 1) {
      var y = candidates[i];
      var rect = { x: x, y: y, width: w, height: h };
      var cover = 0;
      for (var j = 0; j < targets.length; j += 1) {
        var t = targets[j];
        if (!overlaps(rect, t, CARD_MARGIN / 2)) continue;
        var ox = Math.min(rect.x + rect.width, t.x + t.width) - Math.max(rect.x, t.x);
        var oy = Math.min(rect.y + rect.height, t.y + t.height) - Math.max(rect.y, t.y);
        cover += Math.max(1, ox) * Math.max(1, oy);
      }
      if (cover === 0) return { x: x, y: y };
      if (cover < bestCover) {
        bestCover = cover;
        best = y;
      }
    }
    return { x: x, y: best };
  }

  // --- DOM helpers ----------------------------------------------------------------------------------------------------
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var STYLE = [
    ':host{all:initial}',
    '.layer{position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:"Nuffle",system-ui,"Segoe UI",Roboto,Arial,sans-serif}',
    'svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}',
    '.ring{fill:none;stroke:#f0383f;stroke-width:3;filter:drop-shadow(0 0 6px rgba(240,56,63,.75))}',
    '.arrow{stroke:#f0383f;stroke-width:4;stroke-linecap:round;fill:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.8))}',
    '.head{fill:#f0383f}',
    // Owner 10-06: large cards (480-640 px wide, 17 px copy); the off-page card stays compact.
    '.card{position:absolute;box-sizing:border-box;width:min(640px,max(480px,46vw),calc(100vw - 48px));max-height:calc(100vh - 48px);',
    'display:flex;flex-direction:column;pointer-events:auto;padding:24px 26px 20px;',
    'color:#f3eee2;background:#151818;border:1px solid #762025;border-top:3px solid #f0383f;border-radius:8px;',
    'box-shadow:0 18px 48px rgba(0,0,0,.65);line-height:1.55;font-size:17px}',
    '.card.compact{width:min(400px,calc(100vw - 48px));padding:16px 18px 14px;font-size:15px}',
    '.card.compact .title{font-size:16px}',
    '.title{flex:none;margin:0 0 12px;color:#ff3b3b;font-size:22px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}',
    // Small windows / high zoom: the copy scrolls, the buttons never leave the card.
    '.body{flex:1 1 auto;min-height:0;overflow-y:auto;margin:0;white-space:pre-line;overscroll-behavior:contain}',
    '.actions{flex:none;display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end;align-items:center;margin-top:14px}',
    'button{font:inherit;font-size:15px;letter-spacing:.05em;border-radius:6px;cursor:pointer;padding:8px 18px}',
    'button.primary{color:#fff;background:linear-gradient(180deg,#bd3038,#9b2027 48%,#4b1015);border:1px solid #ec5d63}',
    'button.primary:hover{filter:brightness(1.15)}',
    'button.secondary{color:#f3eee2;background:#202323;border:1px solid #762025}',
    'button.secondary:hover{border-color:#bf252d}',
    'button.back{color:#f3eee2;background:none;border:1px solid #3a3f44}',
    'button.back:hover{border-color:#bf252d}',
    'button.skip{margin-right:auto;color:#aaa59b;background:none;border:none;padding:7px 4px;text-decoration:underline}',
  ].join('');

  var active = null; // { payload, host, layer, svg, card, timer, started, decided, alternate, onView }

  function visibleRect(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    var b = el.getBoundingClientRect();
    if (!(b.width > 0 && b.height > 0)) return null;
    return { x: b.left, y: b.top, width: b.width, height: b.height };
  }

  function textOf(el) {
    var t = (el.textContent || '').trim();
    if (!t && typeof el.value === 'string') t = el.value.trim();
    return t.toLowerCase();
  }

  function findTarget(arrow) {
    var candidates = (arrow && arrow.candidates) || [];
    for (var i = 0; i < candidates.length; i += 1) {
      var c = candidates[i];
      var list;
      try {
        list = document.querySelectorAll(c.selector);
      } catch (e) {
        continue;
      }
      for (var j = 0; j < list.length; j += 1) {
        var el = list[j];
        if (c.text && textOf(el) !== String(c.text).toLowerCase()) continue;
        if (visibleRect(el)) return el;
      }
    }
    return null;
  }

  function anyPresent(selectors) {
    for (var i = 0; i < selectors.length; i += 1) {
      try {
        if (document.querySelector(selectors[i])) return true;
      } catch (e) {
        /* a bad selector counts as absent */
      }
    }
    return false;
  }

  function emit(button, step) {
    try {
      window.location.assign(window.location.origin + EVENT_PATH + HASH_PREFIX + button + '.' + step);
    } catch (e) {
      /* nothing else to try: the host's Skip in Settings still works */
    }
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function buildCard(payload, body) {
    var card = el('div', payload.compact ? 'card compact' : 'card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', String(payload.title || 'Walkthrough'));
    card.appendChild(el('h2', 'title', payload.title || ''));
    card.appendChild(el('p', 'body', body));
    var actions = el('div', 'actions');
    var buttons = payload.buttons || [];
    for (var i = 0; i < buttons.length; i += 1) {
      (function (b) {
        var cls = b.id === 'skip' ? 'skip' : b.id === 'next' ? 'primary' : b.id === 'back' ? 'back' : 'secondary';
        var node = el('button', cls, b.label);
        node.type = 'button';
        node.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var clickSel = payload.clicks && payload.clicks[b.id];
          if (clickSel) {
            var target = null;
            try {
              target = document.querySelector(clickSel);
            } catch (e) {
              target = null;
            }
            if (!target) {
              // The site element this button drives is missing: do nothing (Next / Skip stay the way on).
              console.warn('[sf-tour] ' + payload.step + ': nothing matches ' + clickSel);
              return;
            }
            target.click();
          }
          emit(b.id, payload.step);
        });
        actions.appendChild(node);
      })(buttons[i]);
    }
    card.appendChild(actions);
    return card;
  }

  function render() {
    if (!active) return;
    var a = active;
    var payload = a.payload;
    var found = [];
    var arrows = a.alternate ? [] : payload.arrows || [];
    for (var i = 0; i < arrows.length; i += 1) {
      var target = findTarget(arrows[i]);
      var rect = target && visibleRect(target);
      if (rect) found.push(rect);
      else if (a.decided && !a.missingLogged[i]) {
        a.missingLogged[i] = true;
        console.warn('[sf-tour] ' + payload.step + ': no element for ' + arrows[i].name + ' (showing the step without that arrow)');
      }
    }
    if (!a.card) {
      a.card = buildCard(payload, a.alternate ? payload.alternate.body : payload.body);
      a.layer.appendChild(a.card);
    }
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var cb = a.card.getBoundingClientRect();
    // Keep clear of the arrow targets AND of the site elements the step must leave free (the login form).
    var keepClear = found.slice();
    var avoid = payload.avoid || [];
    for (var v = 0; v < avoid.length; v += 1) {
      var spot = null;
      try {
        spot = visibleRect(document.querySelector(avoid[v]));
      } catch (e) {
        spot = null;
      }
      if (spot) keepClear.push(spot);
    }
    var pos = placeCard({ width: vw, height: vh }, { width: cb.width || 560, height: cb.height || 200 }, keepClear, payload.placement);
    a.card.style.left = pos.x + 'px';
    a.card.style.top = pos.y + 'px';
    var cardRect = { x: pos.x, y: pos.y, width: cb.width || 560, height: cb.height || 200 };
    while (a.svg.firstChild) a.svg.removeChild(a.svg.firstChild);
    for (var k = 0; k < found.length; k += 1) {
      var t = found[k];
      var ring = document.createElementNS(SVG_NS, 'rect');
      ring.setAttribute('class', 'ring');
      ring.setAttribute('x', String(t.x - 4));
      ring.setAttribute('y', String(t.y - 4));
      ring.setAttribute('width', String(t.width + 8));
      ring.setAttribute('height', String(t.height + 8));
      ring.setAttribute('rx', '6');
      a.svg.appendChild(ring);
      var g = arrowBetween(cardRect, { x: t.x - 4, y: t.y - 4, width: t.width + 8, height: t.height + 8 });
      if (!g.visible) continue;
      var line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', 'arrow');
      line.setAttribute('x1', String(g.x1));
      line.setAttribute('y1', String(g.y1));
      line.setAttribute('x2', String(g.x2));
      line.setAttribute('y2', String(g.y2));
      a.svg.appendChild(line);
      var ang = Math.atan2(g.y2 - g.y1, g.x2 - g.x1);
      var size = 14;
      var head = document.createElementNS(SVG_NS, 'polygon');
      head.setAttribute('class', 'head');
      var p = [
        [g.x2, g.y2],
        [g.x2 - size * Math.cos(ang - 0.45), g.y2 - size * Math.sin(ang - 0.45)],
        [g.x2 - size * Math.cos(ang + 0.45), g.y2 - size * Math.sin(ang + 0.45)],
      ];
      head.setAttribute('points', p.map(function (q) { return q[0] + ',' + q[1]; }).join(' '));
      a.svg.appendChild(head);
    }
  }

  /** Decide the no-teams branch and when the card may appear: at once when the step has no alternate; otherwise as
   *  soon as the coach's teams or an arrow target render, or at waitMs (alternate copy when nothing showed up). */
  function tick() {
    if (!active) return;
    var a = active;
    var p = a.payload;
    var elapsed = Date.now() - a.started;
    if (a.autoClickPending) {
      var tab = null;
      try {
        tab = document.querySelector(p.autoClick);
      } catch (e) {
        tab = null;
      }
      if (tab) {
        a.autoClickPending = false;
        tab.click();
      } else if (elapsed >= (p.waitMs || 0)) {
        a.autoClickPending = false;
        console.warn('[sf-tour] ' + p.step + ': nothing matches ' + p.autoClick + ' (showing the card without it)');
      }
    }
    if (!a.decided) {
      if (!p.alternate) {
        var all = true;
        var arrows = p.arrows || [];
        for (var i = 0; i < arrows.length; i += 1) if (!findTarget(arrows[i])) all = false;
        if (all || elapsed >= (p.waitMs || 0)) a.decided = true;
      } else {
        var present = anyPresent(p.alternate.present || []);
        var arrowFound = false;
        var list = p.arrows || [];
        for (var j = 0; j < list.length; j += 1) if (findTarget(list[j])) arrowFound = true;
        if (present || arrowFound) a.decided = true;
        else if (elapsed >= (p.waitMs || 0)) {
          a.decided = true;
          a.alternate = true;
        }
        if (!a.decided) return; // the card waits for the branch decision
      }
    }
    render();
  }

  /** payload.reveal: open a hover-only nav dropdown the way the site's theme script does on hover. */
  function revealMenu(selector) {
    var link = null;
    try {
      link = document.querySelector(selector);
    } catch (e) {
      link = null;
    }
    var li = link && link.closest ? link.closest('li') : null;
    var sub = li ? li.querySelector('.submenu') : null;
    if (!li || !sub) {
      console.warn('[sf-tour] nothing to open for ' + selector);
      return null;
    }
    var undo = { li: li, sub: sub, classes: li.className, display: sub.style.display };
    li.classList.add('selected', 'expanded');
    sub.style.display = 'block';
    return undo;
  }

  function clear() {
    if (!active) return true;
    var a = active;
    active = null;
    if (a.revealed) {
      a.revealed.li.className = a.revealed.classes;
      a.revealed.sub.style.display = a.revealed.display;
    }
    window.clearInterval(a.timer);
    window.removeEventListener('resize', a.onView, true);
    window.removeEventListener('scroll', a.onView, true);
    if (a.host && a.host.parentNode) a.host.parentNode.removeChild(a.host);
    return true;
  }

  function show(payload) {
    clear();
    if (!payload || typeof payload !== 'object' || typeof payload.step !== 'string') return false;
    var host = document.createElement('sf-tour-overlay');
    var root = host.attachShadow({ mode: 'closed' });
    var style = document.createElement('style');
    style.textContent = STYLE;
    root.appendChild(style);
    var layer = el('div', 'layer');
    var svg = document.createElementNS(SVG_NS, 'svg');
    layer.appendChild(svg);
    root.appendChild(layer);
    var mount = function () {
      (document.body || document.documentElement).appendChild(host);
    };
    if (document.body || document.documentElement) mount();
    var raf = 0;
    var onView = function () {
      if (raf) return;
      raf = window.requestAnimationFrame(function () {
        raf = 0;
        tick();
      });
    };
    active = {
      payload: payload,
      host: host,
      layer: layer,
      svg: svg,
      card: null,
      started: Date.now(),
      decided: false,
      alternate: false,
      missingLogged: {},
      onView: onView,
      timer: 0,
      revealed: typeof payload.reveal === 'string' ? revealMenu(payload.reveal) : null,
      autoClickPending: typeof payload.autoClick === 'string' && payload.autoClick.length > 0,
    };
    window.addEventListener('resize', onView, true);
    window.addEventListener('scroll', onView, true);
    // Re-anchor while the site's Vue pages render and move things around.
    active.timer = window.setInterval(tick, 300);
    tick();
    return true;
  }

  /** The coach name from an overview link (`/~Coach`, relative or absolute), or ''. */
  function coachFromLink(link) {
    if (!link) return '';
    var href = link.getAttribute('href') || '';
    var at = href.indexOf('/~');
    if (at < 0) return '';
    try {
      return decodeURIComponent(href.slice(at + 2).split(/[/?#]/)[0]).trim();
    } catch (e) {
      return '';
    }
  }

  /** Logged-in state + coach name, read from the page header (host-initiated, after a page load). Logged in, FUMBBL's
   *  header logo and first nav item ("Home", submenu "Overview") link to /~<Coach> and the account box holds "Account"
   *  (/user.php); logged out the logo links to / and the account box holds "Log in" (/p/login). */
  function report() {
    var coach = coachFromLink(document.querySelector('.topheader a[href*="/~"]')) ||
      coachFromLink(document.querySelector('.topnav .mainmenu a[href*="/~"]'));
    var attrs = document.querySelectorAll('[coach]');
    for (var i = 0; i < attrs.length && !coach; i += 1) coach = (attrs[i].getAttribute('coach') || '').trim();
    var box = document.querySelector('.accountbox');
    var loginLink = box ? box.querySelector('a[href$="/p/login"]') : null;
    var loggedIn = !!coach || (!!box && !loginLink);
    return { loggedIn: loggedIn, coach: coach };
  }

  function arm() {
    return true;
  }

  /** Owner 10-06: the client's colorblind correction, the same feColorMatrix the client shell uses
   *  (src/game/colorblindFilters.ts, sent by the shell on every page load): an inert <svg><filter> in the page and
   *  `filter: url(#...)` on the root element (which filters the walkthrough's cards too, like the client). null = off.
   *  Values are set as attributes only - the shell already reduced the matrix to numbers. */
  var FILTER_DEFS_ID = 'sf-colorblind-defs';
  function filter(spec) {
    var root = document.documentElement;
    var old = document.getElementById(FILTER_DEFS_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (!spec || typeof spec.id !== 'string' || typeof spec.matrix !== 'string' || !/^cb-[a-z]+$/.test(spec.id)) {
      if (root && root.style.getPropertyValue('filter').indexOf('#sf-cb-') >= 0) root.style.removeProperty('filter');
      return true;
    }
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('id', FILTER_DEFS_ID);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none');
    var f = document.createElementNS(SVG_NS, 'filter');
    var fid = 'sf-' + spec.id;
    f.setAttribute('id', fid);
    f.setAttribute('color-interpolation-filters', 'sRGB');
    var m = document.createElementNS(SVG_NS, 'feColorMatrix');
    m.setAttribute('type', 'matrix');
    m.setAttribute('values', spec.matrix);
    f.appendChild(m);
    svg.appendChild(f);
    (document.body || root).appendChild(svg);
    root.style.setProperty('filter', 'url(#' + fid + ')');
    return true;
  }

  Object.defineProperty(window, '__sfTour', {
    value: Object.freeze({
      show: show,
      clear: clear,
      report: report,
      arm: arm,
      filter: filter,
      _geometry: Object.freeze({ arrowBetween: arrowBetween, placeCard: placeCard }),
    }),
    configurable: false,
    enumerable: false,
    writable: false,
  });
})();
