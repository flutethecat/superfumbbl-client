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
 * Owner 10-09: focus() (the "sf-focus" section near the end) crops the page to the Gamefinder's queue panel while the
 * site is in the floating window. Presentation only - see that section; it clicks nothing, hides nothing and reports
 * nothing by navigation. The report also says when the coach is in the draw ("sf-draw": the Blackbox box shows the
 * site's "Leave the Draw" button - read, never pressed). joinWatch() ("sf-join") only counts presses of the site's "Join the Draw"; diagnose()
 * ("sf-diag") describes the page's structure around the panel for a development build. All three answer the host's
 * own call and are inert until it comes.
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

  // --- sf-focus:begin (queue focus) -----------------------------------------------------------------------------------
  /*
   * Owner 10-09: while the site is in the floating window, bring the Gamefinder's queue panel - the "Blackbox" box and
   * the "Match Offers" box under it - to the frame's top-left at the page's own size. The frame's size decides how
   * much is visible (by default exactly the Blackbox box: the report carries its size); the size of the content is the
   * webview's zoom (the float's slider), which the shell applies natively. Nothing here scales or fits anything.
   * Host-initiated (fumbbl_home_focus_region evals focus({mode:'queue'}) / focus({mode:'off'})); inert until then.
   *
   * PRESENTATION ONLY, all of it reversible, and nothing here talks to anyone: it reads element rectangles and computed
   * styles and writes (a) one <style> element, (b) one attribute on <html> and one marker attribute on each element of
   * the region. It never activates, fills in or alters anything of the site's, makes no request, and sends nothing to
   * the host (the host reads the returned report). Nothing of the site's layout is changed: the region is brought into
   * view with a TRANSFORM on the root element (a translate), so the page keeps the exact layout it has.
   *
   * NOTHING IS HIDDEN (Astra 10-09, F1). The view is a CROP: the page's scrollbars go and the page is shifted, that is
   * all. The first build hid everything but the two boxes, which could have hidden a match-acceptance dialog rendered
   * elsewhere on the page. And because a shifted page also moves whatever the site pins to the viewport, the crop is
   * DROPPED - the page shows exactly as the site draws it - for as long as the site shows a dialog or overlay outside
   * the panel (see findBlocker). The report then says reason:'dialog'. Fail towards showing more, never less.
   * "found" therefore means: everything the coach needs is in the frame, or the report says how far the frame must
   * reach to make it so (needWidth / needHeight - Match Offers with something in it, a dialog inside the panel).
   * It also means the crop DRAWS: nothing between the panel and the root clips away what the frame is to show
   * (clippedBy; otherwise reason:'clipped' and the page is shown as it is).
   *
   * Finding the region. FIRST by the Gamefinder's own ids, exactly as the live page has them (owner's saved page,
   * 10-09: /p/lfg2 is a client-rendered app; <div id="offers"> holds the Blackbox box, with <div id="blackboxwrapper">
   * in it, and the Match Offers box, with <div id="offerlistwrapper">). When those are not there it falls back to the
   * two box headings by their TEXT ("Blackbox", "Match Offers"; any element, any case, the words as a text node of
   * their own beside a status or a badge, or split over inline elements): their lowest common ancestor, and that
   * ancestor's children from the one holding the first heading through the one holding the second. Of several
   * candidate pairs the one with the SMALLEST drawn region wins. No class name is relied on. FAIL SOFT: no such panel
   * on this page (another page, logged out, changed markup) = nothing is applied and the report says why
   * (reason: 'not-found', or 'frame' / 'shadow' when the words are only inside an iframe / a shadow root, which this
   * cannot crop).
   *
   * Re-applied (debounced) when the page changes (MutationObserver - a panel a client-rendered page builds after load
   * is picked up when it appears), when the region changes size (ResizeObserver) and when the frame is resized or
   * something scrolls. No timer runs while nothing changes.
   */
  var FOCUS_ATTR = 'data-sf-focus';
  var FOCUS_KEEP_ATTR = 'data-sf-focus-keep';
  var FOCUS_STYLE_ID = 'sf-focus-style';
  var FOCUS_DEBOUNCE_MS = 120;
  /** Attribute changes (a class or style toggled somewhere) are looked at less eagerly: pages animate with them. */
  var FOCUS_ATTR_DEBOUNCE_MS = 400;
  /** Box headings are short; longer text is copy, not a heading. */
  var FOCUS_HEADING_MAX = 24;
  /** More siblings than this between the two headings is not "one panel". */
  var FOCUS_MAX_PARTS = 8;
  var FOCUS_MIN_EDGE = 24;
  /** What the site itself marks as a dialog. A constant: nothing of the page's reaches a selector. */
  var FOCUS_DIALOG_SELECTOR = 'dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"]';
  /** A pinned element smaller than this is a badge, not something the coach must see. */
  var FOCUS_OVERLAY_MIN_W = 40;
  var FOCUS_OVERLAY_MIN_H = 20;
  /** A late-inserted absolutely positioned element counts as an overlay only from this size. */
  var FOCUS_LATE_MIN_W = 150;
  var FOCUS_LATE_MIN_H = 60;
  var FOCUS_SCAN_MAX = 4000;
  var FOCUS_OURS = 'sf-tour-overlay';

  var focusState = null; // see focusStart

  function focusReport(found, reason, box, primary, error, attention) {
    var out = {
      found: found,
      width: box ? Math.round(box.width) : 0,
      height: box ? Math.round(box.height) : 0,
      // How much of the region must be in view to show the whole Blackbox box (from the region's top-left corner).
      primaryWidth: primary ? Math.ceil(primary.width) : 0,
      primaryHeight: primary ? Math.ceil(primary.height) : 0,
      reason: reason,
    };
    if (error) out.error = String(error).slice(0, 160);
    // The coach's place in the draw, when the page says it either way: 'in' / 'out'. Left out = it cannot be told.
    if (focusDraw) out.draw = focusDraw;
    if (focusLoad) out.load = focusLoad;
    // Astra 10-09 (R1): "ok" must mean that everything the coach needs is inside the frame. When more than the
    // Blackbox box has to be seen - Match Offers has something in it, or the panel shows a dialog of its own - the
    // report says how much of the region must be in view (from its top-left corner), and the frame grows to it.
    if (attention) {
      out.offers = attention.offers === true;
      out.needWidth = Math.ceil(attention.width);
      out.needHeight = Math.ceil(attention.height);
    }
    return out;
  }
  /** What the page says of the coach's place in the draw, for the report being made: 'in', 'out', or '' (cannot tell). */
  var focusDraw = '';
  /** This page load's own mark (the Join watch's), for the report being made; '' outside a pass. */
  var focusLoad = '';
  var FOCUS_OFF = Object.freeze(focusReport(false, 'off', null, null));
  var FOCUS_NONE = Object.freeze(focusReport(false, 'not-found', null, null));

  function normText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase();
  }
  /** A heading's words: lower case, single spaces, without the punctuation around them ("Blackbox:", "- Blackbox -"). */
  function headingText(value) {
    return normText(value).replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9)]+$/, '');
  }
  function isBlackboxHeading(t) {
    return t === 'blackbox' || (t.length <= FOCUS_HEADING_MAX && /^blackbox \([^)]*\)$/.test(t));
  }
  function isOffersHeading(t) {
    return t === 'match offers' || (t.length <= FOCUS_HEADING_MAX && /^match offers\b/.test(t));
  }

  function cssOf(el) {
    try {
      return window.getComputedStyle ? window.getComputedStyle(el) : getComputedStyle(el);
    } catch (e) {
      return null;
    }
  }

  /** The element's rectangle when the site is actually drawing it, else null. */
  function shownRect(el) {
    var r = visibleRect(el);
    if (!r) return null;
    var css = cssOf(el);
    if (css && (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || (css.opacity !== '' && Number(css.opacity) === 0))) return null;
    return r;
  }

  /** The elements that are a heading `matches` accepts: visible, and not a link (the site's menus). The heading may be
   *  the element around a text node, that text node's own words beside other content (a badge, a countdown), or an
   *  element a few levels up whose whole text is the heading (words split over inline elements). */
  function headingElements(matches, all) {
    var out = [];
    var root = document.body;
    if (!root || typeof document.createTreeWalker !== 'function') return out;
    var walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    var node = walker.nextNode();
    while (node) {
      var raw = node.nodeValue || '';
      if (raw.length <= FOCUS_HEADING_MAX * 2 && normText(raw)) {
        var el = null;
        var parent = node.parentElement;
        if (parent && matches(headingText(raw))) el = parent;
        // Words split over inline elements: the OUTERMOST element (a few levels up) whose whole text is the heading.
        for (var up = parent, level = 0; parent && el !== parent && up && up !== root && level < 3; up = up.parentElement, level += 1) {
          var text = up.textContent || '';
          if (text.length > FOCUS_HEADING_MAX * 4 || up.childNodes.length > 8) break;
          if (matches(headingText(text))) el = up;
          else if (el) break;
        }
        if (el && out.indexOf(el) < 0) {
          var usable = !(el.closest && el.closest('a[href], script, style, noscript, template, option, ' + FOCUS_OURS)) && !!shownRect(el);
          if (usable || all) out.push(el);
        }
      }
      node = walker.nextNode();
    }
    return out;
  }

  function ancestorsOf(node) {
    var chain = [];
    for (var n = node; n; n = n.parentElement) chain.push(n);
    return chain;
  }

  /** { parts: the region's elements in document order, primary: the ones that are the Blackbox box, area: of their
   *  common parent, depth } for one heading pair, or null. */
  function regionFor(a, b) {
    var up = ancestorsOf(a);
    var lca = null;
    for (var n = b; n; n = n.parentElement) {
      if (up.indexOf(n) >= 0) {
        lca = n;
        break;
      }
    }
    // One heading inside the other is not two boxes.
    if (!lca || lca === a || lca === b) return null;
    var first = a;
    while (first.parentElement !== lca) first = first.parentElement;
    var last = b;
    while (last.parentElement !== lca) last = last.parentElement;
    var kids = lca.children;
    var i = Array.prototype.indexOf.call(kids, first);
    var j = Array.prototype.indexOf.call(kids, last);
    if (i < 0 || j < 0 || i === j) return null;
    var from = Math.min(i, j);
    var to = Math.max(i, j);
    // Flat markup (heading, body, heading, body ... as siblings): the last heading's own box follows it, up to the next
    // sibling shaped like that heading.
    var tail = kids[to];
    if (tail === a || tail === b) {
      while (to + 1 < kids.length && !(kids[to + 1].tagName === tail.tagName && kids[to + 1].className === tail.className)) to += 1;
    }
    if (to - from + 1 > FOCUS_MAX_PARTS) return null;
    var parts = [];
    for (var k = from; k <= to; k += 1) parts.push(kids[k]);
    // The Blackbox box itself: the child that holds its heading - or, in flat markup, the heading and what follows it up
    // to the other heading.
    var primary = [first];
    if (first === a) for (var p = i + 1; p <= to && kids[p] !== last; p += 1) primary.push(kids[p]);
    // Measured by what it holds, not by the parent's own box (a display:contents wrapper has none).
    var frame = unionRect(parts);
    if (!frame) return null;
    return { parts: parts, primary: primary, area: frame.width * frame.height, depth: up.length };
  }

  /** The child of `parent` that holds `el`, or null. */
  function childHolding(parent, el) {
    var n = el;
    while (n && n.parentElement !== parent) n = n.parentElement;
    return n || null;
  }

  /** The queue panel by the Gamefinder's own ids: the children of #offers from the box holding #blackboxwrapper through
   *  the box holding #offerlistwrapper. Null when the page is not laid out that way (then the headings decide). */
  function regionByIds() {
    var offers = document.getElementById('offers');
    var blackbox = document.getElementById('blackboxwrapper');
    var list = document.getElementById('offerlistwrapper');
    if (!offers || !blackbox || !list || !offers.contains(blackbox) || !offers.contains(list)) return null;
    var first = childHolding(offers, blackbox);
    var last = childHolding(offers, list);
    var kids = offers.children;
    var i = Array.prototype.indexOf.call(kids, first);
    var j = Array.prototype.indexOf.call(kids, last);
    if (i < 0 || j < 0 || Math.abs(j - i) + 1 > FOCUS_MAX_PARTS) return null;
    var parts = [];
    for (var k = Math.min(i, j); k <= Math.max(i, j); k += 1) parts.push(kids[k]);
    var frame = unionRect(parts);
    if (!frame || !visibleRect(first)) return null;
    return { parts: parts, primary: [first], area: frame.width * frame.height, depth: ancestorsOf(offers).length };
  }

  /** The queue panel ({ parts, primary }), or null: by the page's ids when it has them, else by its headings - of which
   *  the tightest pair wins (the smallest region that is really drawn, then the deepest), so a second "Blackbox"
   *  somewhere else on the page never widens the panel. */
  function findQueueRegion() {
    var known = regionByIds();
    if (known) return known;
    var boxes = headingElements(isBlackboxHeading);
    // The one site id used, and only as a second anchor for the Blackbox box when its heading text is not found.
    var wrapper = document.getElementById('blackboxwrapper');
    if (wrapper && shownRect(wrapper) && boxes.indexOf(wrapper) < 0) {
      var inside = false;
      for (var w = 0; w < boxes.length; w += 1) if (wrapper.contains(boxes[w])) inside = true;
      if (!inside) boxes.push(wrapper);
    }
    var offers = boxes.length ? headingElements(isOffersHeading) : [];
    var best = null;
    for (var i = 0; i < boxes.length; i += 1) {
      for (var j = 0; j < offers.length; j += 1) {
        var region = regionFor(boxes[i], offers[j]);
        if (region && (!best || region.area < best.area || (region.area === best.area && region.depth > best.depth))) best = region;
      }
    }
    return best;
  }

  /** Why nothing was found: the words are on the page, but only inside a frame or a shadow root (which a crop of this
   *  document cannot reach), or simply not there. */
  function focusElsewhere() {
    var hasBoth = function (text) {
      var t = normText(text);
      return t.indexOf('blackbox') >= 0 && t.indexOf('match offers') >= 0;
    };
    try {
      var frames = document.getElementsByTagName('iframe');
      for (var i = 0; i < frames.length; i += 1) {
        var inner = null;
        try {
          inner = frames[i].contentDocument;
        } catch (e) {
          inner = null;
        }
        if (inner && inner.body && hasBoth(inner.body.textContent)) return 'frame';
      }
      var all = document.getElementsByTagName('*');
      for (var k = 0; k < all.length && k < FOCUS_SCAN_MAX; k += 1) {
        var shadow = all[k].shadowRoot;
        if (shadow && hasBoth(shadow.textContent)) return 'shadow';
      }
    } catch (e2) {
      /* fall through */
    }
    return 'not-found';
  }

  /** The rectangle (viewport pixels, as drawn now) around every visible part, or null. */
  function unionRect(parts) {
    var left = Infinity;
    var top = Infinity;
    var right = -Infinity;
    var bottom = -Infinity;
    for (var i = 0; i < parts.length; i += 1) {
      var r = visibleRect(parts[i]);
      if (!r) continue;
      left = Math.min(left, r.x);
      top = Math.min(top, r.y);
      right = Math.max(right, r.x + r.width);
      bottom = Math.max(bottom, r.y + r.height);
    }
    if (!(right > left && bottom > top)) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  // --- what the site shows on top of its page (Astra F1) --------------------------------------------------------------

  function isOurs(el) {
    return !!(el.closest && el.closest(FOCUS_OURS + ', #' + FILTER_DEFS_ID + ', #' + FOCUS_STYLE_ID));
  }
  /** A hover tip is not something to give the page back for (and giving way to one would move it from under the pointer). */
  function isTooltip(el) {
    var names = String((el.getAttribute && el.getAttribute('id')) || '') + ' ' + String(typeof el.className === 'string' ? el.className : '');
    return /tooltip/i.test(names) || (el.getAttribute && el.getAttribute('role') === 'tooltip');
  }
  function holdsParts(el, parts) {
    for (var i = 0; i < parts.length; i += 1) if (el === parts[i] || el.contains(parts[i])) return true;
    return false;
  }
  /** Children of a container that are drawn and are not what the panel sits in. */
  function drawnOutsiders(container, parts) {
    var out = [];
    var kids = container ? container.children : [];
    for (var i = 0; i < kids.length; i += 1) {
      var kid = kids[i];
      if (/^(script|style|link|meta|audio|noscript|template)$/i.test(kid.tagName) || isOurs(kid) || isTooltip(kid)) continue;
      if (holdsParts(kid, parts) || insideParts(kid, parts)) continue;
      if (bigEnough(shownRect(kid), FOCUS_OVERLAY_MIN_W, FOCUS_OVERLAY_MIN_H)) out.push(kid);
    }
    return out;
  }
  function insideParts(el, parts) {
    for (var i = 0; i < parts.length; i += 1) if (parts[i] === el || parts[i].contains(el)) return true;
    return false;
  }
  function positionOf(el) {
    var css = cssOf(el);
    return css ? css.position : '';
  }
  function bigEnough(rect, w, h) {
    return !!rect && rect.width >= w && rect.height >= h;
  }

  /** Every element the site takes out of the page's flow right now: [element, 'fixed' | 'absolute'] (bounded walk). */
  function positionedElements() {
    var out = [];
    var all = document.body ? document.body.getElementsByTagName('*') : [];
    for (var i = 0; i < all.length && i < FOCUS_SCAN_MAX; i += 1) {
      if (isOurs(all[i])) continue;
      var position = positionOf(all[i]);
      if (position === 'fixed' || position === 'absolute') out.push([all[i], position]);
    }
    return out;
  }

  function isSiteDialog(el) {
    return typeof el.matches === 'function' && el.matches(FOCUS_DIALOG_SELECTOR);
  }

  /** The site's PERMANENT layout around a page's content, as the live site has it (owner's saved page, 10-09): what is
   *  inside its page wrapper but outside the page's own content - the header, the menus and their drop-downs, the
   *  search and account boxes. Positioned things there are the site's chrome, not an overlay. Anything else that is
   *  positioned is not presumed harmless (Astra R1: an overlay already open when the crop begins must not be taken
   *  for part of the page). */
  function isSiteChrome(el) {
    return !!(el.closest && el.closest('.contentwrapper') && !el.closest('.pagecontent'));
  }

  /** Match Offers has something in it. By the live page's own structure: its list (#offerlist) has entries, its
   *  "additional offers" note is shown, or its "no offers" line is not. On a page found by its headings: the box under
   *  the Match Offers heading holds a control. Structure only - no text is read. */
  function offersShowing(region) {
    var wrapper = document.getElementById('offerlistwrapper');
    if (wrapper && insideParts(wrapper, region.parts)) {
      var list = document.getElementById('offerlist');
      if (list && list.children.length > 0) return true;
      var box = wrapper;
      for (var b = 0; b < region.parts.length; b += 1) if (region.parts[b].contains(wrapper)) box = region.parts[b];
      var more = box.getElementsByClassName('additionaloffers');
      for (var m = 0; m < more.length; m += 1) if (shownRect(more[m])) return true;
      var none = wrapper.getElementsByClassName('nooffers');
      for (var n = 0; n < none.length; n += 1) if (shownRect(none[n])) return false;
      return true; // nothing says "no offers": show the box rather than assume
    }
    var tags = ['button', 'input', 'select'];
    for (var p = 0; p < region.parts.length; p += 1) {
      if (region.primary.indexOf(region.parts[p]) >= 0) continue;
      for (var t = 0; t < tags.length; t += 1) {
        var controls = region.parts[p].getElementsByTagName(tags[t]);
        for (var c = 0; c < controls.length; c += 1) if (shownRect(controls[c])) return true;
      }
    }
    return false;
  }

  /**
   * What stands between the coach and something they must see. Returns { blocker, inPanel }:
   *  - `blocker`: something of the site's that a cropped, shifted page could put out of view - the crop is dropped
   *    for as long as it is there. In order:
   *     1. anything the site marks as a dialog (dialog[open], role=dialog / alertdialog, aria-modal) that is drawn
   *        outside the panel, or pinned to the viewport;
   *     2. anything drawn directly under the Gamefinder's own root (#gamefinder) beside the grid the panel is in - the
   *        live page mounts its conditional blocks there (its dialogs, its error banners), whatever they are styled as;
   *     3. anything drawn directly under <body> that is positioned, or that was put there after the crop was asked for;
   *     4. anything pinned to the viewport (position: fixed), and anything positioned over the page (absolute) of real
   *        size outside the panel - WHENEVER it appeared. Nothing is presumed to be "part of the page" because it was
   *        already there (Astra R1): only the site's permanent layout is (isSiteChrome), and hover tips (isTooltip).
   *  - `inPanel`: dialogs, and everything positioned of real size, INSIDE the panel - whenever it appeared. They move
   *    with it, so the crop can stay - but only if they can be seen: the caller measures them into what the frame must
   *    show AND into how far the view can be moved.
   * When unsure, there is a blocker: fail towards showing more.
   */
  function findBlocker(st, parts) {
    var inPanel = [];
    var list = document.querySelectorAll(FOCUS_DIALOG_SELECTOR);
    for (var i = 0; i < list.length; i += 1) {
      var d = list[i];
      if (isOurs(d) || !bigEnough(shownRect(d), FOCUS_MIN_EDGE, FOCUS_MIN_EDGE)) continue;
      if (insideParts(d, parts) && positionOf(d) !== 'fixed') {
        inPanel.push(d);
        continue;
      }
      return { blocker: d, inPanel: inPanel };
    }
    var root = document.getElementById('gamefinder');
    if (root && holdsParts(root, parts)) {
      var beside = drawnOutsiders(root, parts);
      if (beside.length) return { blocker: beside[0], inPanel: inPanel };
    }
    var top = drawnOutsiders(document.body, parts);
    for (var t = 0; t < top.length; t += 1) {
      var position = positionOf(top[t]);
      if (position === 'fixed' || position === 'absolute' || st.lateSet.has(top[t])) return { blocker: top[t], inPanel: inPanel };
    }
    if (st.scan || !st.positioned) {
      st.scan = false;
      st.positioned = positionedElements();
    }
    for (var f = 0; f < st.positioned.length; f += 1) {
      var el = st.positioned[f][0];
      if (!el.isConnected || isTooltip(el) || isSiteChrome(el)) continue;
      var now = positionOf(el);
      if (now === 'fixed') {
        if (bigEnough(shownRect(el), FOCUS_OVERLAY_MIN_W, FOCUS_OVERLAY_MIN_H)) return { blocker: el, inPanel: inPanel };
        continue;
      }
      if (now !== 'absolute' || holdsParts(el, parts)) continue;
      if (insideParts(el, parts)) {
        // Inside the panel: measured, late or not (Astra R1: one that was already there when the crop began was never
        // measured). Whatever lies within the panel's own box adds nothing - the bar of the Blackbox timer, say.
        if (bigEnough(shownRect(el), FOCUS_OVERLAY_MIN_W, FOCUS_OVERLAY_MIN_H) && inPanel.indexOf(el) < 0) inPanel.push(el);
        continue;
      }
      if (bigEnough(shownRect(el), FOCUS_LATE_MIN_W, FOCUS_LATE_MIN_H)) return { blocker: el, inPanel: inPanel };
    }
    return { blocker: null, inPanel: inPanel };
  }

  /*
   * The crop's stylesheet. Two elements, two different jobs - and they must stay apart:
   *  - <html> carries the TRANSLATE and `overflow: hidden`. The root element's overflow is not applied to the root's
   *    own box: the browser hands it to the VIEWPORT. So this hides the page's scrollbars and clips nothing but the
   *    viewport itself, which does not move with the translate.
   *  - <body> is made `overflow: visible`: it must never be a clip box of its own.
   *
   * Owner 10-09, live ("The screen is black on the float"; "Expanding the window shows the box ... Fit puts the black
   * box over it again"): the first build set `overflow: hidden` on <body> as well. With <html> no longer `visible`,
   * <body>'s overflow stops being handed to the viewport and applies to <body> itself - and on this site <body> is
   * exactly one viewport in size (height: 100%). So <body> became a viewport-sized clip box that was then MOVED by the
   * translate on its parent: with the panel at (20, 153.65) the clip box sat at x -20..230, y -153.65..(viewport
   * height - 153.65). At the fitted size (viewport 250 x 144) that is y -153.65..-9.65: entirely above the frame -
   * all black. Dragged larger, a strip came into view, cut off on the right at 230 page px (368 px at 160 %).
   * Every rectangle the script measured was right; clipping does not show in a rectangle. See clippedBy().
   */
  function focusCss(transform) {
    var on = 'html[' + FOCUS_ATTR + ']';
    // No scrollbars, and the region brought to the viewport's top-left. Layout is untouched and nothing is hidden.
    return on + '{overflow:hidden!important;transform-origin:0 0!important;transform:' + transform + '!important}' +
      on + ' body{overflow:visible!important}';
  }

  /** How an element's computed overflow clips, per axis: [x, y]. The CSS rule is followed, not just the two values: an
   *  axis left `visible` computes to `auto` - and clips - as soon as the other axis is anything but `visible` or
   *  `clip` (overflow-y: hidden alone makes a box that also cuts off sideways). Where an engine reports only the
   *  shorthand, that decides. */
  function overflowClips(css) {
    var both = String(css.overflow || '').split(' ');
    var x = css.overflowX && css.overflowX !== 'visible' ? css.overflowX : both[0] || 'visible';
    var y = css.overflowY && css.overflowY !== 'visible' ? css.overflowY : both[1] || both[0] || 'visible';
    var open = function (v) { return v === 'visible' || v === ''; };
    var scrolls = function (v) { return !open(v) && v !== 'clip'; };
    return [!open(x) || scrolls(y), !open(y) || scrolls(x)];
  }

  /**
   * Every element between the panel and the root that can cut off what is inside it:
   * [element, its clip box as drawn now, clips sideways, clips up and down, cannot be drawn at all, clips by overflow
   * alone].
   *  - overflow other than `visible` (see overflowClips), `contain: paint | strict | content`, a `clip-path`, and
   *    `content-visibility: auto` all clip to the element's box (a clip-path may cut more: the box is the most it
   *    can leave);
   *  - `content-visibility: hidden`, `visibility: hidden` and `opacity: 0` mean what is inside is not drawn at all.
   * The clip edge is the PADDING box (inside the borders and scrollbars) where the engine gives one.
   * <html> is never in the list (its overflow belongs to the viewport), and neither is <body> under the crop
   * (focusCss makes it `visible`). The panel's own insides are not looked at: only what it sits in.
   */
  function clipAncestors(parts) {
    var out = [];
    var root = document.documentElement;
    for (var n = parts[0] ? parts[0].parentElement : null; n && n !== root; n = n.parentElement) {
      var css = cssOf(n);
      if (!css) continue;
      var gone = css.visibility === 'hidden' || css.visibility === 'collapse' || (css.opacity !== '' && css.opacity != null && Number(css.opacity) === 0) ||
        css.contentVisibility === 'hidden';
      var axes = n === document.body ? [false, false] : overflowClips(css);
      var contain = String(css.contain || '');
      var boxed = /\b(paint|strict|content)\b/.test(contain) || (css.clipPath && css.clipPath !== 'none') || css.contentVisibility === 'auto';
      // Clipping by overflow ALONE reaches only what the element is a containing-block ancestor of; the others cut
      // off everything inside the element, however it is positioned.
      var byOverflowOnly = !boxed && !gone;
      if (boxed) axes = [true, true];
      if (!gone && !axes[0] && !axes[1]) continue;
      var b = n.getBoundingClientRect ? n.getBoundingClientRect() : null;
      if (!b) continue;
      var clip = { x: b.left, y: b.top, width: b.width, height: b.height };
      if (n.clientWidth > 0 && n.clientHeight > 0 && b.width >= n.clientWidth && b.height >= n.clientHeight) {
        clip = { x: b.left + (n.clientLeft || 0), y: b.top + (n.clientTop || 0), width: n.clientWidth, height: n.clientHeight };
      }
      out.push([n, clip, axes[0], axes[1], gone, byOverflowOnly]);
    }
    return out;
  }

  /** An element is the containing block of its absolutely positioned descendants: positioned itself, or transformed,
   *  filtered, or contained. When its style cannot be read it is taken to be one (then its clip applies: refuse rather
   *  than assume). */
  function isContainingBlock(el) {
    var css = cssOf(el);
    if (!css) return true;
    if (css.position && css.position !== 'static') return true;
    // Each of these makes an element the containing block of what is positioned inside it. A property the engine does
    // not report at all (undefined) cannot be ruled out: then it is taken to be one - its clip applies (Astra 10-09,
    // round 8: translate / rotate / scale, backdrop-filter and container-type were not looked at, so an overflow:
    // hidden ancestor that is a containing block only through one of them was skipped and a clipped dialog passed).
    var none = ['transform', 'translate', 'rotate', 'scale', 'filter', 'backdropFilter', 'perspective'];
    for (var i = 0; i < none.length; i += 1) {
      var value = css[none[i]];
      if (value === undefined || (value !== '' && value !== 'none')) return true;
    }
    if (css.containerType === undefined || (css.containerType !== '' && css.containerType !== 'normal')) return true;
    if (css.contain === undefined || css.willChange === undefined) return true; // not reported: cannot be ruled out
    return /\b(layout|paint|strict|content|size|inline-size)\b/.test(String(css.contain)) ||
      /transform|translate|rotate|scale|perspective|filter|contain/.test(String(css.willChange)); // incl. backdrop-filter, container-type
  }

  /**
   * The ancestors whose OVERFLOW can clip `el`: its containing-block chain. An in-flow element is clipped by every
   * ancestor; an absolutely positioned one skips the ancestors between it and its containing block (a static
   * overflow: hidden box does not clip an absolute child whose containing block is outside it) - and so on up the
   * chain. Null = cannot tell (a pinned element, whose containing block is the viewport unless something above it is
   * transformed): the caller then treats every clipping ancestor as applying.
   */
  function containingChain(el) {
    var chain = [];
    var root = document.documentElement;
    for (var n = el; n && n !== root;) {
      var position = positionOf(n);
      if (position === 'fixed') return null;
      var up = n.parentElement;
      if (position === 'absolute') while (up && up !== root && !isContainingBlock(up)) up = up.parentElement;
      if (!up || up === root) break;
      chain.push(up);
      n = up;
    }
    return chain;
  }

  function holds(clip, rect) {
    if (clip[2] && (clip[1].x > rect.x + 1 || clip[1].x + clip[1].width < rect.x + rect.width - 1)) return false;
    if (clip[3] && (clip[1].y > rect.y + 1 || clip[1].y + clip[1].height < rect.y + rect.height - 1)) return false;
    return true;
  }

  /**
   * What would CUT OFF something the frame may have to show: { clipper, cause } or null. What it may have to show is
   * the whole REQUIRED rect - everything the view can be moved over (Astra 10-09: checking only the first
   * viewport-sized slice let a clipping ancestor cut a dialog off further down while the report said ok):
   *  - the panel's own box (`box`), against EVERY clipping ancestor (cause: null);
   *  - each thing measured inside the panel (`inPanel`: its dialogs, what is positioned in it), against the clipping
   *    ancestors that really clip it (cause: that element). Astra 10-09, round 7: an ancestor that clips by overflow
   *    alone only clips what it is a containing-block ancestor of - holding an absolute dialog against a static
   *    overflow: hidden box it is not clipped by refused the crop for as long as the dialog was open.
   * Everything measured moves together under the translate and the pan, so the answer does not depend on where the
   * view is; it is asked on every pass, BEFORE the crop is put on the page. When unsure, it is clipped.
   * A rectangle says where something is, not whether it is painted: this is the check that tells.
   */
  function clippedBy(parts, box, inPanel, sizes) {
    var clips = clipAncestors(parts);
    for (var i = 0; i < clips.length; i += 1) {
      if (clips[i][4] || !holds(clips[i], box)) return { clipper: clips[i][0], cause: null };
    }
    for (var p = 0; p < (inPanel ? inPanel.length : 0); p += 1) {
      var rect = shownRect(inPanel[p]);
      if (!rect) continue;
      // The LARGEST this element has been seen at (see noteSizes): judged at that size, with or without the crop.
      var most = sizes ? sizes.get(inPanel[p]) : null;
      if (most) rect = { x: rect.x, y: rect.y, width: Math.max(rect.width, most.width), height: Math.max(rect.height, most.height) };
      var chain = containingChain(inPanel[p]);
      for (var c = 0; c < clips.length; c += 1) {
        var applies = !clips[c][5] || chain === null || chain.indexOf(clips[c][0]) >= 0;
        if (applies && !holds(clips[c], rect)) return { clipper: clips[c][0], cause: inPanel[p] };
      }
    }
    return null;
  }

  /** A smaller size must be measured this many passes in a row before the remembered one gives way to it. */
  var FOCUS_SIZE_SETTLE = 3;

  /**
   * Remember the largest size each measured thing inside the panel has been seen at. Astra 10-09, round 7: a dialog
   * that measures one size without the crop and another with it (its layout answers to the viewport) passed the check
   * uncropped, failed it cropped, and the frame alternated between the two on every look. Judged at the largest size
   * it has shown, the answer is the same in both states.
   *
   * The memory is not for ever (round 8: a dialog that had shrunk to a safe size stayed refused, and one that was
   * hidden and shown again was refused on sight):
   *  - what is no longer measured - hidden, removed - is forgotten at once;
   *  - what measures the SAME smaller size for FOCUS_SIZE_SETTLE passes in a row has really shrunk: that size is taken.
   * (A dialog that is only smaller without the crop gets one more try every few passes; it grows under the crop, is
   * refused again in that same pass, and the page is never drawn cropped in between.)
   */
  function noteSizes(st, inPanel) {
    var kept = [];
    for (var k = 0; k < st.sized.length; k += 1) {
      if (inPanel.indexOf(st.sized[k]) >= 0 && shownRect(st.sized[k])) kept.push(st.sized[k]);
      else st.seenSizes.delete(st.sized[k]);
    }
    st.sized = kept;
    for (var i = 0; i < inPanel.length; i += 1) {
      var rect = shownRect(inPanel[i]);
      if (!rect) continue;
      var most = st.seenSizes.get(inPanel[i]);
      if (!most) {
        st.seenSizes.set(inPanel[i], { width: rect.width, height: rect.height, lowW: 0, lowH: 0, low: 0 });
        st.sized.push(inPanel[i]);
      } else if (rect.width >= most.width - 0.5 && rect.height >= most.height - 0.5) {
        most.width = Math.max(most.width, rect.width);
        most.height = Math.max(most.height, rect.height);
        most.low = 0;
      } else if (Math.abs(rect.width - most.lowW) <= 0.5 && Math.abs(rect.height - most.lowH) <= 0.5) {
        most.low += 1;
        if (most.low >= FOCUS_SIZE_SETTLE) {
          most.width = rect.width;
          most.height = rect.height;
          most.low = 0;
        }
      } else {
        most.lowW = rect.width;
        most.lowH = rect.height;
        most.low = 1;
      }
    }
  }

  /** The rectangle the frame may have to show: the region and as far as anything measured inside it reaches. */
  function requiredRect(box, inPanel) {
    var want = { x: box.x, y: box.y, width: box.width, height: box.height };
    for (var i = 0; i < inPanel.length; i += 1) {
      var far = shownRect(inPanel[i]);
      if (!far) continue;
      want.width = Math.max(want.width, far.x + far.width - box.x);
      want.height = Math.max(want.height, far.y + far.height - box.y);
    }
    return want;
  }

  /** Take the presentation off the page (the observers stay: the region may come back). */
  function focusUnapply(st) {
    var root = document.documentElement;
    for (var i = 0; i < st.kept.length; i += 1) st.kept[i].removeAttribute(FOCUS_KEEP_ATTR);
    st.kept = [];
    if (st.sizes) st.sizes.disconnect();
    if (st.on) {
      st.on = false;
      root.removeAttribute(FOCUS_ATTR);
      if (st.style.parentNode) st.style.parentNode.removeChild(st.style);
      st.style.textContent = '';
      // A shifted page can clamp the scroll position: put the coach's own back - the window's, and <body>'s own.
      if (window.scrollX !== st.scroll.x || window.scrollY !== st.scroll.y) window.scrollTo(st.scroll.x, st.scroll.y);
      // Only what the crop changed is put back: the SAME <body> (a site may have replaced it meanwhile), and only
      // while it is still where the crop left it (a scroll made since - by the site or the coach - stands).
      var was = st.bodyScroll;
      if (was && document.body === was.el && (was.el.scrollLeft || 0) === was.leftX && (was.el.scrollTop || 0) === was.leftY) {
        if (was.leftX !== was.x) was.el.scrollLeft = was.x;
        if (was.leftY !== was.y) was.el.scrollTop = was.y;
      }
      st.bodyScroll = null;
    }
    st.tx = 0;
    st.ty = 0;
    st.panX = 0;
    st.panY = 0;
    st.maxX = 0;
    st.maxY = 0;
    st.css = '';
  }

  function sameParts(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
    return true;
  }

  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  function focusWrite(st) {
    var css = focusCss('translate(' + st.tx + 'px,' + st.ty + 'px)');
    if (css === st.css) return;
    st.css = css;
    st.style.textContent = css;
  }

  /** One pass: find the region and (re)anchor it. Writes nothing when nothing changed. */
  function focusPass() {
    var st = focusState;
    if (!st) return;
    if (st.timer) window.clearTimeout(st.timer);
    st.timer = 0;
    var root = document.documentElement;
    var region = null;
    // What an earlier pass saw of the draw is not this pass's answer: said again below only if it is SEEN again.
    focusDraw = '';
    try {
      focusLoad = joinWatch().load; // this page load's own mark: the host keys what it knows of the draw by it
    } catch (eLoad) {
      focusLoad = '';
    }
    try {
      region = findQueueRegion();
    } catch (e) {
      st.blocker = null;
      st.clipper = null;
      st.refused = null;
      focusUnapply(st);
      st.report = focusReport(false, 'error', null, null, e && e.message);
      return;
    }
    var parts = region && region.parts;
    var box = parts && unionRect(parts);
    focusDraw = '';
    if (!parts || !box || box.width < FOCUS_MIN_EDGE || box.height < FOCUS_MIN_EDGE) {
      st.blocker = null;
      st.clipper = null;
      st.refused = null;
      focusUnapply(st);
      st.report = focusReport(false, focusElsewhere(), null, null);
      return;
    }
    // Known from here on, whether or not the crop is used: every report below carries it.
    var place = drawState().draw;
    focusDraw = place === 'in' || place === 'out' ? place : '';
    var blocker = null;
    var inPanel = [];
    var offers = false;
    try {
      var found = findBlocker(st, parts);
      blocker = found.blocker;
      inPanel = found.inPanel;
      offers = offersShowing(region);
      // Something of the panel's own that hangs out past its top or left edge cannot be brought into the frame by
      // growing it: the page is shown as it is instead.
      for (var p = 0; !blocker && p < inPanel.length; p += 1) {
        var hang = shownRect(inPanel[p]);
        if (hang && (hang.x < box.x - 1 || hang.y < box.y - 1)) blocker = inPanel[p];
      }
    } catch (e2) {
      blocker = document.body; // cannot tell: show the page as it is
    }
    st.blocker = blocker;
    if (blocker) {
      // Nothing was asked about clipping on this pass: an answer from an earlier one is not this pass's reason - and
      // what was measured inside the panel before the page was given back is not remembered across it either.
      st.clipper = null;
      st.refused = null;
      st.seenSizes = new WeakMap();
      st.sized = [];
      focusUnapply(st);
      st.report = focusReport(false, 'dialog', null, null);
      return;
    }
    // Would the crop actually DRAW? Something between the panel and the root that clips its contents and does not hold
    // what the frame is to show would leave the frame empty while every measurement looked right. Then: no crop.
    var clipper = null;
    try {
      noteSizes(st, inPanel);
      var cut = clippedBy(parts, box, inPanel, st.seenSizes);
      clipper = cut ? cut.clipper : null;
      st.refused = cut && cut.cause ? cut : null;
    } catch (e3) {
      clipper = document.body; // cannot tell: show the page as it is
    }
    st.clipper = clipper;
    if (clipper) {
      focusUnapply(st);
      st.report = focusReport(false, 'clipped', null, null);
      return;
    }
    if (!st.on) {
      st.on = true;
      st.scroll = { x: window.scrollX || 0, y: window.scrollY || 0 };
      // <body> is made `overflow: visible` (focusCss). Where the site scrolls <body> itself, that throws its scroll
      // position away - so it is noted here and put back when the crop comes off (Astra 10-09: only the window's was).
      // Astra 10-09, round 7: WHICH body, and what the crop itself left it at - it is put back only into that same
      // element, and only if nobody has scrolled it since.
      var page = document.body;
      st.bodyScroll = page ? { el: page, x: page.scrollLeft || 0, y: page.scrollTop || 0, leftX: 0, leftY: 0 } : null;
      st.css = focusCss('none');
      st.style.textContent = st.css;
      (document.head || root).appendChild(st.style);
      root.setAttribute(FOCUS_ATTR, 'queue');
      if (st.bodyScroll) {
        st.bodyScroll.leftX = page.scrollLeft || 0; // where making it `visible` left it (0, when it was a scroller)
        st.bodyScroll.leftY = page.scrollTop || 0;
      }
    } else if (!st.style.parentNode) {
      (document.head || root).appendChild(st.style); // the site replaced its <head> content
    }
    if (!sameParts(st.kept, parts)) {
      for (var i = 0; i < st.kept.length; i += 1) if (parts.indexOf(st.kept[i]) < 0) st.kept[i].removeAttribute(FOCUS_KEEP_ATTR);
      for (var j = 0; j < parts.length; j += 1) if (!parts[j].hasAttribute(FOCUS_KEEP_ATTR)) parts[j].setAttribute(FOCUS_KEEP_ATTR, '');
      st.kept = parts;
      if (st.sizes) {
        st.sizes.disconnect();
        for (var k = 0; k < parts.length; k += 1) st.sizes.observe(parts[k]);
      }
    }
    var vw = root.clientWidth || window.innerWidth || 0;
    var vh = root.clientHeight || window.innerHeight || 0;
    // Twice at most: the second look catches a page that answers the shift by moving the region itself (a sticky
    // ancestor, a scroll position the hidden scrollbars clamped).
    for (var attempt = 0; attempt < 2; attempt += 1) {
      // Measured as drawn NOW (under the shift already applied, and after the scrollbars went): the shift is taken
      // out by arithmetic rather than by touching the page. The size is the page's own - nothing here scales anything.
      box = unionRect(parts) || box;
      // The REQUIRED rect, from the region's top-left: the panel itself and as far as anything measured inside it
      // reaches (a dialog of the panel's that is longer than the panel). Astra 10-09 (R1): "found" may only be said
      // when all of that is in the frame or can be brought into it - so the view can be moved over the required
      // rect, not just over the panel (a dialog reaching 270 px below the panel in a frame that cannot grow could
      // not be scrolled to at all).
      var required = requiredRect(box, inPanel);
      var needW = required.width;
      var needH = required.height;
      // How far the view can be moved (a required rect larger than the frame); never past its edges.
      st.maxX = Math.max(0, round2(needW - vw));
      st.maxY = Math.max(0, round2(needH - vh));
      st.panX = Math.min(st.panX, st.maxX);
      st.panY = Math.min(st.panY, st.maxY);
      // Where the region's top-left sits on the unshifted page, then the shift that puts it at the viewport's top-left.
      var left = box.x - st.tx;
      var top = box.y - st.ty;
      var tx = round2(-left - st.panX);
      var ty = round2(-top - st.panY);
      if (tx === st.tx && ty === st.ty) break;
      st.tx = tx;
      st.ty = ty;
      focusWrite(st);
    }
    focusWrite(st);
    // Measured again as drawn UNDER the crop: something inside the panel may be larger now than it was a moment ago.
    // If that puts it past a clip box, the crop comes straight off again - in this same pass, not on the next look.
    try {
      noteSizes(st, inPanel);
      var after = clippedBy(parts, unionRect(parts) || box, inPanel, st.seenSizes);
      if (after) {
        st.clipper = after.clipper;
        st.refused = after.cause ? after : null;
        focusUnapply(st);
        st.report = focusReport(false, 'clipped', null, null);
        return;
      }
    } catch (e4) {
      /* the pass before the crop already answered */
    }
    var mine = unionRect(region.primary);
    var primary = mine
      ? { width: Math.max(0, mine.x + mine.width - box.x), height: Math.max(0, mine.y + mine.height - box.y) }
      : null;
    // What must be in view beyond the Blackbox box: the whole panel while Match Offers has something in it, and the
    // panel's own dialogs wherever they reach.
    var attention = null;
    var base = { width: offers ? box.width : primary ? primary.width : 0, height: offers ? box.height : primary ? primary.height : 0 };
    var want = { width: base.width, height: base.height };
    for (var a = 0; a < inPanel.length; a += 1) {
      var reach = shownRect(inPanel[a]);
      if (!reach) continue;
      want.width = Math.max(want.width, reach.x + reach.width - box.x);
      want.height = Math.max(want.height, reach.y + reach.height - box.y);
    }
    // Said only when there is something to say: offers, or something of the panel's reaching past the Blackbox box.
    if (offers || want.width > base.width + 1 || want.height > base.height + 1) {
      attention = { offers: offers, width: want.width, height: want.height };
    }
    st.report = focusReport(true, 'ok', box, primary, null, attention);
  }

  function focusSchedule(delay) {
    var st = focusState;
    if (!st || st.timer) return;
    st.timer = window.setTimeout(focusPass, typeof delay === 'number' ? delay : FOCUS_DEBOUNCE_MS);
  }
  function focusOnView() {
    focusSchedule(FOCUS_DEBOUNCE_MS);
  }

  /** The wheel moves the VIEW inside the region when the region is larger than the frame (there are no scrollbars and
   *  the page itself cannot scroll while focused). Passive: the event is only read. */
  function focusWheel(event) {
    var st = focusState;
    if (!st || !st.on || !(st.maxX > 0 || st.maxY > 0)) return;
    var unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? (window.innerHeight || 400) : 1;
    var dx = (event.shiftKey ? event.deltaY : event.deltaX) * unit || 0;
    var dy = (event.shiftKey ? 0 : event.deltaY) * unit || 0;
    var nx = Math.max(0, Math.min(st.maxX, st.panX + dx));
    var ny = Math.max(0, Math.min(st.maxY, st.panY + dy));
    if (nx === st.panX && ny === st.panY) return;
    st.tx = round2(st.tx - (nx - st.panX));
    st.ty = round2(st.ty - (ny - st.panY));
    st.panX = nx;
    st.panY = ny;
    focusWrite(st);
  }

  function focusStart() {
    var style = document.createElement('style');
    style.setAttribute('id', FOCUS_STYLE_ID);
    var st = {
      style: style, kept: [], tx: 0, ty: 0, panX: 0, panY: 0, maxX: 0, maxY: 0, css: '', on: false,
      scroll: { x: 0, y: 0 }, bodyScroll: null, timer: 0, observer: null, sizes: null, onView: focusOnView, onWheel: focusWheel,
      report: FOCUS_NONE, positioned: null, lateSet: new WeakSet(), scan: false, blocker: null, clipper: null, refused: null,
      seenSizes: new WeakMap(), sized: [],
    };
    focusState = st;
    if (typeof MutationObserver === 'function') {
      st.observer = new MutationObserver(function (records) {
        var structural = false;
        var styled = false;
        for (var i = 0; i < records.length; i += 1) {
          var record = records[i];
          var target = record.target;
          // Our own stylesheet update is not a page change.
          if (target === st.style || target.parentNode === st.style) continue;
          if (record.type === 'attributes') {
            styled = true;
            continue;
          }
          structural = true;
          var added = record.addedNodes || [];
          for (var a = 0; a < added.length; a += 1) {
            if (added[a].nodeType !== 1 || added[a] === st.style || isOurs(added[a])) continue;
            st.scan = true; // something new may be pinned over the page
            st.lateSet.add(added[a]);
          }
        }
        if (styled) st.scan = true; // something may have been shown by a class or a style
        if (structural) focusSchedule(FOCUS_DEBOUNCE_MS);
        else if (styled) focusSchedule(FOCUS_ATTR_DEBOUNCE_MS);
      });
      // Structure, text, and the few attributes a site shows or hides things with. Never our own two markers.
      st.observer.observe(document.documentElement, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'role', 'aria-modal', 'aria-hidden'],
      });
    }
    if (typeof ResizeObserver === 'function') st.sizes = new ResizeObserver(focusOnView);
    window.addEventListener('resize', st.onView, true);
    window.addEventListener('scroll', st.onView, true);
    window.addEventListener('wheel', st.onWheel, { capture: true, passive: true });
  }

  function focusStop() {
    var st = focusState;
    if (!st) return;
    focusState = null;
    if (st.timer) window.clearTimeout(st.timer);
    if (st.observer) st.observer.disconnect();
    window.removeEventListener('resize', st.onView, true);
    window.removeEventListener('scroll', st.onView, true);
    window.removeEventListener('wheel', st.onWheel, { capture: true });
    focusUnapply(st);
    st.sizes = null;
  }

  /** focus({mode:'queue'}): bring the queue panel to the viewport's top-left (idempotent: a repeat call re-checks and
   *  returns the current report). Any other mode: remove every trace. Returns { found, width, height, primaryWidth,
   *  primaryHeight, reason[, error] } - sizes in CSS pixels; reason says why found is false. Never throws. */
  function focus(spec) {
    try {
      focusDraw = '';
      focusLoad = '';
      if (!spec || spec.mode !== 'queue') {
        focusStop();
        return FOCUS_OFF;
      }
      if (!focusState) focusStart();
      focusPass();
      return focusState ? focusState.report : FOCUS_NONE;
    } catch (e) {
      try {
        focusStop();
      } catch (e2) {
        /* nothing more to take off */
      }
      return focusReport(false, 'error', null, null, e && e.message);
    }
  }
  // --- sf-focus:end ---------------------------------------------------------------------------------------------------

  // --- sf-join:begin (the coach joined the draw) ----------------------------------------------------------------------
  /*
   * Owner 10-09: "Float page should be the default behavior if the user has selected join queue." The host needs to
   * know that the coach pressed the Gamefinder's "Join the Draw". This only WATCHES: one passive, capture-phase click
   * listener (and one for the keyboard) on the document that recognises the button by its TEXT and counts. It never
   * prevents, stops, repeats or fakes anything - the site's own handler runs exactly as it would without us - and it
   * tells the host nothing by itself: the host asks for the count (fumbbl_home_queue_watch evals joinWatch()), so
   * nothing happens on the page while the site handles the click. Inert until the host's first call.
   */
  var JOIN_REPEAT_MS = 400;
  var joinState = null;

  function isJoinControl(el) {
    if (!el || el.nodeType !== 1) return false;
    var raw = typeof el.value === 'string' && /^(input|button)$/i.test(el.tagName) && el.value ? el.value : el.textContent || '';
    return raw.length <= 64 && headingText(raw) === 'join the draw';
  }
  /** The "Join the Draw" control the event started in (the control itself or something inside it), or null. */
  function joinControlOf(node) {
    for (var n = node && node.nodeType === 1 ? node : node && node.parentElement, i = 0; n && i < 4; n = n.parentElement, i += 1) {
      if (isJoinControl(n)) return n;
    }
    return null;
  }
  function joinNote(control) {
    if (!control || control.disabled === true || control.getAttribute('aria-disabled') === 'true') return;
    // On the live Gamefinder the button is drawn inside the Blackbox box (<div id="blackboxwrapper">): when the page has
    // that box, only a control in it counts. A page without it is judged by the text alone.
    var box = document.getElementById('blackboxwrapper');
    if (box && !box.contains(control)) return;
    var now = Date.now();
    if (now - joinState.last < JOIN_REPEAT_MS) return; // Enter on a button is a key press AND a click
    joinState.last = now;
    joinState.count += 1;
  }
  /** joinWatch(): start watching (once) and return { count, load } - how often "Join the Draw" was pressed in this
   *  document, and this document's own random mark. */
  function joinWatch() {
    if (!joinState) {
      joinState = {
        count: 0,
        // Made here, once per document: the host tells a new page load from a count that merely started again.
        load: Math.random().toString(36).slice(2, 12) || 'x',
        last: 0,
        onClick: function (event) {
          joinNote(joinControlOf(event.target));
        },
        onKey: function (event) {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          var control = joinControlOf(event.target);
          // Buttons, links and inputs turn the key into a click themselves; anything else is the control's own doing.
          if (control && !/^(button|a|input|summary)$/i.test(control.tagName)) joinNote(control);
        },
      };
      document.addEventListener('click', joinState.onClick, { capture: true, passive: true });
      document.addEventListener('keydown', joinState.onKey, { capture: true, passive: true });
    }
    // `queue`: this page has the Gamefinder on it (the host asks other pages far less often).
    return { count: joinState.count, load: joinState.load, queue: !!(document.getElementById('blackboxwrapper') || document.getElementById('gamefinder')) };
  }
  // --- sf-join:end ----------------------------------------------------------------------------------------------------

  // --- sf-draw:begin (is the coach in the draw?) ----------------------------------------------------------------------
  /*
   * Owner 10-09: "IF the user has selected Join the draw and the user selects the X then let's pop a modal telling them
   * that they must leave the draw before they can close the pane." Closing the floating window unloads this page while
   * the server still has the coach in the draw - so the window must know, before it closes, whether they are in it.
   *
   * READ-ONLY, like everything the floating window does. drawState() looks inside the Blackbox box and answers from
   * what it POSITIVELY sees (Astra 10-09, round 8: "no Leave button" was taken for "not in the draw", so the moment
   * between two renders of the box could let the window close on a coach who was queued):
   *  - 'in'      a drawn, enabled control whose own text is "Leave the Draw" (the site shows it only while the coach
   *              is activated - whether they joined here, before this window was opened, or on another device);
   *  - 'out'     a drawn, enabled control whose own text is "Join the Draw": the draw is open and they are not in it;
   *  - 'unknown' neither. That includes the box while the Blackbox is PAUSED, which shows no button at all - whether
   *              a coach who had joined is still counted then is not something the page says.
   * A control is a real one - a button, an input button, a link, something with role="button", or something made to
   * be pressed (focusable, with a pointer cursor). The words as plain text are not a control and prove nothing.
   * It presses nothing: leaving the draw is the coach's own click on the site's own button. Nothing is written, sent
   * or changed.
   */
  var LEAVE_WORDS = 'leave the draw';
  var JOIN_WORDS = 'join the draw';

  /** The Blackbox box: the live page's own element, else the Blackbox part of a panel found by its headings. */
  function drawBoxes() {
    var wrapper = document.getElementById('blackboxwrapper');
    if (wrapper && shownRect(wrapper)) return [wrapper];
    var region = findQueueRegion();
    return region ? region.primary : null;
  }

  /** Something the site made to be pressed (read from its markup and computed style only). */
  function isRealControl(el) {
    var tag = String(el.tagName || '').toLowerCase();
    if (tag === 'button') return true;
    if (tag === 'summary') return !!el.parentElement && String(el.parentElement.tagName).toLowerCase() === 'details'; // only where it is operative
    if (tag === 'input') return /^(button|submit)$/i.test(String(el.getAttribute('type') || ''));
    if (tag === 'a') return el.hasAttribute('href');
    if (el.getAttribute('role') === 'button') return true;
    if (!el.hasAttribute('tabindex')) return false;
    var css = cssOf(el);
    return !!css && css.cursor === 'pointer';
  }

  /**
   * The control is really there to be pressed: IT and everything it sits in are shown and enabled. Astra 10-09, round
   * 9: only the control's own style and `disabled` were looked at, so a "Join the Draw" button inside an invisible
   * or disabled ancestor read as "the coach is out of the draw" and the window closed on a coach who was queued.
   *  - not disabled itself, nor aria-disabled, nor inside a disabled <fieldset>, nor inside anything inert or aria-hidden;
   *  - drawn: a rectangle of its own, and no ancestor that is display: none (then it has none), visibility: hidden,
   *    opacity 0 or content-visibility: hidden;
   *  - and some of it left inside every ancestor that clips it.
   */
  function effectiveControl(control) {
    if (control.disabled === true || control.getAttribute('aria-disabled') === 'true') return false;
    var rect = shownRect(control);
    if (!rect) return false;
    for (var n = control; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hasAttribute('inert') || n.getAttribute('aria-hidden') === 'true') return false;
      if (n !== control && String(n.tagName).toLowerCase() === 'fieldset' && n.disabled === true) return false;
      if (n !== control) {
        var css = cssOf(n);
        if (css && (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' ||
          (css.opacity !== '' && css.opacity != null && Number(css.opacity) === 0) || css.contentVisibility === 'hidden')) return false;
      }
    }
    var clips = clipAncestors([control]);
    var left = rect.x;
    var top = rect.y;
    var right = rect.x + rect.width;
    var bottom = rect.y + rect.height;
    for (var c = 0; c < clips.length; c += 1) {
      if (clips[c][4]) return false;
      if (clips[c][2]) {
        left = Math.max(left, clips[c][1].x);
        right = Math.min(right, clips[c][1].x + clips[c][1].width);
      }
      if (clips[c][3]) {
        top = Math.max(top, clips[c][1].y);
        bottom = Math.min(bottom, clips[c][1].y + clips[c][1].height);
      }
    }
    return right - left > 0 && bottom - top > 0;
  }

  /** The drawn, enabled CONTROLS inside `boxes` whose own text is `words` (any case and spacing). */
  function controlsSaying(boxes, words) {
    var out = [];
    var note = function (el, box) {
      // The control the words sit in (themselves, or a few levels up). No control: plain text - not counted.
      var control = null;
      for (var n = el, level = 0; n && n !== box && level < 4; n = n.parentElement, level += 1) {
        if (isRealControl(n)) {
          control = n;
          break;
        }
      }
      if (!control) return;
      var said = /^input$/i.test(control.tagName) && typeof control.value === 'string' ? control.value : control.textContent || '';
      if (said.length > 64 || headingText(said) !== words) return;
      if (out.indexOf(control) >= 0 || !effectiveControl(control)) return;
      out.push(control);
    };
    for (var b = 0; b < boxes.length; b += 1) {
      var box = boxes[b];
      if (typeof document.createTreeWalker === 'function') {
        var walker = document.createTreeWalker(box, 4 /* NodeFilter.SHOW_TEXT */);
        for (var node = walker.nextNode(); node; node = walker.nextNode()) {
          var raw = node.nodeValue || '';
          var part = raw.length <= 64 ? headingText(raw) : '';
          if (part && node.parentElement && words.indexOf(part) >= 0) note(node.parentElement, box);
        }
      }
      var inputs = box.getElementsByTagName('input');
      for (var i = 0; i < inputs.length; i += 1) note(inputs[i], box);
    }
    return out;
  }

  /** drawState(): { draw: 'in' | 'out' | 'unknown', leave, join } - see above. Reads only. Never throws. */
  function drawState() {
    try {
      var boxes = drawBoxes();
      if (!boxes) return { draw: 'unknown', leave: [], join: [] };
      var leave = controlsSaying(boxes, LEAVE_WORDS);
      var join = controlsSaying(boxes, JOIN_WORDS);
      // Both at once is not a state the page should show: then they are taken to be in it.
      return { draw: leave.length ? 'in' : join.length ? 'out' : 'unknown', leave: leave, join: join };
    } catch (e) {
      return { draw: 'unknown', leave: [], join: [] };
    }
  }
  // --- sf-draw:end ----------------------------------------------------------------------------------------------------

  // --- sf-diag:begin (queue diagnostics, development builds) ----------------------------------------------------------
  /*
   * Owner 10-09: the queue view did not take on the live Gamefinder and its markup cannot be read from outside. This
   * returns a STRUCTURAL description of the page around the queue panel so the finder can be fixed from facts: for the
   * elements whose text is one of OUR three constants ("Blackbox", "Match Offers", "Join the Draw") and their ancestors
   * up to <body>: tag, id, classes, role and a few aria states, computed position / overflow / display, rectangle,
   * whether it is a link or in a shadow root. NO text of the page, no names, nothing from the browser's stores, no URL
   * beyond a shortened path. Read-only; nothing is written to the page; returned to the host, which asked.
   */
  var DIAG_NAME = /^[A-Za-z0-9_-]{1,64}$/;

  function diagRect(el) {
    var b = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    return b ? [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] : null;
  }
  function diagElement(el) {
    var out = { tag: String(el.tagName || '').toLowerCase() };
    var id = el.getAttribute && el.getAttribute('id');
    if (id && DIAG_NAME.test(id)) out.id = id;
    var classes = [];
    var list = el.classList || [];
    for (var i = 0; i < list.length && classes.length < 12; i += 1) if (DIAG_NAME.test(list[i])) classes.push(list[i]);
    if (classes.length) out.cls = classes;
    var role = el.getAttribute && el.getAttribute('role');
    if (role && DIAG_NAME.test(role)) out.role = role;
    var states = ['aria-modal', 'aria-hidden', 'aria-expanded', 'aria-live', 'aria-disabled', 'open', 'hidden', 'disabled'];
    for (var s = 0; s < states.length; s += 1) {
      if (el.hasAttribute && el.hasAttribute(states[s])) {
        var value = el.getAttribute(states[s]) || 'true';
        out[states[s]] = DIAG_NAME.test(value) ? value : 'other';
      }
    }
    var css = cssOf(el);
    if (css) {
      out.pos = css.position;
      out.display = css.display;
      if (css.visibility && css.visibility !== 'visible') out.visibility = css.visibility;
      if (css.overflowX !== 'visible' || css.overflowY !== 'visible') out.overflow = css.overflowX + ' ' + css.overflowY;
      if (css.transform && css.transform !== 'none') out.transformed = true;
      if (css.zIndex && css.zIndex !== 'auto') out.z = css.zIndex;
    }
    out.rect = diagRect(el);
    if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) {
      out.scroll = [Math.round(el.scrollLeft || 0), Math.round(el.scrollTop || 0), el.scrollWidth, el.scrollHeight];
    }
    if (el.hasAttribute && el.hasAttribute(FOCUS_KEEP_ATTR)) out.kept = true;
    return out;
  }
  function diagChain(el) {
    var chain = [];
    var shadow = false;
    for (var n = el; n && n.nodeType === 1 && chain.length < 30; n = n.parentElement) {
      chain.push(diagElement(n));
      if (n === document.body) break;
      if (!n.parentElement && n.parentNode && n.parentNode.host) shadow = true;
    }
    return { chain: chain, shadow: shadow };
  }
  /** The shape of a subtree: tags, ids, classes, sizes - and which of OUR three constants an element's own text is. */
  function diagTree(el, depth, budget) {
    var node = diagElement(el);
    var own = '';
    for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) own += c.nodeValue || '';
    var words = headingText(own.length <= 64 ? own : '');
    if (words === 'join the draw' || isBlackboxHeading(words) || isOffersHeading(words)) node.says = words === 'join the draw' ? words : isBlackboxHeading(words) ? 'blackbox' : 'match offers';
    if (depth > 0) {
      var kids = [];
      for (var i = 0; i < el.children.length && budget.left > 0; i += 1) {
        budget.left -= 1;
        kids.push(diagTree(el.children[i], depth - 1, budget));
      }
      if (kids.length) node.kids = kids;
      if (el.children.length > kids.length) node.more = el.children.length - kids.length;
    } else if (el.children.length) {
      node.more = el.children.length;
    }
    return node;
  }

  function diagPath() {
    var path = String((window.location && window.location.pathname) || '');
    if (path === '/' || path === '') return '/';
    var m = /^\/([a-z])\/([A-Za-z0-9_]{1,32})(?:\/|$)/.exec(path);
    return m ? '/' + m[1] + '/' + m[2] : '(other)';
  }

  /** diagnose(): the description above, as plain data. Never throws. */
  function diagnose() {
    var out = { v: 1, path: diagPath() };
    try {
      var root = document.documentElement;
      out.viewport = [root.clientWidth || 0, root.clientHeight || 0, Math.round(window.scrollX || 0), Math.round(window.scrollY || 0)];
      out.dpr = window.devicePixelRatio || 1;
      out.focus = focusState
        ? { on: focusState.on, report: focusState.report, shift: [focusState.tx, focusState.ty], blocker: focusState.blocker ? diagElement(focusState.blocker) : null }
        : null;
      out.joins = joinState ? joinState.count : null;
      // The coach's place in the draw, and the control that says so (its tag, classes and place - never its text).
      var drawNow = drawState();
      out.draw = { state: drawNow.draw, leave: drawNow.leave.map(diagElement), join: drawNow.join.map(diagElement) };
      var wanted = [
        ['blackbox', isBlackboxHeading],
        ['match offers', isOffersHeading],
        ['join the draw', function (t) { return t === 'join the draw'; }],
      ];
      out.headings = [];
      for (var w = 0; w < wanted.length; w += 1) {
        var found = headingElements(wanted[w][1], true);
        for (var i = 0; i < found.length && i < 6; i += 1) {
          var el = found[i];
          var described = diagChain(el);
          out.headings.push({
            text: wanted[w][0],
            link: !!(el.closest && el.closest('a[href]')),
            shown: !!shownRect(el),
            shadow: described.shadow,
            chain: described.chain,
          });
        }
      }
      var region = null;
      try {
        region = findQueueRegion();
      } catch (e) {
        out.finderError = String((e && e.message) || e).slice(0, 160);
      }
      out.region = region
        ? { parts: region.parts.map(diagElement), primary: region.primary.map(diagElement), box: unionRect(region.parts), elsewhere: null }
        : { parts: [], primary: [], box: null, elsewhere: focusElsewhere() };
      var frames = document.getElementsByTagName('iframe');
      out.frames = [];
      for (var f = 0; f < frames.length && f < 10; f += 1) {
        var reachable = false;
        try {
          reachable = !!frames[f].contentDocument;
        } catch (e2) {
          reachable = false;
        }
        out.frames.push({ rect: diagRect(frames[f]), sameOrigin: reachable });
      }
      // What stands directly under <body> and under the Gamefinder's root, and the Blackbox box's own shape (where the
      // join control is drawn when the draw is open).
      out.body = [];
      for (var bc = 0; bc < document.body.children.length && bc < 30; bc += 1) out.body.push(diagElement(document.body.children[bc]));
      var gamefinder = document.getElementById('gamefinder');
      out.gamefinder = gamefinder ? diagTree(gamefinder, 2, { left: 60 }) : null;
      var blackbox = document.getElementById('blackboxwrapper');
      out.blackbox = blackbox ? diagTree(blackbox, 5, { left: 80 }) : null;
      if (focusState && focusState.blocker && focusState.blocker !== document.body) out.blockerTree = diagTree(focusState.blocker, 4, { left: 80 });
      // What clips the panel, and the page's own two outer boxes - which rectangle each has, and how it overflows. (The
      // black float of 10-09 was a clip box in the wrong place; nothing else in a description shows that.)
      out.clips = [];
      if (region) {
        var clipBoxes = clipAncestors(region.parts);
        for (var cb = 0; cb < clipBoxes.length && cb < 12; cb += 1) {
          var clipInfo = diagElement(clipBoxes[cb][0]);
          clipInfo.clip = [Math.round(clipBoxes[cb][1].x), Math.round(clipBoxes[cb][1].y), Math.round(clipBoxes[cb][1].width), Math.round(clipBoxes[cb][1].height)];
          clipInfo.axes = [clipBoxes[cb][2], clipBoxes[cb][3]];
          if (clipBoxes[cb][4]) clipInfo.undrawn = true;
          out.clips.push(clipInfo);
        }
        var regionBox = unionRect(region.parts);
        // The same answer the pass gave (with everything it measured inside the panel) - never a second opinion from
        // a narrower question. Without a crop in progress: the panel's own box.
        var cut = focusState ? focusState.clipper : regionBox ? (clippedBy(region.parts, regionBox, [], null) || {}).clipper || null : null;
        out.clippedBy = cut ? diagElement(cut) : null;
        out.refusedFor = focusState && focusState.refused ? diagElement(focusState.refused.cause) : null;
      }
      var outer = [root, document.body];
      out.outer = [];
      for (var ob = 0; ob < outer.length; ob += 1) {
        var outerCss = cssOf(outer[ob]);
        out.outer.push({
          tag: String(outer[ob].tagName).toLowerCase(), rect: diagRect(outer[ob]),
          overflow: outerCss ? outerCss.overflowX + ' ' + outerCss.overflowY : '', transformed: !!(outerCss && outerCss.transform && outerCss.transform !== 'none'),
          client: [outer[ob].clientWidth, outer[ob].clientHeight], scroll: [outer[ob].scrollWidth, outer[ob].scrollHeight],
        });
      }
      out.dialogs = [];
      var dialogs = document.querySelectorAll(FOCUS_DIALOG_SELECTOR);
      for (var d = 0; d < dialogs.length && d < 10; d += 1) if (!isOurs(dialogs[d])) out.dialogs.push(diagElement(dialogs[d]));
      out.fixed = [];
      var placed = positionedElements();
      for (var x = 0, shownCount = 0; x < placed.length && shownCount < 30; x += 1) {
        if (placed[x][1] !== 'fixed' && !bigEnough(shownRect(placed[x][0]), FOCUS_LATE_MIN_W, FOCUS_LATE_MIN_H)) continue;
        var described = diagElement(placed[x][0]);
        described.chrome = isSiteChrome(placed[x][0]);
        out.fixed.push(described);
        shownCount += 1;
      }
    } catch (e3) {
      out.error = String((e3 && e3.message) || e3).slice(0, 160);
    }
    return out;
  }
  // --- sf-diag:end ----------------------------------------------------------------------------------------------------

  Object.defineProperty(window, '__sfTour', {
    value: Object.freeze({
      show: show,
      clear: clear,
      report: report,
      arm: arm,
      filter: filter,
      focus: focus,
      joinWatch: joinWatch,
      diagnose: diagnose,
      _geometry: Object.freeze({ arrowBetween: arrowBetween, placeCard: placeCard }),
    }),
    configurable: false,
    enumerable: false,
    writable: false,
  });
})();
