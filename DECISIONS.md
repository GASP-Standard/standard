# GASP Standard — Decisions

Architecture decision records for the GASP Standard project (gaspwiki.com site +
gasp-wiki-mcp server). Append new entries at the top.

---

## [2026-10-13] The standard is published through a read-only mirror, and the standard and MCP server stand alone
**Decision:** The monorepo (`GASP-Standard/gasp`, private) keeps the website. A GitHub Actions workflow mirrors the public parts, `standard/`, `gasp-wiki-mcp/`, the decision documents, `DECISIONS.md` and the Ossie spec, to `GASP-Standard/standard` (public, read-only) on every push to `main`, with a README, a test workflow and a source-commit marker written for the mirror. To make the mirror self-sufficient, the two inputs the MCP package read from the frontend move into `/standard/`: `relationships.json` is canonical there and carries each metric node's page `slug` and each entity's glossary `definition`, and every derived artefact (Cypher, adapter template, Ossie files) is written to `standard/exports/`. The website copies all of it, and the data bundle, into its own tree at build time; those copies are generated and ignored by git, as the content files already were.

**Context:** The owner wanted the standard public and the site code private. The alternatives were a public monorepo (site code, wireframes and working notes visible, no root README, one licence file for two licences) or a split into two repos with a sync mechanism, which would undo the single-source pipeline built this week. Before this change `loadStandard()` read `relationships.json` and `metric-links.ts` from the frontend and `npm run derive` wrote into `frontend/public`, so the MCP package could not build or test without the site.

**Alternatives considered:**
- **Public monorepo after a tidy.** Rejected by the owner: the site code need not be public.
- **Two repositories with a submodule or npm dependency between them.** Rejected: the consistency tests span the standard, the server and the site, and a submodule makes every content change a two-step commit.
- **Mirror with the frontend data files copied in at their old paths.** Rejected: a stub `gasp-wiki-frontend/` folder in the public repo would confuse readers, and the coupling was wrong in the first place.

**Consequences:**
- The MCP package's test suite passes from a tree containing only `standard/` and `gasp-wiki-mcp/`; the URL test skips its frontend checks when the site is absent.
- The npm `repository` field, the MCP registry manifest and the held-back site links point at the mirror, which is where the source is public.
- The mirror needs one secret, `MIRROR_PUSH_TOKEN`, scoped to the public repository. Issues opened on the mirror are answered there; changes land in the monorepo and appear with the next push.
- `gasp-wiki-frontend/public/api/*.json`, `public/downloads/**`, `public/schemas/**`, `src/data/relationships.json` and `src/data/metric-links.ts` are no longer tracked. Cloudflare builds regenerate them, as they already did for the content files.

---

## [2026-10-13] The Ossie export is generated, every formula is direct or staged, and GASP checks what the upstream validator does not
**Decision:** `npm run derive` writes three Apache Ossie (incubating) documents from `/standard/`: an ontology (every dataset and GASP concept an entity type, every field a value type or a relationship, enum values as `requires` constraints, snapshot fields as ternary relationships with a Date role), a reference semantic model (the 47 datasets with `OSSIE_SQL_2026` field expressions, foreign keys as relationships, every canonical formula as a metric) and the mapping between them. A formula is exported as a direct portable expression when it is arithmetic over aggregates on event or fact datasets with no period bound in the filter, or a snapshot aggregate at period end. Anything else (cohort, lag, window, to_date, all_time, `at period_start`, a period bound inside a filter) is staged: a per-period dataset whose `source` is the compiled SQL over a `gasp.period_spine` table, and the metric is `SUM(<staged>.value)`. O/M forms and variants are separate metrics with the form in `custom_extensions`. GASP's own cross-reference checker runs inside the export and fails the derive step; the upstream validator is vendored and pinned and runs in tests when `uv` is present.

**Context:** The spike (`docs/ossie-spike.md`) found the upstream validator checks document shape, ontology references and SQL syntax only. It passes a metric that references a dataset that does not exist, a mapping that names concepts the ontology lacks, and a scalar subquery the expression language forbids. It also found that a dataset's `source` may be a query, which lets a staged table travel inside the model, and that Ossie metrics cannot name the reporting period, which is why 88 of 270 formulas (flow metrics on snapshots, `in_period(close_date)` and the like) are staged rather than direct.

**Alternatives considered:**
- **Per-entity staged tables (`gasp_account_cohorts` with one row per customer), as the spec sketched.** Rejected for now: a generic per-period scalar table works for every staged formula with no per-formula design and runs today; per-entity tables that allow slicing are a refinement once a consumer asks.
- **Inlining the compiled SQL as the metric expression.** Rejected: subqueries are outside the portable subset and the upstream validator would pass them anyway, which hides the problem.
- **Trusting the upstream validator as the gate.** Rejected: see the probe table in the spike.
- **Emitting `ANSI_SQL`.** Rejected: `OSSIE_SQL_2026` is the only dialect whose semantics Ossie defines; other dialects may be ignored by implementations.

**Consequences:**
- Coverage is 164 direct, 138 staged, 19 not computable. The staged reasons are the proposals to raise upstream: a period-bound construct or metric `filter` (88), a per-aggregate time offset (25).
- The semantic model is about 600 KB because each staged dataset carries its SQL. Acceptable for a download; revisit if a consumer needs the direct metrics alone.
- Three concept names collided and the value type took a `Value` suffix (`RevenueValue`, `TcvValue`, `OnboardingMilestoneValue`). Four `entityRelationships` edges are not exported because an end (license, plan, product, contact) has no dataset; eleven are exported without a mapping because no dataset carries both keys. Dataset-to-entity promotion closes both.
- Joins to fact datasets carry the date and match only the period's first day; backlog.
- `test/ossie-ontology.test.ts`, `test/ossie-model.test.ts` (every staged source executes on PGlite) and `test/ossie-check.test.ts` (the probe breakages) guard it; `test/derived.test.ts` fails when the four files are stale.

