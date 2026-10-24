/*
 * Emberprint Lab engine.
 *
 * Shared by the browser UI (window.Ember) and the Node tools (module.exports).
 *
 * Model
 *   Grid of cells: '.' burnable, '#' fireproof wall, 'S' ignition source (burns at t=0).
 *   Fire spreads orthogonally, one cell per tick. A cell's ignition time is its BFS
 *   distance from the nearest source through burnable cells; unreachable cells never
 *   burn (INF). Firebreaks turn a burnable cell fireproof.
 *
 * Puzzle JSON
 *   { id, mode: 'A'|'B', w, h, rows: [string], k, clues: [{x, y, op, t}], solution: [[x, y]] }
 *   op: '='     ignites at exactly t (t === null means "never burns")
 *       'never' never burns                    (mode A target)
 *       '<='    burns no later than t           (mode A target)
 *       '>='    does not burn before t (or never burns) (mode A target)
 *   Mode A: place at most k firebreaks so every target holds.
 *   Mode B: exactly k firebreaks are hidden; clues are observed ignition times.
 *   Firebreaks may only go on burnable cells that are not sources and carry no clue.
 *
 * Key fact used everywhere: adding firebreaks never makes any cell ignite earlier.
 * So "unknown cells open" gives a lower bound on every ignition time and
 * "unknown cells blocked" gives an upper bound.
 */
