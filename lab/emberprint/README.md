# Emberprint Lab

An experimental puzzle prototype about fire spreading across a grid. This is a test bench for
the mechanics, not a finished game: no art, no production UI.

## Rules

- `S` cells ignite at t=0. Fire spreads to the four orthogonal neighbours, one cell per tick.
- Walls (`#`) and firebreaks never burn. A cell's **ignition time** is its shortest route
  length from a source through burnable cells; a cell the fire never reaches burns at ∞.
- Firebreaks go only on burnable cells that are not sources and carry no clue.

**Mode A: place firebreaks.** You have at most *k* firebreaks. Targets: `=t` (ignites exactly
at t), `≤t` (burns by t), `≥t` (not before t, or never), `∞` (must never burn). You can
simulate as much as you like.

**Mode B: infer firebreaks.** Exactly *k* firebreaks are hidden. Some cells show their observed
ignition time (`∞` = never burned). Work out where the firebreaks are. There is no simulation
until you press Check.

## Running

Open `index.html` through any static server (scripts are classic `<script>` tags, but
`file://` previews in some tools don't load them):

```bash
python3 -m http.server 8765
```

```bash
node tools/generate.js
```

regenerates the 12 puzzles (`puzzles/`) and `PUZZLES.md`. It's deterministic and takes about 5 s.

```bash
node tools/selftest.js 3000
```

cross-checks the solver against brute force, and every logical deduction against the full
solution set.

## Interface

- **Play**: click to toggle a firebreak; Shift+click or right-click marks a cell "open" (a
  note only). Undo/Redo (also Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z), Reset, Hint (next logical
  deduction, with the technique and reason, or points out wrong marks), Check (mode B),
  live simulation (mode A), Replay (animates the burn tick by tick; scrub with the slider).
- **Editor**: paint burnable cells, walls and sources; place the solution's firebreaks; add
  clues (blank t = take the time from the solution). Tools: auto-time clues, clue every cell,
  minimize clues (greedy, keeps uniqueness), random puzzle from the generator, playtest, save
  to list (localStorage), export/import JSON, separate undo/redo.
- **Developer view**: every valid solution (exhaustive, up to 64) as mini boards, solutions
  with fewer firebreaks than the budget, the logical analysis (rounds, techniques, flags), and a
  clickable deduction log that highlights cells on the board. There are also a solution
  overlay, a mode-B time peek, and a deep (L5) analysis button.

## Files

- `engine.js`: simulation, exhaustive solver, logical deducer, generator. Runs in both the
  browser and Node.
- `ui.js`, `index.html`: the test interface.
- `tools/generate.js`, `tools/selftest.js`: the puzzle set build, and the soundness tests.
- `PUZZLES.md`: the 12 puzzles, each with its required deduction patterns, a full deduction log,
  flags, and generator statistics.

## How it works

**Solver.** Branch and bound over the candidate cells. The core fact: *adding firebreaks never
makes any cell ignite earlier*. So with the unknown cells treated as open you get a lower bound
on every ignition time, and with them treated as blocked you get an upper bound. A branch dies
when some clue's lower bound is already too late or its upper bound already too early. Leaves
are verified exactly. It handles 7×7 boards in milliseconds.

**Generator.** Random walls and sources; plant *k* firebreaks, each where it changes at least one
ignition time. Start from every possible clue (trivially unique), then remove clues greedily
while the puzzle stays unique *and* no smaller firebreak set satisfies the clues. Reject
trivial puzzles. Each slot collects 40 accepted candidates and picks one by difficulty tier.

**Deducer (the difficulty model).** Each round applies the cheapest technique level that finds
anything:

| Level | Techniques | Idea |
|---|---|---|
| 0 | Budget exhausted / fill | counting |
| 1 | Early-arrival block, Leak seal, Lone predecessor, Detour too long, Sole corridor | one cell, fire from sources only |
| 2 | Relay block, Relay leak seal, Held-back front | combine clues: a clue cell is a secondary fire source, or a hold on the front |
| 3 | Forced cut, Budget squeeze, Last firebreak | route reasoning against the budget |
| 4 | Shallow contradiction | one-step trial and error (flagged) |
| 5 | Deep contradiction | nested trials (flagged as guessing) |

A puzzle is **trivial** if levels 0-1 solve it in at most 2 logic rounds, or if the first round
resolves 85% or more of the cells.

## Design findings

- **On open ground a lone firebreak does nothing.** Manhattan detours around a single block
  tie in length, so a firebreak only matters next to walls or other firebreaks. Before the
  generator planted only effective firebreaks, 95% of random plantings were redundant.
  Puzzles need corridors: about 20% wall density works well.
- **Monotonicity is the whole game.** Every sound technique found so far comes from the fact
  that blocking more never speeds fire up. Single-cell tests against those bounds are the
  basic move.
- **The interesting middle is clue-to-clue reasoning.** With only source-based reasoning,
  most minimal-clue puzzles jumped straight from easy deductions to trial and error. Two
  human-style ideas closed most of that gap:
  - *relay*: "this clue burns at 6, so it lights its neighbours by 7";
  - *hold*: "this clue can't burn before 14, so fire routed through it is late".
- **Never-burn and `≥` targets create route squeezes.** A `≥14` target near a source can need
  two separate firebreaks on two disjoint routes. When the disjoint routes use up the budget,
  every other cell is open (A3 is the clearest example).
- **Still missing: shared firebreaks.** In the flagged rejects (appendix of `PUZZLES.md`), one
  firebreak has to serve two clues at once, and their routes overlap. That is a natural next
  technique to try.
- **Mode A vs B.** At minimal clues, A puzzles lean on inequalities and never-burn targets,
  which favour leak seals and squeezes. B puzzles lean on exact times, which favour lone
  predecessor and detour reasoning, plus the exact-count budget fill.

## Status of the generated set

All 12 puzzles have unique solutions, no solution with fewer firebreaks, and are not trivial.
All 12 solve by pure deduction with techniques up to level 3; none needed trial and error. About
12% of accepted candidates did need a one-step contradiction; selection passed over them, and
`PUZZLES.md` shows two of them as flagged examples.
