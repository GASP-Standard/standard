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
 * The template uses the compiler's placeholders ({{field@dataset}},
 * {{_table:dataset}}), so `fillTemplate` compiles it over any adapter or Ossie
 * mapping that covers the six subscription fields it reads.
 */
import { DIALECT, type DialectName } from "./dialect.js";
import { exampleSql } from "./compile.js";
import { chooseDialect, fillTemplate } from "./tools.js";
import { loadAdapter } from "./ossie/adapt.js";
import { resolveDocLink } from "./urls.js";
import type { QueryTemplate, StandardData } from "./types.js";

export const DERIVATION_DATASET = "subscription";
/** The subscription fields the derivation reads, in the order the ledger CTE selects them. */
export const DERIVATION_FIELDS = ["subscription_id", "customer_id", "snapshot_date", "mrr", "subscription_status", "segment"] as const;
/** The revenue_event fields the derivation writes, in column order. */
export const DERIVED_FIELDS = ["event_id", "event_date", "customer_id", "subscription_id", "event_type", "mrr_change", "currency", "prior_mrr", "new_mrr", "expansion_classification", "change_nature", "lifecycle_attribution", "segment"] as const;

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
}

const ph = (field: string) => `{{${field}@${DERIVATION_DATASET}}}`;
/** MRR is kept to the cent, so a chained total within half a cent of zero is zero (the sums are floats on some warehouses). */
const ZERO = "0.005";

/** The SQL that derives revenue events from the subscription ledger, with compiler placeholders. */
export function revenueEventDerivationSql(opts: DerivationOptions): string {
  const d = DIALECT[opts.dialect ?? "postgres"];
  if (!/^[A-Z]{3}$/.test(opts.currency)) throw new Error(`currency must be an ISO 4217 code, got ${JSON.stringify(opts.currency)}`);
  const opening = opts.firstSnapshot === "steps" ? "0" : "CASE WHEN snapshot_date = MIN(snapshot_date) OVER () THEN 1 ELSE 0 END";
  // Within a date a customer's increases come before its decreases, then subscription id, so the chained MRR is deterministic.
  const chain = "PARTITION BY c.customer_id ORDER BY c.snapshot_date, CASE WHEN c.mrr_change > 0 THEN 0 ELSE 1 END, c.subscription_id";
  return `WITH ledger AS (
  SELECT ${ph("subscription_id")} AS subscription_id,
         ${ph("customer_id")} AS customer_id,
         ${ph("snapshot_date")} AS snapshot_date,
         ${ph("segment")} AS segment,
         CASE WHEN ${ph("subscription_status")} = 'active' THEN ROUND(COALESCE(${ph("mrr")}, 0), 2) ELSE 0 END AS mrr
  FROM {{_table:${DERIVATION_DATASET}}}
  WHERE ${ph("snapshot_date")} IS NOT NULL
),
steps AS (
  SELECT subscription_id, customer_id, snapshot_date, segment, mrr,
         COALESCE(LAG(mrr) OVER (PARTITION BY subscription_id ORDER BY snapshot_date), 0) AS prior_sub_mrr,
         ${opening} AS opening
  FROM ledger
),
changes AS (
  SELECT subscription_id, customer_id, snapshot_date, segment, opening,
         mrr - prior_sub_mrr AS mrr_change
  FROM steps
  WHERE mrr <> prior_sub_mrr
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
  SELECT c.subscription_id, c.customer_id, c.snapshot_date, c.segment, c.opening, c.mrr_change,
         COALESCE(SUM(c.mrr_change) OVER (${chain} ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prior_mrr,
         SUM(c.mrr_change) OVER (${chain} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS new_mrr,
         s.day_start, s.day_end, s.active_before
  FROM changes c
  JOIN day_state s ON s.customer_id = c.customer_id AND s.snapshot_date = c.snapshot_date
),
typed AS (
  SELECT subscription_id, customer_id, snapshot_date, segment, opening, mrr_change, prior_mrr, new_mrr,
         CASE
           WHEN mrr_change > 0 AND ABS(day_start) < ${ZERO} AND active_before = 1 THEN 'reactivation'
           WHEN mrr_change > 0 AND ABS(day_start) < ${ZERO} THEN 'new'
           WHEN mrr_change < 0 AND ABS(day_end) < ${ZERO} THEN 'churn'
           WHEN mrr_change > 0 THEN 'expansion'
           ELSE 'contraction'
         END AS event_type
  FROM chained
)
SELECT ${d.toText("subscription_id")} || ':' || ${d.toText("snapshot_date")} AS event_id,
       snapshot_date AS event_date,
       customer_id,
       subscription_id,
       event_type,
       mrr_change,
       '${opts.currency}' AS currency,
       prior_mrr,
       new_mrr,
       ${d.toText("NULL")} AS expansion_classification,
       'permanent' AS change_nature,
       CASE event_type
         WHEN 'new' THEN 'acquisition'
         WHEN 'expansion' THEN 'expansion'
         WHEN 'reactivation' THEN 'reactivation'
         ELSE 'retention'
       END AS lifecycle_attribution,
       segment
FROM typed
WHERE opening = 0
ORDER BY snapshot_date, customer_id, CASE WHEN mrr_change > 0 THEN 0 ELSE 1 END, subscription_id`;
}