(function (root) {
  'use strict';

  const INF = 1000000000;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rnd) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function clueBounds(op, t) {
    switch (op) {
      case '=': return t == null ? [INF, INF] : [t, t];
      case 'never': return [INF, INF];
      case '<=': return [0, t];
      case '>=': return [t, INF];
    }
    throw new Error('unknown clue op ' + op);
  }

  function clueLabel(c) {
    switch (c.op) {
      case '=': return c.t == null ? '∞' : String(c.t);
      case 'never': return '∞';
      case '<=': return '≤' + c.t;
      case '>=': return '≥' + c.t;
    }
    return '?';
  }

  function clueText(c) {
    const at = '(' + c.x + ',' + c.y + ')';
    switch (c.op) {
      case '=': return at + (c.t == null ? ' never burns' : ' ignites at t=' + c.t);
      case 'never': return at + ' must never burn';
      case '<=': return at + ' must burn by t=' + c.t;
      case '>=': return at + ' must not burn before t=' + c.t;
    }
    return at;
  }

  function parse(pz) {
    const w = pz.w, h = pz.h, n = w * h;
    const grid = new Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grid[y * w + x] = pz.rows[y][x] || '.';
    const sources = [];
    const nbr = new Array(n);
    for (let i = 0; i < n; i++) {
      if (grid[i] === 'S') sources.push(i);
      nbr[i] = [];
      if (grid[i] === '#') continue;
      const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (grid[j] !== '#') nbr[i].push(j);
      }
    }
    const clueAt = new Int32Array(n).fill(-1);
    const clues = [];
    for (const c of pz.clues || []) {
      const i = c.y * w + c.x;
      if (clueAt[i] >= 0) continue;
      const [lo, hi] = clueBounds(c.op, c.t);
      clueAt[i] = clues.length;
      clues.push({ i, x: c.x, y: c.y, op: c.op, t: c.t == null ? null : c.t, lo, hi });
    }
    const cand = [];
    const isCand = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (grid[i] === '.' && clueAt[i] < 0) { cand.push(i); isCand[i] = 1; }
    return { w, h, n, grid, sources, nbr, clues, clueAt, cand, isCand, k: pz.k, exact: pz.mode === 'B', mode: pz.mode };
  }

  function bfs(P, starts, blocked) {
    const t = new Int32Array(P.n).fill(INF);
    const q = new Int32Array(P.n);
    let head = 0, tail = 0;
    for (const s of starts) if (!blocked[s] && t[s] === INF) { t[s] = 0; q[tail++] = s; }
    while (head < tail) {
      const c = q[head++], nt = t[c] + 1, nb = P.nbr[c];
      for (let j = 0; j < nb.length; j++) {
        const v = nb[j];
        if (t[v] === INF && !blocked[v]) { t[v] = nt; q[tail++] = v; }
      }
    }
    return t;
  }

  /** Ignition times with the given cells blocked (Uint8Array mask). */
  function simulate(P, blocked) { return bfs(P, P.sources, blocked); }

  function maskOf(P, list) {
    const b = new Uint8Array(P.n);
    for (const i of list) b[i] = 1;
    return b;
  }

  function timesFor(P, breaks) { return simulate(P, maskOf(P, breaks)); }

  function clueOk(c, t) { return t >= c.lo && t <= c.hi; }

  function checkBreaks(P, breaks) {
    const times = timesFor(P, breaks);
    const clueStatus = P.clues.map(c => clueOk(c, times[c.i]));
    const countOk = P.exact ? breaks.length === P.k : breaks.length <= P.k;
    const legal = breaks.every(i => P.isCand[i]);
    return { times, clueStatus, countOk, legal, solved: countOk && legal && clueStatus.every(Boolean) };
  }

  // ---------------------------------------------------------------- exhaustive solver

  /**
   * Branch and bound over candidate cells. Prunes with the monotone bounds:
   * a clue fails if its lower-bound time is already too late or its upper-bound
   * time is already too early. Exhaustive: every returned set is verified exactly.
   * opts: limit (stop after this many), maxBreaks (default P.k), exact (default mode B).
   */
  function solve(P, opts) {
    opts = opts || {};
    const limit = opts.limit || 2;
    const maxB = opts.maxBreaks != null ? opts.maxBreaks : P.k;
    const exact = opts.exact != null ? opts.exact : P.exact;
    const base = simulate(P, new Uint8Array(P.n));
    const order = P.cand.slice().sort((a, b) => base[a] - base[b] || a - b);
    const st = new Int8Array(P.n);
    const bmin = new Uint8Array(P.n), bmax = new Uint8Array(P.n);
    for (const c of order) bmax[c] = 1;
    const sols = [];
    let nodes = 0, nb = 0;

    function rec(d) {
      if (sols.length >= limit) return;
      nodes++;
      if (exact && nb + (order.length - d) < maxB) return;
      const mn = simulate(P, bmin);
      if (nb === maxB || d === order.length) {
        if (exact && nb !== maxB) return;
        for (const c of P.clues) if (!clueOk(c, mn[c.i])) return;
        const s = [];
        for (let j = 0; j < d; j++) if (st[order[j]] === 1) s.push(order[j]);
        sols.push(s.sort((a, b) => a - b));
        return;
      }
      for (const c of P.clues) if (mn[c.i] > c.hi) return;
      const mx = simulate(P, bmax);
      for (const c of P.clues) if (mx[c.i] < c.lo) return;
      const c = order[d];
      st[c] = 1; bmin[c] = 1; nb++;
      rec(d + 1);
      nb--; bmin[c] = 0;
      st[c] = 2; bmax[c] = 0;
      rec(d + 1);
      bmax[c] = 1; st[c] = 0;
    }
    rec(0);
    return { solutions: sols, nodes, capped: sols.length >= limit };
  }

  /** Solutions that use fewer firebreaks than the budget (ignores mode B's exact count). */
  function fewerMoveSolutions(P, limit) {
    if (P.k === 0) return [];
    return solve(P, { limit: limit || 1, maxBreaks: P.k - 1, exact: false }).solutions;
  }

  // ---------------------------------------------------------------- logical deducer

  /*
   * State: Int8Array over cells, for candidates 0 = unknown, 1 = firebreak, 2 = open.
   * Techniques are tried cheapest first; each round applies every deduction found by
   * the cheapest technique level that finds anything.
   */
  const TECHNIQUES = {
    'Budget exhausted': { level: 0, desc: 'Every firebreak is already placed, so all remaining cells are open.' },
    'Budget fill': { level: 0, desc: 'Mode B: the unknown cells left exactly match the firebreaks left, so all are firebreaks.' },
    'Early-arrival block': { level: 1, desc: 'Even if every other unknown cell were a firebreak, leaving this cell open lets fire from a source reach a clue too early. It must be a firebreak.' },
    'Leak seal': { level: 1, desc: 'Leaving this cell open lets fire from a source reach a must-never-burn cell no matter what else is blocked. It must be a firebreak.' },
    'Lone predecessor': { level: 1, desc: 'The clue next to this cell cannot ignite on time unless fire passes through this cell, even with every other unknown open. It must be open.' },
    'Detour too long': { level: 1, desc: 'Blocking this cell forces fire onto a detour that reaches a clue too late, even with every other unknown open. It must be open.' },
    'Sole corridor': { level: 1, desc: 'Blocking this cell cuts a clue off from fire completely. It must be open.' },
    'Relay block': { level: 2, desc: 'A clue cell is known to burn by time t, so it acts as a secondary fire source. Fire relayed from it through this cell would reach another clue too early, so this cell must be a firebreak.' },
    'Relay leak seal': { level: 2, desc: 'As Relay block, but the fire relayed from a clue cell would reach a must-never-burn cell.' },
    'Held-back front': { level: 2, desc: 'A clue cell cannot burn before time t, which holds back the fire front passing through it. With that delay, blocking this cell would make another clue ignite too late, so it must be open.' },
    'Forced cut': { level: 3, desc: 'A fire route that reaches a clue too early (or at all, for a never-burn clue) has exactly one unknown cell left on it, after setting aside the cells reserved for other routes. That cell must be a firebreak.' },
    'Budget squeeze': { level: 3, desc: 'Clues need firebreaks on several fire routes that share no unknown cells, and that uses up the whole remaining budget. Each route gets exactly one firebreak, so every cell on none of those routes is open.' },
    'Last firebreak': { level: 3, desc: 'Only one firebreak is left. Putting it on this cell, with everything else open, breaks a clue, so this cell is open.' },
    'Shallow contradiction': { level: 4, desc: 'Assuming the opposite value and propagating the level 0-3 techniques reaches a contradiction (one-step trial and error).' },
    'Deep contradiction': { level: 5, desc: 'Needs a trial whose refutation itself needs nested trials (two-level trial and error). Treated as guessing.' },
  };

  const LEVEL_NAMES = ['budget counting', 'single-cell bounds', 'clue relay', 'route squeeze', 'shallow contradiction', 'deep contradiction'];

  function stateBlocked(P, st, unknownBlocked) {
    const b = new Uint8Array(P.n);
    for (const c of P.cand) if (st[c] === 1 || (unknownBlocked && st[c] === 0)) b[c] = 1;
    return b;
  }

  function countState(P, st) {
    let nb = 0, nu = 0;
    for (const c of P.cand) { if (st[c] === 1) nb++; else if (st[c] === 0) nu++; }
    return { nb, nu };
  }

  function xy(P, i) { return '(' + (i % P.w) + ',' + ((i / P.w) | 0) + ')'; }

  /*
   * Earliest-arrival spread with per-cell start times and optional per-cell holds
   * ("cannot ignite before"). via[] records, per cell, the start cell of its wave
   * (relay mode) or the last held cell on its route (hold mode, -1 if none).
   */
  function spread(P, start, blocked, hold) {
    const best = new Int32Array(P.n).fill(INF);
    const done = new Uint8Array(P.n);
    const via = new Int32Array(P.n).fill(-1);
    const held = [];
    const buckets = [];
    const push = (v, t, o) => {
      if (t >= best[v]) return;
      best[v] = t; via[v] = o;
      (buckets[t] || (buckets[t] = [])).push(v);
    };
    for (let i = 0; i < P.n; i++) if (start[i] < INF && !blocked[i]) push(i, start[i], hold ? -1 : i);
    for (let T = 0; T < buckets.length; T++) {
      const b = buckets[T];
      if (!b) continue;
      for (let j = 0; j < b.length; j++) {
        const v = b[j];
        if (done[v] || best[v] !== T) continue;
        if (hold && hold[v] > T) {
          held.push(v);
          best[v] = INF;
          if (hold[v] >= INF) done[v] = 1; else push(v, hold[v], v);
          continue;
        }
        done[v] = 1;
        for (const nb of P.nbr[v]) if (!blocked[nb] && !done[nb]) push(nb, T + 1, via[v]);
      }
    }
    return { t: best, via, held };
  }

  function sourceStarts(P) {
    const s = new Int32Array(P.n).fill(INF);
    for (const i of P.sources) s[i] = 0;
    return s;
  }

  /** Upper bounds on ignition times: unknowns blocked, clue cells relay fire from their latest allowed time. */
  function relayUpper(P, blocked) {
    const s = sourceStarts(P);
    for (const c of P.clues) if (c.hi < INF) s[c.i] = Math.min(s[c.i], c.hi);
    return spread(P, s, blocked, null);
  }

  /** Lower bounds on ignition times: unknowns open, clue cells cannot ignite before their earliest allowed time. */
  function heldLower(P, blocked) {
    const hold = new Int32Array(P.n);
    for (const c of P.clues) hold[c.i] = c.lo;
    return spread(P, sourceStarts(P), blocked, hold);
  }

  /*
   * Unknown cells on the fire route to `target` (shorter than maxLen, any length if INF)
   * with the fewest unknown cells, avoiding firebreaks and `used` cells. Every such route
   * must contain a firebreak, so its unknown cells form a "needs one firebreak" set.
   * Returns null when no route exists, [] when an unblockable route exists.
   */
  function cheapestRoute(P, st, used, target, maxLen) {
    const n = P.n;
    const cost = u => (P.isCand[u] && st[u] === 0 ? 1 : 0);
    const free = u => !(P.isCand[u] && st[u] === 1) && !used[u];
    if (!free(target)) return null;
    let endLayer = -1, endCost = INF;
    const layers = [];
    if (maxLen >= INF) {
      // 0-1 BFS over cells
      const dist = new Int32Array(n).fill(INF), par = new Int32Array(n).fill(-1);
      const dq = [];
      for (const s of P.sources) if (free(s)) { dist[s] = cost(s); dq.push(s); }
      while (dq.length) {
        let bi = 0;
        for (let j = 1; j < dq.length; j++) if (dist[dq[j]] < dist[dq[bi]]) bi = j;
        const v = dq.splice(bi, 1)[0];
        for (const nb of P.nbr[v]) {
          if (!free(nb)) continue;
          const d = dist[v] + cost(nb);
          if (d < dist[nb]) { dist[nb] = d; par[nb] = v; dq.push(nb); }
        }
      }
      if (dist[target] >= INF) return null;
      const out = [];
      for (let v = target; v >= 0; v = par[v]) if (cost(v)) out.push(v);
      return out;
    }
    let cur = new Int32Array(n).fill(INF);
    for (const s of P.sources) if (free(s)) cur[s] = cost(s);
    layers.push({ c: cur, p: null });
    if (cur[target] < endCost) { endCost = cur[target]; endLayer = 0; }
    for (let l = 1; l <= maxLen; l++) {
      const nxt = new Int32Array(n).fill(INF), par = new Int32Array(n).fill(-1);
      for (let v = 0; v < n; v++) {
        if (cur[v] >= INF) continue;
        for (const nb of P.nbr[v]) {
          if (!free(nb)) continue;
          const d = cur[v] + cost(nb);
          if (d < nxt[nb]) { nxt[nb] = d; par[nb] = v; }
        }
      }
      layers.push({ c: nxt, p: par });
      if (nxt[target] < endCost) { endCost = nxt[target]; endLayer = l; }
      cur = nxt;
    }
    if (endLayer < 0) return null;
    const out = new Set();
    for (let l = endLayer, v = target; l >= 0; l--) {
      if (cost(v)) out.add(v);
      if (l > 0) v = layers[l].p[v];
    }
    return Array.from(out);
  }

  /** Disjoint "needs one firebreak" routes, greedily extracted clue by clue. */
  function routeSets(P, st) {
    const used = new Uint8Array(P.n);
    const sets = [];
    for (const c of P.clues) {
      if (c.lo <= 0) continue;
      for (;;) {
        const r = cheapestRoute(P, st, used, c.i, c.lo >= INF ? INF : c.lo - 1);
        if (!r) break;
        if (!r.length) return { sets, broken: c };
        sets.push({ clue: c, cells: r });
        r.forEach(u => { used[u] = 1; });
      }
    }
    return { sets, broken: null };
  }

  function contradictionOf(P, st) {
    const { nb, nu } = countState(P, st);
    if (nb > P.k) return 'more firebreaks than the budget';
    if (P.exact && nb + nu < P.k) return 'too few cells left for the remaining firebreaks';
    const lo = heldLower(P, stateBlocked(P, st, false)).t;
    for (const c of P.clues) if (lo[c.i] > c.hi) return clueText(c) + ' becomes impossible (fire arrives too late)';
    const up = relayUpper(P, stateBlocked(P, st, true)).t;
    for (const c of P.clues) if (up[c.i] < c.lo) return clueText(c) + ' becomes impossible (fire arrives too early)';
    const rs = routeSets(P, st);
    if (rs.broken) return clueText(rs.broken) + ' becomes impossible (an unblockable route reaches it too early)';
    if (rs.sets.length > P.k - nb) return rs.sets.length + ' separate routes need a firebreak but only ' + (P.k - nb) + ' firebreak(s) left';
    return null;
  }

  function passBudget(P, st) {
    const { nb, nu } = countState(P, st);
    if (nu === 0) return [];
    const unknown = P.cand.filter(c => st[c] === 0);
    if (nb === P.k) return unknown.map(c => ({ cell: c, val: 2, tech: 'Budget exhausted', detail: 'all ' + P.k + ' firebreaks placed' }));
    if (P.exact && nb + nu === P.k) return unknown.map(c => ({ cell: c, val: 1, tech: 'Budget fill', detail: nu + ' unknown cell(s) for ' + (P.k - nb) + ' firebreak(s)' }));
    return [];
  }

  function passSingle(P, st) {
    const out = [];
    const bMax = stateBlocked(P, st, true), bMin = stateBlocked(P, st, false);
    for (const u of P.cand) {
      if (st[u] !== 0) continue;
      bMax[u] = 0; const mx = simulate(P, bMax); bMax[u] = 1;
      bMin[u] = 1; const mn = simulate(P, bMin); bMin[u] = 0;
      for (const c of P.clues) {
        if (mx[c.i] < c.lo) {
          out.push({
            cell: u, val: 1, clue: c,
            tech: c.lo >= INF ? 'Leak seal' : 'Early-arrival block',
            detail: 'if ' + xy(P, u) + ' stays open, fire reaches ' + xy(P, c.i) + ' by t=' + mx[c.i] + ' even with all other unknowns blocked; clue: ' + clueText(c),
          });
          break;
        }
        if (mn[c.i] > c.hi) {
          const adj = Math.abs(u % P.w - c.x) + Math.abs(((u / P.w) | 0) - c.y) === 1;
          out.push({
            cell: u, val: 2, clue: c,
            tech: mn[c.i] >= INF ? 'Sole corridor' : adj ? 'Lone predecessor' : 'Detour too long',
            detail: 'blocking ' + xy(P, u) + ' makes ' + xy(P, c.i) + ' ignite ' + (mn[c.i] >= INF ? 'never' : 'at t=' + mn[c.i]) + ' even with all other unknowns open; clue: ' + clueText(c),
          });
          break;
        }
      }
    }
    return out;
  }

  function passRelay(P, st) {
    const out = [];
    const bMax = stateBlocked(P, st, true), bMin = stateBlocked(P, st, false);
    for (const u of P.cand) {
      if (st[u] !== 0) continue;
      bMax[u] = 0; const up = relayUpper(P, bMax); bMax[u] = 1;
      bMin[u] = 1; const lo = heldLower(P, bMin); bMin[u] = 0;
      for (const c of P.clues) {
        if (up.t[c.i] < c.lo) {
          const o = up.via[c.i], oc = P.clueAt[o] >= 0 ? P.clues[P.clueAt[o]] : null;
          out.push({
            cell: u, val: 1, clue: c,
            tech: c.lo >= INF ? 'Relay leak seal' : 'Relay block',
            detail: 'clue ' + (oc ? clueText(oc) : xy(P, o)) + ' relays fire; through an open ' + xy(P, u) + ' it reaches ' + xy(P, c.i) + ' by t=' + up.t[c.i] + '; clue: ' + clueText(c),
          });
          break;
        }
        if (lo.t[c.i] > c.hi) {
          const hs = lo.held.filter(v => v !== c.i).map(v => clueText(P.clues[P.clueAt[v]]));
          out.push({
            cell: u, val: 2, clue: c, tech: 'Held-back front',
            detail: 'fire is held back at ' + (hs.length ? hs.join(' and ') : clueText(c)) + '; with ' + xy(P, u) + ' blocked, ' + xy(P, c.i) + ' could not ignite before t=' + (lo.t[c.i] >= INF ? '∞' : lo.t[c.i]) + '; clue: ' + clueText(c),
          });
          break;
        }
      }
    }
    return out;
  }

  function passSqueeze(P, st) {
    const { nb } = countState(P, st);
    const r = P.k - nb;
    if (r <= 0) return [];
    const out = [];
    const { sets } = routeSets(P, st);
    for (const s of sets) {
      if (s.cells.length === 1) out.push({ cell: s.cells[0], val: 1, clue: s.clue, tech: 'Forced cut', detail: 'the only unknown cell left on a route that must be cut for ' + clueText(s.clue) });
    }
    if (sets.length === r) {
      const inside = new Set();
      sets.forEach(s => s.cells.forEach(c => inside.add(c)));
      const per = {};
      sets.forEach(s => { const key = xy(P, s.clue.i); per[key] = (per[key] || 0) + 1; });
      const names = Object.keys(per).map(k => per[k] > 1 ? k + ' (needs ' + per[k] + ' separate firebreaks)' : k).join(', ');
      for (const c of P.cand) {
        if (st[c] === 0 && !inside.has(c)) out.push({ cell: c, val: 2, tech: 'Budget squeeze', detail: r + ' firebreak(s) left, all needed on disjoint routes into ' + names + '; ' + xy(P, c) + ' is on none of them' });
      }
    }
    if (r === 1) {
      const known = P.cand.filter(c => st[c] === 1);
      for (const u of P.cand) {
        if (st[u] !== 0) continue;
        const res = checkBreaks(P, known.concat([u]));
        const bad = P.clues.findIndex((c, j) => !res.clueStatus[j]);
        if (bad >= 0) out.push({ cell: u, val: 2, clue: P.clues[bad], tech: 'Last firebreak', detail: 'with the last firebreak on ' + xy(P, u) + ', ' + clueText(P.clues[bad]) + ' fails (t=' + (res.times[P.clues[bad].i] >= INF ? '∞' : res.times[P.clues[bad].i]) + ')' });
      }
    }
    return out;
  }

  function passContradiction(P, st, depth) {
    for (const u of P.cand) {
      if (st[u] !== 0) continue;
      for (const v of [1, 2]) {
        const s2 = st.slice();
        s2[u] = v;
        const r = propagate(P, s2, depth + 2);
        if (r.contradiction) {
          return [{
            cell: u, val: 3 - v, tech: depth === 1 ? 'Shallow contradiction' : 'Deep contradiction',
            detail: 'assuming ' + xy(P, u) + ' is ' + (v === 1 ? 'a firebreak' : 'open') + ' leads after ' + r.steps + ' round(s) to: ' + r.contradiction,
          }];
        }
      }
    }
    return [];
  }

  const PASSES = [passBudget, passSingle, passRelay, passSqueeze, (P, st) => passContradiction(P, st, 1), (P, st) => passContradiction(P, st, 2)];

  function nextDeductions(P, st, maxLevel) {
    for (let L = 0; L <= maxLevel; L++) {
      const ds = PASSES[L](P, st);
      if (ds.length) return { level: L, ds };
    }
    return null;
  }

  function applyDeductions(P, st, ds) {
    for (const d of ds) {
      if (st[d.cell] !== 0 && st[d.cell] !== d.val) return xy(P, d.cell) + ' is forced both ways';
      st[d.cell] = d.val;
    }
    return null;
  }

  function propagate(P, st, maxLevel) {
    let steps = 0;
    for (;;) {
      const why = contradictionOf(P, st);
      if (why) return { contradiction: why, steps };
      if (countState(P, st).nu === 0) return { contradiction: null, steps, solved: true };
      const r = nextDeductions(P, st, maxLevel);
      if (!r) return { contradiction: null, steps };
      const conflict = applyDeductions(P, st, r.ds);
      if (conflict) return { contradiction: conflict, steps };
      steps++;
    }
  }

  /**
   * Solve like a human would, logging every round. maxLevel caps the technique level
   * (4 = allow one-step contradictions, 5 = allow nested ones). opts.start: initial state.
   */
  function analyze(P, opts) {
    opts = opts || {};
    const maxLevel = opts.maxLevel != null ? opts.maxLevel : 4;
    const st = opts.start ? Int8Array.from(opts.start) : new Int8Array(P.n);
    const steps = [];
    let error = null;
    for (;;) {
      const why = contradictionOf(P, st);
      if (why) { error = why; break; }
      if (countState(P, st).nu === 0) break;
      const r = nextDeductions(P, st, maxLevel);
      if (!r) break;
      const conflict = applyDeductions(P, st, r.ds);
      if (conflict) { error = conflict; break; }
      steps.push({
        round: steps.length + 1,
        level: r.level,
        deductions: r.ds.map(d => ({
          cell: d.cell, x: d.cell % P.w, y: (d.cell / P.w) | 0, val: d.val, tech: d.tech, detail: d.detail,
          clue: d.clue ? { x: d.clue.x, y: d.clue.y, op: d.clue.op, t: d.clue.t } : null,
        })),
      });
    }
    const unresolved = countState(P, st).nu;
    const techCounts = {};
    let hardest = -1;
    for (const s of steps) {
      hardest = Math.max(hardest, s.level);
      for (const d of s.deductions) techCounts[d.tech] = (techCounts[d.tech] || 0) + 1;
    }
    const solved = !error && unresolved === 0;
    const logicRounds = steps.filter(s => s.level > 0).length;
    const flags = [];
    if (error) flags.push('inconsistent: ' + error);
    else if (!solved) flags.push('STUCK with ' + unresolved + ' unresolved cell(s) using techniques up to level ' + maxLevel + ' (' + LEVEL_NAMES[maxLevel] + '): appears to require guessing or exhaustive trial');
    if (hardest === 5) flags.push('needs nested trial and error (deep contradiction): appears to require guessing');
    else if (hardest === 4) flags.push('needs ' + (techCounts['Shallow contradiction'] || 0) + ' one-step trial(s) (shallow contradiction): borderline trial and error');
    return {
      solved, error, steps, rounds: steps.length, logicRounds, hardest, techCounts, unresolved, flags,
      firstRoundShare: steps.length ? steps[0].deductions.length / Math.max(1, P.cand.length) : 0,
      state: Array.from(st), maxLevel,
    };
  }

  function isTrivial(an) {
    return an.solved && an.hardest <= 1 && (an.logicRounds <= 2 || an.firstRoundShare >= 0.85);
  }

  // ---------------------------------------------------------------- generator

  /**
   * One generation attempt. Returns { puzzle, analysis } or null (reason counted in stats).
   * spec: { mode, w, h, k, wallRate, sources, eqRate (mode A share of exact targets) }
   */
  function generate(spec, seed, stats) {
    stats = stats || {};
    const bump = r => { stats[r] = (stats[r] || 0) + 1; return null; };
    const rnd = mulberry32(seed);
    const { mode, w, h, k } = spec;
    const n = w * h;
    const g = new Array(n).fill('.');
    for (let i = 0; i < n; i++) if (rnd() < spec.wallRate) g[i] = '#';
    const open = [];
    for (let i = 0; i < n; i++) if (g[i] === '.') open.push(i);
    if (open.length < k + 10) return bump('too few open cells');
    shuffle(open, rnd);
    for (let s = 0; s < (spec.sources || 1); s++) g[open[s]] = 'S';
    const rows = [];
    for (let y = 0; y < h; y++) rows.push(g.slice(y * w, y * w + w).join(''));
    const base = { mode, w, h, k, rows, clues: [] };

    const P0 = parse(base);
    const t0 = simulate(P0, new Uint8Array(n));
    let nonWall = 0, reach = 0;
    for (let i = 0; i < n; i++) if (g[i] !== '#') { nonWall++; if (t0[i] < INF) reach++; }
    if (reach / nonWall < 0.85) return bump('poorly connected board');

    // On open ground a lone block changes nothing (detours tie in length), so plant
    // each firebreak only where it changes some ignition time.
    const pool = shuffle(P0.cand.filter(i => t0[i] < INF), rnd);
    const breaks = [];
    let cur = t0;
    for (const c of pool) {
      if (breaks.length === k) break;
      const next = timesFor(P0, breaks.concat([c]));
      let changes = false;
      for (let i = 0; i < n && !changes; i++) if (i !== c && !breaks.includes(i) && next[i] !== cur[i]) changes = true;
      if (changes) { breaks.push(c); cur = next; }
    }
    if (breaks.length < k) return bump('no room for effective firebreaks');
    breaks.sort((a, b) => a - b);
    const isBreak = maskOf(P0, breaks);
    const tb = timesFor(P0, breaks);
    for (const b of breaks) {
      const t2 = timesFor(P0, breaks.filter(x => x !== b));
      let matters = false;
      for (let i = 0; i < n && !matters; i++) if (!isBreak[i] && t2[i] !== tb[i]) matters = true;
      if (!matters) return bump('planted firebreak has no effect');
    }

    // Start from every possible clue (trivially unique: no free cells), then remove greedily.
    let clues = [];
    for (let i = 0; i < n; i++) {
      if (g[i] !== '.' || isBreak[i]) continue;
      const x = i % w, y = (i / w) | 0, t = tb[i];
      if (mode === 'B') clues.push({ x, y, op: '=', t: t >= INF ? null : t });
      else if (t >= INF) clues.push({ x, y, op: 'never', t: null });
      else {
        const r = rnd();
        if (r < spec.eqRate) clues.push({ x, y, op: '=', t });
        else if (r < spec.eqRate + (1 - spec.eqRate) / 2) clues.push({ x, y, op: '<=', t: t + (rnd() < 0.5 ? 0 : 1) });
        else clues.push({ x, y, op: '>=', t: Math.max(1, t - (rnd() < 0.5 ? 0 : 1)) });
      }
    }
    shuffle(clues, rnd);
    // Mode A: drop exact targets first so the survivors lean towards inequalities.
    if (mode === 'A') clues.sort((a, b) => (a.op === '=' ? 0 : 1) - (b.op === '=' ? 0 : 1));
    const uniqueWith = cs => {
      const P = parse(Object.assign({}, base, { clues: cs }));
      if (solve(P, { limit: 2 }).solutions.length !== 1) return false;
      return fewerMoveSolutions(P).length === 0;
    };
    if (!uniqueWith(clues)) return bump('ambiguous even with every clue');
    for (const c of clues.slice()) {
      const trial = clues.filter(x => x !== c);
      if (uniqueWith(trial)) clues = trial;
    }

    const puzzle = Object.assign({}, base, {
      clues: clues.sort((a, b) => a.y - b.y || a.x - b.x),
      solution: breaks.map(i => [i % w, (i / w) | 0]),
      seed,
    });
    const P = parse(puzzle);
    const an = analyze(P, { maxLevel: 4 });
    if (an.error) return bump('deducer inconsistency (bug)');
    if (an.solved && an.state.some((v, i) => P.isCand[i] && (v === 1) !== !!isBreak[i])) return bump('deducer disagrees with solver (bug)');
    if (isTrivial(an)) return bump('trivial');
    return { puzzle, analysis: an };
  }

  const api = {
    INF, mulberry32, shuffle, clueBounds, clueLabel, clueText, parse, simulate, timesFor, maskOf, checkBreaks,
    solve, fewerMoveSolutions, TECHNIQUES, LEVEL_NAMES, analyze, nextDeductions, contradictionOf, countState,
    isTrivial, generate,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ember = api;
})(typeof window !== 'undefined' ? window : globalThis);
