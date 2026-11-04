/**
 * Deriving CEL Revenue_Events from a subscription ledger (standard/cel.md,
 * "Deriving Revenue Events from a Subscription Ledger").
 *
 * Most billing systems hold subscriptions, not events: a row per subscription
 * whose MRR and status change over time, kept as snapshots or as a version
 * history. The CEL needs the movements between those states. The rules here
 * turn the GASP `subscription` dataset into `revenue_event` rows and are the
 * same for every source system; a vendor appears only in a mapping.
 *
 *   1. A subscription's MRR on a snapshot is its `mrr` when `subscription_status`
 *      is active, else 0. A customer's MRR is the sum over its subscriptions.
 *   2. A step is a snapshot whose MRR differs from the subscription's previous
 *      snapshot (by snapshot_date). A subscription's first snapshot steps from 0.
 *   3. Rows on the ledger's first snapshot date are opening balances: they seed
 *      the customer's MRR and produce no event (`firstSnapshot: "steps"` turns
 *      that off for a ledger that starts with the business). The ledger holds
 *      one row per subscription per snapshot date and keeps a cancelled
 *      subscription's row, since a subscription that stops appearing has no step.
 *   4. One Revenue_Event per step, dated the snapshot that first shows the change.
 *      mrr_change is the subscription's change; prior_mrr and new_mrr are the
 *      customer's MRR before and after it, chained through the customer's steps
 *      in (snapshot_date, increases before decreases, subscription_id) order, so
 *      prior_mrr + mrr_change = new_mrr holds on every row and the rows of one
 *      date add up.
 *   5. event_type from the customer's MRR at the start and end of the date: an
 *      increase from 0 is `new`, or `reactivation` when the customer was active
 *      on an earlier date; a decrease to 0 is `churn`; any other increase is
 *      `expansion` and any other decrease `contraction`. So a plan swap onto a
 *      new subscription id is an expansion and a contraction, two subscriptions
 *      cancelled on one date are two churns. `renewal` is not a movement and
 *      comes from Contract_Event or the renewal fields.
 *   6. lifecycle_attribution follows the ATL rules for each type; change_nature
 *      is `permanent`; segment is the snapshot's; expansion_classification is
 *      NULL, because the ledger does not say what kind of expansion it was (the
 *      amendment does), and the readiness check for the ATL tag names the gap.
 *   7. event_id is the subscription id and the snapshot date.
 *
 * The cadence of the ledger is the grain of the events: with daily snapshots
 * every movement is seen on its day; with month-end snapshots the movements
 * inside a month net to one event dated the month end, and a churn followed by
 * a reactivation inside one interval leaves no event. Where amendment events
 * exist they are the better source and the pairing rule in cel.md applies.
 *
 * Two more sources feed the same rules (cel.md, "Deriving Revenue Events from
 * an Invoice Ledger" and "Deriving Usage Realisation"):
 *
 *   - An invoice ledger (`source: "invoice"`) is a subscription ledger with one
 *     row per service period: an invoice's MRR is its `recurring_amount` over
 *     the months its service period covers, a subscription's MRR on a date is
 *     the sum over the invoices covering it, and its ledger dates are the
 *     starts of its service periods and the day after each end, up to the
 *     ledger's horizon (the latest service period start). Rules 2 to 7 then
 *     apply unchanged. The invoice dataset carries no segment.
 *   - Usage records (`usage: true`) add one pair of events per period in which
 *     `usage_amount` exceeds `committed_amount`: an `expansion` dated the
 *     period's end for the overage over the months the period covers, tagged
 *     `usage_realisation` with `change_nature` `temporary`, and its
 *     `scheduled_reversal`, a `contraction` dated the next day. The commitment
 *     is already in the subscription's MRR, so usage within it is no event. The
 *     pairs chain with the ledger's steps, so prior_mrr and new_mrr hold.
 *
 * The template uses the compiler's placeholders ({{field@dataset}},
 * {{_table:dataset}}), so `fillTemplate` compiles it over any adapter or Ossie
 * mapping that covers the fields it reads.
 */