---

## [2026-10-13] NRR-M keeps the cohort, ARR-O is a trailing-year measure, forms can reference forms, and no two metrics point at each other
**Decision:** The ATL tags are encoded in the O and M forms. NRR-O counts expansion tagged `same_product` or `usage_realisation`; NRR-M counts all six `expansion_classification` values plus reactivation, and both forms keep the start-of-period cohort. ARR-O subtracts the pricing_adjustment and recontracting MRR change of the trailing twelve months for customers active at period end. At-Risk Rate keeps its health-score formula and gains an `entered_at_risk` variant on `state_category`. The grammar accepts `metric.<id>.O` and `metric.<id>.M`, so LTV-O reads `metric.gross_margin.O` rather than restating the contribution margin cost list. The CEL rules that every amendment that changes MRR also writes a `Revenue_Event`. In the graph, a curated edge may not run against a derived `component` edge between the same two metrics: four were deleted and three drivers of Expansion Revenue Rate re-pointed at Expansion MRR.

**Context:** `expansion_classification`, `lifecycle_attribution` and `state_category` were declared enum fields no formula read, and the `arr` and `nrr` notes said the tags were not canonical. `infer_drivers("Churned MRR")` ranked Contraction MRR and MRR as causes because the curated `revenue_churn_rate → churned_mrr` edge led traversal back through the ratio's own inputs. The decision document (`docs/decision-atl-tags-and-cycles.md`) recommended dropping the cohort from NRR-M so reactivation could count and an all-history horizon for ARR-O; the owner overruled both on industry grounds.

**Alternatives considered:**
- **Account-method NRR-M without a cohort.** Rejected: public SaaS filings and the Bessemer and KeyBanc benchmarks define NRR on the customers held twelve months earlier. A customer who churned before the window and returns is new business; one who churns and returns inside it is in the cohort already, so the cohort form counts the reactivation that matters.
- **All-history ARR-O.** Rejected: excluding price rises from ARR is a GASP construct, and where price and volume are separated elsewhere it is a growth decomposition over the period. An all-history balance drifts from ARR-M every year with no clear reading.
- **A `contribution_margin` metric for LTV-O.** Rejected in favour of form references: it would add a 301st metric and a second copy of GM-O.
- **Keeping the curated reverse edges and ignoring them in traversal.** Rejected: the diagram and Cypher would show edges traversal does not use.

**Consequences:**
- Five metrics carry O and M forms in `formulas.json` (ARR, NRR, CAC, LTV, Gross Margin). `analyzeFormula` reports a form reference as the bare metric, so graph edges and `structuredFormulas` do not change. `validateFormula` rejects a form the target does not declare.
- `get_formula` still lists the fields and datasets of the main formula only; showing what each form reads is in the backlog.
- Graph: 172 edges. `test/traversal.test.ts` fails if any two metric nodes gain edges in both directions. Expansion MRR now has direct drivers (Customer Health Score, QBR Completion Rate, PQAs).
- cel.md examples 3 and 4 show the paired Revenue_Event; the Revenue_Event table carries `expansion_classification`. atl.md's Churn-O row matches core.md (Revenue Churn Rate).

---

## [2026-10-13] Compiled SQL is executed in tests, placeholders carry their dataset, and the grammar gets windows
**Decision:** Three changes to the compiler pass, shipped together as MCP 1.12.0. (1) The test suite executes every fully mapped compiled template against a seeded fixture in an in-process Postgres (PGlite, `gasp-wiki-mcp/test/fixture/`, 20 customers over six months, seed 20260101) and checks ten metrics against values computed in plain TypeScript over the same rows. (2) Every field placeholder names the dataset it is read from, `{{customer_status@customer}}`; `fillTemplate` resolves each by its tag and `validate_adapter` scores coverage on exact (field, dataset) pairs. `exampleSql` strips the tag for display. (3) The grammar adds `window(expr, n unit)`, which replaces an event or fact aggregate's period filter with the n units ending at period_end (or the `at` point), and `all_time(expr)`, which drops the period filter so the where clause can bound rows relative to another field. Intervals are emitted in units Postgres accepts (a quarter is `3 month`).

**Context:** The server had never run the SQL it generates. Running it showed that the old filler, which parsed the compiled SQL with regexes to find each placeholder's dataset, left placeholders unfilled in 34 of 136 fully mapped templates (any WHERE clause with parentheses two deep, not only the NRR cohort subquery) while reporting every field mapped, and filled NRR's customer table with the subscription table's date column. DAU, WAU and MAU shared one formula, so DAU/MAU was always 1; the retention numerators were clipped to the period so week 8 and day 30 were zero; Magic Number's denominator was a period-length window rather than a quarter of spend; and `INTERVAL '1 quarter'` is rejected by Postgres.

