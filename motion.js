/* Xoborcim home: motion layer (stitches that sew themselves, tilting plates, drifting threads,
   scroll reveals). Pure enhancement: without JS, or with prefers-reduced-motion, nothing here runs
   and every bit of content is already visible. Only transforms/opacity animate, so there is no layout shift. */
(function () {
  "use strict";
  var mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (mq.matches || !("IntersectionObserver" in window)) return;
  var root = document.documentElement;
  root.classList.add("motion");
  var NS = "http://www.w3.org/2000/svg";

  /* 1. Stitching: a dashed seam around each plate, revealed by a solid mask stroke. */
  var uid = 0;
  function seam(host, inset) {
    var id = "seam" + (uid++);
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "seam"); svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = '<defs><mask id="' + id + '" maskUnits="userSpaceOnUse"><rect class="seam-draw" pathLength="1" fill="none" stroke="#fff" stroke-width="6" x="' + inset + '" y="' + inset + '" rx="6"/></mask></defs>' +
      '<rect class="seam-line" mask="url(#' + id + ')" fill="none" x="' + inset + '" y="' + inset + '" rx="6"/>';
    host.appendChild(svg);
    function size() {
      var w = host.clientWidth, h = host.clientHeight;
      svg.querySelectorAll("rect").forEach(function (r) { r.setAttribute("width", Math.max(0, w - inset * 2)); r.setAttribute("height", Math.max(0, h - inset * 2)); });
    }
    size();
    if ("ResizeObserver" in window) new ResizeObserver(size).observe(host);
    return svg;
  }
  var plates = Array.prototype.slice.call(document.querySelectorAll(".plate"));
  plates.forEach(function (p) { seam(p, 8); });

  /* 4. Scroll reveal (also triggers the seams inside each revealed block). */
  var targets = document.querySelectorAll(".masthead, .rule, .plate, footer");
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
  Array.prototype.forEach.call(targets, function (t) { t.classList.add("reveal"); io.observe(t); });

  /* 2. Tilt toward the pointer (fine pointers only; touch just gets the lift). */
  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    plates.forEach(function (p) {
      var raf = 0, x = 0, y = 0;
      function apply() { raf = 0; p.style.setProperty("--rx", (-y * 4).toFixed(2) + "deg"); p.style.setProperty("--ry", (x * 5).toFixed(2) + "deg"); p.style.setProperty("--gx", ((x + 0.5) * 100).toFixed(1) + "%"); p.style.setProperty("--gy", ((y + 0.5) * 100).toFixed(1) + "%"); }
      p.addEventListener("pointermove", function (e) {
        var r = p.getBoundingClientRect(); x = (e.clientX - r.left) / r.width - 0.5; y = (e.clientY - r.top) / r.height - 0.5;
        p.classList.add("tilt"); if (!raf) raf = requestAnimationFrame(apply);
      });
      p.addEventListener("pointerleave", function () { p.classList.remove("tilt"); p.style.removeProperty("--rx"); p.style.removeProperty("--ry"); });
    });
  }

  /* 3. Drifting threads on a low-cost canvas: ~24 fps, a handful of strokes, paused when hidden. */
  var c = document.createElement("canvas");
  c.className = "threads"; c.setAttribute("aria-hidden", "true");
  document.body.insertBefore(c, document.body.firstChild);
  var ctx = c.getContext("2d"), W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  function resize() { W = innerWidth; H = innerHeight; c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  resize(); addEventListener("resize", resize);
  var threads = [], ripples = [];
  for (var i = 0; i < 7; i++) threads.push({ y: (i + 0.5) / 7, a: 18 + Math.random() * 30, f: 0.002 + Math.random() * 0.003, s: 0.00015 + Math.random() * 0.0002, p: Math.random() * 6.28, pink: i % 3 === 0 });
  var dark = window.matchMedia("(prefers-color-scheme: dark)");
  var running = false, last = 0, t0 = performance.now();
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (!ripples.length && now - last < 42) return; last = now; // threads ~24fps; ripples get full rate
    var t = now - t0, d = dark.matches;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1.2; ctx.setLineDash([7, 6]);
    threads.forEach(function (th) {
      ctx.strokeStyle = th.pink ? (d ? "rgba(255,127,175,.13)" : "rgba(217,70,127,.13)") : (d ? "rgba(200,101,122,.12)" : "rgba(122,42,58,.10)");
      ctx.lineDashOffset = -t * 0.01;
      ctx.beginPath();
      for (var x = -20; x <= W + 20; x += 24) {
        var y = th.y * H + Math.sin(x * th.f + th.p + t * th.s) * th.a + Math.sin(t * th.s * 0.7 + th.p) * 20;
        x === -20 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
    // ripples: 3 expanding thread rings each, fading out over RIPPLE_MS
    ctx.setLineDash([5, 5]); ctx.lineDashOffset = 0;
    for (var k = ripples.length - 1; k >= 0; k--) {
      var rp = ripples[k], age = (now - rp.t) / RIPPLE_MS;
      if (age >= 1) { ripples.splice(k, 1); continue; }
      for (var ring = 0; ring < 3; ring++) {
        var a = age - ring * 0.14; if (a <= 0) continue;
        var e = 1 - Math.pow(1 - a, 3);
        ctx.globalAlpha = (1 - a) * 0.55; ctx.lineWidth = 1.6 - ring * 0.4;
        ctx.strokeStyle = rp.pink ? (d ? "#FF7FAF" : "#D9467F") : (d ? "#C8657A" : "#7A2A3A");
        ctx.beginPath(); ctx.arc(rp.x, rp.y, 6 + e * (110 - ring * 22), 0, 6.2832); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  /* Ripple on background clicks/taps only; no DOM per click, at most MAX_RIPPLES alive. */
  var RIPPLE_MS = 1100, MAX_RIPPLES = 5, pinkNext = false;
  document.addEventListener("pointerdown", function (e) {
    if (e.button > 0 || document.hidden) return;
    if (e.target.closest && e.target.closest("a, button, input, select, textarea, label, [role], .plate, .teaser, .masthead .mark")) return;
    if (ripples.length >= MAX_RIPPLES) ripples.shift();
    ripples.push({ x: e.clientX, y: e.clientY, t: performance.now(), pink: (pinkNext = !pinkNext) });
    start();
  }, { passive: true });
  function start() { if (!running && !document.hidden) { running = true; requestAnimationFrame(frame); } }
  function stop() { running = false; }
  document.addEventListener("visibilitychange", function () { document.hidden ? stop() : start(); });
  start();

  // if the user switches on reduced motion mid-visit, settle everything
  (mq.addEventListener ? mq.addEventListener.bind(mq, "change") : mq.addListener.bind(mq))(function () {
    if (mq.matches) { stop(); c.remove(); root.classList.remove("motion"); }
  });
})();