import { DIALECT, type Dialect, type DialectName } from "./dialect.js";
import { exampleSql } from "./compile.js";
import { chooseDialect, fillTemplate, resolveAdapter } from "./tools.js";
import { loadAdapter } from "./ossie/adapt.js";
import { resolveDocLink } from "./urls.js";
import type { QueryTemplate, StandardData } from "./types.js";

export const DERIVATION_DATASET = "subscription";
/** The subscription fields the derivation reads, in the order the ledger CTE selects them. */
export const DERIVATION_FIELDS = ["subscription_id", "customer_id", "snapshot_date", "mrr", "subscription_status", "segment"] as const;
/** The invoice fields the invoice source reads. */
export const INVOICE_FIELDS = ["invoice_id", "subscription_id", "customer_id", "snapshot_date", "service_period_start", "service_period_end", "recurring_amount"] as const;
/** The usage_record fields the usage branch reads. */
export const USAGE_FIELDS = ["subscription_id", "customer_id", "period_start", "period_end", "committed_amount", "usage_amount"] as const;
/** The revenue_event fields the derivation writes, in column order. */
export const DERIVED_FIELDS = ["event_id", "event_date", "customer_id", "subscription_id", "event_type", "mrr_change", "currency", "prior_mrr", "new_mrr", "expansion_classification", "change_nature", "lifecycle_attribution", "segment"] as const;

export type DerivationSource = "subscription" | "invoice";
export const DERIVATION_SOURCES: readonly DerivationSource[] = ["subscription", "invoice"];

export interface DerivationOptions {
  dialect?: DialectName;
  /** ISO 4217 code written on every event: the ledger's currency (the subscription dataset carries none). */
  currency: string;
  /**
   * What the rows on the ledger's first snapshot date are: `opening` (the default) seeds each customer's
   * MRR and produces no event, for a ledger that starts after the oldest subscription; `steps` treats them
   * as steps from 0, for a ledger that starts with the business.
   */
  firstSnapshot?: "opening" | "steps";
  /** The ledger: the `subscription` dataset (the default) or the `invoice` dataset read as one row per service period. */
  source?: DerivationSource;
  /** Read the `usage_record` dataset too and add the usage realisation pairs. */
  usage?: boolean;
}

const ph = (field: string, dataset: string = DERIVATION_DATASET) => `{{${field}@${dataset}}}`;
/** MRR is kept to the cent, so a chained total within half a cent of zero is zero (the sums are floats on some warehouses). */
const ZERO = "0.005";

/** The length of a period of whole days in months (365.25 / 12 days each), as a fraction. */
const monthsExpr = (d: Dialect, start: string, end: string) => `${d.periodDays(end, start)} * 12.0 / 365.25`;
/**
 * The months a period covers, from its length in months: the nearest whole
 * number (so January and February are one month each and a year is twelve), or
 * the fraction itself for a period shorter than about a fortnight.
 */
const MONTHS_COVERED = "CASE WHEN ROUND(months) < 1 THEN months ELSE ROUND(months) END";

/** The `ledger` CTE of the subscription source: one row per subscription per snapshot date, MRR when active. */
export function subscriptionLedgerSql(): string {
  return `ledger AS (
  SELECT ${ph("subscription_id")} AS subscription_id,
         ${ph("customer_id")} AS customer_id,
         ${ph("snapshot_date")} AS snapshot_date,
         ${ph("segment")} AS segment,
         CASE WHEN ${ph("subscription_status")} = 'active' THEN ROUND(COALESCE(${ph("mrr")}, 0), 2) ELSE 0 END AS mrr
  FROM {{_table:${DERIVATION_DATASET}}}
  WHERE ${ph("snapshot_date")} IS NOT NULL
)`;
}

