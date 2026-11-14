import { describe, it, expect } from "vitest";
import { parseMetricsFile, parseDefinitions } from "../src/parser.js";

// ── parseMetricsFile ────────────────────────────────────────────────

describe("parseMetricsFile", () => {
  const sampleMetric = `
## Revenue Metrics

### MRR (Monthly Recurring Revenue)

**Definition:** The total predictable revenue normalized to a monthly amount.

\`\`\`
MRR = Sum of all active subscription amounts normalized to monthly
\`\`\`

**Benchmarks (by stage):**
- Seed: $10K–$100K
- Series A: $100K–$500K

**What it tells you:** Whether your recurring revenue engine is growing.

**Common mistakes:**
- Including one-time fees
- Not normalizing annual contracts to monthly

**Sources:**
- [SMSB](https://saasmetricsboard.com/mrr)
- [OpenView](https://openviewpartners.com/blog/mrr)

### ARR (Annual Recurring Revenue)

**Definition:** Annualized value of active recurring subscriptions.

\`\`\`
ARR = MRR × 12
\`\`\`

**Benchmarks (by stage):**
- Series A: $1M–$5M

**What it tells you:** The annualized run-rate of your business.
`;

  const metrics = parseMetricsFile(sampleMetric, "core.md");

  it("parses correct number of metrics", () => {
    expect(metrics).toHaveLength(2);
  });

  it("extracts metric name", () => {
    expect(metrics[0].name).toBe("MRR (Monthly Recurring Revenue)");
  });

  it("extracts definition", () => {
    expect(metrics[0].definition).toBe(
      "The total predictable revenue normalized to a monthly amount."
    );
  });

  it("extracts formula from code block", () => {
    expect(metrics[0].formulas).toHaveLength(1);
    expect(metrics[0].formulas[0]).toContain("Sum of all active subscription");
  });

  it("extracts benchmarks", () => {
    expect(metrics[0].benchmarks).toBeTruthy();
    expect(metrics[0].benchmarks).toContain("Seed");
  });

  it("extracts aliases / abbreviations", () => {
    expect(metrics[0].aliases).toContain("MRR");
  });

  it("sets department from filename", () => {
    expect(metrics[0].department).toBe("Core");
  });

  it("sets category from ## heading", () => {
    expect(metrics[0].category).toBe("Revenue Metrics");
  });

  it("generates a slug", () => {
    expect(metrics[0].slug).toBe("mrr-monthly-recurring-revenue");
  });

  it("includes rawMarkdown", () => {
    expect(metrics[0].rawMarkdown).toContain("### MRR");
    expect(metrics[0].rawMarkdown).toContain("Definition:");
  });

  it("extracts common mistakes", () => {
    expect(metrics[0].commonMistakes).toBeTruthy();
    expect(metrics[0].commonMistakes).toHaveLength(2);
    expect(metrics[0].commonMistakes![0]).toContain("one-time fees");
  });

  it("extracts sources", () => {
    expect(metrics[0].sources).toHaveLength(2);
    expect(metrics[0].sources[0]).toContain("SMSB");
  });
});

// ── dual-lens parsing ──────────────────────────────────────────────

