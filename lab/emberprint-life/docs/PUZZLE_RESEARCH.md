# Emberprint: puzzle research report

**Question:** can Conway's Game of Life (B3/S23) produce placement puzzles that are solved by
reasoning rather than by trying things?

**Short answer from this prototype:** yes, within a narrow band.

- **What works:** with 1-2 generations, 2-3 flames and 4-6 editable cells, the generator finds
  unique puzzles that a rule-based analyzer solves through chains of 3-11 human-readable
  neighbour-count deductions.
- **Where it gets harder:** at 3 or more generations, almost every unique puzzle needs a
  bounded local search (try a handful of cases in a small area) rather than a one-line
  deduction.
- **The physical limit on distance:** a lantern can never be more than T cells from the
  starting flames, because Life patterns grow at most one cell per generation.

Every claim below is tagged **[demonstrated]** (measured by code in this repository) or
**[hypothesis]** (needs human playtesting).

---

## 1. Implemented mechanics

| Module | File | Notes |
|---|---|---|
| Conway engine | `src/core/board.ts` | B3/S23, 8 neighbours, finite non-wrapping grid, immutable frozen boards, `step` / `simulate` |
| Puzzle model | `src/core/puzzle.ts` | Locked flames, editable cells, budget (at most *k*), objectives; every objective compiles to "cell X is burning or dark at gen g" facts |
| Validator | `src/core/validate.ts` | Legality, and a per-objective explanation of every success or failure in neighbour-count terms |
| Solver | `src/core/solver.ts` | Exhaustive enumeration of 0..k flames on the editable cells |
| Deduction analyzer | `src/core/deduce.ts` | Human-style rules with readable traces; never consults the solver |
| Generator | `src/core/generate.ts` | Seeded and reproducible |
| Player UI | `src/ui/Player.tsx`, `Board.tsx` | Place, Ignite, pause/step/scrub, reset (keeps placements), undo/redo, live objective status, explanations |
| Developer lab | `src/ui/Lab.tsx` | Editor, solution enumeration, trace viewer, generator, batch tool, JSON import/export, saving |

All game logic lives in `src/core/` with no React or DOM imports, so it can be ported to Swift.

Objective types:

- **Lantern**: lit at gen T, or *first* lights at gen T (dark at every earlier generation). These
  are different constraints, and the solver tests cover the difference.
- **Protect**: dark for every generation in [a, b].
- **Clue**: burning or dark at gen g.

## 2. Simulation correctness [demonstrated]

`npm test` runs 84 tests in three files.

- **`tests/board.test.ts`:**
  - the exact birth and survival tables for 0-8 neighbours;
  - block, beehive and boat still lifes;
  - blinker and toad (period 2);
  - glider translation by (1,1) every 4 generations;
  - L-tromino to block;
  - edge behaviour (a blinker against the edge loses its outside cell, opposite edges don't
    interact, a corner block survives);
  - immutability (frozen output, input unchanged);
  - agreement with an independent set-based implementation on 500 random boards over 6
    generations.
- **`tests/solver.test.ts`:**
  - subset enumeration is exact;
  - the solver matches an independent brute force (all 2^|E| subsets, checked by the
    validator) on 400 random puzzles;
  - minimum-flame, exact-budget and lantern-only reporting are correct;
  - **analyzer soundness:** on 600 random puzzles, every deduced fact (at every generation, not
    just the start) holds in every solution, and whenever the analyzer finishes, its placement
    equals the unique solution.
- **`tests/content.test.ts`:** every shipped puzzle:
  - is well formed;
  - has exactly one solution, equal to the intended one;
  - needs the full budget (no simpler unintended solution);
  - has no redundant objective (removing any one breaks uniqueness);
  - is solved by the analyzer without branching.

  The generator is reproducible from a seed, and every generated puzzle regenerates
  bit-for-bit from its stored parameters.

## 3. Solver and generator methodology

**Solver.** It enumerates every placement of 0..k flames on the editable cells (C(|E|,≤k)
placements). Each placement is simulated generation by generation, with an early exit on the
first violated fact. It reports:

- solvable or not, and the total count;
- counts by flame number, and the minimum number of flames;
- whether the exact budget is required;
- unintended solutions;
- *lantern-only* placements: ones that light every lantern but break a protect or clue
  objective. This shows how much the negative objectives do.

Shipped puzzles have 4-64 placements, the experiments go up to 130, and each solves in about a millisecond or less. Exhaustive search
is enough at this scale, so a SAT or constraint-programming backend was not justified.

**Generator (seeded).**

1. Grow a compact editable region and put locked flames within 2 cells of it.
2. Pick a hidden placement of exactly *k* flames. Retry up to 12 times if it dies out.
3. Choose lanterns among cells burning at the final generation, with the "first lights"
   variant when it applies.
4. While more than one placement (of any size ≤ k) remains, add the candidate objective that
   eliminates the most placements (another lantern first, then protect, then clue).
5. Drop every objective that uniqueness doesn't need. This removes redundant clues and also
   guarantees that no placement with fewer flames works.
6. Run the analyzer and reject:
   - **too few possibilities:** fewer than 8 placements;
   - **trivial:** solved in one round of direct neighbour counting;
   - **needs guessing:** the analyzer is stuck;
   - **needs branching:** a hypothesis is required.

**Difficulty** is the sum of step weights over the trace plus the number of logic rounds. It
comes from deduction complexity, not board size or generation count. The thresholds are
uncalibrated **[hypothesis]**.

## 4. The deduction analyzer

**Knowledge.** The analyzer keeps a grid of cell states for every generation: burning, dark or
unknown. Generation 0 is known except for the editable cells, and objectives fix the facts they
name. Each cell's next state is a local constraint over its 3×3 neighbourhood. Rules are tried
cheapest first, and each round applies everything found at the cheapest productive level.

| Level | Rule | What a human does |
|---|---|---|
| L0 | Forward simulation, Budget spent | "These cells can't reach 3 burning neighbours, so they stay dark." "All flames placed." |
| L1 | Neighbour count | "C4 must ignite at gen 1, so exactly 3 starting neighbours burn. Two already do, so the last undecided one must burn." |
| L2 | Working backwards | The same reasoning between gen g and g+1 for g ≥ 1, deducing intermediate states and walking them back to the start. |
| L3 | Overlapping neighbourhoods | Two count constraints that share undecided cells, combined (Minesweeper subset logic). |
| L4 | Lookahead | A fact at gen g depends only on starting cells within g steps. With at most 6 undecided cells there, try each arrangement and simulate that small area. **Sound, but this is search.** |
| L5 | Hypothesis | Assume a placement, propagate L0-L4, reach a contradiction. **Branching.** |
| L6 | Nested hypothesis | **Guessing.** |

**Verdicts:**

- **trivial:** one round at L1;
- **logical:** L1-L3 only;
- **lookahead:** needs L4;
- **branching:** needs L5 or more;
- **stuck:** cannot finish.

Only "trivial" and "logical" count as pure deduction here. Exhaustive uniqueness is never treated
as evidence of human solvability.

## 5. Shipped puzzles (15) [demonstrated]

The full boards, solutions, counts and complete traces are in
[`puzzle-samples.md`](puzzle-samples.md), generated from the shipped data. All are 7×7, and `npx vite-node scripts/table.ts` reprints this table. Every one
has exactly 1 solution, needs its full budget, and has no redundant objective.

