/* Xoborcim home: a small patchwork island in the background. Procedural (new seed per load),
   painted ONCE onto its own canvas; never redrawn per frame. Draw-in is a CSS clip/opacity
   transition on the canvas (compositor only); static under reduced motion. No JS = no island. */
(function () {
  "use strict";
  var box = document.createElement("div"); box.className = "isle"; box.setAttribute("aria-hidden", "true");
  var c = document.createElement("canvas"); c.className = "island";
  var fog = document.createElement("canvas"); fog.className = "fog";
  // Critical layout inline, so the two canvases can never drift apart even if a stale/cached
  // stylesheet is paired with this script: both fill the same wrapper box exactly.
  box.style.cssText = "position:absolute;z-index:0;pointer-events:none;aspect-ratio:1/1;";
  c.style.cssText = fog.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;display:block;";
  box.appendChild(c); box.appendChild(fog);
  document.body.insertBefore(box, document.body.firstChild);
  var still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var seed = (Math.random() * 4294967296) >>> 0;
  function rng(s) { return function () { s |= 0; s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var dark = matchMedia("(prefers-color-scheme: dark)");
  var PAL = {
    light: { patch: ["#D9C59A", "#BFC2A2", "#CFAEA6", "#C9B48F", "#AEB3AC", "#E2D5B8"], ink: "#3A332C", seam: "rgba(58,51,44,.55)", wave: "rgba(90,83,75,.35)" },
    dark:  { patch: ["#4A4032", "#3C4136", "#4A3537", "#453A2C", "#373B3D", "#524836"], ink: "#CFC4B2", seam: "rgba(207,196,178,.45)", wave: "rgba(171,161,148,.30)" }
  };
  function paint() {
    var css = box.clientWidth || 260, dpr = Math.min(devicePixelRatio || 1, 1.5), S = Math.round(css * dpr);
    if (!S) return;
    c.width = c.height = S;
    var g = c.getContext("2d"), r = rng(seed), P = PAL[dark.matches ? "dark" : "light"];
    g.setTransform(S / 400, 0, 0, S / 400, 0, 0); // draw in a fixed 400x400 space
    // coastline: radial blob from a few seeded harmonics
    var N = 72, cx = 200, cy = 205, base = 120, h = [];
    for (var k = 0; k < 4; k++) h.push({ a: (0.06 + r() * 0.12) / (k + 1) * 1.6, f: k + 2, p: r() * 6.283 });
    function rad(t) { var v = 1; h.forEach(function (q) { v += q.a * Math.sin(q.f * t + q.p); }); return base * v; }
    function coast(scale) { g.beginPath(); for (var i = 0; i <= N; i++) { var t = i / N * 6.2832, R = rad(t) * scale; i ? g.lineTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R * 0.82) : g.moveTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R * 0.82); } g.closePath(); }
    // faint wave lines offshore
    // a few short, broken, wavy strokes hugging the coast (no closed rings)
    g.lineWidth = 1.1; g.strokeStyle = P.wave; g.lineCap = "round";
    for (var w = 0; w < 7; w++) {
      var t0 = r() * 6.2832, span = 0.35 + r() * 0.5, sc = 1.1 + r() * 0.22, ph = r() * 6.28;
      g.beginPath();
      for (var j = 0; j <= 16; j++) { var t = t0 + span * j / 16, R = rad(t) * sc + Math.sin(j * 1.3 + ph) * 2.2; j ? g.lineTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R * 0.82) : g.moveTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R * 0.82); }
      g.stroke();
    }
    // patchwork land: a slightly rotated, jittered quilt grid clipped to the coast
    g.save(); coast(1); g.clip();
    var rot = (r() - 0.5) * 0.5, step = 46, n = 7, pts = [];
    g.translate(cx, cy); g.rotate(rot);
    for (var y = 0; y <= n; y++) { pts.push([]); for (var x = 0; x <= n; x++) pts[y].push([(x - n / 2) * step + (r() - 0.5) * 14, (y - n / 2) * step + (r() - 0.5) * 14]); }
    for (y = 0; y < n; y++) for (x = 0; x < n; x++) {
      var a = pts[y][x], b = pts[y][x + 1], d = pts[y + 1][x + 1], e = pts[y + 1][x];
      g.fillStyle = P.patch[(r() * P.patch.length) | 0];
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(d[0], d[1]); g.lineTo(e[0], e[1]); g.closePath(); g.fill();
      if (r() < 0.35) { g.fillStyle = "rgba(0,0,0,.05)"; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(d[0], d[1]); g.lineTo(e[0], e[1]); g.closePath(); g.fill(); } // half-square triangle
    }
    g.strokeStyle = P.seam; g.lineWidth = 1; g.setLineDash([4, 3]);
    for (y = 0; y < n; y++) for (x = 0; x < n; x++) { a = pts[y][x]; b = pts[y][x + 1]; e = pts[y + 1][x]; g.beginPath(); g.moveTo(e[0], e[1]); g.lineTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
    g.restore(); g.setLineDash([]);
    // inked coastline, doubled slightly for a hand-drawn feel
    g.strokeStyle = P.ink; g.lineWidth = 2; g.lineJoin = "round"; coast(1); g.stroke();
    g.globalAlpha = 0.35; g.lineWidth = 0.8; g.translate(1.2, -0.8); coast(1.01); g.stroke(); g.globalAlpha = 1;
  }
  /* Fog of war: one canvas, parchment fill + faint hatching, erased with a destination-out brush.
     Reveals are stored in 400-space so they replay on resize/scheme change. Drawing happens only
     on input, batched into one rAF; nothing runs while idle. */
  var FOG = { light: { fill: "#EDE5D6", hatch: "rgba(111,104,95,.16)", edge: "rgba(58,51,44,.35)", word: "rgba(90,83,75,.55)" },
              dark:  { fill: "#151216", hatch: "rgba(171,161,148,.10)", edge: "rgba(207,196,178,.28)", word: "rgba(171,161,148,.45)" } };
  var holes = [], queue = [], fr = 0, fg = null, k = 1;
  /* Organic brush, built once: many jittered, noise-edged, blurred dabs at low alpha, so reveals
     overlap into a soft painted wash with no round outline. Each reveal stamps it rotated. */
  var brush = (function () {
    var B = 128, bc = document.createElement("canvas"); bc.width = bc.height = B;
    var b = bc.getContext("2d"), br = rng(seed ^ 0x51ed);
    b.filter = "blur(5px)";
    for (var d = 0; d < 16; d++) {
      var ox = 64 + (br() - 0.5) * 48, oy = 64 + (br() - 0.5) * 48, rr = 12 + br() * 18, M = 11;
      b.fillStyle = "rgba(0,0,0," + (0.18 + br() * 0.22).toFixed(2) + ")";
      b.beginPath();
      for (var i = 0; i <= M; i++) { var a = i / M * 6.2832, q = rr * (0.65 + br() * 0.6); i ? b.lineTo(ox + Math.cos(a) * q, oy + Math.sin(a) * q) : b.moveTo(ox + Math.cos(a) * q, oy + Math.sin(a) * q); }
      b.closePath(); b.fill();
    }
    return bc;
  })();
  function hole(h) {
    var ang = (h[0] * 12.9898 + h[1] * 78.233) % 6.2832, s2 = h[2] * 2.3;
    fg.globalCompositeOperation = "destination-out";
    fg.save(); fg.translate(h[0], h[1]); fg.rotate(ang); fg.drawImage(brush, -s2 / 2, -s2 / 2, s2, s2); fg.restore();
    fg.globalCompositeOperation = "source-over";
  }
  function paintFog() {
    if (still) { fog.remove(); return; }
    var S = c.width; if (!S) return; fog.width = fog.height = S;
    fg = fog.getContext("2d"); fg.setTransform(S / 400, 0, 0, S / 400, 0, 0);
    var F = FOG[dark.matches ? "dark" : "light"];
    fg.fillStyle = F.fill; fg.fillRect(0, 0, 400, 400);
    fg.strokeStyle = F.hatch; fg.lineWidth = 1;
    for (var i = -400; i < 400; i += 9) { fg.beginPath(); fg.moveTo(i, 0); fg.lineTo(i + 400, 400); fg.stroke(); }
    fg.fillStyle = F.word; fg.font = "italic 20px 'IM Fell', Georgia, serif"; fg.textAlign = "center";
    fg.fillText("terra incognita", 200, 210);
    holes.forEach(function (h) { hole(h, false); });
  }
  function flush() { fr = 0; queue.forEach(function (h) { hole(h); holes.push(h); }); queue = []; if (holes.length > 600) holes.splice(0, holes.length - 600); }
  function reveal(x, y, r) { queue.push([x, y, r]); if (!fr) fr = requestAnimationFrame(flush); }
  if (!still) {
    var lastP = 0;
    function atPoint(e, r) {
      var b = fog.getBoundingClientRect(); if (!b.width) return;
      var x = (e.clientX - b.left) / b.width * 400, y = (e.clientY - b.top) / b.height * 400;
      if (x < -60 || y < -60 || x > 460 || y > 460) return;
      reveal(x, y, r);
    }
    document.addEventListener("pointermove", function (e) { var n = performance.now(); if (n - lastP < 24) return; lastP = n; atPoint(e, 46); }, { passive: true });
    document.addEventListener("pointerdown", function (e) { atPoint(e, 70); }, { passive: true });
    var maxY = 0, sr = rng(seed ^ 0x9e37);
    addEventListener("scroll", function () {
      var y = scrollY; if (y < maxY + 120) return; maxY = y;   // a new patch per ~120px of fresh scroll
      reveal(60 + sr() * 280, 60 + sr() * 280, 40);
    }, { passive: true });
  }
  function all() { paint(); paintFog(); }
  all();
  var rt = 0, lastW = box.clientWidth;
  addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { if (c.clientWidth !== lastW) { lastW = box.clientWidth; all(); } }, 200); });
  (dark.addEventListener ? dark.addEventListener.bind(dark, "change") : dark.addListener.bind(dark))(all);
  requestAnimationFrame(function () { requestAnimationFrame(function () { box.classList.add("in"); }); });
})();
