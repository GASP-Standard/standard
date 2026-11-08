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
 *   - A credit ledger (`usage: true, usageSource: "credit_event"`) gives the
 *     same pairs from its `consumption` events with basis `overage`: a month's
 *     overage for a subscription is the sum of their amounts, negated, and the
 *     pair is dated the month's last day and the next day (cel.md, "Deriving
 *     Credit Events", "Realisation from the Credit Ledger"). Where the usage
 *     records exist they are the source, so the overage is never derived twice.
 *
 * The other way round, `creditEventDerivation` writes `credit_event` rows from
 * the usage records: one `consumption` with basis `overage` per period over its
 * commitment, for the amount the period bills beyond it (cel.md, "Consumption
 * Events from Usage Records").
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
/** The credit_event fields the credit-ledger usage branch reads. */
export const CREDIT_USAGE_FIELDS = ["subscription_id", "customer_id", "event_date", "credit_event_type", "consumption_basis", "credit_amount"] as const;
/** The usage_record fields the credit event derivation reads. */
export const CREDIT_SOURCE_FIELDS = ["subscription_id", "customer_id", "period_end", "committed_amount", "usage_amount"] as const;
/** The credit_event fields the credit event derivation writes, in column order. */
export const CREDIT_DERIVED_FIELDS = ["event_id", "event_date", "customer_id", "subscription_id", "credit_event_type", "credit_amount", "consumption_basis", "credit_balance_before", "credit_balance_after", "expires_on", "currency", "segment"] as const;
/** The revenue_event fields the derivation writes, in column order. */
export const DERIVED_FIELDS = ["event_id", "event_date", "customer_id", "subscription_id", "event_type", "mrr_change", "currency", "prior_mrr", "new_mrr", "expansion_classification", "change_nature", "lifecycle_attribution", "segment"] as const;

export type DerivationSource = "subscription" | "invoice";
export const DERIVATION_SOURCES: readonly DerivationSource[] = ["subscription", "invoice"];
/** Where the usage realisation pairs come from: the usage records or the credit ledger's overage consumption. */
export type UsageSource = "usage_record" | "credit_event";
export const USAGE_SOURCES: readonly UsageSource[] = ["usage_record", "credit_event"];
/** What derive_cel writes: revenue events (the default) or credit events from the usage records. */
export type DerivationTarget = "revenue_event" | "credit_event";
export const DERIVATION_TARGETS: readonly DerivationTarget[] = ["revenue_event", "credit_event"];

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
  /** Add the usage realisation pairs, read from `usageSource`. */
  usage?: boolean;
  /**
   * With `usage`: the `usage_record` dataset (the default) or the `credit_event` dataset's `consumption`
   * events with basis `overage`, summed per subscription and calendar month. One source only, so the
   * overage is never derived twice.
   */
  usageSource?: UsageSource;
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
${usagePairsSql(d)}`;
}

/** The `usage_changes` CTE both usage sources end in: the pair of changes each row of `usage_periods` adds. */
function usagePairsSql(d: Dialect): string {
  return `usage_changes AS (
  SELECT subscription_id, customer_id, period_end AS snapshot_date, ${d.toText("NULL")} AS segment, 0 AS opening, overage AS mrr_change, 'usage' AS kind
  FROM usage_periods WHERE overage >= 0.01
  UNION ALL
  SELECT subscription_id, customer_id, CAST(${d.plus("period_end", 1, "day")} AS DATE), ${d.toText("NULL")}, 0, -overage, 'usage_reversal'
  FROM usage_periods WHERE overage >= 0.01
)`;
}

/**
 * The usage CTEs read from a credit ledger: each subscription's `consumption`
 * events with basis `overage`, their amounts negated and summed per calendar
 * month into the month's overage, dated the month's last day, and the same pair
 * of changes the usage records give.
 */
export function creditUsageChangesSql(dialect: DialectName = "postgres"): string {
  const d = DIALECT[dialect];
  const c = (f: string) => ph(f, "credit_event");
  return `usage_periods AS (
  SELECT subscription_id, customer_id, period_end,
         ROUND(SUM(overage), 2) AS overage
  FROM (
    SELECT ${c("subscription_id")} AS subscription_id,
           ${c("customer_id")} AS customer_id,
           ${d.monthEnd(c("event_date"))} AS period_end,
           -(${c("credit_amount")}) AS overage
    FROM {{_table:credit_event}}
    WHERE ${c("subscription_id")} IS NOT NULL AND ${c("event_date")} IS NOT NULL
      AND ${c("credit_event_type")} = 'consumption' AND ${c("consumption_basis")} = 'overage'
  ) c
  GROUP BY subscription_id, customer_id, period_end
),
${usagePairsSql(d)}`;
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
  const usageSource = opts.usageSource ?? "usage_record";
  if (!USAGE_SOURCES.includes(usageSource)) throw new Error(`usageSource must be one of ${USAGE_SOURCES.join(", ")}, got ${JSON.stringify(usageSource)}`);
  const ledger = source === "invoice" ? invoiceLedgerSql(d.name) : subscriptionLedgerSql();
  const usage = opts.usage ? `,
${usageSource === "credit_event" ? creditUsageChangesSql(d.name) : usageChangesSql(d.name)}` : "";
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
export function derivationPairs(opts: Pick<DerivationOptions, "source" | "usage" | "usageSource">): Array<[field: string, dataset: string]> {
  const source = opts.source ?? "subscription";
  const ledger: Array<[string, string]> = source === "invoice" ? INVOICE_FIELDS.map((f) => [f, "invoice"]) : DERIVATION_FIELDS.map((f) => [f, DERIVATION_DATASET]);
  if (!opts.usage) return ledger;
  const usage = opts.usageSource === "credit_event"
    ? CREDIT_USAGE_FIELDS.map((f): [string, string] => [f, "credit_event"])
    : USAGE_FIELDS.map((f): [string, string] => [f, "usage_record"]);
  return [...ledger, ...usage];
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

/**
 * The SQL that writes `credit_event` rows from the usage records: one
 * `consumption` with basis `overage` per period whose usage exceeds its
 * commitment, dated the period's end, for the overage the period bills (not
 * stated as MRR). Usage within the commitment is no event; the records hold no
 * balance, so the balances, `expires_on` and `segment` are empty.
 */
export function creditEventDerivationSql(opts: Pick<DerivationOptions, "dialect" | "currency">): string {
  const d = DIALECT[opts.dialect ?? "postgres"];
  if (!/^[A-Z]{3}$/.test(opts.currency)) throw new Error(`currency must be an ISO 4217 code, got ${JSON.stringify(opts.currency)}`);
  const u = (f: string) => ph(f, "usage_record");
  return `WITH overage_periods AS (
  SELECT ${u("subscription_id")} AS subscription_id,
         ${u("customer_id")} AS customer_id,
         ${u("period_end")} AS period_end,
         ROUND(${u("usage_amount")} - ${u("committed_amount")}, 2) AS overage
  FROM {{_table:usage_record}}
  WHERE ${u("period_end")} IS NOT NULL
    AND ${u("usage_amount")} > ${u("committed_amount")}
)
SELECT ${d.toText("subscription_id")} || ':overage:' || ${d.toText("period_end")} AS event_id,
       period_end AS event_date,
       customer_id,
       subscription_id,
       'consumption' AS credit_event_type,
       -overage AS credit_amount,
       'overage' AS consumption_basis,
       CAST(NULL AS DECIMAL(18, 2)) AS credit_balance_before,
       CAST(NULL AS DECIMAL(18, 2)) AS credit_balance_after,
       CAST(NULL AS DATE) AS expires_on,
       '${opts.currency}' AS currency,
       ${d.toText("NULL")} AS segment
FROM overage_periods
WHERE overage >= 0.01
ORDER BY period_end, customer_id, subscription_id`;
}

/** The credit event derivation as a query template, for `fillTemplate`. */
export function creditEventDerivation(opts: Pick<DerivationOptions, "dialect" | "currency">): QueryTemplate {
  const pairs = CREDIT_SOURCE_FIELDS.map((f): [string, string] => [f, "usage_record"]);
  return {
    metric: "cel_credit_events",
    fields: pairs.map(([f]) => f),
    datasets: ["usage_record"],
    sourceTable: "usage_record",
    grain: "event",
    frequency: "as the usage periods close",
    source: "usage records",
    parameterizedQuery: creditEventDerivationSql(opts),
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

/** The credit ledger's usage CTEs over the GASP field names, as cel.md prints them. */
export function referenceCreditUsageSql(): string {
  return exampleSql(creditUsageChangesSql("postgres"));
}

/** The credit event derivation over the GASP field names, as cel.md prints it. */
export function referenceCreditEventSql(currency = "USD"): string {
  return exampleSql(creditEventDerivationSql({ dialect: "postgres", currency }));
}

// ── the derive_cel tool ──────────────────────────────────────────────────────

export interface DeriveCelOptions {
  dialect?: string;
  currency?: string;
  firstSnapshot?: "opening" | "steps";
  source?: string;
  usage?: boolean;
  /** Where the usage realisation pairs come from; default the usage records when mapped, else the credit ledger when mapped. */
  usageSource?: string;
  /** What to derive: revenue events (the default) or credit events from the usage records. */
  target?: string;
  output?: "report" | "sql";
}

/**
 * The derive_cel tool: the derivation compiled over a company's mapping (a GASP
 * adapter or an Ossie mapping with its model), from the subscription or the
 * invoice dataset, with the usage records (or else the credit ledger's overage)
 * when the mapping covers them, in the dialect asked for or the one the
 * adapter's warehouse names, as a report or the SQL alone. With target
 * credit_event, the credit events the usage records give instead.
 */
export function deriveCelFromText(documentText: string | undefined, modelText: string | undefined, data: StandardData, opts: DeriveCelOptions = {}): string {
  if (!documentText?.trim()) return "Pass adapter: your mapping as text, a GASP adapter (JSON) or an Ossie mapping document (YAML or JSON) with its semantic_model. Check it with validate_mapping first.";
  const currency = opts.currency?.trim().toUpperCase();
  if (!currency) return "Pass currency: the ISO 4217 code of the ledger's currency (USD, EUR, GBP ...). Every derived event carries it; the subscription dataset has no currency field to read it from.";
  if (!/^[A-Z]{3}$/.test(currency)) return `currency must be a three-letter ISO 4217 code, got ${JSON.stringify(opts.currency)}.`;
  const source = (opts.source?.trim().toLowerCase() || "subscription") as DerivationSource;
  if (!DERIVATION_SOURCES.includes(source)) return `source must be one of ${DERIVATION_SOURCES.join(", ")}, got ${JSON.stringify(opts.source)}.`;
  const target = (opts.target?.trim().toLowerCase() || "revenue_event") as DerivationTarget;
  if (!DERIVATION_TARGETS.includes(target)) return `target must be one of ${DERIVATION_TARGETS.join(", ")}, got ${JSON.stringify(opts.target)}.`;
  const askedUsageSource = opts.usageSource?.trim().toLowerCase() as UsageSource | undefined;
  if (askedUsageSource && !USAGE_SOURCES.includes(askedUsageSource)) return `usage_source must be one of ${USAGE_SOURCES.join(", ")}, got ${JSON.stringify(opts.usageSource)}.`;
  const loaded = loadAdapter(documentText, modelText, data);
  if (!loaded.adapter) return loaded.error!;
  const chosen = chooseDialect(opts.dialect, loaded.adapter.warehouse);
  if ("error" in chosen) return chosen.error;
  const resolved = resolveAdapter(loaded.adapter, data);
  const covers = (ds: string) => Boolean(resolved.tables[ds]) || Object.keys(resolved.columns[ds] ?? {}).length > 0;
  const usageMapped = covers("usage_record");
  const creditMapped = covers("credit_event");
  const header = (title: string, rules: string): string[] => [
    title,
    `**Rules:** ${rules}`,
    `**Mapping:** ${loaded.format === "v1" ? "GASP adapter" : "Ossie mapping"}${loaded.adapter!.organization ? ` (${loaded.adapter!.organization})` : ""}`,
    `**Warehouse:** ${loaded.adapter!.warehouse || "not specified"}`,
    `**Dialect:** ${chosen.note}`,
  ];
  const problems = (r: ReturnType<typeof fillTemplate>): string[] => [
    ...(r.missingFields.length ? [`**Unmapped fields (left as placeholders):** \`${r.missingFields.join("\`, \`")}\`. Map each on its dataset and run again.`] : []),
    ...(r.missingTables.length ? [`**Dataset with no table:** ${r.missingTables.join(", ")}. Name its table under "datasets" in the adapter, or map one of its fields with a schema.table column reference.`] : []),
    ...r.conflicts.map((c) => `**Conflict:** ${c}`),
  ];
  const mappingUsed = (r: ReturnType<typeof fillTemplate>): string[] =>
    r.mapped.length ? ["", "**Field mapping used:**", ...r.mapped.map((m) => `- \`${m.field}\` (${m.dataset}) → \`${m.ref}\`${m.transform ? ` (transform: ${m.transform})` : ""}`)] : [];
  const mappedOf = (r: ReturnType<typeof fillTemplate>, pairs: string[]) => pairs.filter((p) => r.mapped.some((m) => `${m.field}@${m.dataset}` === p)).length;

  if (target === "credit_event") {
    const template = creditEventDerivation({ dialect: chosen.dialect, currency });
    const r = fillTemplate(template, loaded.adapter, data);
    if (opts.output === "sql") return r.sql;
    const p = [
      ...header("# CEL Credit_Events derived from your usage records", resolveDocLink("cel.md#consumption-events-from-usage-records")!),
      `**Reads:** the \`usage_record\` dataset, ${mappedOf(r, template.placeholders)} / ${template.placeholders.length} fields mapped`,
      `**Writes:** one \`credit_event\` row per usage period over its commitment (${CREDIT_DERIVED_FIELDS.join(", ")}), currency \`${currency}\``,
      ...problems(r),
    ];
    if (creditMapped) p.push("**Your mapping covers the `credit_event` dataset already.** The billing system's own credit ledger is the better source; adding these rows to it would count the overage twice.");
    p.push(
      "",
      "**What the usage records can and cannot say for the credit ledger.** Each usage period whose `usage_amount` exceeds its `committed_amount` is one `consumption` event with `consumption_basis` `overage`, dated the period's end, for the amount the period bills beyond the commitment (negative, as consumption is; the whole period's charge, not stated as MRR). Its id is `<subscription_id>:overage:<period_end>`. Usage within a ratable commitment is no event: the commitment is already in the subscription's MRR. The records hold no prepaid balance, so `credit_balance_before`, `credit_balance_after` and `expires_on` are empty, and they carry no segment. A prepaid balance, its purchases, committed drawdowns and expiries come from the billing system's credit ledger, not from usage records.",
      "",
      "Run the query to build (or rebuild) the `credit_event` table from the usage records; it reads every period and carries no period parameters. Map the result as the `credit_event` dataset and Consumption Revenue compiles over it with generate_query or compile_model. Do not also derive the usage realisation from it: derive_cel reads the usage records for that.",
      "",
      "\`\`\`sql\n" + r.sql + "\n\`\`\`",
      ...mappingUsed(r),
    );
    return p.join("\n");
  }

  const usageSource: UsageSource = askedUsageSource ?? (usageMapped || !creditMapped ? "usage_record" : "credit_event");
  const usage = opts.usage ?? (askedUsageSource ? true : usageSource === "usage_record" ? usageMapped : creditMapped);
  const template = revenueEventDerivation({ dialect: chosen.dialect, currency, firstSnapshot: opts.firstSnapshot, source, usage, usageSource });
  const r = fillTemplate(template, loaded.adapter, data);
  if (opts.output === "sql") return r.sql;
  const ledgerName = source === "invoice" ? "invoice ledger" : "subscription ledger";
  const rulesAnchor = source === "invoice" ? "cel.md#deriving-revenue-events-from-an-invoice-ledger" : "cel.md#deriving-revenue-events-from-a-subscription-ledger";
  const usageDataset = usageSource;
  const ledgerPairs = template.placeholders.filter((p) => !p.endsWith(`@${usageDataset}`));
  const usagePairs = template.placeholders.filter((p) => p.endsWith(`@${usageDataset}`));
  const credit = usage && usageSource === "credit_event";
  const usageRules = credit ? "cel.md#realisation-from-the-credit-ledger" : "cel.md#deriving-usage-realisation";
  const reads = usage
    ? `; the \`${usageDataset}\` dataset${credit ? " (its overage consumption)" : ""}, ${mappedOf(r, usagePairs)} / ${usagePairs.length} fields mapped${opts.usage === undefined && !askedUsageSource ? " (read because the mapping covers it; pass usage: false to leave it out)" : ""}${usageSource === "usage_record" && creditMapped ? "; the `credit_event` dataset is mapped too and not read, so the overage is not derived twice (usage_source: credit_event reads it instead)" : ""}`
    : usageMapped || creditMapped ? "" : "; no usage records (map the `usage_record` dataset, or a credit ledger as the `credit_event` dataset, or pass usage: true, for the usage realisation events)";
  const p: string[] = [
    ...header(`# CEL Revenue_Events derived from your ${ledgerName}${usage ? (credit ? " and credit ledger" : " and usage records") : ""}`, `${resolveDocLink(rulesAnchor)}${usage ? ` and ${resolveDocLink(usageRules)}` : ""}`),
    `**Reads:** the \`${source}\` dataset, ${mappedOf(r, ledgerPairs)} / ${ledgerPairs.length} fields mapped${reads}`,
    `**Writes:** one \`revenue_event\` row per movement (${DERIVED_FIELDS.join(", ")}), currency \`${currency}\``,
    ...problems(r),
  ];
  const firstRows = opts.firstSnapshot === "steps"
    ? "Every first row is a step from 0 (first_snapshot: steps), so the ledger must start with the business."
    : "Rows on the ledger's first date are opening balances and produce no event; a customer that churned before the ledger starts comes back as new, not reactivation. Pass first_snapshot: steps if the ledger starts with the business.";
  const limits = source === "invoice"
    ? `**What the invoices can and cannot say.** Each invoice is read at its latest snapshot as one service period: its MRR is \`recurring_amount\` over the months the period covers (whole months for monthly, quarterly and annual billing; a prorated invoice for part of a period is approximate). A subscription's MRR on a date is the sum over the invoices covering it, its ledger dates are the starts of its service periods and the day after each end, and a date after the ledger's horizon (the latest service period start) is not read, so a subscription whose last invoice is still current does not churn. Invoices with no subscription or no service period (one-off charges) produce no event. ${firstRows} Each movement is dated the service period that first bills it, so a change agreed mid-period shows on the next period's start unless a prorated invoice was issued. The invoice dataset carries no segment, so \`segment\` is empty; fill it from the customer snapshot. \`expansion_classification\` is empty: the invoices show that MRR rose, not what was bought, and the Operating forms of ARR and NRR read that tag; fill it from your amendment records or record the classification as a decision. Where a subscription ledger exists it is the better source (source: subscription).`
    : `**What the ledger can and cannot say.** Each movement is dated the snapshot that first shows it, so the ledger's cadence is the grain of the events: daily snapshots show every movement on its day, month-end snapshots net a month's movements into one event dated the month end. ${firstRows} The ledger needs one row per subscription per snapshot date and must keep a cancelled subscription's row; a subscription that stops appearing produces no churn. A null MRR on an active row counts as 0. \`expansion_classification\` is empty: the ledger shows that MRR rose, not what was bought, and the Operating forms of ARR and NRR read that tag; fill it from your amendment records or record the classification as a decision. Renewals change no MRR and are not derived here.`;
  p.push("", limits);
  if (credit) p.push("", "**Usage realisation from the credit ledger.** A subscription's `consumption` events with `consumption_basis` `overage` in a calendar month sum, negated, to the month's realised usage, and each month with an overage adds a pair of events: an `expansion` dated the month's last day for that sum, tagged `usage_realisation` with `change_nature` `temporary`, and a `contraction` the next day with `change_nature` `scheduled_reversal`. Consumption drawn from a prepaid balance (basis `committed`) and pay-as-you-go consumption (`on_demand`) are no event here: the commitment is in the subscription's MRR and on-demand usage is outside it. The pairs chain with the ledger's steps, so `prior_mrr` and `new_mrr` hold across both. Their ids are `<subscription_id>:usage:<date>`. Where the usage records are mapped they are the source instead, and the credit ledger's overage is not derived twice.");
  else if (usage) p.push("", "**Usage realisation.** Each usage period whose `usage_amount` exceeds its `committed_amount` adds a pair of events: an `expansion` dated the period's end for the overage over the months the period covers, tagged `usage_realisation` with `change_nature` `temporary`, and a `contraction` the next day with `change_nature` `scheduled_reversal`. The commitment is already in the subscription's MRR, so usage within it is no event, and a commitment raised to cover the usage shows on the ledger as a permanent expansion. The pairs chain with the ledger's steps, so `prior_mrr` and `new_mrr` hold across both. Their ids are `<subscription_id>:usage:<date>`.");
  p.push(
    "",
    `Run the query to build (or rebuild) the \`revenue_event\` table; it reads the whole ledger and carries no period parameters. Map the result as the \`revenue_event\` dataset and the MRR movement metrics, NRR and GRR compile over it with generate_query or compile_model.`,
    "",
    "\`\`\`sql\n" + r.sql + "\n\`\`\`",
    ...mappingUsed(r),
  );
  return p.join("\n");
}
