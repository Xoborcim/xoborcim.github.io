/* Emberprint Lab test interface. Deliberately plain: this is for exercising the mechanics. */
(function () {
  'use strict';
  const E = window.Ember;
  const INF = E.INF;
  const $ = id => document.getElementById(id);
  const CUSTOM_KEY = 'emberprint.custom';

  const app = {
    view: 'play',
    list: [],
    idx: 0,
    pz: null, P: null, solution: null,
    marks: null, hist: [], fut: [],
    replayT: null, timer: null,
    highlight: new Set(), hintClue: -1,
    devCache: new Map(),
    ed: { pz: null, hist: [], fut: [] },
  };

  // ---------------------------------------------------------------- helpers

  function stripPuzzle(pz) {
    return { id: pz.id, mode: pz.mode, w: pz.w, h: pz.h, k: pz.k, rows: pz.rows.slice(), clues: pz.clues.map(c => Object.assign({}, c)), solution: (pz.solution || []).map(p => p.slice()) };
  }

  function loadCustom() {
    try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveCustom(list) {
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }

  function solutionIdx(pz, P) {
    const given = (pz.solution || []).map(([x, y]) => y * pz.w + x);
    if (E.checkBreaks(P, given).solved) return given;
    const s = E.solve(P, { limit: 1 }).solutions;
    return s.length ? s[0] : [];
  }

  function label(pz, c) { return (pz.mode === 'A' && c.op === '=' ? '=' : '') + E.clueLabel(c); }

  function breaksOf(marks) { const b = []; marks.forEach((v, i) => { if (v === 1) b.push(i); }); return b; }

  /** Draw a grid. cellFn(i) -> { cls: [], text, sub } */
  function drawGrid(host, P, cellFn, handlers) {
    host.innerHTML = '';
    const g = document.createElement('div');
    g.className = 'grid';
    g.style.gridTemplateColumns = `repeat(${P.w}, 44px)`;
    for (let i = 0; i < P.n; i++) {
      const info = cellFn(i);
      const d = document.createElement('div');
      d.className = 'cell ' + info.cls.join(' ');
      d.textContent = info.text || '';
      if (info.sub != null) { const s = document.createElement('span'); s.className = 'sub'; s.textContent = info.sub; d.appendChild(s); }
      d.title = `(${i % P.w},${(i / P.w) | 0})` + (info.title ? ' ' + info.title : '');
      if (handlers.click) d.addEventListener('mousedown', e => { e.preventDefault(); handlers.click(i, e); });
      if (handlers.enter) d.addEventListener('mouseenter', e => handlers.enter(i, e));
      d.addEventListener('contextmenu', e => e.preventDefault());
      g.appendChild(d);
    }
    host.appendChild(g);
  }

  function miniGrid(P, breaks) {
    const set = new Set(breaks);
    const g = document.createElement('div');
    g.className = 'mini';
    g.style.gridTemplateColumns = `repeat(${P.w}, 9px)`;
    for (let i = 0; i < P.n; i++) {
      const d = document.createElement('div');
      if (P.grid[i] === '#') d.className = 'wall';
      else if (P.grid[i] === 'S') d.className = 'src';
      else if (set.has(i)) d.className = 'brk';
      else if (P.clueAt[i] >= 0) d.className = 'clue';
      g.appendChild(d);
    }
    return g;
  }

  // ---------------------------------------------------------------- play

  function buildList() {
    const builtins = (window.EMBER_PUZZLES || []).map(p => Object.assign(stripPuzzle(p), { builtin: true, meta: p.analysis }));
    app.list = builtins.concat(loadCustom().map(p => Object.assign(p, { custom: true })));
    const sel = $('puzzleSel');
    sel.innerHTML = '';
    app.list.forEach((p, i) => {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = `${p.id || 'custom ' + i} · mode ${p.mode} · ${p.w}×${p.h} · ${p.mode === 'A' ? '≤' : ''}${p.k} breaks` + (p.custom ? ' (custom)' : '');
      sel.appendChild(o);
    });
  }

  function loadPuzzle(pz) {
    stopReplay();
    app.pz = stripPuzzle(pz);
    app.meta = pz.meta || null;
    app.P = E.parse(app.pz);
    app.solution = solutionIdx(app.pz, app.P);
    app.marks = new Int8Array(app.P.n);
    app.hist = []; app.fut = [];
    app.highlight = new Set(); app.hintClue = -1;
    app.solvedB = false;
    $('liveWrap').classList.toggle('hidden', app.pz.mode !== 'A');
    $('checkBtn').classList.toggle('hidden', app.pz.mode !== 'B');
    setMsg(app.pz.mode === 'A'
      ? `Mode A: place at most ${app.pz.k} firebreak(s) so every target holds. ${app.P.clues.length} target(s).`
      : `Mode B: exactly ${app.pz.k} firebreak(s) are hidden. Numbers are observed ignition times (∞ = never burned). Deduce where the firebreaks are, then Check.`);
    renderPlay();
    renderDev();
  }

  function setMsg(t) { $('msg').textContent = t; }

  function playTimes() {
    const A = app.pz.mode === 'A';
    const show = A ? $('liveToggle').checked || app.replayT != null : app.solvedB || app.replayT != null || (devOn() && $('peekSim').checked);
    return show ? E.timesFor(app.P, breaksOf(app.marks)) : null;
  }

  function renderPlay() {
    const { P, pz, marks } = app;
    const times = playTimes();
    const solSet = new Set(devOn() && $('showSol').checked ? app.solution : []);
    drawGrid($('playGrid'), P, i => {
      const cls = [];
      let text = '', sub = null;
      const g = P.grid[i], ci = P.clueAt[i];
      if (g === '#') return { cls: ['wall'] };
      if (g === 'S') { cls.push('src'); text = 'S'; }
      if (ci >= 0) {
        const c = P.clues[ci];
        cls.push('clue'); text = label(pz, c);
        if (times) cls.push(c.lo <= times[i] && times[i] <= c.hi ? 'ok' : 'bad');
        if (ci === app.hintClue) cls.push('hlc');
      }
      if (marks[i] === 1) { cls.push('brk'); text = '■'; }
      else if (marks[i] === 2) { cls.push('opn'); text = text || '·'; }
      if (times && times[i] < INF && marks[i] !== 1) {
        sub = times[i];
        if (app.replayT != null && times[i] <= app.replayT) cls.push(times[i] === app.replayT ? 'front' : 'burnt');
      }
      if (app.highlight.has(i)) cls.push('hl');
      if (solSet.has(i)) cls.push('sol');
      return { cls, text, sub };
    }, { click: onPlayClick });

    const used = breaksOf(marks).length;
    let status = `firebreaks ${used}/${pz.k}`;
    if (pz.mode === 'A') {
      const res = E.checkBreaks(P, breaksOf(marks));
      const met = res.clueStatus.filter(Boolean).length;
      status += ` · targets met ${met}/${P.clues.length}`;
      if (res.solved) status += ` · SOLVED${used === pz.k ? '' : ' (with ' + used + ')'}`;
    } else if (app.solvedB) status += ' · SOLVED';
    const meta = app.meta;
    $('info').innerHTML = `<b>${pz.id || 'custom'}</b> · mode ${pz.mode} · ${status}` +
      (meta && devOn() ? `<br><small>generator rating: hardest L${meta.hardest} (${E.LEVEL_NAMES[meta.hardest]}), ${meta.logicRounds} logic rounds</small>` : '');
    $('undoBtn').disabled = !app.hist.length;
    $('redoBtn').disabled = !app.fut.length;
    const canReplay = pz.mode === 'A' || app.solvedB || devOn();
    $('replayBtn').disabled = !canReplay;
  }

  function pushHist() { app.hist.push(app.marks.slice()); app.fut = []; }

  function onPlayClick(i, e) {
    const { P, pz } = app;
    if (!P.isCand[i]) { setMsg('Firebreaks can only go on burnable cells without a clue or source.'); return; }
    if (app.solvedB) return;
    const openMark = e.shiftKey || e.button === 2;
    pushHist();
    if (openMark) app.marks[i] = app.marks[i] === 2 ? 0 : 2;
    else if (app.marks[i] === 1) app.marks[i] = 0;
    else {
      if (breaksOf(app.marks).length >= pz.k) { app.hist.pop(); setMsg(`You only have ${pz.k} firebreak(s).`); return; }
      app.marks[i] = 1;
    }
    app.highlight = new Set(); app.hintClue = -1;
    stopReplay();
    renderPlay();
  }

  function undo() { if (!app.hist.length) return; app.fut.push(app.marks); app.marks = app.hist.pop(); stopReplay(); renderPlay(); }
  function redo() { if (!app.fut.length) return; app.hist.push(app.marks); app.marks = app.fut.pop(); stopReplay(); renderPlay(); }
  function reset() { pushHist(); app.marks = new Int8Array(app.P.n); app.solvedB = false; stopReplay(); renderPlay(); }

  function check() {
    const res = E.checkBreaks(app.P, breaksOf(app.marks));
    if (res.solved) { app.solvedB = true; setMsg('Correct! Press Replay to watch the fire.'); }
    else if (!res.countOk) setMsg(`You have marked ${breaksOf(app.marks).length} of ${app.pz.k} firebreaks.`);
    else setMsg('Not consistent with the observed times.');
    renderPlay();
  }

  function hint() {
    const { P } = app;
    const sol = new Set(app.solution);
    const wrong = [];
    const st = new Int8Array(P.n);
    for (const c of P.cand) {
      const m = app.marks[c];
      if (m === 1 && !sol.has(c) || m === 2 && sol.has(c)) wrong.push(c);
      else if (m) st[c] = m;
    }
    if (wrong.length) {
      app.highlight = new Set(wrong); app.hintClue = -1;
      setMsg(`${wrong.length} highlighted mark(s) contradict the solution.`);
      renderPlay();
      return;
    }
    const r = E.nextDeductions(P, st, 5);
    if (!r) { setMsg('Nothing left to deduce.'); return; }
    const d = r.ds.find(x => app.marks[x.cell] !== x.val) || r.ds[0];
    app.highlight = new Set([d.cell]);
    app.hintClue = d.clue ? P.clueAt[d.clue.i] : -1;
    setMsg(`[L${r.level} ${d.tech}] (${d.cell % P.w},${(d.cell / P.w) | 0}) is ${d.val === 1 ? 'a FIREBREAK' : 'OPEN'}.\n${d.detail}\n— ${E.TECHNIQUES[d.tech].desc}`);
    renderPlay();
  }

  // ---------------------------------------------------------------- replay

  function stopReplay() {
    if (app.timer) clearInterval(app.timer);
    app.timer = null;
    app.replayT = null;
    $('replaySlider').disabled = true;
    $('replayLabel').textContent = '';
    $('replayBtn').textContent = '▶ Replay';
  }

  function replayMax() {
    const t = E.timesFor(app.P, breaksOf(app.marks));
    let m = 0;
    t.forEach(v => { if (v < INF && v > m) m = v; });
    return m;
  }

  function setReplay(t) {
    app.replayT = t;
    $('replaySlider').value = t;
    $('replayLabel').textContent = `t = ${t}`;
    renderPlay();
  }

  function toggleReplay() {
    if (app.replayT != null) { stopReplay(); renderPlay(); return; }
    const max = replayMax();
    const sl = $('replaySlider');
    sl.max = max; sl.disabled = false;
    $('replayBtn').textContent = '■ Stop';
    setReplay(0);
    app.timer = setInterval(() => {
      if (app.replayT >= max) { clearInterval(app.timer); app.timer = null; return; }
      setReplay(app.replayT + 1);
    }, 450);
  }

  // ---------------------------------------------------------------- developer view

  function devOn() { return $('devToggle').checked; }

  function devReport(pz, deep) {
    const key = JSON.stringify(stripPuzzle(pz)) + (deep ? '#deep' : '');
    if (app.devCache.has(key)) return app.devCache.get(key);
    const P = E.parse(pz);
    const t0 = performance.now();
    const sol = E.solve(P, { limit: 64 });
    const fewer = E.fewerMoveSolutions(P, 16);
    const an = E.analyze(P, { maxLevel: deep ? 5 : 4 });
    const rep = { P, sol, fewer, an, ms: Math.round(performance.now() - t0), deep };
    app.devCache.set(key, rep);
    return rep;
  }

  function renderDev(deep) {
    const body = $('devBody');
    if (!devOn()) return;
    const pz = app.view === 'play' ? app.pz : app.ed.pz;
    if (!pz) { body.textContent = ''; return; }
    const rep = devReport(pz, deep);
    const { P, sol, fewer, an } = rep;
    body.innerHTML = '';
    const h = (tag, html) => { const e = document.createElement(tag); e.innerHTML = html; body.appendChild(e); return e; };
    const n = sol.solutions.length;
    h('h3', `Valid solutions: ${n}${sol.capped ? '+' : ''} <small>(exhaustive, ${sol.nodes} nodes, ${rep.ms} ms)</small>`);
    h('div', n === 1 ? 'Unique ✓' : n === 0 ? '<span class="flag">No solution</span>' : '<span class="flag">Not unique</span>');
    const box = h('div', '');
    sol.solutions.forEach(s => box.appendChild(miniGrid(P, s)));
    h('div', fewer.length ? `<span class="flag">${fewer.length}${fewer.length >= 16 ? '+' : ''} solution(s) with fewer than ${pz.k} firebreaks</span>` : `No solution with fewer than ${pz.k} firebreaks ✓`);
    if (fewer.length) { const fb = h('div', ''); fewer.forEach(s => fb.appendChild(miniGrid(P, s))); }

    h('h3', `Logical analysis (up to L${an.maxLevel})`);
    h('div', (an.solved ? `Solved in ${an.logicRounds} logic round(s); hardest level ${an.hardest} (${E.LEVEL_NAMES[an.hardest]})` : `<span class="flag">Not solved: ${an.unresolved} cell(s) unresolved</span>`) +
      (E.isTrivial(an) ? ' · <span class="flag">trivial</span>' : ''));
    an.flags.forEach(f => h('div', `<span class="flag">⚑ ${f}</span>`));
    const tc = Object.entries(an.techCounts).sort((a, b) => E.TECHNIQUES[a[0]].level - E.TECHNIQUES[b[0]].level);
    if (tc.length) h('table', '<tr><th>L</th><th>technique</th><th>uses</th></tr>' + tc.map(([t, c]) => `<tr><td>${E.TECHNIQUES[t].level}</td><td title="${E.TECHNIQUES[t].desc}">${t}</td><td>${c}</td></tr>`).join(''));
    const ol = h('ol', '');
    ol.className = 'steps';
    for (const s of an.steps) {
      const li = document.createElement('li');
      const techs = [...new Set(s.deductions.map(d => d.tech))].join(', ');
      li.innerHTML = `<span class="tag">L${s.level}</span> ${techs}: ` + s.deductions.map(d => `(${d.x},${d.y})${d.val === 1 ? '■' : '·'}`).join(' ');
      li.title = s.deductions.map(d => d.detail).join('\n');
      li.addEventListener('click', () => {
        if (app.view !== 'play') return;
        app.highlight = new Set(s.deductions.map(d => d.cell));
        const withClue = s.deductions.find(d => d.clue);
        app.hintClue = withClue ? app.P.clueAt[withClue.clue.y * app.P.w + withClue.clue.x] : -1;
        setMsg(s.deductions.slice(0, 4).map(d => `[${d.tech}] ${d.detail}`).join('\n') + (s.deductions.length > 4 ? `\n… +${s.deductions.length - 4} more` : ''));
        renderPlay();
      });
      ol.appendChild(li);
    }
    h('small', 'Click a step to highlight its cells on the play grid; hover for details.');
  }

  // ---------------------------------------------------------------- editor

  function blank(w, h, mode, k) {
    const rows = [];
    for (let y = 0; y < h; y++) rows.push('.'.repeat(w));
    rows[0] = 'S' + rows[0].slice(1);
    return { id: 'custom', mode, w, h, k, rows, clues: [], solution: [] };
  }

  function edSet(pz) { app.ed.pz = pz; renderEditor(); }
  function edChange(fn) { app.ed.hist.push(JSON.stringify(app.ed.pz)); app.ed.fut = []; fn(app.ed.pz); app.devCache.clear(); renderEditor(); }
  function edUndo() { if (!app.ed.hist.length) return; app.ed.fut.push(JSON.stringify(app.ed.pz)); app.ed.pz = JSON.parse(app.ed.hist.pop()); renderEditor(); }
  function edRedo() { if (!app.ed.fut.length) return; app.ed.hist.push(JSON.stringify(app.ed.pz)); app.ed.pz = JSON.parse(app.ed.fut.pop()); renderEditor(); }

  function setCh(pz, x, y, ch) { const r = pz.rows[y]; pz.rows[y] = r.slice(0, x) + ch + r.slice(x + 1); }
  function dropAt(list, x, y) { return list.filter(c => Array.isArray(c) ? !(c[0] === x && c[1] === y) : !(c.x === x && c.y === y)); }

  function edTimes(pz) { const P = E.parse(pz); return { P, t: E.timesFor(P, pz.solution.map(([x, y]) => y * pz.w + x)) }; }

  function timedClue(pz, op, x, y, t) {
    if (op === 'never' || t >= INF) return pz.mode === 'B' ? { x, y, op: '=', t: null } : { x, y, op: op === '>=' ? '>=' : 'never', t: op === '>=' ? 1 : null };
    return { x, y, op, t };
  }

  let painting = false;
  document.addEventListener('mouseup', () => { painting = false; });

  function edApply(i) {
    const pz = app.ed.pz, x = i % pz.w, y = (i / pz.w) | 0;
    const tool = document.querySelector('input[name=tool]:checked').value;
    edChange(p => {
      const g = p.rows[y][x];
      if (tool === 'open') setCh(p, x, y, '.');
      else if (tool === 'wall') { setCh(p, x, y, '#'); p.clues = dropAt(p.clues, x, y); p.solution = dropAt(p.solution, x, y); }
      else if (tool === 'source') { setCh(p, x, y, 'S'); p.solution = dropAt(p.solution, x, y); }
      else if (tool === 'break') {
        if (g !== '.') return;
        const had = p.solution.some(([a, b]) => a === x && b === y);
        p.solution = dropAt(p.solution, x, y);
        if (!had) { p.solution.push([x, y]); p.clues = dropAt(p.clues, x, y); }
      } else if (tool === 'clue') {
        if (g === '#') return;
        p.solution = dropAt(p.solution, x, y);
        const op = $('edOp').value, raw = $('edT').value.trim();
        let t;
        if (raw === '') t = edTimes(p).t[i];
        else t = raw === '∞' || raw.toLowerCase() === 'inf' ? INF : parseInt(raw, 10);
        if (Number.isNaN(t)) return;
        p.clues = dropAt(p.clues, x, y);
        p.clues.push(timedClue(p, op, x, y, t));
      } else if (tool === 'erase') p.clues = dropAt(p.clues, x, y);
    });
  }

  function renderEditor() {
    const pz = app.ed.pz;
    const { P, t } = edTimes(pz);
    const sol = new Set(pz.solution.map(([x, y]) => y * pz.w + x));
    drawGrid($('edGrid'), P, i => {
      const g = P.grid[i], ci = P.clueAt[i], cls = [];
      let text = '';
      if (g === '#') return { cls: ['wall'] };
      if (g === 'S') { cls.push('src'); text = 'S'; }
      if (ci >= 0) { const c = P.clues[ci]; cls.push('clue', c.lo <= t[i] && t[i] <= c.hi ? 'ok' : 'bad'); text = label(pz, c); }
      if (sol.has(i)) { cls.push('brk'); text = '■'; }
      return { cls, text, sub: t[i] < INF && !sol.has(i) ? t[i] : null };
    }, {
      click: i => { painting = true; edApply(i); },
      enter: i => {
        const tool = document.querySelector('input[name=tool]:checked').value;
        if (painting && (tool === 'wall' || tool === 'open')) edApply(i);
      },
    });
    $('edW').value = pz.w; $('edH').value = pz.h; $('edMode').value = pz.mode; $('edK').value = pz.k;
    $('edMsg').textContent = `${pz.solution.length} solution firebreak(s) · budget k=${pz.k} · ${pz.clues.length} clue(s). Small numbers = ignition times with the solution firebreaks.`;
    if (devOn()) renderDev();
  }

  function edMinimize() {
    const base = app.ed.pz;
    const uniq = cs => {
      const P = E.parse(Object.assign({}, base, { clues: cs }));
      return E.solve(P, { limit: 2 }).solutions.length === 1 && E.fewerMoveSolutions(P).length === 0;
    };
    if (!uniq(base.clues)) { $('edMsg').textContent = 'Puzzle is not unique (or has a fewer-firebreak solution) yet; add clues first.'; return; }
    let cs = base.clues.slice();
    for (const c of base.clues.slice().reverse()) { const tr = cs.filter(x => x !== c); if (uniq(tr)) cs = tr; }
    edChange(p => { p.clues = cs; });
    $('edMsg').textContent += ` Minimized to ${cs.length} clue(s).`;
  }

  function edRandom() {
    const spec = { mode: $('edMode').value, w: +$('edW').value, h: +$('edH').value, k: +$('edK').value, wallRate: 0.2, sources: 1, eqRate: 0.35 };
    const base = Math.floor(Math.random() * 1e9);
    for (let a = 0; a < 400; a++) {
      const r = E.generate(spec, base + a, {});
      if (r) { edChange(p => Object.assign(p, r.puzzle, { id: 'gen-' + r.puzzle.seed })); $('edMsg').textContent += ` Generated (seed ${r.puzzle.seed}, hardest L${r.analysis.hardest}).`; return; }
    }
    $('edMsg').textContent = 'Generator found nothing in 400 attempts for this size/k. Try more cells or fewer firebreaks.';
  }

  // ---------------------------------------------------------------- wiring

  function setView(v) {
    app.view = v;
    $('tabPlay').classList.toggle('on', v === 'play');
    $('tabEdit').classList.toggle('on', v === 'edit');
    $('playPane').classList.toggle('hidden', v !== 'play');
    $('editPane').classList.toggle('hidden', v !== 'edit');
    if (v === 'edit' && !app.ed.pz) edSet(stripPuzzle(app.pz));
    if (v === 'play') renderPlay(); else renderEditor();
    renderDev();
  }

  function init() {
    buildList();
    $('puzzleSel').addEventListener('change', e => { app.idx = +e.target.value; loadPuzzle(app.list[app.idx]); });
    $('prevBtn').onclick = () => { app.idx = (app.idx + app.list.length - 1) % app.list.length; $('puzzleSel').value = app.idx; loadPuzzle(app.list[app.idx]); };
    $('nextBtn').onclick = () => { app.idx = (app.idx + 1) % app.list.length; $('puzzleSel').value = app.idx; loadPuzzle(app.list[app.idx]); };
    $('undoBtn').onclick = undo; $('redoBtn').onclick = redo; $('resetBtn').onclick = reset;
    $('hintBtn').onclick = hint; $('checkBtn').onclick = check;
    $('liveToggle').onchange = renderPlay;
    $('replayBtn').onclick = toggleReplay;
    $('replaySlider').oninput = e => { if (app.timer) { clearInterval(app.timer); app.timer = null; } setReplay(+e.target.value); };
    $('tabPlay').onclick = () => setView('play');
    $('tabEdit').onclick = () => setView('edit');
    $('devToggle').onchange = () => { $('dev').classList.toggle('hidden', !devOn()); renderDev(); if (app.view === 'play') renderPlay(); };
    $('showSol').onchange = renderPlay; $('peekSim').onchange = renderPlay;
    $('deepBtn').onclick = () => { $('devBody').textContent = 'Running deep analysis…'; setTimeout(() => renderDev(true), 20); };
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const z = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z';
      if (!z) return;
      e.preventDefault();
      const back = !e.shiftKey;
      if (app.view === 'play') (back ? undo : redo)(); else (back ? edUndo : edRedo)();
    });

    $('edNew').onclick = () => edChange(p => Object.assign(p, blank(Math.min(9, Math.max(3, +$('edW').value)), Math.min(9, Math.max(3, +$('edH').value)), $('edMode').value, +$('edK').value)));
    $('edMode').onchange = () => edChange(p => {
      p.mode = $('edMode').value;
      p.clues = p.clues.map(c => p.mode === 'B' ? { x: c.x, y: c.y, op: '=', t: c.op === 'never' ? null : c.t } : c.op === '=' && c.t == null ? { x: c.x, y: c.y, op: 'never', t: null } : c);
    });
    $('edK').onchange = () => edChange(p => { p.k = Math.max(0, +$('edK').value); });
    $('edRandom').onclick = edRandom;
    $('edUndo').onclick = edUndo; $('edRedo').onclick = edRedo;
    $('edK2').onclick = () => edChange(p => { p.k = p.solution.length; });
    $('edAutoT').onclick = () => edChange(p => { const { t } = edTimes(p); p.clues = p.clues.map(c => timedClue(p, c.op, c.x, c.y, t[c.y * p.w + c.x])); });
    $('edReveal').onclick = () => edChange(p => {
      const { P, t } = edTimes(p);
      const sol = new Set(p.solution.map(([x, y]) => y * p.w + x));
      p.clues = [];
      for (let i = 0; i < P.n; i++) if (P.grid[i] === '.' && !sol.has(i)) p.clues.push(timedClue(p, '=', i % p.w, (i / p.w) | 0, t[i]));
    });
    $('edMin').onclick = edMinimize;
    $('edClear').onclick = () => edChange(p => { p.clues = []; });
    $('edAnalyze').onclick = () => { if (!devOn()) { $('devToggle').checked = true; $('dev').classList.remove('hidden'); } app.devCache.clear(); renderDev(); };
    $('edPlay').onclick = () => { setView('play'); loadPuzzle(app.ed.pz); };
    $('edSave').onclick = () => {
      const list = loadCustom();
      const p = stripPuzzle(app.ed.pz);
      p.id = 'custom-' + (list.length + 1);
      list.push(p);
      $('edMsg').textContent = saveCustom(list) ? `Saved as ${p.id}.` : 'Could not save (storage unavailable). Use Export instead.';
      buildList();
    };
    $('edExport').onclick = () => { $('edJson').value = JSON.stringify(stripPuzzle(app.ed.pz)); };
    $('edImport').onclick = () => {
      try {
        const p = JSON.parse($('edJson').value);
        if (!p.rows || !p.w || !p.h || !p.mode) throw new Error('missing fields');
        p.clues = p.clues || []; p.solution = p.solution || []; p.k = p.k || 0;
        edChange(q => { Object.keys(q).forEach(k => delete q[k]); Object.assign(q, stripPuzzle(p)); });
      } catch (err) { $('edMsg').textContent = 'Import failed: ' + err.message; }
    };

    if (!app.list.length) app.list.push(blank(6, 6, 'A', 2));
    loadPuzzle(app.list[0]);
  }

  init();
})();
