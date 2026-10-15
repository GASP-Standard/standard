# Governance

This file says who decides what goes into the GASP Standard, how those decisions are recorded and what happens to the standard if its maintainer stops working on it. It describes the arrangement as of October 2026 and will change as more people contribute.

## Who maintains it

GASP has one maintainer, Gareth O'Shea, who wrote it and maintains it as an individual. No company owns or sponsors it. He reviews every change, runs the releases of the `gasp-standard-mcp` npm package and publishes gaspwiki.com.

This repository is a read-only mirror. The working repository is private and holds the website source as well; a workflow copies `standard/`, `gasp-wiki-mcp/`, the decision documents and these files here on every change to its main branch.

## How a change is decided

1. **A proposal.** Anyone opens an issue on this repository. For a change to a definition or a formula, the issue cites the source the change rests on (an accounting standard, a published benchmark, a vendor's documented calculation) and says which metrics it touches. `CONTRIBUTING.md` has the detail.
2. **The bar.** A change is accepted when the maintainer agrees with the reasoning and the change passes the tests. Every formula has to parse, resolve against the ontology and compile. Every compiled query also runs against the seeded test dataset. `npm run derive` has to leave the derived files current, which `npm run derive:check` verifies in CI. A change that cannot be expressed in the formula grammar is marked not computable with a reason, which is itself a reviewed decision.
3. **The memory.** Any change that sets a rule, retires a metric or picks between reasonable alternatives gets an entry in `DECISIONS.md`: the decision, the context, the alternatives considered with the reason each was rejected, then the consequences. New entries go at the top. When someone later asks why the standard says what it says, the answer should be in that file.

Wording fixes, examples and tooling changes go straight to review without a decision record.

## Versioning

The standard and the MCP package carry separate versions.

**The standard** is versioned by its content path. Every page lives under `/v1/` on gaspwiki.com. The metric and definition URLs under it are stable identifiers that agents, adapters and the Apache Ossie export all point at. The MCP package and the site also publish a content hash (`standard-version.json`) so a client can tell when the canon changed.

A breaking change to the canon is one that makes an existing implementation silently wrong or unable to resolve a reference:

- renaming a metric, or changing its id or slug
- changing what a formula means (a different numerator, denominator, population or period treatment)
- removing a field or dataset from `ontology.json`, or removing an enum value

Breaking changes are batched for a `/v2/` path. Until then they are avoided. Where one has been unavoidable, the old URL redirects to the new page, `CHANGELOG.md` names the old and new ids and `DECISIONS.md` records why. Three cases so far: Headcount by Department, retired into a breakdown of Total Headcount on 2026-10-13; the four metrics renamed on 2026-10-14 because two pairs shared a heading (Escalation Rate in Support and Professional Services, Milestone Completion Rate in Onboarding and Professional Services), which broke the rule that a metric's name identifies it; and Net New MRR on 2026-10-14, whose formula gained the reactivation term its definition had always described, so the MRR waterfall reconciles.

Additive changes ship within `v1`: a new metric, a new field, a new breakdown, a new formula for a metric that was not computable, a clarified definition that does not change the number.

**The MCP package** follows semver. A minor version adds tools, arguments or standard content. A patch fixes behaviour. A major version would change a tool's name, arguments or result shape in a way that breaks a client. Releases are listed in `CHANGELOG.md`.

## Adding a maintainer

A second maintainer is someone who has made sustained contributions over several months: proposals that were accepted, reviews of other people's issues, fixes to the tests or the compiler. The current maintainer invites them. A maintainer gets commit rights on the private working repository that this mirror is built from, which is where changes land. They also get a say in every decision recorded from then on.

With two or more maintainers, a change to the canon needs the agreement of one maintainer who did not propose it. The decision record names who agreed.

## If the maintainer is unavailable

The licences already allow anyone to carry the standard on. `standard/` is CC BY 4.0 and the code is Apache 2.0, so a fork needs nobody's permission, only attribution.

The intended handover artefacts are this repository and the `gasp-standard-mcp` package on npm. Together they hold everything needed to continue: the canon, the derive step that regenerates every export, the test suite that checks it, the decision records that explain it and a published package that already works offline. The website is a presentation of the same files and can be rebuilt from them.

If the maintainer stops responding for six months, contributors are encouraged to fork this repository and continue under a new name or under GASP with attribution. The maintainer will add a pointer to an active fork in this file if he is able to.

## Relationship to Apache Ossie

GASP publishes its ontology, reference semantic model and mapping as Apache Ossie (incubating) files, generated into `standard/exports/ossie/` and checked against the upstream validator, which is vendored in `gasp-wiki-mcp/ossie-validator/` at a pinned commit. Proposals GASP would like to make upstream are written up in `docs/ossie-interop-spec.md`. Any that are made go through the Ossie project's own process.

GASP is not an Apache Software Foundation project and is not governed by the ASF. It works with Apache Ossie (incubating) and contributes to it as an outside user of the format.