/** The derivation as a query template, so `fillTemplate` resolves it over an adapter or Ossie mapping like a metric's. */
export function revenueEventDerivation(opts: DerivationOptions): QueryTemplate {
  return {
    metric: "cel_revenue_events",
    fields: [...DERIVATION_FIELDS],
    datasets: [DERIVATION_DATASET],
    sourceTable: DERIVATION_DATASET,
    grain: "event",
    frequency: "as the ledger is snapshotted",
    source: "subscription ledger",
    parameterizedQuery: revenueEventDerivationSql(opts),
    staged: false,
    placeholders: DERIVATION_FIELDS.map((f) => `${f}@${DERIVATION_DATASET}`),
  };
}

/** The reference SQL over the GASP field names, as cel.md prints it. */
export function referenceDerivationSql(currency = "USD"): string {
  return exampleSql(revenueEventDerivationSql({ dialect: "postgres", currency }));
}

// ── the derive_cel tool ──────────────────────────────────────────────────────

export interface DeriveCelOptions {
  dialect?: string;
  currency?: string;
  firstSnapshot?: "opening" | "steps";
  output?: "report" | "sql";
}

/**
 * The derive_cel tool: the derivation compiled over a company's mapping (a GASP
 * adapter or an Ossie mapping with its model), in the dialect asked for or the
 * one the adapter's warehouse names, as a report or the SQL alone.
 */
export function deriveCelFromText(documentText: string | undefined, modelText: string | undefined, data: StandardData, opts: DeriveCelOptions = {}): string {
  if (!documentText?.trim()) return "Pass adapter: your mapping as text, a GASP adapter (JSON) or an Ossie mapping document (YAML or JSON) with its semantic_model. Check it with validate_mapping first.";
  const currency = opts.currency?.trim().toUpperCase();
  if (!currency) return "Pass currency: the ISO 4217 code of the ledger's currency (USD, EUR, GBP ...). Every derived event carries it; the subscription dataset has no currency field to read it from.";
  if (!/^[A-Z]{3}$/.test(currency)) return `currency must be a three-letter ISO 4217 code, got ${JSON.stringify(opts.currency)}.`;
  const loaded = loadAdapter(documentText, modelText, data);
  if (!loaded.adapter) return loaded.error!;
  const chosen = chooseDialect(opts.dialect, loaded.adapter.warehouse);
  if ("error" in chosen) return chosen.error;
  const template = revenueEventDerivation({ dialect: chosen.dialect, currency, firstSnapshot: opts.firstSnapshot });
  const r = fillTemplate(template, loaded.adapter, data);
  if (opts.output === "sql") return r.sql;
  const p: string[] = [
    "# CEL Revenue_Events derived from your subscription ledger",
    `**Rules:** ${resolveDocLink("cel.md#deriving-revenue-events-from-a-subscription-ledger")}`,
    `**Mapping:** ${loaded.format === "v1" ? "GASP adapter" : "Ossie mapping"}${loaded.adapter.organization ? ` (${loaded.adapter.organization})` : ""}`,
    `**Warehouse:** ${loaded.adapter.warehouse || "not specified"}`,
    `**Dialect:** ${chosen.note}`,
    `**Reads:** the \`${DERIVATION_DATASET}\` dataset, ${r.mapped.length} / ${template.placeholders.length} fields mapped`,
    `**Writes:** one \`revenue_event\` row per movement (${DERIVED_FIELDS.join(", ")}), currency \`${currency}\``,
  ];
  if (r.missingFields.length) p.push(`**Unmapped fields (left as placeholders):** \`${r.missingFields.join("\`, \`")}\`. Map each on the \`${DERIVATION_DATASET}\` dataset and run again.`);
  if (r.missingTables.length) p.push(`**Dataset with no table:** ${r.missingTables.join(", ")}. Name its table under "datasets" in the adapter, or map one of its fields with a schema.table column reference.`);
  for (const c of r.conflicts) p.push(`**Conflict:** ${c}`);
  p.push(
    "",
    `**What the ledger can and cannot say.** Each movement is dated the snapshot that first shows it, so the ledger's cadence is the grain of the events: daily snapshots show every movement on its day, month-end snapshots net a month's movements into one event dated the month end. ${opts.firstSnapshot === "steps" ? "Every first row is a step from 0 (first_snapshot: steps), so the ledger must start with the business." : "Rows on the ledger's first snapshot date are opening balances and produce no event; a customer that churned before the ledger starts comes back as new, not reactivation. Pass first_snapshot: steps if the ledger starts with the business."} The ledger needs one row per subscription per snapshot date and must keep a cancelled subscription's row; a subscription that stops appearing produces no churn. A null MRR on an active row counts as 0. \`expansion_classification\` is empty: the ledger shows that MRR rose, not what was bought, and the Operating forms of ARR and NRR read that tag; fill it from your amendment records or record the classification as a decision. Renewals change no MRR and are not derived here.`,
    "",
    `Run the query to build (or rebuild) the \`revenue_event\` table; it reads the whole ledger and carries no period parameters. Map the result as the \`revenue_event\` dataset and the MRR movement metrics, NRR and GRR compile over it with generate_query or compile_model.`,
    "",
    "```sql\n" + r.sql + "\n```",
  );
  if (r.mapped.length) {
    p.push("", "**Field mapping used:**");
    for (const m of r.mapped) p.push(`- \`${m.field}\` (${m.dataset}) → \`${m.ref}\`${m.transform ? ` (transform: ${m.transform})` : ""}`);
  }
  return p.join("\n");
}
