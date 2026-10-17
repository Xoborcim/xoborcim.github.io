/* Xoborcim home: a procedural patchwork archipelago behind the whole page, under a fog of war.
   - Page-anchored layer; split into horizontal tiles that are generated lazily as they near the
     viewport, painted ONCE (islands) and kept; fog lives on a second canvas per tile.
   - Canvas memory is capped: backing scale <= 1 (<= 0.75 on small screens), tiles 640 CSS px tall.
   - Fog is erased only on input (pointer, tap, scroll), batched into one rAF. Nothing runs idle.
   - Reduced motion: islands static and fully revealed. No JS: plain parchment. */
(function () {
  "use strict";
  var still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var dark = matchMedia("(prefers-color-scheme: dark)");
  var seed = (Math.random() * 4294967296) >>> 0;
  function rng(s) { return function () { s |= 0; s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var PAL = {
    light: { patch: ["#D9C59A", "#BFC2A2", "#CFAEA6", "#C9B48F", "#AEB3AC", "#E2D5B8"], ink: "#3A332C", seam: "rgba(58,51,44,.5)", wave: "rgba(90,83,75,.32)",
             fog: "#EDE5D6", hatch: "rgba(111,104,95,.13)" },
    dark:  { patch: ["#4A4032", "#3C4136", "#4A3537", "#453A2C", "#373B3D", "#524836"], ink: "#CFC4B2", seam: "rgba(207,196,178,.4)", wave: "rgba(171,161,148,.26)",
             fog: "#151216", hatch: "rgba(171,161,148,.08)" }
  };
  var TILE = 640, layer, tiles = [], isles = [], W = 0, H = 0, scale = 1, holes = [], queue = [], fr = 0;

  /* ---- layout: islands scattered over the page with min spacing; small inside the text column ---- */
  function layout() {
    var r = rng(seed), col = Math.min(W, 820), cl = (W - col) / 2, cr = cl + col, small = W < 700;
    var m = document.querySelector(".masthead"), mb = m ? m.getBoundingClientRect().bottom + scrollY + 30 : 380;
    isles = []; var tries = 0, target = Math.round(W * H / (small ? 60000 : 70000));
    while (isles.length < target && tries++ < target * 40) {
      var x = r() * W, y = 40 + r() * (H - 80), inCol = x > cl && x < cr;
      var R = inCol ? (small ? 22 + r() * 34 : 20 + r() * 30) : 36 + r() * 84;
      if (y < mb + R && inCol) continue;   // keep the title and lede clear of islands
      var ok = isles.every(function (o) { var dx = o.x - x, dy = o.y - y; return dx * dx + dy * dy > Math.pow((o.R + R) * 1.25 + 24, 2); });
      if (ok) isles.push({ x: x, y: y, R: R, s: (r() * 4294967296) >>> 0, a: inCol ? 0.55 : 1 });
    }
  }
  window.__archiHit = function (cx, cy) { // client coords -> is this over an island? (used by ripple)
    var x = cx + scrollX, y = cy + scrollY;
    return isles.some(function (o) { var dx = o.x - x, dy = (o.y - y) / 0.82; return dx * dx + dy * dy < o.R * o.R * 1.3; });
  };

  /* ---- one island, drawn at (x,y) with radius R in the given context (CSS px) ---- */
  function island(g, o, P) {
    var r = rng(o.s), N = 60, h = [];
    for (var k = 0; k < 4; k++) h.push({ a: (0.06 + r() * 0.12) / (k + 1) * 1.6, f: k + 2, p: r() * 6.283 });
    function rad(t) { var v = 1; for (var i = 0; i < h.length; i++) v += h[i].a * Math.sin(h[i].f * t + h[i].p); return o.R * v; }
    function coast() { g.beginPath(); for (var i = 0; i <= N; i++) { var t = i / N * 6.2832, R = rad(t), X = o.x + Math.cos(t) * R, Y = o.y + Math.sin(t) * R * 0.82; i ? g.lineTo(X, Y) : g.moveTo(X, Y); } g.closePath(); }
    g.globalAlpha = o.a;
    g.lineWidth = 1; g.strokeStyle = P.wave; g.lineCap = "round";
    var waves = 3 + Math.round(o.R / 30);
    for (var w = 0; w < waves; w++) {
      var t0 = r() * 6.2832, span = 0.35 + r() * 0.5, sc = 1.12 + r() * 0.22, ph = r() * 6.28;
      g.beginPath();
      for (var j = 0; j <= 14; j++) { var t = t0 + span * j / 14, R = rad(t) * sc + Math.sin(j * 1.3 + ph) * 2, X = o.x + Math.cos(t) * R, Y = o.y + Math.sin(t) * R * 0.82; j ? g.lineTo(X, Y) : g.moveTo(X, Y); }
      g.stroke();
    }
    g.save(); coast(); g.clip();
    var step = Math.max(14, o.R * 0.38), n = Math.ceil(o.R * 2.6 / step), pts = [];
    g.translate(o.x, o.y); g.rotate((r() - 0.5) * 0.6);
    for (var y = 0; y <= n; y++) { pts.push([]); for (var x = 0; x <= n; x++) pts[y].push([(x - n / 2) * step + (r() - 0.5) * step * 0.3, (y - n / 2) * step + (r() - 0.5) * step * 0.3]); }
    for (y = 0; y < n; y++) for (x = 0; x < n; x++) {
      var a = pts[y][x], b = pts[y][x + 1], d = pts[y + 1][x + 1], e = pts[y + 1][x];
      g.fillStyle = P.patch[(r() * P.patch.length) | 0];
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(d[0], d[1]); g.lineTo(e[0], e[1]); g.closePath(); g.fill();
      if (r() < 0.35) { g.fillStyle = "rgba(0,0,0,.05)"; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(d[0], d[1]); g.lineTo(e[0], e[1]); g.closePath(); g.fill(); }
    }
    g.strokeStyle = P.seam; g.lineWidth = 0.9; g.setLineDash([4, 3]);
    for (y = 0; y < n; y++) for (x = 0; x < n; x++) { a = pts[y][x]; b = pts[y][x + 1]; e = pts[y + 1][x]; g.beginPath(); g.moveTo(e[0], e[1]); g.lineTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
    g.restore(); g.setLineDash([]);
    g.strokeStyle = P.ink; g.lineWidth = Math.min(2, 1 + o.R / 80); g.lineJoin = "round"; coast(); g.stroke();
    g.globalAlpha = o.a * 0.35; g.lineWidth = 0.8; g.save(); g.translate(1, -0.7); coast(); g.stroke(); g.restore();
    g.globalAlpha = 1;
  }

  /* ---- organic fog brush, built once: jittered noise-edged blurred dabs ---- */
  var brush = (function () {
    var B = 128, bc = document.createElement("canvas"); bc.width = bc.height = B;
    var b = bc.getContext("2d"), br = rng(seed ^ 0x51ed); b.filter = "blur(5px)";
    for (var d = 0; d < 16; d++) {
      var ox = 64 + (br() - 0.5) * 48, oy = 64 + (br() - 0.5) * 48, rr = 12 + br() * 18, M = 11;
      b.fillStyle = "rgba(0,0,0," + (0.18 + br() * 0.22).toFixed(2) + ")"; b.beginPath();
      for (var i = 0; i <= M; i++) { var a = i / M * 6.2832, q = rr * (0.65 + br() * 0.6); i ? b.lineTo(ox + Math.cos(a) * q, oy + Math.sin(a) * q) : b.moveTo(ox + Math.cos(a) * q, oy + Math.sin(a) * q); }
      b.closePath(); b.fill();
    }
    return bc;
  })();
  function stamp(t, h) {
    var g = t.fg, ang = (h[0] * 12.9898 + h[1] * 78.233) % 6.2832, s2 = h[2] * 2.3;
    g.globalCompositeOperation = "destination-out";
    g.save(); g.translate(h[0], h[1] - t.y0); g.rotate(ang); g.drawImage(brush, -s2 / 2, -s2 / 2, s2, s2); g.restore();
    g.globalCompositeOperation = "source-over";
  }

  /* ---- tiles ---- */
  function paintTile(t) {
    var P = PAL[dark.matches ? "dark" : "light"], h = t.h;
    t.c.width = Math.round(W * scale); t.c.height = Math.round(h * scale);
    var g = t.c.getContext("2d"); g.setTransform(scale, 0, 0, scale, 0, -t.y0 * scale);
    isles.forEach(function (o) { var ext = o.R * 1.6; if (o.y + ext > t.y0 && o.y - ext < t.y0 + h) island(g, o, P); });
    if (still) return;
    t.f.width = t.c.width; t.f.height = t.c.height;
    var f = t.fg = t.f.getContext("2d"); f.setTransform(scale, 0, 0, scale, 0, 0);
    f.fillStyle = P.fog; f.fillRect(0, 0, W, h);
    f.strokeStyle = P.hatch; f.lineWidth = 1; f.beginPath();
    for (var i = -h; i < W; i += 10) { f.moveTo(i, 0); f.lineTo(i + h, h); } f.stroke();
    holes.forEach(function (hh) { if (hh[1] + hh[2] * 1.2 > t.y0 && hh[1] - hh[2] * 1.2 < t.y0 + h) stamp(t, hh); });
  }
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { var t = e.target.__t; if (e.isIntersecting && !t.done) { t.done = true; paintTile(t); } });
  }, { rootMargin: "400px 0px" });
  function build() {
    W = document.documentElement.clientWidth; H = Math.max(document.documentElement.scrollHeight, innerHeight);
    scale = Math.min(devicePixelRatio || 1, W < 700 ? 0.75 : 1);
    if (layer) { io.disconnect(); layer.remove(); }
    layer = document.createElement("div"); layer.className = "archi"; layer.setAttribute("aria-hidden", "true");
    layer.style.cssText = "position:absolute;left:0;top:0;width:100%;height:" + H + "px;z-index:0;pointer-events:none;overflow:hidden;";
    document.body.insertBefore(layer, document.body.firstChild);
    layout(); tiles = [];
    for (var y0 = 0; y0 < H; y0 += TILE) {
      var h = Math.min(TILE, H - y0), d = document.createElement("div");
      d.style.cssText = "position:absolute;left:0;width:100%;top:" + y0 + "px;height:" + h + "px;";
      var c = document.createElement("canvas"), f = document.createElement("canvas");
      c.style.cssText = f.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;display:block;";
      d.appendChild(c); if (!still) d.appendChild(f);
      var t = { y0: y0, h: h, c: c, f: f, el: d, done: false }; d.__t = t; tiles.push(t);
      layer.appendChild(d); io.observe(d);
    }
    requestAnimationFrame(function () { layer.classList.add("in"); });
  }
  function flush() {
    fr = 0;
    queue.forEach(function (h) {
      holes.push(h);
      tiles.forEach(function (t) { if (t.done && t.fg && h[1] + h[2] * 1.2 > t.y0 && h[1] - h[2] * 1.2 < t.y0 + t.h) stamp(t, h); });
    });
    queue = []; if (holes.length > 3000) holes.splice(0, holes.length - 3000);
  }
  function reveal(x, y, r) { queue.push([x, y, r]); if (!fr) fr = requestAnimationFrame(flush); }

  build();
  if (!still) {
    var lastP = 0;
    document.addEventListener("pointermove", function (e) { var n = performance.now(); if (n - lastP < 24) return; lastP = n; reveal(e.clientX + scrollX, e.clientY + scrollY, 54); }, { passive: true });
    document.addEventListener("pointerdown", function (e) { reveal(e.clientX + scrollX, e.clientY + scrollY, 80); }, { passive: true });
    // scrolling uncovers one island coming into view per ~140px of fresh scroll
    var maxY = 0, sr = rng(seed ^ 0x9e37);
    addEventListener("scroll", function () {
      var y = scrollY; if (y < maxY + 140) return; maxY = y;
      var vis = isles.filter(function (o) { return o.y > y + innerHeight * 0.3 && o.y < y + innerHeight; });
      if (!vis.length) return;
      var o = vis[(sr() * vis.length) | 0];
      reveal(o.x + (sr() - 0.5) * o.R, o.y + (sr() - 0.5) * o.R * 0.6, Math.max(40, o.R * 0.9));
    }, { passive: true });
  }
  var rt = 0, lastW = document.documentElement.clientWidth;
  addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { var w = document.documentElement.clientWidth; if (w !== lastW) { lastW = w; build(); } }, 250); });
  (dark.addEventListener ? dark.addEventListener.bind(dark, "change") : dark.addListener.bind(dark))(function () { tiles.forEach(function (t) { if (t.done) paintTile(t); }); });
})();