describe("dual-lens parsing", () => {
  // Pattern 1: Standard O/M (CAC-like)
  const standardOMSample = `
## Efficiency Metrics

### CAC (Customer Acquisition Cost)

**Definition:** The total cost to acquire a new customer.

**Formula:**
\`\`\`
CAC = (Sales + Marketing spend) / New customers acquired
\`\`\`

**What it tells you:** The investment required to acquire each customer.

**Sources:**
- [WSP](https://example.com/cac)

#### Operating Form: Fully Loaded CAC (CAC-O)

CAC-O includes all costs to make a customer productive.

**CEL Source:** \`Cost_Event\`
**ATL Inclusion:** \`lifecycle_attribution\` ∈ (\`Acquisition\`, \`Activation\`)

\`\`\`
CAC-O = Total Cost (Acquisition + Activation) / New Customers
\`\`\`

**What it tells you:** The full investment to get a customer generating value.

#### Market Form: GTM CAC (CAC-M)

CAC-M includes only go-to-market costs.

**CEL Source:** \`Cost_Event\`
**ATL Inclusion:** \`lifecycle_attribution\` = \`Acquisition\` AND \`cost_function\` = \`GTM\`

\`\`\`
CAC-M = S&M Spend / New Customers
\`\`\`

**What it tells you:** The market-comparable acquisition cost.

#### Bridge: CAC-O ↔ CAC-M

**Reconciliation:**
\`\`\`
CAC-O = CAC-M + Implementation_Cost + Onboarding_Cost
\`\`\`

**Diagnostic:** The delta is the Activation Delta — the hidden cost of making customers productive.
`;

  const standardMetrics = parseMetricsFile(standardOMSample, "core.md");
  const cacMetric = standardMetrics[0];

  it("parses standard O/M dual-lens: dualLens is not null", () => {
    expect(cacMetric.dualLens).not.toBeNull();
  });

  it("parses standard O/M: operating form fields", () => {
    const op = cacMetric.dualLens!.operating;
    expect(op.label).toBe("Fully Loaded CAC (CAC-O)");
    expect(op.description).toContain("all costs to make a customer productive");
    expect(op.celSource).toContain("Cost_Event");
    expect(op.atlInclusion).toContain("Acquisition");
    expect(op.formula).toContain("Total Cost");
    expect(op.insight).toContain("full investment");
  });

  it("parses standard O/M: market form fields", () => {
    const mkt = cacMetric.dualLens!.market;
    expect(mkt.label).toBe("GTM CAC (CAC-M)");
    expect(mkt.description).toContain("go-to-market costs");
    expect(mkt.celSource).toContain("Cost_Event");
    expect(mkt.formula).toContain("S&M Spend");
    expect(mkt.insight).toContain("market-comparable");
  });

  it("parses standard O/M: bridge fields", () => {
    const br = cacMetric.dualLens!.bridge;
    expect(br.reconciliation).toContain("CAC-O = CAC-M");
    expect(br.diagnostic).toContain("Activation Delta");
  });

  it("preserves existing metric fields with dual-lens", () => {
    expect(cacMetric.definition).toContain("total cost to acquire");
    expect(cacMetric.formulas.length).toBeGreaterThan(0);
    expect(cacMetric.dualLensNote).toBeNull();
  });

  // Pattern 2: Shared Churn
  const sharedChurnSample = `
## Retention Metrics

### Revenue Churn Rate

**Definition:** The percentage of MRR lost to churn.

**Formula:**
\`\`\`
Revenue Churn Rate = (Churned MRR + Contraction MRR) / Beginning MRR × 100
\`\`\`

**What it tells you:** The revenue impact of churn.

#### Dual-Lens: Revenue Churn (Churn-O) and Logo Churn (Churn-M)

Revenue Churn Rate and Logo Churn Rate are the Operating and Market forms.

**Operating Form: Revenue Churn Rate (Churn-O)**

MRR-weighted churn captures the economic impact of attrition.

**CEL Source:** \`Revenue_Event\` where \`event_type\` ∈ (\`churn\`, \`contraction\`)

**What it tells you:** The operating metric because it reflects actual economic damage.

**Market Form: Logo Churn Rate (Churn-M)**

Customer-count churn treats every logo equally.

**CEL Source:** \`Revenue_Event\` where \`event_type\` = \`churn\`

**What it tells you:** The market metric because it is simple and comparable.

**Bridge:** Revenue Churn and Logo Churn are not additive. Churn-O high, Churn-M low means concentration risk.
`;

  const churnMetrics = parseMetricsFile(sharedChurnSample, "core.md");
  const churnMetric = churnMetrics[0];

  it("parses shared churn: dualLens is not null", () => {
    expect(churnMetric.dualLens).not.toBeNull();
  });

  it("parses shared churn: operating form labels and fields", () => {
    const op = churnMetric.dualLens!.operating;
    expect(op.label).toBe("Revenue Churn Rate (Churn-O)");
    expect(op.celSource).toContain("Revenue_Event");
    expect(op.formula).toBeNull();
    expect(op.atlInclusion).toBe("");
    expect(op.insight).toContain("economic damage");
  });

  it("parses shared churn: market form", () => {
    const mkt = churnMetric.dualLens!.market;
    expect(mkt.label).toBe("Logo Churn Rate (Churn-M)");
    expect(mkt.celSource).toContain("Revenue_Event");
    expect(mkt.formula).toBeNull();
  });

  it("parses shared churn: bridge with null reconciliation", () => {
    const br = churnMetric.dualLens!.bridge;
    expect(br.reconciliation).toBeNull();
    expect(br.diagnostic).toContain("not additive");
  });

  // Regression (canon m20): the shared pattern cites each form's formula inline in backticks.
  const sharedInlineSample = sharedChurnSample
    .replace("MRR-weighted churn captures the economic impact of attrition.", "MRR-weighted churn. The formula is defined above: \`(Churned MRR + Contraction MRR) / Beginning MRR × 100\`.")
    .replace("Customer-count churn treats every logo equally.", "Customer-count churn. The formula is \`Customers lost / Customers at start × 100\`.");
  const inlineChurn = parseMetricsFile(sharedInlineSample, "core.md")[0];

  it("parses shared churn: inline formulas become the O and M formulas", () => {
    expect(inlineChurn.dualLens!.operating.formula).toBe("(Churned MRR + Contraction MRR) / Beginning MRR × 100");
    expect(inlineChurn.dualLens!.market.formula).toBe("Customers lost / Customers at start × 100");
  });

  // Pattern 3: Note only
  const noteSample = `
## Retention Metrics

### Gross Revenue Retention (GRR)

**Definition:** Revenue retained from existing customers, excluding expansion.

**Formula:**
\`\`\`
GRR = (Beginning MRR - Contraction MRR - Churned MRR) / Beginning MRR × 100
\`\`\`

**What it tells you:** Baseline health of customer relationships.

#### Dual-Lens Note

GRR measures revenue retained excluding expansion. The Operating/Market distinction does not apply.
`;

  const noteMetrics = parseMetricsFile(noteSample, "core.md");
  const grrMetric = noteMetrics[0];

  it("parses note: dualLensNote is not null", () => {
    expect(grrMetric.dualLensNote).not.toBeNull();
    expect(grrMetric.dualLensNote).toContain("Operating/Market distinction");
  });

  it("parses note: dualLens is null", () => {
    expect(grrMetric.dualLens).toBeNull();
  });

  // Null case
  const nullSample = `
## Revenue Metrics

### MRR (Monthly Recurring Revenue)

**Definition:** Total predictable revenue normalized to monthly.

**Formula:**
\`\`\`
MRR = Sum of all active subscription amounts
\`\`\`

**What it tells you:** Current run rate.
`;

  const nullMetrics = parseMetricsFile(nullSample, "core.md");

  it("returns null for metrics without dual-lens content", () => {
    expect(nullMetrics[0].dualLens).toBeNull();
    expect(nullMetrics[0].dualLensNote).toBeNull();
  });
});