**Alternatives considered:**
- **Keep untagged placeholders and fix the regex.** Rejected: any filler that infers a dataset from SQL structure breaks on the next nesting; the compiler knows the dataset when it emits the placeholder.
- **A `dataset` suffix on the field id in the adapter instead of a tag in the SQL.** Rejected: the adapter already names its dataset per mapping (schema 1.1); the tag is on the consuming side so the adapter format does not change.
- **Express DAU, WAU and MAU through `lag`.** Rejected: `lag` shifts a period, it cannot shorten one; a 30-day window on a quarterly report is a different thing from a quarter shifted back.
- **Mocking Postgres or asserting on SQL text.** Rejected: only execution catches dialect errors and wrong-but-valid SQL, and PGlite needs no native build.

**Consequences:**
- `test/execute.test.ts` runs 136 templates (the ones the fixture maps fully) and pins MRR, ARR, NRR, GRR, Logo Churn Rate, CAC, CAC Payback, Win Rate, DAU/MAU and Magic Number. The fixture is the synthetic dataset the Ossie spec needs for drift scoring; grow it there. 31 of the 136 return NULL because the fixture has no rows for them (services, partners, renewals); that is coverage to add, not a SQL fault.
- `parameterizedQuery` changes shape (tagged placeholders) and `QueryTemplate` and `DataRequirement` gain `placeholders`, so the release is 1.12.0.
- `window` does not mark a metric as staged; it is a filter, not a shifted period. `window` and `all_time` are compile errors on a snapshot dataset.
- `test/formula.test.ts` and `test/tools.test.ts` cover the grammar, the tags and the per-dataset fill.

---

## [2026-10-13] Lookups never guess, and every public copy of a canonical file is derived
**Decision:** Every MCP resolver matches exactly or says not found with suggestions. `resolveMetric` accepts a metric's name with or without its abbreviation, the abbreviation, an alias, the slug, the formula id or a graph node label; one `resolveNode` in the loader does the same for graph nodes and serves `get_relationships`, `infer_drivers`, `explain_path` and `coverage_gap`; `findDefinition` no longer falls through to a substring. In the same release the public adapter schema at `/schemas/gasp-adapter-v1.json` becomes a derived file written by `npm run derive` from `standard/gasp-adapter-schema.json`, field usage counts (`metricCount`, template `usedBy`) come from the fields each metric's compiled SQL reads rather than the names in the formula text, and the compiler casts every numerator to double.

**Context:** The 2026-10-13 recheck of the coherence audit ran the tools rather than reading them. `get_relationships("revenue")` returned Revenue Churn Rate and `infer_drivers("churn")` Churned MRR, because three functions still substring-matched after the 2026-10-12 fix to `lookup_metric`. "Net Revenue Retention", the `lookup_metric` description's own example, resolved to the glossary term, and 10 of 60 node labels failed. The site served the 1.0 schema while the template declared 1.1 and named that URL as its `$schema`, failing it with 1,297 errors, because the public copy was hand-maintained and untested. `snapshot_date` showed 5 metrics against 168 that read it. 98 templates divided COUNT by COUNT, which is integer division on Postgres, Redshift and SQL Server.

**Alternatives considered:**
- **Keep substring fallbacks but rank exact first.** Rejected: an agent cannot tell a ranked guess from an answer, and the suggestions text already gives it the names to retry with.
- **Add aliases to the two metrics whose graph labels differ (QBR Completion Rate, Employee NPS).** Rejected in favour of resolving through `metricNodeIds`, which is the tested map and covers any future label.
- **Cast only when both operands are counts.** Rejected: the cast is harmless on numerics and the rule "every numerator is cast" needs no type inference.

**Consequences:**
- `test/tools.test.ts` asserts every graph node label resolves, that substrings return nothing, and that every ratio formula compiles with the cast. `test/derived.test.ts` asserts the public schema equals the canonical file and validates the template against it.
- The derived file set is now five (ontology sections, relationships edges, Cypher, adapter template, public schema). Adding another public copy of a canonical file means adding it to `DERIVED_FILES`, not committing it by hand.
- Compiled SQL output changed (the cast), so the next MCP release after 1.11.1 that also changes placeholder format (per-dataset tags, TODO next step 2) should be 1.12.0.
- Pending, not decided: executing compiled SQL in tests with PGlite and a seeded fixture (TODO next step 1). Record when implemented.

---

## [2026-10-12] Every derived representation is generated from formulas.json
**Decision:** `standard/formulas.json` is the single source for how a metric is computed. Everything that restates it is generated: query templates and data requirements are compiled per metric at load time (`gasp-wiki-mcp/src/compile.ts`); `structuredFormulas`, `entityMappings`, field usage counts, the graph's `component` and `measures` edges, the Cypher export and the adapter template are written by `npm run derive` (`src/derive.ts`) and a test fails when any of them differs from a fresh run. The hand-written `standard/query-templates.json` and the dashboard mock's `dataRequirements` are gone.

**Context:** The 2026-10-12 coherence review found five representations of each metric written at different times and never reconciled: 4 query templates could not run, 23 referenced identifiers no adapter could bind, several computed a different metric from the one they were named after, `structuredFormulas` disagreed with the formulas on 47 of 60 metrics, and `validate_adapter` scored coverage against field lists that matched the formula inputs for 1 of 78 metrics.

**Alternatives considered:**
- **Fix the hand-written files and add consistency tests.** Keeps five sources; every future edit has to be made five times and the tests only report drift after the fact.
- **Store compiled SQL in the repo.** Committed derived content drifts the same way `source-dates.json` does when someone forgets to regenerate; compiling at load time has no stale state.