/**
 * The `ledger` CTE of the invoice source: each invoice's latest snapshot, its MRR
 * as the recurring amount over the months of its service period, the boundaries
 * of each subscription's periods as its ledger dates and the invoices covering
 * each date summed into its MRR, up to the ledger's horizon.
 */
export function invoiceLedgerSql(dialect: DialectName = "postgres"): string {
  const d = DIALECT[dialect];
  const i = (f: string) => ph(f, "invoice");
  return `invoices AS (
  SELECT invoice_id, subscription_id, customer_id, service_period_start, service_period_end, recurring_amount
  FROM (
    SELECT ${i("invoice_id")} AS invoice_id,
           ${i("subscription_id")} AS subscription_id,
           ${i("customer_id")} AS customer_id,
           ${i("service_period_start")} AS service_period_start,
           ${i("service_period_end")} AS service_period_end,
           ${i("recurring_amount")} AS recurring_amount,
           ROW_NUMBER() OVER (PARTITION BY ${i("invoice_id")} ORDER BY ${i("snapshot_date")} DESC) AS latest
    FROM {{_table:invoice}}
    WHERE ${i("subscription_id")} IS NOT NULL AND ${i("service_period_start")} IS NOT NULL AND ${i("service_period_end")} IS NOT NULL
  ) i
  WHERE latest = 1
),
periods AS (
  SELECT invoice_id, subscription_id, customer_id, service_period_start, service_period_end,
         ROUND(COALESCE(recurring_amount, 0) / (${MONTHS_COVERED}), 2) AS mrr
  FROM (
    SELECT i.*, ${monthsExpr(d, "service_period_start", "service_period_end")} AS months FROM invoices i
  ) m
),
boundaries AS (
  SELECT subscription_id, customer_id, service_period_start AS snapshot_date FROM periods
  UNION
  SELECT subscription_id, customer_id, CAST(${d.plus("service_period_end", 1, "day")} AS DATE) FROM periods
),
horizon AS (
  SELECT MAX(service_period_start) AS latest FROM periods
),
ledger AS (
  SELECT b.subscription_id, b.customer_id, b.snapshot_date,
         ${d.toText("NULL")} AS segment,
         ROUND(COALESCE(SUM(p.mrr), 0), 2) AS mrr
  FROM boundaries b
  LEFT JOIN periods p ON p.subscription_id = b.subscription_id AND p.service_period_start <= b.snapshot_date AND b.snapshot_date <= p.service_period_end
  WHERE b.snapshot_date <= (SELECT latest FROM horizon)
  GROUP BY b.subscription_id, b.customer_id, b.snapshot_date
)`;
}

/**
 * The usage CTEs: each period whose usage exceeds its commitment, the overage
 * over the months the period covers, and the pair of changes it adds to the
 * customer's steps, a `usage` increase on the period's end and a
 * `usage_reversal` decrease the day after.
 */
export function usageChangesSql(dialect: DialectName = "postgres"): string {
  const d = DIALECT[dialect];
  const u = (f: string) => ph(f, "usage_record");
  return `usage_periods AS (
  SELECT subscription_id, customer_id, period_end,
         ROUND(overage / (${MONTHS_COVERED}), 2) AS overage
  FROM (
    SELECT ${u("subscription_id")} AS subscription_id,
           ${u("customer_id")} AS customer_id,
           ${u("period_end")} AS period_end,
           ${u("usage_amount")} - ${u("committed_amount")} AS overage,
           ${monthsExpr(d, u("period_start"), u("period_end"))} AS months
    FROM {{_table:usage_record}}
    WHERE ${u("period_start")} IS NOT NULL AND ${u("period_end")} IS NOT NULL
      AND ${u("usage_amount")} > ${u("committed_amount")}
  ) u
),
usage_changes AS (
  SELECT subscription_id, customer_id, period_end AS snapshot_date, ${d.toText("NULL")} AS segment, 0 AS opening, overage AS mrr_change, 'usage' AS kind
  FROM usage_periods WHERE overage >= 0.01
  UNION ALL
  SELECT subscription_id, customer_id, CAST(${d.plus("period_end", 1, "day")} AS DATE), ${d.toText("NULL")}, 0, -overage, 'usage_reversal'
  FROM usage_periods WHERE overage >= 0.01
)`;
}

