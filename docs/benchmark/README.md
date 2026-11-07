# GASP accuracy benchmark

Does an AI model answer a SaaS metric question correctly over a warehouse, and how much does the GASP semantic layer help? First run 2026-11-07. The runner is `gasp-wiki-mcp/scripts/benchmark.ts`; every answer, its SQL and its grade are in the JSON beside each report.

## Result (2026-11-07)

24 questions, one per Core metric with a canonical formula, each "What was <metric> for March 2026?" over the GASP synthetic SaaS warehouse (53 tables, PGlite). Five runs per question per condition per model, effort medium, adaptive thinking, no fallbacks. A run is correct when its SQL returns one row and one column within 1e-6 relative of the canonical value.

| Model | Raw schema | With the GASP definition | The GASP tools |
|---|---|---|---|
| Claude Sonnet 5.5 | 60.0% (72/120) | **100%** (120/120) | |
| Claude Opus 5.5 | 70.0% (84/120) | **100%** (120/120) | |
| `generate_query` | | | **100%** (24/24) |

Cost of the run: about $6 (480 calls, the schema served from cache). Report: `results-2026-11-07.md`.

## What the raw failures were

Every raw miss was read. None was a grading artefact and none was a syntax problem (one SQL error in 240 raw runs). Each was the model computing a plausible metric of the same name with a different definition:

- **CAC**: costs tagged with the `acquisition` lifecycle attribution over customers by acquisition date, instead of the go-to-market cost function over new-business events. 3,350 against 3,000, every run, both models.
- **Carry MRR**: MRR read at the period end, or at the start without the movements netted out.
- **Gross Margin**: a guessed COGS label that matches no row, so 1.0.
- **NRR**: per-subscription start and end columns summed, so 1.0; or the wrong cohort.
- **NPS**: the wrong survey population and the score as a fraction rather than points.
- **LTV, LTV:CAC, CAC Payback**: inherit the CAC and churn definitions above, or divide by a churn of zero.
- **Expansion MRR** (Sonnet): filtered on the classification column instead of the event type, so 0.

This is the divergence Ordway measured across public SaaS companies (48 of 97 use different NRR formulas), reproduced by a model over one warehouse: the schema does not say what a metric means, and a capable model fills the gap with a reasonable guess that is not the standard's.

## Conditions

- **raw**: the `CREATE TABLE` statements for all 53 tables and the question. The text-to-SQL baseline. The warehouse uses renamed columns (`booked_on`, `account_ref`, `snapshot_day`, `lifecycle_status`), as real schemas do.
- **gasp**: the same plus the GASP definition of the metric: its canonical formula in the standard's grammar, the canonical formula of every metric it references (transitively), how to read the grammar, the fields and datasets it reads, and the table and column each maps to. The semantic layer as context.
- **layer**: the compiled SQL `generate_query` returns for the metric and period, run as is. The layer answering directly. 100% by construction, shown because it is what a client that calls the tools gets.

The same system prompt in every model condition states the period convention (a month is its inclusive calendar range), that ratios are decimals and money is in stored units, and how snapshot tables are read. SQL that is not a single `SELECT` is refused unrun. The grader also recognises an answer off by a factor of 100 as its own category; none occurred.

## Caveats

- **Synthetic data, one month, 24 questions.** The warehouse is the standard's seeded fixture, not a customer's. March 2026 was chosen because every Core metric but Rule of 40 (whose one-year lag has no data) has a value. More periods, more departments and the derived questions ("what drove NRR down?") are the next rounds.
- **The judge is a model vendor's own models.** Both conditions were run on Claude. A cross-vendor run is the obvious follow-up.
- **The GASP context includes the mapping.** The layer condition and the GASP condition both know which column each field lives in, because that is what a semantic layer holds. The raw condition has the column names only. That is the comparison the benchmark is about; it is not a test of schema linking in isolation.
- **Run 1 (`results-2026-11-07-run1`)** had a weaker GASP context: the formula of the asked metric without the formulas of the metrics it references. Sonnet missed CAC Payback five times out of five by guessing what CAC meant; Opus did not. The context was corrected to carry the referenced definitions, which the layer holds, and the whole benchmark rerun. Both runs are kept.
- **The NPS instruction.** The shared system prompt asks for ratios as decimals; GASP's NPS is in points. In the raw condition both models returned a fraction over the wrong population, so the miss stands on the population, but the unit instruction is one more thing the raw condition had to guess that the GASP context states.

## Reproduce

```bash
cd gasp-wiki-mcp && npm run build
npx tsx scripts/benchmark.ts --dry-run                     # questions, truth and the layer condition, no API calls
npx tsx scripts/benchmark.ts --runs 5 --models claude-sonnet-5-5,claude-opus-5-5
```

The runner reads `ANTHROPIC_API_KEY` from the environment or from `gasp-wiki-mcp/.env`. Flags: `--runs`, `--models`, `--concurrency`, `--questions N`, `--show <metric id>` to print one prompt.
