/* Xoborcim home: a small patchwork island in the background. Procedural (new seed per load),
   painted ONCE onto its own canvas; never redrawn per frame. Draw-in is a CSS clip/opacity
   transition on the canvas (compositor only); static under reduced motion. No JS = no island. */
(function () {
  "use strict";
  var c = document.createElement("canvas");
  c.className = "island"; c.setAttribute("aria-hidden", "true");
  document.body.insertBefore(c, document.body.firstChild);
  var seed = (Math.random() * 4294967296) >>> 0;
  function rng(s) { return function () { s |= 0; s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var dark = matchMedia("(prefers-color-scheme: dark)");
  var PAL = {
    light: { patch: ["#D9C59A", "#BFC2A2", "#CFAEA6", "#C9B48F", "#AEB3AC", "#E2D5B8"], ink: "#3A332C", seam: "rgba(58,51,44,.55)", wave: "rgba(90,83,75,.35)" },
    dark:  { patch: ["#4A4032", "#3C4136", "#4A3537", "#453A2C", "#373B3D", "#524836"], ink: "#CFC4B2", seam: "rgba(207,196,178,.45)", wave: "rgba(171,161,148,.30)" }
  };
  function paint() {
    var css = c.clientWidth || 300, dpr = Math.min(devicePixelRatio || 1, 1.5), S = Math.round(css * dpr);
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
    g.lineWidth = 1.1; g.strokeStyle = P.wave; g.setLineDash([2, 5]);
    [1.16, 1.32, 1.5].forEach(function (s) { coast(s); g.stroke(); });
    g.setLineDash([]);
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
  paint();
  var rt = 0, lastW = c.clientWidth;
  addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { if (c.clientWidth !== lastW) { lastW = c.clientWidth; paint(); } }, 200); });
  (dark.addEventListener ? dark.addEventListener.bind(dark, "change") : dark.addListener.bind(dark))(paint);
  requestAnimationFrame(function () { requestAnimationFrame(function () { c.classList.add("in"); }); });
})();