/** The SQL that derives revenue events from the ledger (and the usage records), with compiler placeholders. */
export function revenueEventDerivationSql(opts: DerivationOptions): string {
  const d = DIALECT[opts.dialect ?? "postgres"];
  if (!/^[A-Z]{3}$/.test(opts.currency)) throw new Error(`currency must be an ISO 4217 code, got ${JSON.stringify(opts.currency)}`);
  const source = opts.source ?? "subscription";
  if (!DERIVATION_SOURCES.includes(source)) throw new Error(`source must be one of ${DERIVATION_SOURCES.join(", ")}, got ${JSON.stringify(source)}`);
  const opening = opts.firstSnapshot === "steps" ? "0" : "CASE WHEN snapshot_date = MIN(snapshot_date) OVER () THEN 1 ELSE 0 END";
  // Within a date a customer's increases come before its decreases, then subscription id and kind, so the chained MRR is deterministic.
  const chain = "PARTITION BY c.customer_id ORDER BY c.snapshot_date, CASE WHEN c.mrr_change > 0 THEN 0 ELSE 1 END, c.subscription_id, c.kind";
  const ledger = source === "invoice" ? invoiceLedgerSql(d.name) : subscriptionLedgerSql();
  const usage = opts.usage ? `,
${usageChangesSql(d.name)}` : "";
  const union = opts.usage ? `
  UNION ALL
  SELECT subscription_id, customer_id, snapshot_date, segment, opening, mrr_change, kind FROM usage_changes` : "";
  return `WITH ${ledger},
steps AS (
  SELECT subscription_id, customer_id, snapshot_date, segment, mrr,
         COALESCE(LAG(mrr) OVER (PARTITION BY subscription_id ORDER BY snapshot_date), 0) AS prior_sub_mrr,
         ${opening} AS opening
  FROM ledger
)${usage},
changes AS (
  SELECT subscription_id, customer_id, snapshot_date, segment, opening,
         mrr - prior_sub_mrr AS mrr_change, 'ledger' AS kind
  FROM steps
  WHERE mrr <> prior_sub_mrr${union}
),
day_changes AS (
  SELECT customer_id, snapshot_date, SUM(mrr_change) AS day_change
  FROM changes
  GROUP BY customer_id, snapshot_date
),
days AS (
  SELECT customer_id, snapshot_date, day_change,
         SUM(day_change) OVER (PARTITION BY customer_id ORDER BY snapshot_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS day_end
  FROM day_changes
),
day_state AS (
  SELECT customer_id, snapshot_date, day_end - day_change AS day_start, day_end,
         COALESCE(MAX(CASE WHEN day_end > ${ZERO} THEN 1 ELSE 0 END) OVER (PARTITION BY customer_id ORDER BY snapshot_date ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS active_before
  FROM days
),
chained AS (
  SELECT c.subscription_id, c.customer_id, c.snapshot_date, c.segment, c.opening, c.mrr_change, c.kind,
         COALESCE(SUM(c.mrr_change) OVER (${chain} ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prior_mrr,
         SUM(c.mrr_change) OVER (${chain} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS new_mrr,
         s.day_start, s.day_end, s.active_before
  FROM changes c
  JOIN day_state s ON s.customer_id = c.customer_id AND s.snapshot_date = c.snapshot_date
),
typed AS (
  SELECT subscription_id, customer_id, snapshot_date, segment, opening, mrr_change, prior_mrr, new_mrr, kind,
         CASE
           WHEN kind = 'usage' THEN 'expansion'
           WHEN kind = 'usage_reversal' THEN 'contraction'
           WHEN mrr_change > 0 AND ABS(day_start) < ${ZERO} AND active_before = 1 THEN 'reactivation'
           WHEN mrr_change > 0 AND ABS(day_start) < ${ZERO} THEN 'new'
           WHEN mrr_change < 0 AND ABS(day_end) < ${ZERO} THEN 'churn'
           WHEN mrr_change > 0 THEN 'expansion'
           ELSE 'contraction'
         END AS event_type
  FROM chained
)
SELECT ${d.toText("subscription_id")} || CASE WHEN kind = 'ledger' THEN ':' ELSE ':usage:' END || ${d.toText("snapshot_date")} AS event_id,
       snapshot_date AS event_date,
       customer_id,
       subscription_id,
       event_type,
       mrr_change,
       '${opts.currency}' AS currency,
       prior_mrr,
       new_mrr,
       CASE WHEN kind = 'ledger' THEN ${d.toText("NULL")} ELSE 'usage_realisation' END AS expansion_classification,
       CASE kind WHEN 'usage' THEN 'temporary' WHEN 'usage_reversal' THEN 'scheduled_reversal' ELSE 'permanent' END AS change_nature,
       CASE event_type
         WHEN 'new' THEN 'acquisition'
         WHEN 'expansion' THEN 'expansion'
         WHEN 'reactivation' THEN 'reactivation'
         ELSE 'retention'
       END AS lifecycle_attribution,
       segment
FROM typed
WHERE opening = 0
ORDER BY snapshot_date, customer_id, CASE WHEN mrr_change > 0 THEN 0 ELSE 1 END, subscription_id, kind`;
}

