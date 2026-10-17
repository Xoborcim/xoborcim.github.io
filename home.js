/* Xoborcim home: two tiny playable teasers. No dependencies; the markup is in index.html,
   so nothing shifts when this runs. Without JavaScript the teasers stay hidden (see .no-js). */
(function () {
  "use strict";

  /* Roving-tabindex arrow-key navigation over a role=grid of buttons. */
  function gridNav(grid, cols) {
    var cells = Array.prototype.slice.call(grid.querySelectorAll('[role="gridcell"]'));
    cells.forEach(function (c, i) { c.tabIndex = i === 0 ? 0 : -1; });
    grid.addEventListener("keydown", function (e) {
      var i = cells.indexOf(document.activeElement);
      if (i < 0) return;
      var n = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + cols, ArrowUp: i - cols, Home: i - (i % cols), End: i - (i % cols) + cols - 1 }[e.key];
      if (n === undefined) return;
      e.preventDefault();
      if (n < 0 || n >= cells.length) return;
      cells[i].tabIndex = -1;
      cells[n].tabIndex = 0;
      cells[n].focus();
    });
    grid.addEventListener("focusin", function (e) {
      if (cells.indexOf(e.target) < 0) return;
      cells.forEach(function (c) { c.tabIndex = c === e.target ? 0 : -1; });
    });
    return cells;
  }

  /* ---------- Hewn: 3×3 map, heights 0–4 ---------- */
  function hewn(root) {
    if (!root) return;
    var grid = root.querySelector(".hewn-grid");
    var status = root.querySelector(".teaser-status");
    var solution = grid.dataset.solution.split(",").map(Number);
    var cells = gridNav(grid, 3);
    var h = cells.map(function () { return null; });
    var MAX = 4, solved = false;

    function neighbours(i) {
      var r = Math.floor(i / 3), c = i % 3, out = [];
      if (r > 0) out.push(i - 3);
      if (r < 2) out.push(i + 3);
      if (c > 0) out.push(i - 1);
      if (c < 2) out.push(i + 1);
      return out;
    }

    function render() {
      var clash = {};
      h.forEach(function (v, i) {
        if (v === null) return;
        neighbours(i).forEach(function (j) { if (h[j] !== null && Math.abs(v - h[j]) !== 1) { clash[i] = clash[j] = true; } });
      });
      cells.forEach(function (c, i) {
        var mark = c.dataset.mark;
        var v = h[i];
        c.textContent = v === null ? "" : String(v);
        c.dataset.h = v === null ? "" : String(v);
        c.classList.toggle("clash", !!clash[i]);
        var r = Math.floor(i / 3) + 1, col = (i % 3) + 1;
        c.setAttribute("aria-label", "Row " + r + ", column " + col + (mark ? ", " + mark : "") + ", " +
          (v === null ? "empty" : "height " + v) + (clash[i] ? ", breaks the neighbour rule" : ""));
      });
      var filled = h.every(function (v) { return v !== null; });
      var correct = filled && h.every(function (v, i) { return v === solution[i]; });
      if (correct && !solved) {
        solved = true;
        root.classList.add("solved");
        status.innerHTML = 'Charted! That\u2019s a whole Hewn map in miniature. <a href="/hewn/">Play today\u2019s full map</a>';
      } else if (!correct) {
        solved = false;
        root.classList.remove("solved");
        status.textContent = Object.keys(clash).length ? "Squares side by side must differ by exactly 1." :
          filled ? "Not quite: check the summits, hollows and sea level." : "";
      }
    }

    function set(i, v) { if (!solved || v !== h[i]) { h[i] = v; render(); } }

    cells.forEach(function (c, i) {
      c.addEventListener("click", function () { set(i, h[i] === null ? 0 : h[i] >= MAX ? null : h[i] + 1); });
      c.addEventListener("keydown", function (e) {
        if (/^[0-4]$/.test(e.key)) { e.preventDefault(); set(i, Number(e.key)); }
        else if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); set(i, null); }
      });
    });
    root.querySelector(".teaser-reset").addEventListener("click", function () {
      h = h.map(function () { return null; });
      solved = false;
      render();
      cells[0].focus();
    });
    render();
  }

  /* ---------- Pocket Quilt: 4×4 board, sew 2×2 squares of one fabric ---------- */
  var FABRIC = { r: "rose", b: "blue", y: "mustard" };
  var ORDER = ["r", "b", "y"];

  function pocketQuilt(root) {
    if (!root) return;
    var grid = root.querySelector(".pq-grid");
    var status = root.querySelector(".teaser-status");
    var pocketEl = root.querySelector(".pq-pocket");
    var dyeBtn = root.querySelector(".pq-dye");
    var spoolsEl = root.querySelector(".pq-spools");
    var quilt = Array.prototype.slice.call(root.querySelectorAll(".pq-quilt li"));
    var start = grid.dataset.board.replace(/\s+/g, "").split("");
    var cells = gridNav(grid, 4);
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    var board, queue, pocket, spools, sewn;

    function reset() {
      board = start.slice();
      queue = ["b", "r", "y", "r"];
      pocket = queue.shift();
      spools = 2;
      sewn = [];
      status.textContent = "";
      render();
    }

    function render() {
      cells.forEach(function (c, i) {
        var f = board[i];
        c.dataset.f = f === "." ? "" : f;
        c.setAttribute("aria-label", "Row " + (Math.floor(i / 4) + 1) + ", column " + (i % 4 + 1) + ", " +
          (f === "." ? "empty" : FABRIC[f]));
      });
      pocketEl.dataset.f = pocket || "";
      pocketEl.textContent = pocket ? FABRIC[pocket] : "empty";
      spoolsEl.textContent = "(" + spools + " spool" + (spools === 1 ? "" : "s") + ")";
      dyeBtn.disabled = !pocket || spools === 0;
      quilt.forEach(function (li, i) {
        li.dataset.f = sewn[i] || "";
        li.setAttribute("aria-label", sewn[i] ? FABRIC[sewn[i]] + " square" : "empty square");
      });
    }

    /* Indices of every complete one-fabric 2×2 block. */
    function blocks() {
      var out = [];
      for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) {
        var i = r * 4 + c, q = [i, i + 1, i + 4, i + 5], f = board[i];
        if (f !== "." && q.every(function (k) { return board[k] === f; })) out.push(q);
      }
      return out;
    }

    function place(i) {
      if (!pocket) return;
      if (board[i] !== ".") { status.textContent = "That square already has fabric. Pick an empty one."; return; }
      board[i] = pocket;
      pocket = queue.shift() || null;
      var found = blocks();
      var msg = "";
      found.forEach(function (q) {
        var f = board[q[0]];
        q.forEach(function (k) {
          board[k] = ".";
          if (!reduce.matches) {
            cells[k].classList.remove("sew");
            void cells[k].offsetWidth; // restart the animation
            cells[k].classList.add("sew");
          }
        });
        if (sewn.length < quilt.length) sewn.push(f);
        msg = "Sewn! A " + FABRIC[f] + " square joins your quilt.";
      });
      if (sewn.length === quilt.length) {
        status.innerHTML = 'Quilt finished! Pocket Quilt is coming to iPhone soon. <a href="/games/pocket-quilt/">See how it plays</a>';
      } else if (!pocket) {
        status.textContent = (msg ? msg + " " : "") + "Out of pieces. Start over to try again.";
      } else {
        status.textContent = msg || "Placed. Next piece: " + FABRIC[pocket] + ".";
      }
      render();
    }

    cells.forEach(function (c, i) {
      c.addEventListener("click", function () { place(i); });
      c.addEventListener("animationend", function () { c.classList.remove("sew"); });
    });
    dyeBtn.addEventListener("click", function () {
      if (!pocket || spools === 0) return;
      pocket = ORDER[(ORDER.indexOf(pocket) + 1) % ORDER.length];
      spools--;
      status.textContent = "Dyed your piece " + FABRIC[pocket] + ".";
      render();
    });
    root.querySelector(".teaser-reset").addEventListener("click", function () { reset(); cells[0].focus(); });
    reset();
  }

  hewn(document.getElementById("hewn-teaser"));
  pocketQuilt(document.getElementById("pq-teaser"));
})();