// ── parseDefinitions ────────────────────────────────────────────────

describe("parseDefinitions", () => {
  const sampleDefs = `
## Revenue Terms

### Monthly Recurring Revenue

The total predictable revenue from active subscriptions, normalized to a monthly cadence.

**Canonical definition:** [MRR](https://gaspwiki.com/v1/metrics/core#mrr)

**Used in:** Core, Finance, RevOps

### Annual Recurring Revenue

Annualized value of all recurring subscription revenue.

**Canonical definition:** [ARR](https://gaspwiki.com/v1/metrics/core#arr)

**Used in:** Core, Finance

## Customer Terms

### Customer (Account / Organization)

A billing entity with one or more subscriptions.
`;

  const defs = parseDefinitions(sampleDefs);

  it("parses correct number of definitions", () => {
    expect(defs).toHaveLength(3);
  });

  it("extracts term name", () => {
    expect(defs[0].term).toBe("Monthly Recurring Revenue");
  });

  it("generates slug", () => {
    expect(defs[0].slug).toBe("monthly-recurring-revenue");
  });

  it("assigns section from ## heading", () => {
    expect(defs[0].section).toBe("Revenue Terms");
    expect(defs[2].section).toBe("Customer Terms");
  });

  it("extracts definition text", () => {
    expect(defs[0].definition).toContain("predictable revenue");
  });

  it("extracts canonical link", () => {
    expect(defs[0].canonicalLink).toBe(
      "https://gaspwiki.com/v1/metrics/core#mrr"
    );
  });

  it("extracts usedIn departments", () => {
    expect(defs[0].usedIn).toEqual(["Core", "Finance", "RevOps"]);
  });
});