| id | title | tier | budget | gens | objectives | placements | lantern-only* | analyzer | logic rounds |
|---|---|---|---|---|---|---|---|---|---|
| t1 | Spark | tutorial | 1 | 1 | 1 lantern | 4 | 0 | trivial (L1) | 1 |
| t2 | Keep it burning | tutorial | 1 | 1 | 1 lantern | 4 | 0 | trivial (L1) | 1 |
| t3 | Smother | tutorial | 1 | 1 | 1 lantern + 1 protect | 4 | 3 | trivial (L1) | 1 |
| t4 | Blinker | tutorial | 1 | 2 | 2 lanterns | 5 | 0 | lookahead (L4) | 1 |
| e1 | Kindling | easy | 2 | 1 | 2 lanterns + 1 protect | 11 | 1 | logical (L1) | 3 |
| e2 | Ember Row | easy | 3 | 1 | 2 lanterns + 1 protect | 26 | 2 | logical (L1) | 3 |
| e3 | Two Sparks | easy | 3 | 2 | 1 lantern | 26 | 0 | logical (L2) | 2 |
| e4 | Cinder Gate | easy | 2 | 1 | 3 lanterns | 16 | 0 | logical (L1) | 3 |
| m1 | Lantern Walk | medium | 2 | 3 | 1 lantern + 3 protect + 1 clue | 22 | 7 | logical (L2) | 8 |
| m2 | Smoulder | medium | 2 | 3 | 1 lantern + 2 protect + 1 clue | 16 | 10 | logical (L3) | 7 |
| m3 | Crossfire | medium | 3 | 3 | 1 lantern + 3 clues | 64 | 28 | logical (L3) | 7 |
| m4 | Afterglow | medium | 3 | 2 | 1 lantern + 1 protect + 1 clue | 42 | 6 | logical (L3) | 7 |
| h1 | Slow Burn | hard | 3 | 4 | 1 lantern + 1 protect | 42 | 2 | lookahead (L4) | 12 |
| h2 | Wildfire Map | hard | 3 | 4 | 1 lantern + 2 clues | 42 | 4 | lookahead (L4) | 10 |
| h3 | Far Lantern | hard | 3 | 4 | 1 lantern | 42 | 0 | logical (L3) | 11 |

\*Lantern-only: placements that light every lantern but violate a protect or clue objective. It
measures how much work the negative objectives do.

The quota was met without padding, but the margin differs by tier.

- **Easy (188 qualifying candidates) and hard (288):** these tiers had a comfortable surplus.
- **Medium:** only 73 of 6,000 seeds qualified. Medium required pure deduction with at least
  two objectives and either an overlap step or three or more rounds.
- **Hard:** two of the three hard puzzles need lookahead. Pure-deduction hard puzzles with a
  distant lantern are rare (h3 is one).
- **Tutorials:** they are hand-designed. Tutorials 1-3 are deliberately trivial, one rule each.
  Tutorial 4 needs lookahead: the analyzer has no "this is a blinker" rule. A human who has
  just read the blinker hint probably would not need one **[hypothesis]**.

### Sample traces (verbatim analyzer output, abridged)

**t1 Spark (trivial):**

> D4 must be burning at gen 1. It is dark at gen 0, so exactly 3 of its neighbours must burn at gen 0. Burning at gen 0: C3, E3; undecided: D5 (the rest are dark). So D5 must hold a flame.

**m2 Smoulder (logical, 7 rounds):** a gen-3 lantern, a gen-1 clue and two protected cells.

1. *Overlapping neighbourhoods:* C6 must stay dark at gen 1, and B7 must ignite at gen 1. They
   share undecided B6, which forces B5 empty and B6 burning.
2. *Working backwards:* D6 must burn at gen 3 and is burning at gen 2, so it needs 2-3
   neighbours. Only C7 is undecided, so C7 burns at gen 2.
3. *Working backwards:* C7 burns at gen 2 and is dark at gen 1, so it needs exactly 3 neighbours
   at gen 1, which forces B6 burning at gen 1.
4. …B4 must stay dark at gen 2, which forces B5 dark at gen 1, which forces A6 empty.
5. *Neighbour count:* B7 must ignite at gen 1. Burning at gen 0: B6, C7. Undecided: A7, so A7
   holds a flame.

This is the intended experience: an early clue and a late lantern each eliminate different
cells, and the protected cells supply "forbidden birth" constraints.

**h3 Far Lantern (logical, 11 rounds):** one lantern at gen 4, three cells from the editable
region, and nothing else. The analyzer walks backwards one generation at a time:

> E6 must be burning at gen 4. It is dark at gen 3, so exactly 3 of its neighbours must burn at
> gen 3 … undecided: D5, D6, D7. So all three burn at gen 3.

