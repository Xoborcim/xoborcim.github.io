# Emberprint (Game of Life puzzle prototype)

Place a few flames, press **Ignite**, and Conway's Game of Life (B3/S23, finite grid) decides
whether the golden lanterns light, protected cells stay dark, and temporal clues hold.

An experiment in whether Life can carry *deduction* puzzles. Findings:
[`docs/PUZZLE_RESEARCH.md`](docs/PUZZLE_RESEARCH.md).

```bash
npm install
```

```bash
npm run dev
```

opens the player at http://localhost:5173 (developer lab at `#/lab`). Then:

```bash
npm test
```

## Layout

- `src/core/`: framework-free logic, intended to port to Swift.
  - `board.ts`: Conway engine (immutable boards).
  - `puzzle.ts`: puzzle model; objectives compile to cell/generation facts.
  - `validate.ts`: checks a placement and explains each result.
  - `solver.ts`: exhaustive solver (counts, minimum flames, unintended and lantern-only
    solutions).
  - `deduce.ts`: human-style deduction analyzer with readable traces and honest verdicts
    (trivial / logical / lookahead / branching / stuck).
  - `generate.ts`: seeded generator with rejection filters.
- `src/content/`: 4 hand-made tutorials, plus 11 curated generated puzzles (`npm run content`).
- `src/ui/`: React player and developer lab.
- `scripts/`:
  - `batch.ts` (`npm run gen`)
  - `research.ts` (`npm run research`)
  - `buildContent.ts`
  - `samples.ts`
  - `table.ts`
  - `inspect.ts [seed]`
- `tests/`: engine, solver, analyzer-soundness and content tests.

Player controls: tap outlined cells to place flames · Space ignites or pauses · ←/→ step ·
R resets (keeps your flames) · Cmd/Ctrl+Z undo, Shift+Cmd/Ctrl+Z redo.