/** The (field, dataset) pairs the derivation reads for the given source and usage setting. */
export function derivationPairs(opts: Pick<DerivationOptions, "source" | "usage">): Array<[field: string, dataset: string]> {
  const source = opts.source ?? "subscription";
  const ledger: Array<[string, string]> = source === "invoice" ? INVOICE_FIELDS.map((f) => [f, "invoice"]) : DERIVATION_FIELDS.map((f) => [f, DERIVATION_DATASET]);
  return opts.usage ? [...ledger, ...USAGE_FIELDS.map((f): [string, string] => [f, "usage_record"])] : ledger;
}

/** The derivation as a query template, so `fillTemplate` resolves it over an adapter or Ossie mapping like a metric's. */
export function revenueEventDerivation(opts: DerivationOptions): QueryTemplate {
  const source = opts.source ?? "subscription";
  const pairs = derivationPairs(opts);
  const datasets = [...new Set(pairs.map(([, ds]) => ds))];
  return {
    metric: "cel_revenue_events",
    fields: [...new Set(pairs.map(([f]) => f))],
    datasets,
    sourceTable: source,
    grain: "event",
    frequency: source === "invoice" ? "as the service periods start and end" : "as the ledger is snapshotted",
    source: source === "invoice" ? "invoice ledger" : "subscription ledger",
    parameterizedQuery: revenueEventDerivationSql(opts),
    staged: false,
    placeholders: pairs.map(([f, ds]) => `${f}@${ds}`),
  };
}

/** The reference SQL over the GASP field names, as cel.md prints it. */
export function referenceDerivationSql(currency = "USD"): string {
  return exampleSql(revenueEventDerivationSql({ dialect: "postgres", currency }));
}

/** The invoice source's ledger CTEs over the GASP field names, as cel.md prints them. */
export function referenceInvoiceLedgerSql(): string {
  return exampleSql(invoiceLedgerSql("postgres"));
}

/** The usage CTEs over the GASP field names, as cel.md prints them. */
export function referenceUsageSql(): string {
  return exampleSql(usageChangesSql("postgres"));
}

// ── the derive_cel tool ──────────────────────────────────────────────────────

export interface DeriveCelOptions {
  dialect?: string;
  currency?: string;
  firstSnapshot?: "opening" | "steps";
  source?: string;
  usage?: boolean;
  output?: "report" | "sql";
}