Then D7 at gen 3 forces C6, D6 and C7 at gen 2, and so on, down to the starting placement. It is a
genuine "the target pulls the fire towards it" deduction.

## 6. Research questions

Data: [`research-data.md`](research-data.md) (`npm run research`, 600 seeded candidates per
row). Baseline: 7×7, budget 2, 6 editable cells, 3 locked flames.

### Q1. Can players infer initial placements from future target constraints?

**[demonstrated]** for the analyzer, **[hypothesis]** for people.

- One lantern alone is weak. Over all generated boards, a single lantern is satisfied by a
  median of 6 placements at T=1, and 3 at T=2-3. It is unique only 9-25% of the time.
- The generator adds about 0.6 extra objectives on average (mean 1.6-1.7 objectives per unique
  puzzle).
- When the analyzer does solve a puzzle, it infers the placement entirely from future facts,
  with traces like h3's.

### Q2. Are one-generation puzzles too trivial?

**[demonstrated]**

- At T=1, every unique puzzle is solvable by pure deduction (117/117), but 63% are trivial (one
  round of neighbour counting) and get rejected.
- The rest chain 2-3 counts, Minesweeper-style (e1, e2).
- T=1 puzzles never exercise time: they test the birth/survival table and nothing else.

So they are not *too* trivial as tutorials and easy puzzles, but they're shallow. Whether
chained neighbour counting stays fun across many levels is a **[hypothesis]**.

### Q3. Do multi-generation puzzles become unpredictable rather than interesting?

**[demonstrated]** for the analyzer. Among unique puzzles, the share solvable by pure deduction
(L1-L3) falls steeply with generations:

| generations | solvable by pure deduction |
|---|---|
| T = 1 | 100% |
| T = 2 | 20% |
| T = 3 | 8.5% |
| T = 4 | 2.4% |

Most of the rest are solved by L4 lookahead (26% → 41% of all candidates). In this experiment,
at most 0.5% of candidates needed branching and none left the analyzer stuck.

So multi-generation puzzles don't become *chaotic* in the sense of requiring blind guessing. They
become *opaque*: a gen-3 lantern is decided by the joint behaviour of every starting cell within
3 steps, and the shortest honest explanation is "simulate these 8-32 cases".

Mean objectives don't grow with T (about 1.6). That's a warning sign: one late lantern pins the
answer while giving the player almost nothing to reason from.

Whether players experience L4 as satisfying mental simulation or as tedious trial is the
central open **[hypothesis]**.

### Q4. Does requiring a distant target encourage meaningful pattern construction?

**[demonstrated]:** the distance is physically capped. A lantern lit at gen T is at most T cells
from some starting flame. Distance from the editable region can only exceed that by relaying
through locked flames.

- With small budgets and random generation, the mean lantern distance is about 1.1, and only
  9% of lanterns sit at the maximum distance T.
- Preferring the farthest lantern ("distant" mode) barely changes this, because few cells far
  from the region are alive at gen T at all.
- Gliders, the classic "carry information across the board" pattern, need 5 cells and move one
  cell per 4 generations. That is out of reach at 1-3 flames, 4 generations and 7×7.
- Distant lanterns do exist when searched for: h1-h3 reach distance 3 at T=3-4, through
  expanding growth, not travelling patterns.

**[hypothesis]:** these are the most satisfying puzzles, since the fire visibly crosses the
board, but at current parameters they're rare and mostly need lookahead.

### Q5. Do negative clues make puzzles more satisfying?

**[demonstrated]:** they are structurally necessary. With lanterns only, 112 of 600 baseline
boards can be made unique. Adding the other objective types (same seeds) helps a lot:

| objectives allowed | unique boards (of 600) |
|---|---|
| lanterns only | 112 |
| + protect | 158 |
| + clues | 209 |

Of the unique puzzles, 47% use at least one protect or clue objective. In the shipped set, they
eliminate up to 28 lantern-only placements (m3).

They also create the readable deductions:

- protected cells give "forbidden birth" steps (t3, e1);
- early clues give anchor points for working backwards (m2).

They don't raise the share of pure-deduction puzzles (17% → 15-19%).

**[hypothesis]:** "satisfying" can only be answered by playtesting.

### Q6. Can we generate puzzles that require several deductions without guessing?

**[demonstrated]:** yes, but at a low rate.

- About 5% of baseline candidates are non-trivial pure-deduction puzzles.
- Curated medium puzzles need 7-8 rounds of L1-L3, and h3 needs 11.
- Generation is fast (about 200 candidates per second), so a low rate costs little: the content
  build searches 18,000 seeds in about a minute.

### Q7. Is pattern recognition becoming more important than reasoning?

**[demonstrated]:** not required.

- The analyzer uses only neighbour counts and never names a pattern.
- Among accepted puzzles, the intended configuration has settled into a still life by the final
  generation in 31.5% of cases, and into a period-2 oscillator in 8.2%.

So named patterns appear naturally and would let an experienced player shortcut steps (for
example, spotting that a configuration "becomes a block"). **[hypothesis]:** experienced Life
players will chunk patterns and find the T ≥ 3 puzzles much easier than newcomers do. That would
make difficulty depend on prior knowledge.

### Q8. How much placement freedom should players have?

**[demonstrated]**

- **Budget 1 fails.** 65% of boards die out, and the rest offer too few choices.
- **Sweet spot: budget 2-3 with 4-6 editable cells (11-42 placements).** "Budget 2, 4 editable"
  gives the highest pure-deduction share (13% of all candidates, 29% of unique ones).
- **Larger regions push puzzles towards guessing.** With 9 editable cells, branching plus
  stuck rises to 7%, and with budget 3 and 9 cells, 47% of boards can't be made unique at all.

So more freedom means more combinatorics, not more interesting reasoning.

## 7. Where the analyzer gets stuck [demonstrated]

Stuck cases are rare (36 of 2,669 unique candidates) and close to **all-or-nothing**: when the
analyzer stopped, a mean of 8 editable cells were still undecided, in regions of 4-9 editable
cells. It barely gets started.

Typical case, seed 132 (5×5, budget 2, T=2, 29 placements):

```
   A B C D E
 1 . ? . . .
 2 ? ? L . .        L: lantern C2 lit at gen 2
 3 ? ? # . .        #: locked flame
 4 ? ? . . .        ?: 7 editable cells
 5 . . . . .
```

- All 7 editable cells are within 2 steps of the lantern. That exceeds the 6-cell lookahead
  window.
- No gen-1 fact is known, so neither neighbour counting nor working backwards has a foothold.
- The solver finds exactly one answer, but the only honest explanation is "try the 29
  placements". **This is a puzzle the generator correctly rejects.**

Branching case, seed 102 (T=2, budget 3): the analyzer must assume "D3 stays empty" and follow 4
deductions to a contradiction (C1 could not burn at gen 2). After that, everything is direct.
A human would face the same fork.

## 8. Common trivial patterns [demonstrated]

Trivial puzzles made up 164 candidates in the experiments. 95% were decided by a **single**
neighbour-count step, and 45% had T=1. The recurring shapes:

1. **Missing third neighbour.** A lantern next to two locked flames and one editable cell (the
   t1 shape).
2. **Overcrowded protect.** A protected cell that will be born unless one more flame crowds it
   (the t3 shape).
3. **Budget closes it.** After one forced flame, "budget spent" settles every other cell.

Also discarded: boards that die out (13-65% depending on budget) and boards where every live
final cell is locked or editable ("no lantern candidate", 8-36%).

## 9. Design limitations

- **The analyzer is a model of human reasoning, not a measurement of it.** The rule levels and
  difficulty weights are my judgement. Nothing has been calibrated against players.
- **L0 bookkeeping hides work.** Steps like "the rest are dark at gen 3" rely on forward
  simulation of cells far from the action. A person has to compute that too, and on busy boards
  it isn't free. Traces therefore understate effort at T ≥ 3.