**Consequences:**
- The compiler turns each aggregate into a scalar subquery on one dataset, so metrics that span datasets need no joins. Snapshot datasets read as of the period boundary; event and fact datasets filter to the period; `lag` shifts both bounds; `cohort` restricts to keys active at the point.
- Dialect handling is minimal (ANSI with `INTERVAL`, `EXTRACT(EPOCH ...)` and `PERCENTILE_CONT`); the Ossie exporter owns dialects when it lands.
- `generate_query` fills the compiled template per dataset and `validate_adapter` scores metrics against the fields the formula reads. Both say "not found" and suggest names rather than returning a substring guess.
- Entity mappings and MEASURES edges now follow the data a metric reads (its datasets' entities and the key fields it references). The hand-curated list disagreed with the formulas for about half of a 24-metric sample.

---

## [2026-10-12] One field vocabulary, organised by dataset, with CEL names
**Decision:** The canonical fields are the fields the formulas read: 251 fields across 47 datasets (logical tables: CEL event classes, entity snapshots, operational facts). Each field declares its datasets; a field that means different things on different tables is split (`customer_status`, `subscription_status`, `ticket_status`; `opportunity_stage`, `lead_stage`; `opportunity_amount`, `invoice_amount`). Where the CEL has a name, it wins (`customer_id`, `event_type`, `cost` with `cost_function` and `cost_type`, `tcv`, `acv`, `contract_event_type`, `amendment_type`). Enum fields declare their values in lowercase snake_case, and a formula literal outside the declared set fails the build. The ATL tags are lowercase and `cost_function` covers every cost, so `cogs` is `cost where cost_function = 'infrastructure'` and S&M is `gtm`.

**Context:** 273 flat fields included 79 nothing read, 17 that were metrics, four spellings of period MRR and names like `status` used against 7 different tables; the adapter maps one name to one column, so whichever column a company chose was wrong for most metrics. The CEL, positioned as the atomic layer, shared 6 of its 27 field names with the ontology.

**Alternatives considered:**
- **Entity-prefixed grammar (`customer.status`).** Cleaner to read, but every formula, the adapter schema and the Cypher export change shape; splitting ids keeps the flat adapter.
- **Keep `account_id`.** Fewer renames, but the entity is called Customer everywhere else and the CEL says `customer_id`.

**Consequences:**
- Adapter schema 1.1: a mapping may name its `dataset`, the template emits one row per (field, dataset) for shared fields, and `datasets` maps each logical table to a warehouse table.
- Snapshot datasets used with flow semantics (deals closed, invoices issued, projects completed) carry explicit `in_period(date)` filters in their formulas.
- Datasets not yet in `ontology.entities` (incident, deployment, requisition, project milestone and others) are candidates for promotion; the graph still shows the original 15 entities.

---

## [2026-10-12] Gross Margin's COGS is infrastructure only; canonical GM equals GM-M
**Decision:** `cogs` means cost with `cost_function = 'infrastructure'` (hosting, compute, payment processing, delivery software). The canonical Gross Margin equals the Market form. The Operating form (contribution margin) subtracts support, success engineering, implementation and onboarding on top, which is where those human delivery costs belong in GASP. Related: Deferred Revenue is one balance metric (cumulative billed minus cumulative recognised; Finance stubs to RevOps), Burn Rate is net cash delta per month, and MTTR runs from incident start.

**Context:** The canon had three incompatible COGS bases: the Include block put Support and CS in COGS, GM-M restricted COGS to infrastructure, and GM-O subtracted Support and CS again, double counting them. LTV, CAC Payback and Operating Margin inherit Gross Margin, so unit economics were ambiguous.

**Alternatives considered:**
- **Fully burdened COGS (Support and CS included) as canonical.** Matches some companies' statements but makes GM-O double count and leaves no form that matches investor benchmarks.

**Consequences:**
- The two forms reconcile exactly through the stated bridge.
- Companies that allocate Support and CS to COGS in their statements report that figure as GM-O.

---

## [2026-10-12] Canonical formulas get a small grammar and their own file
**Decision:** Metric formulas are written in a constrained expression grammar (`gasp-wiki-mcp/src/formula.ts`) and stored in `standard/formulas.json`, keyed by formula id (graph node id when the metric has one, else slug with underscores). The grammar covers arithmetic over `metric.` refs, aggregates over `field.` refs with `where` filters, `at period_start|period_end` snapshots, `lag(expr, n unit)` and `over cohort(key, point)`. Ratios are unscaled and each entry carries a `unit`. O/M forms and named variants (Adjusted NRR) sit beside the main formula. Metrics with no single formula carry `notComputable` with a reason.

**Context:** The Ossie interop spec needs a metric compiler (GASP canon → Ossie `metrics[]`). `structuredFormulas` in `ontology.json` covers 60 of 300 metrics, its `expression` values are prose ("QoQ ARR growth / Prior quarter S&M spend") and several input lists were wrong (NRR, GRR and Revenue Churn Rate omitted Beginning MRR; Rule of 40 used MRR Growth and Operating Margin where the canon says ARR growth and EBITDA margin). None of it could be compiled.

**Alternatives considered:**
- **JSON expression trees.** Unambiguous, but verbose and hard to review or author at 300-metric scale.
- **SQL strings.** Dialect-bound, and they would tie the canon to a table layout before any warehouse exists.
- **Extend `structuredFormulas` in place.** Keyed by graph node id, so the 240 metrics outside the graph had nowhere to go.

**Consequences:**
- `test/formulas-data.test.ts` fails if any expression does not parse, references an unknown field or metric, nests aggregates, puts fields outside aggregates, forms a cycle, or disagrees with `structuredFormulas` on metric inputs and polarity (subtracted and denominator inputs are negative). Input roles become derivable from the formula; `structuredFormulas` stays as the traversal input until it can be generated from `formulas.json`.
- `cohort` restricts every aggregate in the formula, including those inside referenced metrics, so NRR and GRR keep their component form and the traversal edges that go with it. `lag` and `cohort` mark the metrics that need a staged dataset in Ossie, which is the boundary for upstream proposal P2.
- Formulas may only use the canonical field vocabulary. Missing fields are proposed and added centrally, not invented per metric.
- All 300 metrics are covered (287 entries; 268 formulas, 19 `notComputable`). NRR-M, ARR-M and LTV-O are partial because the ATL movement tags and contribution margin are not canonical fields yet.
- Encoding all metrics added three grammar rules: date subtraction yields elapsed days (unit conversion is explicit), a `period_days` constant, and a `percentile(expr, p)` aggregate (latency is canonically P95). The alternative for durations, a pre-computed duration field per metric, would have added ~17 fields that are just differences of existing dates.
- The field vocabulary grew from 198 to 273. 20 `structuredFormulas` entries were corrected where the canon disagreed; the stale inputs dropped were "drives" relationships, which stay as edges in `relationships.json`.

---

## [2026-09-28] MCP emits canonical URLs; glossary terms get both a fallback and a dedicated tool
**Decision:** Every MCP result that names a metric or definition carries its gaspwiki.com URL, built in one place (`gasp-wiki-mcp/src/urls.ts`) that mirrors the frontend routes. Glossary terms are reachable two ways: `lookup_metric` falls back to definitions when no metric matches, and a new `lookup_definition` tool looks up terms directly. Both share `findDefinition()` in the loader.

**Context:** A user reported 404s for signal type, sensitivity tier, access scope and metric owner. The pages existed. The MCP returned the definitions without links, so agents constructed URLs themselves and guessed wrong. Before the 2026-09-06 soft-404 fix those guesses silently returned the homepage.

**Alternatives considered:**
- **Fallback only.** Fixes the path agents actually take (they reach for `lookup_metric` first) without a new tool, but a term that shares a name with a metric is then only reachable through `search`.
- **`lookup_definition` only.** Cleaner single-purpose tools, but agents that call `lookup_metric("Signal Type")` still hit "not found" and go back to guessing.
- **Store URLs in `standard-data.json`.** Rejected: URLs are derived from routing, and computing them at output time keeps older bundled or remote data working.

**Consequences:**
- `test/urls.test.ts` fails if any emitted URL is not a real route. New frontend routes need mirroring in `urls.ts`.
- Tool count goes to 12; site copy and docs updated.
- `lookup_metric` output shape varies (metric or definition). The definition form is labelled `**Type:** Definition` so agents can tell them apart.
- Same release: metric → graph node id resolution moved to one function (`metricNodeId`) backed by `metric-links.ts`, the existing tested node → page map, instead of four slug-prefix guesses. Label matching was tried and rejected: 5 nodes matched nothing and 5 matched several records (`arr` also matched ARR per CSM). This makes `metric-links.ts` an MCP input, not only a website file.

---

## [2026-09-06] Homepage hero is an ambient, responsive network field, not a diagram
**Decision:** Replace the decorative hero network with a canvas-rendered field: drifting nodes in depth layers, proximity edges, spontaneous signals that hop along edges and dim as they spread, and a cursor that acts as a physical presence (pull with momentum, velocity wake, movement-seeded firings, click pulse). Monochrome ink for structure, accent only for activity. It thins behind the copy so the headline stays legible. Component: `src/components/HeroField.astro`.

**Context:** The previous hero was a hand-placed lattice of anonymous dots at 7 percent opacity behind a grid, with bezier edges swaying on sine waves and a whole-layer parallax drift. The concept (a living network behind the thesis) was right; the execution was faint, wobbly and barely responsive.

A first replacement rendered the real GASP TWIN Core graph, labelled and valued, with live propagation from the simulator engine. It was technically sound and was rejected within a minute of viewing: "an insanely literal cluster of meaningful things" where the brief wanted a feeling. Lesson recorded: when a client says a hero is "conceptually right", keep the concept and fix the execution. The literal graph belongs in the relationship explorer and the World Modifier, which already exist one click away.

**Alternatives considered:**
- **Literal graph as the hero.** Built, rejected. See above.
- **SVG DOM animation.** Rejected: a few hundred nodes with per-frame edge recomputation is a canvas job. The previous SVG version could only afford 32 nodes.
- **WebGL.** Not needed at this density; 2D canvas with a grid hash holds 60fps at 280 nodes and stays readable for the next person.
- **Constant busyness.** Rejected in favour of calm drift with occasional bursts and cursor-driven activity, so the field reads as attentive rather than noisy.

**Rationale:** The page's job in the first viewport is to make a claim and to feel alive and precise while making it. An abstract field that responds instantly to the visitor communicates "on top of the tech" better than a diagram the visitor has to read.

**Consequences:**
- `src/lib/twin-model.ts` (extracted for the rejected graph hero) stays: the simulator imports it and the consistency tests read it. It is the single source for the Core model.
- `HeroGraph.astro` is unused and slated for deletion (TODO).
- DESIGN.md hero pattern documents the field's rules and tunables.
- The field is decorative to assistive technology (`aria-hidden`) and inert under reduced motion.

---

## [2026-09-06] Crawlability, SEO/GEO, Lighthouse and WCAG 2.1 AA hardening
**Decision:** Treat search engines, AI crawlers and assistive technology as first-class consumers of gaspwiki.com and encode the requirements as tests rather than as a one-off audit. Concretely: a real 404 page, server-side redirects for `/sitemap.xml` and `/v1`, a sitemap with git-derived `lastmod` that excludes noindex pages, `llms-full.txt` generated from `/standard/` at build time, Organization/WebSite/TechArticle/DefinedTerm/FAQPage structured data on every page, security and immutable-cache headers, font preloading, removal of the unused Tailwind typography plugin, a WCAG 2.1 AA token palette in both themes, a public accessibility statement at `/accessibility`, and a `site-quality.test.ts` suite plus `npm run audit` (Lighthouse) so none of it regresses.

**Context:** The live site returned the homepage with a 200 for every unknown path, including `/sitemap.xml` and `/llms-full.txt`, so search consoles saw HTML where they expected XML. Cloudflare's "Managed robots.txt" was prepending `Disallow: /` for GPTBot, ClaudeBot, CCBot, Google-Extended and others, directly contradicting the goal of being the reference AI agents cite. Lighthouse baseline on mobile was 91 to 98 performance, 93 to 100 accessibility, 82 best practices and 92 SEO, with contrast failures on the homepage tiles, muted text at 60 percent opacity around 2.7:1, success and warning tokens as text at 3.3:1 and 3.2:1, an invalid `<dl>`, and in-text links distinguished by colour only. The EU-facing bar is WCAG 2.1 AA via EN 301 549 and the European Accessibility Act.

**Alternatives considered:**
- **Inline all CSS (`inlineStylesheets: 'always'`) to kill render-blocking.** Rejected. 128KB of CSS was the real problem; 49KB of it was the `@tailwindcss/typography` `.prose` rules that nothing on the site uses (the site has its own `prose-custom`). Dropping the plugin removes the cost without giving up cross-page CSS caching.
- **Leave design tokens alone and fix contrast per component.** Rejected after the user approved token changes. Per-component overrides would have left the root cause (a muted-fg of `#64748b` that fails on the muted surface, a success green that fails under white text) for the next page to rediscover.
- **Keep one accent blue in dark mode.** Not possible: no blue reads as link text on `#1e293b` at 4.5:1 while also carrying white text at 4.5:1. Dark accent lightens to `#60a5fa` with a dark-ink foreground. Same rule applied to category and signal badge colours (700-series light, 400-series dark, text flips via `--color-category-fg`).
- **`article:modified_time` from the build date.** Rejected as a false freshness signal. Dates now come from the last git commit touching a page's source files (`src/utils/last-modified.ts`), with an mtime fallback for uncommitted files. Cloudflare Pages builds have no git history (the first deploy shipped zero `lastmod` entries), so `npm run generate` persists the dates to a committed `src/data/source-dates.json` that hosted builds read back.
- **Index the `/test` quiz page.** Rejected: it renders entirely client-side, so it is a thin page to a crawler. Marked noindex and excluded from the sitemap. The `/v1` redirect stub is likewise excluded and served as a 301 via `_redirects`.
- **A strict script-src Content-Security-Policy.** Deferred. Astro's inline theme script and Cloudflare's injected challenge script would need hashes or nonces; the shipped CSP covers `frame-ancestors`, `base-uri`, `form-action` and `object-src`.

**Rationale:** Exposure is the sum of being crawlable, being citable and being usable. Each requirement here is cheap to keep true once a test asserts it and expensive to notice once it silently breaks, so the durable deliverable is the test suite and the audit script rather than the current scores.

**Consequences:**
- `test/site-quality.test.ts` runs in `npm test`. Token contrast and config checks always run; the built-output group (titles, descriptions, canonicals, one h1, JSON-LD, sitemap, 404, llms, dead internal links) runs when `dist/` exists. Run `npm run build` first for full coverage.
- `npm run audit` serves `dist/` and runs Lighthouse on representative pages (`--url` for the live site, `--desktop`, `--paths`). Exit code 1 if accessibility or SEO drop below 100.
- Cloudflare dashboard state is part of the deploy contract: managed robots.txt off, AI bot blocking off. Bot Fight Mode still injects `cdn-cgi/challenge-platform`, which is the only remaining Lighthouse best-practices deduction (deprecation warnings from that script).
- DESIGN.md token table updated. `text-warning-text` and `text-category-fg` are new Tailwind colours. Faded text (`opacity-*`, `/60`, `/40`) on accent, success or warning surfaces is now a documented no.
- `public/llms-full.txt` is generated and gitignored, like the rest of the derived content.
- `/accessibility` states partial conformance honestly: interactive graphs and dashboard charts have text equivalents but not full assistive-technology parity, and screen-reader testing by users has not yet happened.

---

## [2026-05-10] MCP traversal builds on canonical ontology, not the frontend simulator
**Decision:** The Phase 6 MCP traversal tools (`infer_drivers`, `explain_path`, `coverage_gap`) read directly from `standard/ontology.json` and `gasp-wiki-frontend/src/data/relationships.json` rather than sharing or extracting code from `gasp-wiki-frontend/src/lib/twin-propagation.ts`. Direction overrides are derived from `structuredFormulas[*].inputs[*].role` (denominator / subtrahend → flip) — the MCP picked up 11 overrides automatically, vs. 4 hand-coded in the frontend. Edge attenuation buckets come from `entityRelationships.edgeTypeClassification` (5 buckets across 17 entity edge types). Inverse-correlation predicts edges that aren't derivable from formula structure (e.g. NPS predicts churn inversely) are captured by a new optional `inverse: true` property on edges in `relationships.json` — currently set on the two NPS predicts edges, with room to extend.

**Context:** Original Phase 6 plan (recorded earlier today) called for "lifting traversal logic into a shared module" between the frontend and MCP. While planning the implementation, the canonical layer turned out to already contain the structured representations the frontend's `EDGE_DIRECTION_OVERRIDES` table approximates by hand. This shifted the framing: the frontend's simulator is application-specific (curated 31-node Core subset, simulator-tuned attenuation values), while the MCP traversal needs to operate on the full 82-node canonical graph for agent use cases. They aren't variants of the same module — they're separate programs that happen to share an algorithm shape (BFS + per-edge attenuation + direction-override pass + reverse inference).

A subsequent verification pass (an Explore subagent re-checking the original "frontend overrides miss 5 cases" claim) corrected an overconfident framing: most of the supposedly-missed cases are `reduces` edges that flip automatically via edge type. The genuine canonical wins are (a) the 3 `component`-typed denominator overrides for ratio metrics (LTV:CAC, CAC Payback) and (b) future ratio metrics added to the standard pick up direction flips for free without touching MCP code. The genuine canonical loss — there is no formula representation for inverse-correlation `predicts` edges — is now closed by the new `inverse: true` schema field.

**Alternatives considered:**
- **Shared module via cross-package import.** Rejected: there's no monorepo workspace setup; cross-package imports between two npm-built packages don't have a clean path. The MCP must be standalone (it bundles its own data via `standard-data.json` and is published to npm), which makes "frontend imports MCP module" or vice versa awkward in dev *and* publish.
- **Duplicate `twin-propagation.ts` into MCP with a parity consistency test.** Was the working plan after rejecting cross-package imports. Rejected once we noticed the canonical layer already had the data: parity-with-the-simulator turned out to be the wrong invariant. Parity-with-canonical is the right one, and that's enforced by the MCP test suite + the new "every `inverse: true` edge that the simulator traverses must have a matching override" cross-check.
- **Hardcode the same `EDGE_DIRECTION_OVERRIDES` table inside `gasp-wiki-mcp/src/traversal.ts`.** Pragmatic but reintroduces the duplicate-knowledge problem and silently scales worse — every new ratio metric requires a code change in two places, and inverse-correlation cases stay hardcoded with no canonical pointer.
- **Skip the inverse-predicts case for now.** Rejected: the case exists today (NPS), and silently propagating the wrong direction in `infer_drivers` would erode trust in the tool. Adding `inverse: true` was a small canonical schema addition that closed the gap without forcing the frontend to migrate.

**Rationale:** Canonical data is the right home for any rule that's a property of the standard rather than a property of one application. Denominator direction flips are formula structure (canonical). Edge classifications are graph structure (canonical). Inverse-correlation predicts edges are real-world judgments about leading-indicator polarity (canonical, now via the new `inverse` flag). The frontend simulator's curated subset, hand-tuned attenuation, and demo-specific sliders are application-specific and should stay in the frontend. Two small programs reading the same canonical files are easier to keep aligned than one shared module trying to serve two different graph shapes.

**Consequences:**
- `RelationshipEdge.inverse?: boolean` is now part of the MCP type surface and the `relationships.json` schema. Two edges currently use it (`nps → logo_churn_rate`, `nps → churned_mrr`). Future inverse-correlation cases extend the same field rather than a TypeScript constants table.
- The frontend's `EDGE_DIRECTION_OVERRIDES` is intentionally NOT migrated. The simulator's CORE_EDGES is hand-curated and doesn't read from `relationships.json` at runtime; refactoring it is bigger than this phase. Instead, a new `consistency.test.ts` cross-check asserts every `inverse:true` edge that the simulator traverses also appears in `EDGE_DIRECTION_OVERRIDES`, so the two can't silently diverge.
- The MCP traversal automatically handles new ratio metrics added to `structuredFormulas`. No code change required as long as inputs are tagged with the right `role`.
- Memory note: when extending the MCP, default to deriving from canonical files first, hardcoding second. See feedback memory `feedback_mcp_canonical_data.md` for the rule and its caveats (not every override is derivable; verify case-by-case).
- The `coverage_gap` "Core 8 returns zero gaps" sanity check from the original ADR was reframed during implementation. Core 8 has real one-hop upstream gaps (Net New MRR feeds MRR, etc.), so a strict zero-gap test there would fail. The shipped test instead asserts zero gaps when *all* metric ids are passed — a degenerate but real well-formedness check — plus targeted assertions on small sets that exercise the function without claiming false-zero invariants.

---

## [2026-05-10] Add `infer_drivers`, `explain_path` and `coverage_gap` to the MCP server
**Decision:** Build three new MCP tools that expose graph-traversal reasoning to agents. All three return objects built from the same primitives (`id`, `path` with edge classifications and attenuation, `direction`, `score`) so an LLM can compose them across workflows:
1. `infer_drivers(metric, direction)` — given an observed movement on a metric (e.g. "ARR is down"), return a ranked list of upstream metric candidates whose movement would be consistent with that outcome. Output is candidate IDs + direction (up/down) + attenuation score (0.0–1.0) + the path that produced the rank. No projected magnitudes. Serves the diagnostic use case.
2. `explain_path(from, to)` — return the edge chain (or chains) between two metrics with the operational classification of each step (structural / lifecycle / behavioral / assignment / generative) so an agent can narrate "how X reaches Y." Serves the exploration use case.
3. `coverage_gap(metric_set)` — given a set of metrics the user is tracking, return three sets: upstream-missing (metrics that feed the set but aren't in it), downstream-missing (metrics the set feeds that aren't tracked), disconnected (in-graph metrics with no path to/from the set). Serves the audit/coverage use case.

**Context:** The TWIN Modifier (`/v1/twin-modifier`, Phases 1–4 shipped) codified domain knowledge that wasn't accessible elsewhere — which graph edges propagate, attenuation factors per edge type (component 0.9, drives/reduces 0.75, predicts 0.6), denominator-direction overrides for ratio metrics (LTV:CAC, CAC Payback), and a reverse-inference pass that goes from "metric X moved" back to "which upstream things could explain it." This logic currently lives only in `twin-propagation.ts` and is consumed only by the website. The MCP server today exposes 8 lookup-style tools (`lookup_metric`, `get_formula`, `get_relationships`, etc.) but has no traversal-reasoning verbs. Agents asking root-cause-style questions ("ARR slowed; what could explain it?"), exploration questions ("how does Win Rate eventually affect FCF?") or coverage questions ("we track these 8 metrics, what important ones are we missing?") have to assemble traversal logic ad-hoc from formulas, which produces worse answers than graph-aware tools.

The three tools deliberately serve three distinct, equally important use cases — diagnosis, exploration and coverage — without prescribing which one a user should be in. Output emphasis differs by tool but the underlying primitives are shared so an LLM can chain calls (e.g. `infer_drivers` → pick a candidate → `explain_path` to scrutinize the chain → `coverage_gap` to ask whether the candidate is even being measured).

**Alternatives considered:**
- **Status quo (do nothing).** Agents continue reasoning from static lookups + chain-of-thought. Rejected: traversal reasoning is the bit MCP genuinely can't do today, and chain-of-thought handling of denominator-flips and edge-type attenuation is consistently weak.
- **Build only `infer_drivers` + `explain_path` (the original two-tool scope from the first draft of this record).** Rejected once we worked through the three-use-case framing — diagnosis, exploration and coverage are equally valuable, and "infer_drivers kind of covers coverage" was hand-waving. A dedicated `coverage_gap` keeps each tool's contract small and matches what users actually do.
- **Build `simulate_change` as a fourth tool (forward propagation with magnitudes).** Rejected, not deferred. The TWIN Modifier (`/v1/twin-modifier`) already serves counterfactual reasoning visually — a richer experience than any MCP response could be. The MCP server's distinct value is the things visual simulation doesn't do well: ranking, set operations and narrative explanation. Adding a forward-numeric tool would mostly duplicate the simulator's job in a poorer format AND carry the magnitude-misuse risk we already declined. It would also create cognitive overhead for the calling LLM ("should I use simulate_change or infer_drivers?"). Counterfactual reasoning belongs on the website. The MCP fills the non-visual gap.
- **Return full numeric projections from `infer_drivers`.** Rejected: forecasting-misuse risk. Attenuation scores let agents sort/filter without inventing dollar magnitudes.
- **Single composable `traverse(metric, options)` tool with parameters that switch behavior.** Rejected: three named tools with sharply distinct verbs (diagnose / explain / audit) are easier for an LLM to pick between than one tool with overloaded parameters.

**Rationale:** Three workflows, three tools, one output principle: tools return *structure* (paths with edge classifications and attenuation), users (or their agents) do *judgment*. Every output shows its work — full ranked list, per-candidate path, no top-1 verdicts, no relabelled-attenuation-as-confidence. The tools are composable so a user can chain across workflows rather than getting handed packaged answers. The traversal logic already exists in `twin-propagation.ts`; the marginal cost of shipping three coordinated tools that share that logic is small relative to the agent-task value.

**Consequences:**
- Lift `twin-propagation.ts` traversal logic out of `gasp-wiki-frontend/src/lib/` into a shared module the MCP server can import. Cleanest path is a new `gasp-wiki-mcp/src/traversal.ts` (canonical source) and have the frontend import from there too via the build, OR duplicate carefully and add a consistency test asserting parity. Decide at implementation time.
- Common output schema across all three tools — a small shared type for `TraversalCandidate` so the LLM consuming the response gets predictable shape across calls. Document this once in the MCP README and link to it from each tool's description.
- MCP version bump (likely v1.8.0, additive — three tools means tool count goes from 8 to 11). Update `gasp-wiki-mcp/README.md`, `tools.astro`, `digital-twin.astro`, and any homepage copy that quotes the tool count.
- New consistency-test responsibilities: (a) every metric in `relationships.json` must be reachable as source or target of at least one valid traversal, otherwise `infer_drivers` returns empty for it; (b) `coverage_gap` against the full Core 8 must return zero gaps (sanity check); (c) `explain_path` must always return at least one chain for any pair of connected metrics. Add to `consistency.test.ts`.
- Output framing enforced at the tool description level (in `gasp-wiki-mcp/src/index.ts`) — call out "structural reasoning, not numeric forecasting" in every tool description so agents are oriented before they use it. Document in `tools.astro` and `digital-twin.astro`.
- Tool descriptions emphasize composability: "use `infer_drivers` to pick candidates, then `explain_path` to scrutinize a chain, then `coverage_gap` to check whether it's measured." Helps LLMs pick the right tool for each step.
- Watch for: agents using `infer_drivers` outputs as if they were forecasts despite framing. If we see that, add a more explicit caveat to the response payload itself (e.g. an `_advisory` field).
- Counterfactual / "what if" reasoning is explicitly out of MCP scope — direct that workflow at the TWIN Modifier instead. Cross-link from MCP tool descriptions where helpful.

---