/**
 * The derive_cel tool: the derivation compiled over a company's mapping (a GASP
 * adapter or an Ossie mapping with its model), from the subscription or the
 * invoice dataset, with the usage records when the mapping covers them, in the
 * dialect asked for or the one the adapter's warehouse names, as a report or
 * the SQL alone.
 */
export function deriveCelFromText(documentText: string | undefined, modelText: string | undefined, data: StandardData, opts: DeriveCelOptions = {}): string {
  if (!documentText?.trim()) return "Pass adapter: your mapping as text, a GASP adapter (JSON) or an Ossie mapping document (YAML or JSON) with its semantic_model. Check it with validate_mapping first.";
  const currency = opts.currency?.trim().toUpperCase();
  if (!currency) return "Pass currency: the ISO 4217 code of the ledger's currency (USD, EUR, GBP ...). Every derived event carries it; the subscription dataset has no currency field to read it from.";
  if (!/^[A-Z]{3}$/.test(currency)) return `currency must be a three-letter ISO 4217 code, got ${JSON.stringify(opts.currency)}.`;
  const source = (opts.source?.trim().toLowerCase() || "subscription") as DerivationSource;
  if (!DERIVATION_SOURCES.includes(source)) return `source must be one of ${DERIVATION_SOURCES.join(", ")}, got ${JSON.stringify(opts.source)}.`;
  const loaded = loadAdapter(documentText, modelText, data);
  if (!loaded.adapter) return loaded.error!;
  const chosen = chooseDialect(opts.dialect, loaded.adapter.warehouse);
  if ("error" in chosen) return chosen.error;
  const resolved = resolveAdapter(loaded.adapter, data);
  const usageMapped = Boolean(resolved.tables.usage_record) || Object.keys(resolved.columns.usage_record ?? {}).length > 0;
  const usage = opts.usage ?? usageMapped;
  const template = revenueEventDerivation({ dialect: chosen.dialect, currency, firstSnapshot: opts.firstSnapshot, source, usage });
  const r = fillTemplate(template, loaded.adapter, data);
  if (opts.output === "sql") return r.sql;
  const ledgerName = source === "invoice" ? "invoice ledger" : "subscription ledger";
  const rulesAnchor = source === "invoice" ? "cel.md#deriving-revenue-events-from-an-invoice-ledger" : "cel.md#deriving-revenue-events-from-a-subscription-ledger";
  const ledgerPairs = template.placeholders.filter((p) => !p.endsWith("@usage_record"));
  const usagePairs = template.placeholders.filter((p) => p.endsWith("@usage_record"));
  const mappedOf = (pairs: string[]) => pairs.filter((p) => r.mapped.some((m) => `${m.field}@${m.dataset}` === p)).length;
  const p: string[] = [
    `# CEL Revenue_Events derived from your ${ledgerName}${usage ? " and usage records" : ""}`,
    `**Rules:** ${resolveDocLink(rulesAnchor)}${usage ? ` and ${resolveDocLink("cel.md#deriving-usage-realisation")}` : ""}`,
    `**Mapping:** ${loaded.format === "v1" ? "GASP adapter" : "Ossie mapping"}${loaded.adapter.organization ? ` (${loaded.adapter.organization})` : ""}`,
    `**Warehouse:** ${loaded.adapter.warehouse || "not specified"}`,
    `**Dialect:** ${chosen.note}`,
    `**Reads:** the \`${source}\` dataset, ${mappedOf(ledgerPairs)} / ${ledgerPairs.length} fields mapped${usage ? `; the \`usage_record\` dataset, ${mappedOf(usagePairs)} / ${usagePairs.length} fields mapped${opts.usage === undefined ? " (read because the mapping covers it; pass usage: false to leave it out)" : ""}` : usageMapped ? "" : "; no usage records (map the `usage_record` dataset, or pass usage: true, for the usage realisation events)"}`,
    `**Writes:** one \`revenue_event\` row per movement (${DERIVED_FIELDS.join(", ")}), currency \`${currency}\``,
  ];
  if (r.missingFields.length) p.push(`**Unmapped fields (left as placeholders):** \`${r.missingFields.join("\`, \`")}\`. Map each on its dataset and run again.`);
  if (r.missingTables.length) p.push(`**Dataset with no table:** ${r.missingTables.join(", ")}. Name its table under "datasets" in the adapter, or map one of its fields with a schema.table column reference.`);
  for (const c of r.conflicts) p.push(`**Conflict:** ${c}`);
  const firstRows = opts.firstSnapshot === "steps"
    ? "Every first row is a step from 0 (first_snapshot: steps), so the ledger must start with the business."
    : "Rows on the ledger's first date are opening balances and produce no event; a customer that churned before the ledger starts comes back as new, not reactivation. Pass first_snapshot: steps if the ledger starts with the business.";
  const limits = source === "invoice"
    ? `**What the invoices can and cannot say.** Each invoice is read at its latest snapshot as one service period: its MRR is \`recurring_amount\` over the months the period covers (whole months for monthly, quarterly and annual billing; a prorated invoice for part of a period is approximate). A subscription's MRR on a date is the sum over the invoices covering it, its ledger dates are the starts of its service periods and the day after each end, and a date after the ledger's horizon (the latest service period start) is not read, so a subscription whose last invoice is still current does not churn. Invoices with no subscription or no service period (one-off charges) produce no event. ${firstRows} Each movement is dated the service period that first bills it, so a change agreed mid-period shows on the next period's start unless a prorated invoice was issued. The invoice dataset carries no segment, so \`segment\` is empty; fill it from the customer snapshot. \`expansion_classification\` is empty: the invoices show that MRR rose, not what was bought, and the Operating forms of ARR and NRR read that tag; fill it from your amendment records or record the classification as a decision. Where a subscription ledger exists it is the better source (source: subscription).`
    : `**What the ledger can and cannot say.** Each movement is dated the snapshot that first shows it, so the ledger's cadence is the grain of the events: daily snapshots show every movement on its day, month-end snapshots net a month's movements into one event dated the month end. ${firstRows} The ledger needs one row per subscription per snapshot date and must keep a cancelled subscription's row; a subscription that stops appearing produces no churn. A null MRR on an active row counts as 0. \`expansion_classification\` is empty: the ledger shows that MRR rose, not what was bought, and the Operating forms of ARR and NRR read that tag; fill it from your amendment records or record the classification as a decision. Renewals change no MRR and are not derived here.`;
  p.push("", limits);
  if (usage) p.push("", "**Usage realisation.** Each usage period whose `usage_amount` exceeds its `committed_amount` adds a pair of events: an `expansion` dated the period's end for the overage over the months the period covers, tagged `usage_realisation` with `change_nature` `temporary`, and a `contraction` the next day with `change_nature` `scheduled_reversal`. The commitment is already in the subscription's MRR, so usage within it is no event, and a commitment raised to cover the usage shows on the ledger as a permanent expansion. The pairs chain with the ledger's steps, so `prior_mrr` and `new_mrr` hold across both. Their ids are `<subscription_id>:usage:<date>`.");
  p.push(
    "",
    `Run the query to build (or rebuild) the \`revenue_event\` table; it reads the whole ledger and carries no period parameters. Map the result as the \`revenue_event\` dataset and the MRR movement metrics, NRR and GRR compile over it with generate_query or compile_model.`,
    "",
    "\`\`\`sql\n" + r.sql + "\n\`\`\`",
  );
  if (r.mapped.length) {
    p.push("", "**Field mapping used:**");
    for (const m of r.mapped) p.push(`- \`${m.field}\` (${m.dataset}) → \`${m.ref}\`${m.transform ? ` (transform: ${m.transform})` : ""}`);
  }
  return p.join("\n");
}