- **L4 lookahead sits between deduction and search.** I report it separately rather than as
  "logical". Two shipped hard puzzles and the blinker tutorial depend on it.
- **Generator biases:**
  - editable regions are always compact blobs;
  - lanterns sit only at the final generation;
  - objectives are chosen greedily by elimination power, so clue sets can feel arbitrary;
  - the "first lights" variant is rare in practice.
- **Small parameter space.** Experiments cover 7×7 boards, at most 4 generations and at most 3
  flames, exactly as specified. Conclusions may not extend to larger boards.
- **Budget is "at most k" in the rules, but every shipped puzzle needs exactly k.** The analyzer
  only uses the sound "at most" form, while players may (correctly but unprovably) assume
  "exactly".
- **The UI has no annotation layer.** Players can't record deduced intermediate states, which is
  exactly what the successful traces do.

## 10. Recommended mechanical changes

1. **Make the budget exact ("place exactly k flames").** It's already true of every shipped
   puzzle, it removes doubt, and it allows a sound "budget fill" deduction.
2. **Add per-generation pencil marks.** Let players mark a cell as "burning at gen 2" or "dark
   at gen 1" on a ghost layer, which mirrors L2 working-backwards. This is the single change most
   likely to turn T ≥ 2 from opaque into deducible.
3. **Keep core puzzles at T ≤ 2 and give T ≥ 3 checkpoints.** Use intermediate lanterns or clues
   (gen 1, gen 2, …), so each step stays local. Late lanterns alone produce lookahead puzzles.
4. **Limit freedom:** 4-6 editable cells and budget 2-3, or roughly 10-45 placements.
5. **Treat distance as a T-budget, not a geometry goal.** Distance ≤ T always. For a "reach the
   far lantern" fantasy, add more generations with checkpoints, or locked "fuse" flames that
   relay fire. Don't just make the board bigger.
6. **Replace "first lights at T" with explicit "dark until T" checkpoints, or drop it.** It's a
   compound constraint that players will misread as a plain lantern.

## 11. Three promising directions

1. **Time-layered deduction (the "Sudoku of time").** Show the board at gens 0-T side by side
   and let players fill in states at any generation, with clues scattered across generations.
   The analyzer's best traces (m2, h3) already have this shape. A generator target of "L1-L2
   only, but across 3 generations" is cheap to add.
2. **Checkpoint chains.** A sequence of lanterns at gens 1, 2, 3, … stepping across the board.
   Each link is a local neighbour-count problem, while the chain delivers the distant-target
   fantasy that the speed-of-light limit otherwise blocks.
3. **Rule variants with more local determinism.** Test Life-like rules (e.g. B36/S23, or rules
   with smaller birth sets) for higher pure-deduction rates at T ≥ 2. The engine, solver,
   analyzer and generator are parameterised only by `nextState`, so this is a small experiment.
   Measure it with `npm run research` before committing to a rule.

## 12. Demonstrated vs requires playtesting

**Demonstrated by code and tests:**

- the simulation is correct (standard patterns, edges, cross-check);
- the solver is exact (matches brute force);
- the analyzer is sound (no fact contradicts any solution);
- all 15 shipped puzzles are unique, minimal, free of redundant objectives, and solvable without
  branching;
- the generator is reproducible;
- all the rates and distributions in §6-8.

**Hypotheses that need playtesting:**

- that analyzer traces resemble how people actually solve;
- that L4 lookahead feels like reasoning, not trial;
- the difficulty thresholds;
- that negative clues and distant lanterns are *satisfying*;
- that pattern-literate players get an unfair shortcut;
- that per-generation pencil marks fix T ≥ 3.

## 13. Reproducing everything

```
cd life
npm install
npm test                 # 84 tests
npm run dev              # app at http://localhost:5173 (Lab at #/lab)
npm run research         # regenerates docs/research-data.md
npm run content          # re-curates src/content/generated.ts
npm run gen -- 400 1     # batch-generate 400 candidates from seed 1
npx vite-node scripts/samples.ts   # regenerates docs/puzzle-samples.md
```
