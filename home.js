/* Xoborcim home: a tiny playable Pocket Quilt teaser. No dependencies; the markup is in index.html,
   so nothing shifts when this runs. Without JavaScript the teaser stays hidden (see .no-js). */
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

  pocketQuilt(document.getElementById("pq-teaser"));
})();
