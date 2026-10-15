// ═══════════════════════════════════════════════════════════════
// GASP Standard: SaaS Metric Knowledge Graph (Full Ontology)
// Generated from the GASP Standard (https://gaspwiki.com) by `npm run derive`
// ═══════════════════════════════════════════════════════════════
//
// Nodes: 65 Metrics, 28 Entities, 7 Concepts, 52 Datasets, 268 Fields, 22 Source Categories
// Edges: 91 metric relationships, 79 MEASURES, 30 entity/concept relationships, 395 BELONGS_TO, 360 SOURCED_FROM
//
// Relationship types (metric signal): DRIVES, REDUCES, PREDICTS, COMPONENT_OF, MEASURES
// Relationship types (entity): OWNS, GRANTS, PARENT_OF, PRICED_BY, CONVERTS_TO, SUBMITS, ENGAGES_VIA, MANAGES, SOURCES, SERVES, REPRESENTED_BY, GENERATES, PRODUCES, CONTRIBUTES_TO, INCURS, BELONGS_TO
// Relationship types (data lineage): BELONGS_TO (Field → Dataset), SOURCED_FROM (Field → SourceCategory)
//
// Import: paste into Neo4j Browser or pipe to cypher-shell
// ═══════════════════════════════════════════════════════════════

// Clean slate (optional, uncomment to clear existing data)
// MATCH (n) DETACH DELETE n;

// ─── Metric Nodes (65) ─────────────────────────
CREATE (:Metric {id: 'arr', name: 'ARR', department: 'Core', signalType: 'outcome', level: 1, definition: 'The annualized value of recurring revenue. ARR represents the yearly run rate of subscription revenue.', formula: 'metric.mrr * 12', url: 'https://gaspwiki.com/v1/metrics/core/arr-annual-recurring-revenue', grain: 'End-of-month snapshot', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'rule_of_40', name: 'Rule of 40', department: 'Core', signalType: 'outcome', level: 1, definition: 'A heuristic that balances growth and profitability. A healthy SaaS company\'s growth rate plus profit margin should equal 40% or more.', formula: '(metric.arr - lag(metric.arr, 1 year)) / lag(metric.arr, 1 year) + metric.ebitda_margin', url: 'https://gaspwiki.com/v1/metrics/core/rule-of-40', grain: 'Monthly aggregate', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'mrr', name: 'MRR', department: 'Core', signalType: 'outcome', level: 2, definition: 'The total predictable revenue from active subscriptions, normalized to a monthly value.', formula: 'sum(field.mrr where field.subscription_status = \'active\') at period_end', url: 'https://gaspwiki.com/v1/metrics/core/mrr-monthly-recurring-revenue', grain: 'End-of-month snapshot', frequency: 'Daily sync', period: 'month'});
CREATE (:Metric {id: 'net_new_mrr', name: 'Net New MRR', department: 'Core', signalType: 'outcome', level: 2, definition: 'The net change in MRR after accounting for all movements.', formula: 'metric.new_mrr + metric.expansion_mrr + metric.reactivation_mrr - metric.churned_mrr - metric.contraction_mrr', url: 'https://gaspwiki.com/v1/metrics/core/net-new-mrr', grain: 'Per event, aggregate monthly', frequency: 'Daily sync', period: 'month'});
CREATE (:Metric {id: 'nrr', name: 'NRR', department: 'Core', signalType: 'outcome', level: 2, definition: 'The percentage of revenue retained from existing customers over a period, including expansion, contraction and churn. Also known as Net Dollar Retention (NDR).', formula: '(metric.mrr at period_start + metric.expansion_mrr - metric.contraction_mrr - metric.churned_mrr) / metric.mrr at period_start over cohort(field.customer_id, period_start)', url: 'https://gaspwiki.com/v1/metrics/core/net-revenue-retention-nrr', grain: 'Customer cohort at period start', frequency: 'Monthly', period: 'trailing_12_months'});
CREATE (:Metric {id: 'grr', name: 'GRR', department: 'Core', signalType: 'outcome', level: 2, definition: 'The percentage of revenue retained from existing customers, excluding expansion revenue. Also known as Gross Dollar Retention.', formula: '(metric.mrr at period_start - metric.contraction_mrr - metric.churned_mrr) / metric.mrr at period_start over cohort(field.customer_id, period_start)', url: 'https://gaspwiki.com/v1/metrics/core/gross-revenue-retention-grr', grain: 'Customer cohort at period start', frequency: 'Monthly', period: 'trailing_12_months'});
CREATE (:Metric {id: 'gross_margin', name: 'Gross Margin', department: 'Core', signalType: 'outcome', level: 2, definition: 'Revenue minus cost of goods sold (COGS), as a percentage of revenue. Measures profitability after direct delivery costs.', formula: '(sum(field.revenue) - sum(field.cost where field.cost_function = \'infrastructure\')) / sum(field.revenue)', url: 'https://gaspwiki.com/v1/metrics/core/gross-margin', grain: 'Monthly aggregate', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'arpa', name: 'ARPA', department: 'Core', signalType: 'outcome', level: 2, definition: 'Average monthly recurring revenue per customer.', formula: 'metric.mrr / metric.total_customers', url: 'https://gaspwiki.com/v1/metrics/core/arpa-average-revenue-per-account', grain: 'End-of-month snapshot', frequency: 'Daily sync', period: 'month'});
CREATE (:Metric {id: 'total_customers', name: 'Total Customers', department: 'Core', signalType: 'outcome', level: 3, definition: 'The number of active customers at the end of the period.', formula: 'count_distinct(field.customer_id where field.customer_status = \'active\') at period_end', url: 'https://gaspwiki.com/v1/metrics/core/total-customers', grain: 'End-of-month snapshot', frequency: 'Daily sync', period: 'month'});
CREATE (:Metric {id: 'new_customers', name: 'New Customers', department: 'Core', signalType: 'outcome', level: 3, definition: 'The number of customers acquired in the period: customers whose first paid subscription started in the period.', formula: 'count_distinct(field.customer_id where field.event_type = \'new\')', url: 'https://gaspwiki.com/v1/metrics/core/new-customers', grain: 'Per event, aggregate monthly', frequency: 'Daily sync', period: 'month'});
CREATE (:Metric {id: 'churned_customers', name: 'Churned Customers', department: 'Core', signalType: 'outcome', level: 3, definition: 'The number of customers lost in the period: customers whose last active subscription ended.', formula: 'count_distinct(field.customer_id where field.event_type = \'churn\')', url: 'https://gaspwiki.com/v1/metrics/core/churned-customers', grain: 'Per event, aggregate monthly', frequency: 'Daily sync', period: 'month'});
CREATE (:Metric {id: 'mrr_growth_rate', name: 'MRR Growth Rate', department: 'Core', signalType: 'outcome', level: 2, definition: 'The month-over-month percentage change in MRR.', formula: '(metric.mrr - lag(metric.mrr, 1 month)) / lag(metric.mrr, 1 month)', url: 'https://gaspwiki.com/v1/metrics/core/mrr-growth-rate', grain: 'End-of-month snapshot', frequency: 'Daily sync', period: 'month'});
CREATE (:Metric {id: 'operating_margin', name: 'Operating Margin', department: 'Finance', signalType: 'outcome', level: 2, definition: 'Operating income as a percentage of revenue.', formula: 'metric.gross_margin - metric.opex_ratio', url: 'https://gaspwiki.com/v1/metrics/finance/operating-margin-ebit-margin', grain: 'Monthly aggregate', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'fcf', name: 'Free Cash Flow', department: 'Finance', signalType: 'outcome', level: 2, definition: 'Cash generated from operations minus capital expenditures.', formula: 'sum(field.operating_cash_flow) - sum(field.capital_expenditures)', url: 'https://gaspwiki.com/v1/metrics/finance/free-cash-flow-fcf', grain: 'Monthly aggregate', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'new_mrr', name: 'New MRR', department: 'Core', signalType: 'outcome', level: 3, definition: 'MRR generated from brand new customers acquired in the period.', formula: 'sum(field.mrr_change where field.event_type = \'new\')', url: 'https://gaspwiki.com/v1/metrics/core/new-mrr', grain: 'Per event, aggregate monthly', frequency: 'Daily sync', period: 'month'});
CREATE (:Metric {id: 'expansion_mrr', name: 'Expansion MRR', department: 'Core', signalType: 'outcome', level: 3, definition: 'Additional MRR from existing customers through upgrades, add-ons, seat increases or price increases.', formula: 'sum(field.mrr_change where field.event_type = \'expansion\')', url: 'https://gaspwiki.com/v1/metrics/core/expansion-mrr', grain: 'Per event, aggregate monthly', frequency: 'Daily sync', period: 'month'});
CREATE (:Metric {id: 'churned_mrr', name: 'Churned MRR', department: 'Core', signalType: 'outcome', level: 3, definition: 'MRR lost from customers who cancelled their subscriptions.', formula: '-sum(field.mrr_change where field.event_type = \'churn\')', url: 'https://gaspwiki.com/v1/metrics/core/churned-mrr', grain: 'Per event, aggregate monthly', frequency: 'Daily sync', period: 'month'});
CREATE (:Metric {id: 'contraction_mrr', name: 'Contraction MRR', department: 'Core', signalType: 'outcome', level: 3, definition: 'MRR reduction from existing customers who downgraded but didn\'t churn.', formula: '-sum(field.mrr_change where field.event_type = \'contraction\')', url: 'https://gaspwiki.com/v1/metrics/core/contraction-mrr', grain: 'Per event, aggregate monthly', frequency: 'Daily sync', period: 'month'});
CREATE (:Metric {id: 'reactivation_mrr', name: 'Reactivation MRR', department: 'Core', signalType: 'outcome', level: 3, definition: 'MRR regained from customers who had churned and signed up again in the period.', formula: 'sum(field.mrr_change where field.event_type = \'reactivation\')', url: 'https://gaspwiki.com/v1/metrics/core/reactivation-mrr', grain: 'Per event, aggregate monthly', frequency: 'Daily sync', period: 'month'});
CREATE (:Metric {id: 'cac', name: 'CAC', department: 'Core', signalType: 'efficiency', level: 3, definition: 'The total cost to acquire a new customer.', formula: 'sum(field.cost where field.cost_function = \'gtm\') / metric.new_customers', url: 'https://gaspwiki.com/v1/metrics/core/cac-customer-acquisition-cost', grain: 'Monthly aggregate', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'ltv', name: 'LTV', department: 'Core', signalType: 'efficiency', level: 3, definition: 'The gross profit expected from a customer over their lifetime. Also known as CLV (Customer Lifetime Value) or CLTV.', formula: 'metric.arpa * metric.gross_margin / metric.revenue_churn_rate', url: 'https://gaspwiki.com/v1/metrics/core/ltv-customer-lifetime-value', grain: 'Monthly aggregate', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'ltv_cac_ratio', name: 'LTV:CAC Ratio', department: 'Core', signalType: 'efficiency', level: 3, definition: 'The ratio of customer lifetime value to acquisition cost. Measures the return on investment from sales and marketing spend.', formula: 'metric.ltv / metric.cac', url: 'https://gaspwiki.com/v1/metrics/core/ltvcac-ratio', grain: 'Monthly aggregate', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'cac_payback', name: 'CAC Payback Period', department: 'Core', signalType: 'efficiency', level: 3, definition: 'The number of months required to recover the cost of acquiring a customer. Also called "Months to Recover CAC" or "Time to Recover CAC."', formula: 'metric.cac / (metric.arpa * metric.gross_margin)', url: 'https://gaspwiki.com/v1/metrics/core/cac-payback-period', grain: 'Monthly aggregate', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'logo_churn_rate', name: 'Logo Churn Rate', department: 'Core', signalType: 'outcome', level: 3, definition: 'The percentage of customers lost in a period. Also called customer churn or logo churn.', formula: 'metric.churned_customers / metric.total_customers at period_start', url: 'https://gaspwiki.com/v1/metrics/core/logo-churn-rate-customer-churn', grain: 'Per event, aggregate monthly', frequency: 'Daily sync', period: 'month'});
CREATE (:Metric {id: 'revenue_churn_rate', name: 'Revenue Churn Rate', department: 'Core', signalType: 'outcome', level: 3, definition: 'The percentage of MRR lost to churn and contraction in a period. Also called MRR Churn Rate.', formula: '(metric.churned_mrr + metric.contraction_mrr) / metric.mrr at period_start', url: 'https://gaspwiki.com/v1/metrics/core/revenue-churn-rate', grain: 'Per event, aggregate monthly', frequency: 'Daily sync', period: 'month'});
CREATE (:Metric {id: 'nps', name: 'NPS', department: 'Core', signalType: 'leading', level: 3, definition: 'A measure of customer loyalty based on likelihood to recommend.', formula: '(count(field.nps_score where field.survey_type = \'customer\' and field.nps_score >= 9) - count(field.nps_score where field.survey_type = \'customer\' and field.nps_score <= 6)) / count(field.nps_score where field.survey_type = \'customer\') * 100', url: 'https://gaspwiki.com/v1/metrics/core/nps-net-promoter-score', grain: 'Per survey response', frequency: 'Per response', period: 'undefined'});
CREATE (:Metric {id: 'pipeline_value', name: 'Pipeline Value', department: 'Sales', signalType: 'leading', level: 3, definition: 'Total value of open sales opportunities, weighted by stage probability unless stated as unweighted.', formula: 'sum(field.opportunity_amount * field.stage_probability where field.opportunity_stage not in (\'closed_won\', \'closed_lost\'))', url: 'https://gaspwiki.com/v1/metrics/sales/pipeline-value', grain: 'Daily snapshot', frequency: 'Daily sync', period: 'day'});
CREATE (:Metric {id: 'pipeline_coverage', name: 'Pipeline Coverage', department: 'Sales', signalType: 'leading', level: 3, definition: 'The ratio of unweighted pipeline value to quota for the period.', formula: 'sum(field.opportunity_amount where field.opportunity_stage not in (\'closed_won\', \'closed_lost\')) / sum(field.quota)', url: 'https://gaspwiki.com/v1/metrics/sales/pipeline-coverage-ratio', grain: 'Daily snapshot', frequency: 'Daily sync', period: 'day'});
CREATE (:Metric {id: 'win_rate', name: 'Win Rate', department: 'Sales', signalType: 'efficiency', level: 3, definition: 'The percentage of qualified opportunities closed in the period that were won.', formula: 'count(field.opportunity_id where field.opportunity_stage = \'closed_won\' and in_period(field.close_date)) / count(field.opportunity_id where field.opportunity_stage in (\'closed_won\', \'closed_lost\') and in_period(field.close_date))', url: 'https://gaspwiki.com/v1/metrics/sales/win-rate', grain: 'Per event, aggregate monthly', frequency: 'Daily sync', period: 'month'});
CREATE (:Metric {id: 'acv', name: 'ACV', department: 'Sales', signalType: 'outcome', level: 3, definition: 'The annualized value of a contract, normalizing multi-year deals to a single year. Aggregated, it is the average ACV of new contracts signed in the period.', formula: 'avg(field.acv where field.contract_event_type = \'new_contract\')', url: 'https://gaspwiki.com/v1/metrics/sales/acv-annual-contract-value', grain: 'Per event, aggregate monthly', frequency: 'Daily sync', period: 'month'});
CREATE (:Metric {id: 'quota_attainment', name: 'Quota Attainment', department: 'Sales', signalType: 'outcome', level: 3, definition: 'The percentage of quota achieved by a rep or team.', formula: 'sum(field.closed_revenue) / sum(field.quota)', url: 'https://gaspwiki.com/v1/metrics/sales/quota-attainment', grain: 'Monthly aggregate', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'health_score', name: 'Customer Health Score', department: 'Customer Success', signalType: 'leading', level: 3, definition: 'A composite score predicting likelihood of retention or churn.', formula: 'avg(field.composite_score where field.customer_status = \'active\') at period_end', url: 'https://gaspwiki.com/v1/metrics/customer-success/customer-health-score', grain: 'Weekly snapshot', frequency: 'Weekly', period: 'week'});
CREATE (:Metric {id: 'expansion_rate', name: 'Expansion Revenue Rate', department: 'Customer Success', signalType: 'outcome', level: 3, definition: 'Expansion MRR as a percentage of beginning MRR.', formula: 'metric.expansion_mrr / metric.mrr at period_start', url: 'https://gaspwiki.com/v1/metrics/customer-success/expansion-revenue-rate', grain: 'Per event, aggregate monthly', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'renewal_rate', name: 'Renewal Rate', department: 'Customer Success', signalType: 'outcome', level: 3, definition: 'The percentage of subscriptions whose term ended in the period that renewed.', formula: 'count_distinct(field.subscription_id where field.renewed = true and in_period(field.contract_end)) / count_distinct(field.subscription_id where in_period(field.contract_end))', url: 'https://gaspwiki.com/v1/metrics/customer-success/renewal-rate', grain: 'Monthly aggregate', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'at_risk_rate', name: 'At-Risk Customer Rate', department: 'Customer Success', signalType: 'leading', level: 3, definition: 'The percentage of customers flagged as at-risk.', formula: 'count_distinct(field.customer_id where field.composite_score < 40) / count_distinct(field.customer_id where field.composite_score is not null)', url: 'https://gaspwiki.com/v1/metrics/customer-success/at-risk-customer-rate', grain: 'Weekly snapshot', frequency: 'Weekly', period: 'week'});
CREATE (:Metric {id: 'magic_number', name: 'Magic Number', department: 'Finance', signalType: 'efficiency', level: 3, definition: 'Sales efficiency metric measuring revenue generated per dollar of sales and marketing spend.', formula: '(metric.arr - lag(metric.arr, 1 quarter)) / lag(window(sum(field.cost where field.cost_function = \'gtm\'), 1 quarter), 1 quarter)', url: 'https://gaspwiki.com/v1/metrics/finance/magic-number', grain: 'Monthly aggregate', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'burn_rate', name: 'Cash Burn Rate', department: 'Finance', signalType: 'operational', level: 3, definition: 'Net cash consumed per month.', formula: '(sum(field.cash_balance) at period_start - sum(field.cash_balance) at period_end) / (period_days / 30.4375)', url: 'https://gaspwiki.com/v1/metrics/finance/cash-burn-rate', grain: 'End-of-month snapshot', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'revenue_per_employee', name: 'Revenue per Employee', department: 'Finance', signalType: 'outcome', level: 3, definition: 'Annual Recurring Revenue (ARR) divided by total headcount.', formula: 'metric.arr / metric.total_headcount', url: 'https://gaspwiki.com/v1/metrics/finance/revenue-per-employee', grain: 'End-of-month snapshot', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'partner_sourced_revenue', name: 'Partner-Sourced Revenue', department: 'Partnerships', signalType: 'outcome', level: 3, definition: 'Revenue from deals originated by partners.', formula: 'sum(field.opportunity_amount where field.partner_sourced = true and field.opportunity_stage = \'closed_won\' and in_period(field.close_date))', url: 'https://gaspwiki.com/v1/metrics/partnerships/partner-sourced-revenue', grain: 'Per event, aggregate monthly', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'sales_cycle', name: 'Sales Cycle Length', department: 'Sales', signalType: 'operational', level: 4, definition: 'The average time from opportunity creation to close.', formula: 'avg(field.close_date - field.opportunity_created_date where field.opportunity_stage = \'closed_won\' and in_period(field.close_date))', url: 'https://gaspwiki.com/v1/metrics/sales/sales-cycle-length', grain: 'Per event', frequency: 'Per deal', period: 'undefined'});
CREATE (:Metric {id: 'mqls', name: 'MQLs', department: 'Marketing', signalType: 'operational', level: 4, definition: 'Leads that have demonstrated sufficient engagement and intent to warrant sales attention, based on criteria established between marketing and sales.', formula: 'count_distinct(field.lead_id where in_period(field.mql_date))', url: 'https://gaspwiki.com/v1/metrics/marketing/marketing-qualified-leads-mqls', grain: 'Per lead stage date, aggregate daily', frequency: 'Daily', period: 'day'});
CREATE (:Metric {id: 'sqls', name: 'SQLs', department: 'Marketing', signalType: 'operational', level: 4, definition: 'MQLs accepted by sales as worth pursuing.', formula: 'count_distinct(field.lead_id where in_period(field.sql_date))', url: 'https://gaspwiki.com/v1/metrics/marketing/sales-qualified-leads-sqls', grain: 'Per lead stage date, aggregate daily', frequency: 'Daily', period: 'day'});
CREATE (:Metric {id: 'lvr', name: 'Lead Velocity Rate', department: 'Marketing', signalType: 'leading', level: 4, definition: 'Month-over-month growth in qualified leads (MQLs).', formula: '(metric.mqls - lag(metric.mqls, 1 month)) / lag(metric.mqls, 1 month)', url: 'https://gaspwiki.com/v1/metrics/marketing/lead-velocity-rate-lvr', grain: 'Monthly aggregate', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'marketing_cac', name: 'Marketing CAC', department: 'Marketing', signalType: 'efficiency', level: 4, definition: 'Marketing-only portion of acquisition cost: go-to-market cost booked to the marketing cost centre, divided by all new customers in the period.', formula: 'sum(field.cost where field.cost_function = \'gtm\' and field.cost_centre = \'marketing\') / count_distinct(field.customer_id where field.event_type = \'new\')', url: 'https://gaspwiki.com/v1/metrics/marketing/marketing-cac', grain: 'Monthly aggregate', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'cpl', name: 'Cost per Lead', department: 'Marketing', signalType: 'efficiency', level: 4, definition: 'Cost to acquire a lead.', formula: 'sum(field.cost where field.cost_function = \'gtm\' and field.cost_centre = \'marketing\') / metric.leads', url: 'https://gaspwiki.com/v1/metrics/marketing/cost-per-lead-cpl', grain: 'Monthly aggregate', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'marketing_sourced_pipeline', name: 'Marketing Sourced Pipeline', department: 'Marketing', signalType: 'leading', level: 4, definition: 'Pipeline value attributed to marketing efforts (first-touch attribution).', formula: 'sum(field.opportunity_amount where field.marketing_source = \'marketing\' and field.opportunity_stage not in (\'closed_won\', \'closed_lost\'))', url: 'https://gaspwiki.com/v1/metrics/marketing/marketing-sourced-pipeline', grain: 'Daily snapshot', frequency: 'Daily', period: 'day'});
CREATE (:Metric {id: 'qbr_completion', name: 'QBR Completion Rate', department: 'Customer Success', signalType: 'operational', level: 4, definition: 'The percentage of eligible accounts that completed a QBR.', formula: 'count_distinct(field.customer_id where field.qbr_completed = true) / count_distinct(field.customer_id where field.qbr_due = true)', url: 'https://gaspwiki.com/v1/metrics/customer-success/quarterly-business-review-qbr-completion-rate', grain: 'Quarterly snapshot', frequency: 'Quarterly', period: 'quarter'});
CREATE (:Metric {id: 'csat', name: 'CSAT', department: 'Support', signalType: 'outcome', level: 4, definition: 'Customer rating of support interaction.', formula: 'count(field.satisfaction_score where field.survey_type = \'customer\' and field.satisfaction_score >= 4) / count(field.satisfaction_score where field.survey_type = \'customer\')', url: 'https://gaspwiki.com/v1/metrics/support/customer-satisfaction-score-csat', grain: 'Per survey response', frequency: 'Per response', period: 'undefined'});
CREATE (:Metric {id: 'ttfv', name: 'Time to First Value', department: 'Onboarding', signalType: 'operational', level: 4, definition: 'Time from contract start to the customer\'s first meaningful value milestone.', formula: 'median(field.milestone_date - field.contract_start where field.onboarding_milestone = \'first_value\')', url: 'https://gaspwiki.com/v1/metrics/onboarding/time-to-first-value-ttfv', grain: 'Per event', frequency: 'Daily', period: 'undefined'});
CREATE (:Metric {id: 'onboarding_completion', name: 'Onboarding Completion Rate', department: 'Onboarding', signalType: 'outcome', level: 4, definition: 'Percentage of customers who complete the onboarding program.', formula: 'count_distinct(field.onboarding_id where in_period(field.onboarding_completion_date)) / count_distinct(field.onboarding_id where in_period(field.onboarding_start_date))', url: 'https://gaspwiki.com/v1/metrics/onboarding/onboarding-completion-rate', grain: 'Per event, aggregate monthly', frequency: 'Daily', period: 'month'});
CREATE (:Metric {id: 'activation_rate', name: 'Activation Rate', department: 'Onboarding', signalType: 'outcome', level: 4, definition: 'Percentage of onboarded customers who become actively engaged.', formula: 'count_distinct(field.customer_id where in_period(field.onboarding_completion_date) and field.activation_date is not null) / count_distinct(field.customer_id where in_period(field.onboarding_completion_date))', url: 'https://gaspwiki.com/v1/metrics/onboarding/onboarding-to-active-rate-activation-rate', grain: 'Per event, aggregate monthly', frequency: 'Daily', period: 'month'});
CREATE (:Metric {id: 'dau_mau', name: 'DAU/MAU Ratio', department: 'Product', signalType: 'leading', level: 4, definition: 'The ratio of daily to monthly active users, indicating how often users return.', formula: 'metric.daily_active_users_dau / metric.monthly_active_users_mau', url: 'https://gaspwiki.com/v1/metrics/product/daumau-ratio-stickiness', grain: 'Distinct users in a trailing window (1, 7 or 30 days) ending at period end', frequency: 'Daily', period: 'day'});
CREATE (:Metric {id: 'feature_adoption', name: 'Feature Adoption Rate', department: 'Product', signalType: 'leading', level: 4, definition: 'Percentage of active users who used a specific feature in the period.', formula: 'count_distinct(field.user_id where field.feature_id is not null) / count_distinct(field.user_id where field.product_event_type = \'qualifying\')', url: 'https://gaspwiki.com/v1/metrics/product/feature-adoption-rate', grain: 'Per event, aggregate monthly', frequency: 'Daily', period: 'month'});
CREATE (:Metric {id: 'pqas', name: 'Product Qualified Accounts', department: 'Product', signalType: 'leading', level: 4, definition: 'Accounts that have demonstrated product engagement indicating sales-readiness.', formula: 'count_distinct(field.customer_id where field.criteria_met = true) at period_end', url: 'https://gaspwiki.com/v1/metrics/product/product-qualified-accounts-pqas', grain: 'Daily snapshot', frequency: 'Daily', period: 'day'});
CREATE (:Metric {id: 'trial_to_paid_conversion_rate', name: 'Trial-to-Paid Conversion Rate', department: 'Product', signalType: 'leading', level: 4, definition: 'The percentage of trials that ended in the period and became paying customers.', formula: 'count_distinct(field.trial_id where field.trial_status = \'converted\' and in_period(field.trial_end_date)) / count_distinct(field.trial_id where field.trial_status in (\'converted\', \'expired\', \'cancelled\') and in_period(field.trial_end_date))', url: 'https://gaspwiki.com/v1/metrics/product/trial-to-paid-conversion-rate', grain: 'Per event, aggregate monthly', frequency: 'Daily', period: 'month'});
CREATE (:Metric {id: 'forecast_accuracy', name: 'Forecast Accuracy', department: 'RevOps', signalType: 'operational', level: 4, definition: 'How closely forecasted revenue matched actual revenue.', formula: '1 - abs(sum(field.forecasted_revenue) - sum(field.actual_revenue)) / sum(field.actual_revenue)', url: 'https://gaspwiki.com/v1/metrics/revops/forecast-accuracy', grain: 'Monthly aggregate', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'dso', name: 'Days Sales Outstanding', department: 'RevOps', signalType: 'operational', level: 4, definition: 'Average days to collect payment after invoicing.', formula: 'sum(field.accounts_receivable) at period_end / metric.revenue_gaap * period_days', url: 'https://gaspwiki.com/v1/metrics/revops/days-sales-outstanding-dso', grain: 'End-of-month receivables snapshot', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'employee_turnover', name: 'Employee Turnover Rate', department: 'People', signalType: 'outcome', level: 4, definition: 'Percentage of employees who left in a period.', formula: 'count_distinct(field.employee_id where field.termination_date >= period_start and field.termination_date <= period_end) / ((metric.total_headcount at period_start + metric.total_headcount at period_end) / 2)', url: 'https://gaspwiki.com/v1/metrics/people/employee-turnover-rate', grain: 'Monthly aggregate', frequency: 'Monthly', period: 'month'});
CREATE (:Metric {id: 'frt', name: 'First Response Time', department: 'Support', signalType: 'operational', level: 5, definition: 'Time from ticket creation to first human response.', formula: '(median(field.first_response_at - field.created_at)) * 1440', url: 'https://gaspwiki.com/v1/metrics/support/first-response-time-frt', grain: 'Per event', frequency: 'Per ticket', period: 'undefined'});
CREATE (:Metric {id: 'ticket_volume', name: 'Ticket Volume', department: 'Support', signalType: 'operational', level: 5, definition: 'Total number of support tickets received in a period.', formula: 'count_distinct(field.ticket_id)', url: 'https://gaspwiki.com/v1/metrics/support/ticket-volume', grain: 'Per event, aggregate monthly', frequency: 'Daily', period: 'month'});
CREATE (:Metric {id: 'self_service_rate', name: 'Self-Service Rate', department: 'Support', signalType: 'efficiency', level: 5, definition: 'Percentage of support needs resolved through self-service.', formula: 'sum(field.deflections) / (sum(field.deflections) + metric.ticket_volume)', url: 'https://gaspwiki.com/v1/metrics/support/self-service-rate-ticket-deflection', grain: 'Daily aggregate', frequency: 'Daily', period: 'day'});
CREATE (:Metric {id: 'uptime', name: 'Uptime', department: 'Engineering', signalType: 'outcome', level: 5, definition: 'The percentage of time the service is operational.', formula: '1 - sum(field.downtime_minutes) / (period_days * 1440)', url: 'https://gaspwiki.com/v1/metrics/engineering/uptime-availability', grain: 'Per service per interval, aggregate per period', frequency: 'Real-time', period: 'month'});
CREATE (:Metric {id: 'deployment_frequency', name: 'Deployment Frequency', department: 'Engineering', signalType: 'operational', level: 5, definition: 'How often code is deployed to production.', formula: 'count_distinct(field.deployment_id)', url: 'https://gaspwiki.com/v1/metrics/engineering/deployment-frequency', grain: 'Per event', frequency: 'Per deploy', period: 'undefined'});
CREATE (:Metric {id: 'mttr', name: 'MTTR', department: 'Engineering', signalType: 'operational', level: 5, definition: 'Time from incident start to resolution.', formula: '(avg(field.resolved_at - field.started_at)) * 1440', url: 'https://gaspwiki.com/v1/metrics/engineering/mean-time-to-resolve-mttr', grain: 'Per event', frequency: 'Per deploy', period: 'undefined'});
CREATE (:Metric {id: 'enps', name: 'Employee NPS', department: 'People', signalType: 'leading', level: 5, definition: 'Likelihood of employees recommending the company as a place to work.', formula: '(count(field.nps_score where field.survey_type = \'employee\' and field.nps_score >= 9) - count(field.nps_score where field.survey_type = \'employee\' and field.nps_score <= 6)) / count(field.nps_score where field.survey_type = \'employee\') * 100', url: 'https://gaspwiki.com/v1/metrics/people/employee-net-promoter-score-enps', grain: 'Per survey response, aggregate quarterly', frequency: 'Quarterly', period: 'quarter'});

// ─── Entity Nodes (28) ──────────────────────────
CREATE (:Entity {id: 'customer', name: 'Customer', aliases: 'Account, Organization', definition: 'A distinct billing entity with one or more subscriptions. The "who" of your business relationship.', level: 'billing'});
CREATE (:Entity {id: 'subscription', name: 'Subscription', aliases: 'Contract, Agreement', definition: 'A billable agreement between a customer and your product, with defined terms, pricing, and status. The "what and when" of the relationship.', level: 'billing'});
CREATE (:Entity {id: 'license', name: 'License', aliases: 'Entitlement, Access, Quota', definition: 'A specific capability, quantity, or configuration granted by a subscription. The "how much" of the relationship.', level: 'billing'});
CREATE (:Entity {id: 'lead', name: 'Lead', aliases: 'Prospect, Contact', definition: 'A person or company that has shown interest but has not been qualified as a sales opportunity.', level: 'acquisition'});
CREATE (:Entity {id: 'opportunity', name: 'Opportunity', aliases: 'Deal, Pipeline Item', definition: 'A qualified sales prospect with an estimated value, stage, and expected close date.', level: 'acquisition'});
CREATE (:Entity {id: 'user', name: 'User', aliases: 'Product User, End User', definition: 'An individual who uses the product. In B2B, one Customer may have many Users. Usage metrics are measured at this level.', level: 'engagement'});
CREATE (:Entity {id: 'ticket', name: 'Ticket', aliases: 'Support Case', definition: 'A discrete support interaction initiated by a customer or user, tracked to resolution.', level: 'support'});
CREATE (:Entity {id: 'employee', name: 'Employee', aliases: 'Team Member, Headcount', definition: 'An internal team member. People metrics and efficiency ratios (revenue per employee) are measured at this level.', level: 'internal'});
CREATE (:Entity {id: 'invoice', name: 'Invoice', aliases: 'Transaction, Billing Document', definition: 'A billing document representing money owed or collected. Cash flow and collections metrics are measured at this level.', level: 'financial'});
CREATE (:Entity {id: 'partner', name: 'Partner', aliases: 'Channel Partner, Reseller', definition: 'An external organization that sources, influences, or resells deals. Partner metrics are measured at this level.', level: 'channel'});
CREATE (:Entity {id: 'project', name: 'Project', aliases: 'Engagement, SOW', definition: 'A professional services engagement with defined scope, timeline, and deliverables.', level: 'services'});
CREATE (:Entity {id: 'plan', name: 'Plan', aliases: 'Tier, Pricing Plan, Package', definition: 'A pricing tier offered to customers (e.g. Starter, Pro, Enterprise). Each plan defines a price point and a set of included products and quotas.', level: 'billing'});
CREATE (:Entity {id: 'product', name: 'Product', aliases: 'Module, SKU, Feature Bundle', definition: 'A distinct purchasable unit within the company\'s offering (e.g. Analytics Module, Automation Module). A subscription may include multiple products.', level: 'billing'});
CREATE (:Entity {id: 'campaign', name: 'Campaign', aliases: 'Marketing Campaign, Initiative', definition: 'A marketing initiative with defined objectives, channels, budget and dates. Campaigns source leads and influence opportunities.', level: 'acquisition'});
CREATE (:Entity {id: 'contact', name: 'Contact', aliases: 'Stakeholder, Decision Maker, Champion', definition: 'A named individual at a customer account involved in the buying or expansion process. Distinct from User (product user) and Lead (pre-qualification).', level: 'acquisition'});
CREATE (:Entity {id: 'incident', name: 'Incident', aliases: 'Outage, SEV', definition: 'An unplanned interruption or degradation of service, tracked from start to resolution. Reliability metrics (MTTR, incident rate) are measured at this level.', level: 'engineering'});
CREATE (:Entity {id: 'deployment', name: 'Deployment', aliases: 'Deploy, Production Change', definition: 'A release of code to production. DORA delivery metrics (deployment frequency, lead time for changes, change failure rate) are measured at this level.', level: 'engineering'});
CREATE (:Entity {id: 'release', name: 'Release', aliases: 'Version', definition: 'A versioned bundle of features shipped to customers. Delivery predictability metrics are measured at this level.', level: 'engineering'});
CREATE (:Entity {id: 'issue', name: 'Issue', aliases: 'Bug, Defect, Feature Request', definition: 'A tracked defect or request in the engineering backlog, with its source and the environment it was found in. Quality metrics (escaped defects, bug rate) are measured at this level.', level: 'engineering'});
CREATE (:Entity {id: 'vulnerability', name: 'Vulnerability', aliases: 'CVE, Security Finding', definition: 'A security weakness found in the product or its infrastructure, tracked from discovery to patch. Security remediation metrics are measured at this level.', level: 'engineering'});
CREATE (:Entity {id: 'feature', name: 'Feature', aliases: 'Capability', definition: 'A unit of product functionality with planned and actual ship dates and a first use by customers. Adoption and roadmap delivery metrics are measured at this level.', level: 'product'});
CREATE (:Entity {id: 'requisition', name: 'Requisition', aliases: 'Job Opening, Req', definition: 'An approved request to hire for a role, open until filled or closed. Recruiting metrics (time to fill, offer acceptance rate) are measured at this level.', level: 'internal'});
CREATE (:Entity {id: 'project_milestone', name: 'Project Milestone', aliases: 'Milestone', definition: 'A dated checkpoint inside a professional services project, with a planned and an actual date. Delivery predictability is measured at this level.', level: 'services'});
CREATE (:Entity {id: 'deliverable', name: 'Deliverable', aliases: 'Work Product', definition: 'An artefact a professional services project hands to the customer, which the customer accepts or sends back for rework. Delivery quality is measured at this level.', level: 'services'});
CREATE (:Entity {id: 'quote', name: 'Quote', aliases: 'Proposal, Pricing Quote', definition: 'A priced offer sent to a prospect or customer before an order. Quote turnaround and discounting are measured at this level.', level: 'financial'});
CREATE (:Entity {id: 'order', name: 'Order', aliases: 'Sales Order', definition: 'An accepted quote in fulfilment, from receipt to completion. Order accuracy and fulfilment time are measured at this level.', level: 'financial'});
CREATE (:Entity {id: 'kb_article', name: 'Knowledge Article', aliases: 'Help Article, KB Article', definition: 'A self-service help article. Ticket deflection and self-service rates are measured at this level.', level: 'support'});
CREATE (:Entity {id: 'deal_registration', name: 'Deal Registration', aliases: 'Partner Registration', definition: 'A partner\'s claim on an opportunity it sourced, moving from qualification to close. Partner pipeline and conflict metrics are measured at this level.', level: 'channel'});

// ─── Concept Nodes (7) ───────────────────────
CREATE (:Concept {id: 'revenue', name: 'Revenue (GAAP)', definition: 'Recognized revenue under accrual accounting. The financial outcome of delivering on subscription obligations.'});
CREATE (:Concept {id: 'bookings', name: 'Bookings', definition: 'The total value of new contracts signed in a period. A forward-looking commitment that converts to revenue over the contract term.'});
CREATE (:Concept {id: 'cogs', name: 'COGS', definition: 'Cost of Goods Sold: the direct cost of delivering the product, infrastructure only (hosting, compute, payment processing, delivery software). Support, success engineering, implementation and onboarding are subtracted in Gross Margin\'s Operating form, not in COGS. Subtracted from revenue in Gross Margin.'});
CREATE (:Concept {id: 'cohort', name: 'Cohort', definition: 'A time-bound grouping of customers by acquisition period. Used for retention and expansion analysis to isolate vintage effects.'});
CREATE (:Concept {id: 'pipeline', name: 'Pipeline', definition: 'The aggregate weighted value of active opportunities. Represents potential future bookings at various probability stages.'});
CREATE (:Concept {id: 'segment', name: 'Segment', definition: 'A classification of customers by size, vertical or fit (e.g. SMB, Mid-Market, Enterprise). Used for cohort analysis and benchmark comparison. Recorded in the segment field, which revenue, contract and amendment events carry as of the event and the customer and subscription snapshots carry as of the snapshot.'});
CREATE (:Concept {id: 'tcv', name: 'TCV (Total Contract Value)', definition: 'The total value of a contract over its full term, including one-time fees and multi-year commitments. Distinct from Bookings (period-attributable) and ACV (annualized).'});

// ─── Source Category Nodes (22) ──────────────
CREATE (:SourceCategory {id: 'billing', name: 'Billing', description: 'Subscription, payment, and invoice management systems'});
CREATE (:SourceCategory {id: 'crm', name: 'CRM', description: 'Customer relationship management: accounts, contacts, opportunities, pipeline'});
CREATE (:SourceCategory {id: 'finance', name: 'Finance / ERP', description: 'Accounting, general ledger, cash management, expense tracking'});
CREATE (:SourceCategory {id: 'cs_platform', name: 'CS Platform', description: 'Customer success tooling: health scores, QBRs, playbooks'});
CREATE (:SourceCategory {id: 'product_analytics', name: 'Product Analytics', description: 'User behavior, sessions, feature usage, activation tracking'});
CREATE (:SourceCategory {id: 'marketing_automation', name: 'Marketing Automation', description: 'Lead management, email campaigns, scoring, nurture flows'});
CREATE (:SourceCategory {id: 'web_analytics', name: 'Web Analytics', description: 'Website traffic, visitor tracking, conversion funnels'});
CREATE (:SourceCategory {id: 'ad_platforms', name: 'Ad Platforms', description: 'Paid media channels: spend, impressions, conversions'});
CREATE (:SourceCategory {id: 'help_desk', name: 'Help Desk', description: 'Support ticket management, SLA tracking, agent workflows'});
CREATE (:SourceCategory {id: 'knowledge_base', name: 'Knowledge Base', description: 'Self-service content, article performance, deflection tracking'});
CREATE (:SourceCategory {id: 'hris', name: 'HRIS', description: 'Human resources information system: employee records, compensation, org data'});
CREATE (:SourceCategory {id: 'ats', name: 'ATS', description: 'Applicant tracking: job postings, candidates, hiring pipeline'});
CREATE (:SourceCategory {id: 'survey_tool', name: 'Survey Tool', description: 'NPS, CSAT, eNPS, engagement surveys and response collection'});
CREATE (:SourceCategory {id: 'monitoring', name: 'Monitoring', description: 'Infrastructure and application monitoring: uptime, latency, errors'});
CREATE (:SourceCategory {id: 'cicd', name: 'CI/CD', description: 'Continuous integration and deployment: builds, releases, version control'});
CREATE (:SourceCategory {id: 'incident_management', name: 'Incident Management', description: 'Incident tracking, severity classification, resolution workflows'});
CREATE (:SourceCategory {id: 'cloud_provider', name: 'Cloud Provider', description: 'Cloud infrastructure APIs: compute, storage, cost data'});
CREATE (:SourceCategory {id: 'security_scanner', name: 'Security Scanner', description: 'Vulnerability scanning, patch tracking, compliance reporting'});
CREATE (:SourceCategory {id: 'psa', name: 'PSA', description: 'Professional services automation: time tracking, project management, resource planning'});
CREATE (:SourceCategory {id: 'partner_management', name: 'Partner Management', description: 'Partner relationship management: deal registration, portal activity, certifications'});
CREATE (:SourceCategory {id: 'lms', name: 'LMS', description: 'Learning management: training courses, certifications, completion tracking'});
CREATE (:SourceCategory {id: 'derived', name: 'Derived', description: 'Calculated from other metrics: no direct data source required'});

// ─── Dataset Nodes (52) ─────────────────────────────
CREATE (:Dataset {id: 'revenue_event', name: 'Revenue event', kind: 'event', dateField: 'event_date', keyField: 'event_id', cel: 'Revenue_Event'});
CREATE (:Dataset {id: 'cost_event', name: 'Cost event', kind: 'event', dateField: 'event_date', keyField: 'event_id', cel: 'Cost_Event'});
CREATE (:Dataset {id: 'contract_event', name: 'Contract event', kind: 'event', dateField: 'event_date', keyField: 'event_id', cel: 'Contract_Event'});
CREATE (:Dataset {id: 'amendment_event', name: 'Amendment event', kind: 'event', dateField: 'event_date', keyField: 'event_id', cel: 'Amendment_Event'});
CREATE (:Dataset {id: 'lifecycle_event', name: 'Lifecycle state change', kind: 'event', dateField: 'event_date', keyField: 'event_id', cel: 'Lifecycle_State_Change'});
CREATE (:Dataset {id: 'trial', name: 'Trial', kind: 'fact', dateField: 'trial_end_date', keyField: 'trial_id'});
CREATE (:Dataset {id: 'customer', name: 'Customer', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'customer_id'});
CREATE (:Dataset {id: 'contact', name: 'Contact', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'contact_id'});
CREATE (:Dataset {id: 'plan', name: 'Plan', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'plan_id'});
CREATE (:Dataset {id: 'product', name: 'Product', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'product_id'});
CREATE (:Dataset {id: 'license', name: 'License', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'license_id'});
CREATE (:Dataset {id: 'subscription', name: 'Subscription', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'subscription_id'});
CREATE (:Dataset {id: 'opportunity', name: 'Opportunity', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'opportunity_id'});
CREATE (:Dataset {id: 'lead', name: 'Lead', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'lead_id'});
CREATE (:Dataset {id: 'user', name: 'User', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'user_id'});
CREATE (:Dataset {id: 'employee', name: 'Employee', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'employee_id'});
CREATE (:Dataset {id: 'partner', name: 'Partner', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'partner_id'});
CREATE (:Dataset {id: 'project', name: 'Project', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'project_id'});
CREATE (:Dataset {id: 'invoice', name: 'Invoice', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'invoice_id'});
CREATE (:Dataset {id: 'campaign', name: 'Campaign spend', kind: 'fact', dateField: 'period_start', keyField: 'campaign_id'});
CREATE (:Dataset {id: 'sales_rep', name: 'Sales rep period', kind: 'fact', dateField: 'period_start', keyField: 'rep_id'});
CREATE (:Dataset {id: 'consultant', name: 'Consultant capacity', kind: 'fact', dateField: 'period_start', keyField: 'consultant_id'});
CREATE (:Dataset {id: 'ticket', name: 'Support ticket', kind: 'event', dateField: 'created_at', keyField: 'ticket_id'});
CREATE (:Dataset {id: 'product_event', name: 'Product usage event', kind: 'event', dateField: 'event_date', keyField: 'event_id'});
CREATE (:Dataset {id: 'survey_response', name: 'Survey response', kind: 'event', dateField: 'survey_date', keyField: 'response_id'});
CREATE (:Dataset {id: 'kb_article', name: 'Knowledge base article', kind: 'fact', dateField: 'period_start', keyField: 'article_id'});
CREATE (:Dataset {id: 'requisition', name: 'Job requisition', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'requisition_id'});
CREATE (:Dataset {id: 'incident', name: 'Incident', kind: 'event', dateField: 'started_at', keyField: 'incident_id'});
CREATE (:Dataset {id: 'deployment', name: 'Deployment', kind: 'event', dateField: 'deploy_date', keyField: 'deployment_id'});
CREATE (:Dataset {id: 'vulnerability', name: 'Vulnerability', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'vulnerability_id'});
CREATE (:Dataset {id: 'service_metrics', name: 'Service reliability', kind: 'fact', dateField: 'period_start', keyField: 'service_id'});
CREATE (:Dataset {id: 'issue', name: 'Issue (bug or request)', kind: 'event', dateField: 'created_at', keyField: 'issue_id'});
CREATE (:Dataset {id: 'feature', name: 'Feature', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'feature_id'});
CREATE (:Dataset {id: 'release', name: 'Release', kind: 'event', dateField: 'release_date', keyField: 'release_id'});
CREATE (:Dataset {id: 'roadmap_item', name: 'Roadmap item', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'roadmap_item_id'});
CREATE (:Dataset {id: 'project_milestone', name: 'Project milestone', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'project_milestone_id'});
CREATE (:Dataset {id: 'time_entry', name: 'Time entry', kind: 'event', dateField: 'entry_date', keyField: 'entry_id'});
CREATE (:Dataset {id: 'deliverable', name: 'Deliverable', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'deliverable_id'});
CREATE (:Dataset {id: 'onboarding', name: 'Onboarding engagement', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'onboarding_id'});
CREATE (:Dataset {id: 'onboarding_milestone', name: 'Onboarding milestone', kind: 'event', dateField: 'milestone_date', keyField: 'onboarding_id'});
CREATE (:Dataset {id: 'onboarding_session', name: 'Onboarding session', kind: 'event', dateField: 'onboarding_session_date', keyField: 'onboarding_id'});
CREATE (:Dataset {id: 'quote', name: 'Quote', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'quote_id'});
CREATE (:Dataset {id: 'order', name: 'Order', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'order_id'});
CREATE (:Dataset {id: 'revenue_schedule', name: 'Revenue schedule', kind: 'fact', dateField: 'period_start', keyField: 'subscription_id'});
CREATE (:Dataset {id: 'financials', name: 'Income statement and cash flow', kind: 'fact', dateField: 'period_start', keyField: 'period_start'});
CREATE (:Dataset {id: 'balance_sheet', name: 'Balance sheet', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'snapshot_date'});
CREATE (:Dataset {id: 'web_traffic', name: 'Web traffic', kind: 'fact', dateField: 'period_start', keyField: 'traffic_source'});
CREATE (:Dataset {id: 'brand_mention', name: 'Brand mentions', kind: 'fact', dateField: 'period_start', keyField: 'mention_source'});
CREATE (:Dataset {id: 'crm_record', name: 'CRM record quality', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'record_id'});
CREATE (:Dataset {id: 'partner_activity', name: 'Partner activity', kind: 'event', dateField: 'activity_date', keyField: 'activity_id'});
CREATE (:Dataset {id: 'deal_registration', name: 'Partner deal registration', kind: 'snapshot', dateField: 'snapshot_date', keyField: 'registration_id'});
CREATE (:Dataset {id: 'forecast', name: 'Revenue forecast', kind: 'fact', dateField: 'period_start', keyField: 'period_start'});

// ─── Field Nodes (268) ─────────────────────────────
CREATE (:Field {id: 'accounts_receivable', type: 'decimal', metricCount: 2});
CREATE (:Field {id: 'acknowledged_at', type: 'timestamp', metricCount: 1});
CREATE (:Field {id: 'acquisition_date', type: 'date', metricCount: 1});
CREATE (:Field {id: 'activation_date', type: 'date', metricCount: 3});
CREATE (:Field {id: 'activity_date', type: 'date', metricCount: 1});
CREATE (:Field {id: 'activity_id', type: 'string', metricCount: 1});
CREATE (:Field {id: 'actual_date', type: 'date', metricCount: 2});
CREATE (:Field {id: 'actual_revenue', type: 'decimal', metricCount: 1});
CREATE (:Field {id: 'acv', type: 'decimal', metricCount: 1});
CREATE (:Field {id: 'ad_spend', type: 'decimal', metricCount: 2});
CREATE (:Field {id: 'advanced_to_next_stage', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'agent_id', type: 'string', metricCount: 1});
CREATE (:Field {id: 'amendment_type', type: 'enum', metricCount: 2, values: 'upgrade|downgrade|add_on|cross_sell|seat_change|pricing_change'});
CREATE (:Field {id: 'article_id', type: 'string', metricCount: 0});
CREATE (:Field {id: 'attendees', type: 'integer', metricCount: 1});
CREATE (:Field {id: 'auto_renewed', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'available_hours', type: 'decimal', metricCount: 4});
CREATE (:Field {id: 'bad_debt_expense', type: 'decimal', metricCount: 1});
CREATE (:Field {id: 'billed_amount', type: 'decimal', metricCount: 3});
CREATE (:Field {id: 'billed_hours', type: 'decimal', metricCount: 2});
CREATE (:Field {id: 'billed_revenue', type: 'decimal', metricCount: 1});
CREATE (:Field {id: 'billing_trigger_date', type: 'date', metricCount: 1});
CREATE (:Field {id: 'campaign_id', type: 'string', metricCount: 0});
CREATE (:Field {id: 'capital_expenditures', type: 'decimal', metricCount: 2});
CREATE (:Field {id: 'cash_balance', type: 'decimal', metricCount: 3});
CREATE (:Field {id: 'certification_status', type: 'enum', metricCount: 1, values: 'none|in_progress|certified|expired'});
CREATE (:Field {id: 'ces_score', type: 'integer', metricCount: 1});
CREATE (:Field {id: 'change_nature', type: 'enum', metricCount: 2, values: 'permanent|temporary|scheduled_reversal'});
CREATE (:Field {id: 'channel', type: 'enum', metricCount: 5, values: 'paid_ads|organic_search|email|events|content|referral|marketplace|direct|other'});
CREATE (:Field {id: 'close_date', type: 'date', metricCount: 27});
CREATE (:Field {id: 'close_date_valid', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'closed_revenue', type: 'decimal', metricCount: 2});
CREATE (:Field {id: 'committed_at', type: 'timestamp', metricCount: 1});
CREATE (:Field {id: 'composite_score', type: 'decimal', metricCount: 3});
CREATE (:Field {id: 'consultant_id', type: 'string', metricCount: 3});
CREATE (:Field {id: 'contract_end', type: 'date', metricCount: 6});
CREATE (:Field {id: 'contract_event_type', type: 'enum', metricCount: 2, values: 'new_contract|renewal|amendment|cancellation'});
CREATE (:Field {id: 'contract_start', type: 'date', metricCount: 3});
CREATE (:Field {id: 'core_features_adopted', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'cost', type: 'decimal', metricCount: 22});
CREATE (:Field {id: 'cost_centre', type: 'enum', metricCount: 5, values: 'marketing|sales|customer_success|support|engineering|product|finance|people|services|partnerships|general'});
CREATE (:Field {id: 'cost_function', type: 'enum', metricCount: 22, values: 'gtm|implementation|onboarding|infrastructure|support|success_engineering|account_management|research_development|general_administrative|services_delivery|recruiting|partner_program|partner_commission'});
CREATE (:Field {id: 'cost_type', type: 'enum', metricCount: 0, values: 'personnel|software|services|infrastructure|other'});
CREATE (:Field {id: 'created_at', type: 'timestamp', metricCount: 17});
CREATE (:Field {id: 'credit_memo_count', type: 'integer', metricCount: 1});
CREATE (:Field {id: 'criteria_met', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'csm_id', type: 'string', metricCount: 2});
CREATE (:Field {id: 'currency', type: 'string', metricCount: 0});
CREATE (:Field {id: 'customer_id', type: 'string', metricCount: 29});
CREATE (:Field {id: 'customer_status', type: 'enum', metricCount: 19, values: 'trial|active|churned|dormant'});
CREATE (:Field {id: 'deflections', type: 'integer', metricCount: 1});
CREATE (:Field {id: 'deliverable_id', type: 'string', metricCount: 1});
CREATE (:Field {id: 'department', type: 'string', metricCount: 3});
CREATE (:Field {id: 'deploy_date', type: 'timestamp', metricCount: 3});
CREATE (:Field {id: 'deployment_id', type: 'string', metricCount: 2});
CREATE (:Field {id: 'detected_at', type: 'timestamp', metricCount: 2});
CREATE (:Field {id: 'discovered_at', type: 'timestamp', metricCount: 1});
CREATE (:Field {id: 'downtime_minutes', type: 'integer', metricCount: 1});
CREATE (:Field {id: 'ebitda', type: 'decimal', metricCount: 2});
CREATE (:Field {id: 'employee_id', type: 'string', metricCount: 13});
CREATE (:Field {id: 'employee_status', type: 'enum', metricCount: 10, values: 'active|on_leave|terminated'});
CREATE (:Field {id: 'engagement_score', type: 'decimal', metricCount: 1});
CREATE (:Field {id: 'entry_date', type: 'date', metricCount: 4});
CREATE (:Field {id: 'entry_id', type: 'string', metricCount: 0});
CREATE (:Field {id: 'error_count', type: 'integer', metricCount: 1});
CREATE (:Field {id: 'escalated', type: 'boolean', metricCount: 2});
CREATE (:Field {id: 'event_date', type: 'date', metricCount: 63});
CREATE (:Field {id: 'event_id', type: 'string', metricCount: 1});
CREATE (:Field {id: 'event_type', type: 'enum', metricCount: 21, values: 'new|expansion|contraction|churn|reactivation|renewal'});
CREATE (:Field {id: 'expansion_classification', type: 'enum', metricCount: 2, values: 'same_product|new_module|new_buying_centre|pricing_adjustment|recontracting|usage_realisation'});
CREATE (:Field {id: 'feature_created_date', type: 'date', metricCount: 1});
CREATE (:Field {id: 'feature_id', type: 'string', metricCount: 4});
CREATE (:Field {id: 'filled_date', type: 'date', metricCount: 1});
CREATE (:Field {id: 'first_response_at', type: 'timestamp', metricCount: 2});
CREATE (:Field {id: 'first_response_due_at', type: 'timestamp', metricCount: 1});
CREATE (:Field {id: 'first_use_date', type: 'date', metricCount: 1});
CREATE (:Field {id: 'forecast_category', type: 'enum', metricCount: 1, values: 'pipeline|best_case|commit|closed'});
CREATE (:Field {id: 'forecast_renewal_amount', type: 'decimal', metricCount: 1});
CREATE (:Field {id: 'forecasted_revenue', type: 'decimal', metricCount: 1});
CREATE (:Field {id: 'has_error', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'contact_id', type: 'string', metricCount: 1});
CREATE (:Field {id: 'contact_role', type: 'enum', metricCount: 1, values: 'executive_sponsor|decision_maker|champion|day_to_day|procurement|other'});
CREATE (:Field {id: 'contact_engaged', type: 'boolean', metricCount: 2});
CREATE (:Field {id: 'plan_id', type: 'string', metricCount: 1});
CREATE (:Field {id: 'plan_name', type: 'string', metricCount: 1});
CREATE (:Field {id: 'billing_period', type: 'enum', metricCount: 0, values: 'monthly|annual|multi_year'});
CREATE (:Field {id: 'product_id', type: 'string', metricCount: 1});
CREATE (:Field {id: 'product_name', type: 'string', metricCount: 1});
CREATE (:Field {id: 'product_line', type: 'string', metricCount: 0});
CREATE (:Field {id: 'license_id', type: 'string', metricCount: 0});
CREATE (:Field {id: 'license_status', type: 'enum', metricCount: 1, values: 'active|suspended|expired'});
CREATE (:Field {id: 'seats_purchased', type: 'integer', metricCount: 1});
CREATE (:Field {id: 'seats_assigned', type: 'integer', metricCount: 1});
CREATE (:Field {id: 'application_date', type: 'date', metricCount: 1});
CREATE (:Field {id: 'hire_date', type: 'date', metricCount: 8});
CREATE (:Field {id: 'hire_source', type: 'enum', metricCount: 2, values: 'referral|inbound|sourced|agency|internal|campus|other'});
CREATE (:Field {id: 'hours', type: 'decimal', metricCount: 3});
CREATE (:Field {id: 'hours_actual', type: 'decimal', metricCount: 1});
CREATE (:Field {id: 'hours_budgeted', type: 'decimal', metricCount: 2});
CREATE (:Field {id: 'incident_id', type: 'string', metricCount: 3});
CREATE (:Field {id: 'incident_type', type: 'enum', metricCount: 3, values: 'availability|performance|security|data'});
CREATE (:Field {id: 'includes_services', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'invoice_amount', type: 'decimal', metricCount: 4});
CREATE (:Field {id: 'invoice_corrected', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'invoice_date', type: 'date', metricCount: 9});
CREATE (:Field {id: 'invoice_disputed', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'invoice_id', type: 'string', metricCount: 3});
CREATE (:Field {id: 'is_competitor', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'is_high_performer', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'issue_environment', type: 'enum', metricCount: 1, values: 'production|pre_production'});
CREATE (:Field {id: 'issue_id', type: 'string', metricCount: 3});
CREATE (:Field {id: 'issue_source', type: 'enum', metricCount: 1, values: 'user_report|internal|monitoring'});
CREATE (:Field {id: 'issue_type', type: 'enum', metricCount: 3, values: 'bug|feature_request|question|incident'});
CREATE (:Field {id: 'job_level', type: 'enum', metricCount: 1, values: 'individual_contributor|manager|director|vp|c_level'});
CREATE (:Field {id: 'last_active_date', type: 'date', metricCount: 1});
CREATE (:Field {id: 'lead_created_date', type: 'date', metricCount: 5});
CREATE (:Field {id: 'lead_id', type: 'string', metricCount: 11});
CREATE (:Field {id: 'lead_source', type: 'string', metricCount: 4});
CREATE (:Field {id: 'lead_stage', type: 'enum', metricCount: 1, values: 'lead|mql|sql|opportunity|disqualified'});
CREATE (:Field {id: 'lifecycle_attribution', type: 'enum', metricCount: 0, values: 'acquisition|activation|retention|expansion|reactivation|servicing'});
CREATE (:Field {id: 'list_price', type: 'decimal', metricCount: 1});
CREATE (:Field {id: 'market_midpoint', type: 'decimal', metricCount: 1});
CREATE (:Field {id: 'marketing_influenced', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'marketing_source', type: 'enum', metricCount: 2, values: 'marketing|sales|partner|other'});
CREATE (:Field {id: 'mention_count', type: 'integer', metricCount: 1});
CREATE (:Field {id: 'mention_source', type: 'string', metricCount: 0});
CREATE (:Field {id: 'milestone_date', type: 'date', metricCount: 4});
CREATE (:Field {id: 'milestone_due_date', type: 'date', metricCount: 1});
CREATE (:Field {id: 'mql_date', type: 'date', metricCount: 5});
CREATE (:Field {id: 'mrr', type: 'decimal', metricCount: 16});
CREATE (:Field {id: 'mrr_change', type: 'decimal', metricCount: 15});
CREATE (:Field {id: 'mrr_end', type: 'decimal', metricCount: 1});
CREATE (:Field {id: 'mrr_start', type: 'decimal', metricCount: 2});
CREATE (:Field {id: 'net_income', type: 'decimal', metricCount: 1});
CREATE (:Field {id: 'new_mrr', type: 'decimal', metricCount: 0});
CREATE (:Field {id: 'new_state', type: 'string', metricCount: 0});
CREATE (:Field {id: 'nps_score', type: 'integer', metricCount: 6});
CREATE (:Field {id: 'offer_status', type: 'enum', metricCount: 1, values: 'extended|accepted|declined|withdrawn'});
CREATE (:Field {id: 'onboarding_completion_date', type: 'date', metricCount: 8});
CREATE (:Field {id: 'onboarding_id', type: 'string', metricCount: 6});
CREATE (:Field {id: 'onboarding_milestone', type: 'enum', metricCount: 3, values: 'kickoff|first_value|go_live|full_adoption'});
CREATE (:Field {id: 'onboarding_session_date', type: 'date', metricCount: 1});
CREATE (:Field {id: 'onboarding_start_date', type: 'date', metricCount: 2});
CREATE (:Field {id: 'operating_cash_flow', type: 'decimal', metricCount: 2});
CREATE (:Field {id: 'opportunity_amount', type: 'decimal', metricCount: 22});
CREATE (:Field {id: 'opportunity_created_date', type: 'date', metricCount: 4});
CREATE (:Field {id: 'opportunity_id', type: 'string', metricCount: 15});
CREATE (:Field {id: 'opportunity_stage', type: 'enum', metricCount: 31, values: 'qualification|discovery|proposal|negotiation|closed_won|closed_lost'});
CREATE (:Field {id: 'order_completed_at', type: 'timestamp', metricCount: 3});
CREATE (:Field {id: 'order_id', type: 'string', metricCount: 2});
CREATE (:Field {id: 'order_received_at', type: 'timestamp', metricCount: 1});
CREATE (:Field {id: 'outstanding_amount', type: 'decimal', metricCount: 3});
CREATE (:Field {id: 'partner_activity_type', type: 'enum', metricCount: 1, values: 'webinar|event|content|campaign'});
CREATE (:Field {id: 'partner_churn_date', type: 'date', metricCount: 2});
CREATE (:Field {id: 'partner_id', type: 'string', metricCount: 11});
CREATE (:Field {id: 'partner_recruited_date', type: 'date', metricCount: 2});
CREATE (:Field {id: 'partner_sourced', type: 'boolean', metricCount: 6});
CREATE (:Field {id: 'partner_status', type: 'enum', metricCount: 6, values: 'recruited|active|churned'});
CREATE (:Field {id: 'partner_tier', type: 'enum', metricCount: 2, values: 'registered|silver|gold|platinum'});
CREATE (:Field {id: 'patched_at', type: 'timestamp', metricCount: 1});
CREATE (:Field {id: 'payment_date', type: 'date', metricCount: 1});
CREATE (:Field {id: 'payment_method', type: 'enum', metricCount: 1, values: 'credit_card|ach|wire|check|other'});
CREATE (:Field {id: 'payment_status', type: 'enum', metricCount: 3, values: 'paid|unpaid|partial|written_off'});
CREATE (:Field {id: 'performance_rating', type: 'decimal', metricCount: 1});
CREATE (:Field {id: 'period_start', type: 'date', metricCount: 51});
CREATE (:Field {id: 'planned_date', type: 'date', metricCount: 2});
CREATE (:Field {id: 'populated_field_count', type: 'integer', metricCount: 1});
CREATE (:Field {id: 'prior_mrr', type: 'decimal', metricCount: 0});
CREATE (:Field {id: 'prior_state', type: 'string', metricCount: 0});
CREATE (:Field {id: 'product_event_type', type: 'enum', metricCount: 14, values: 'qualifying|action|error|reactivation|login'});
CREATE (:Field {id: 'project_completion_date', type: 'date', metricCount: 7});
CREATE (:Field {id: 'project_cost', type: 'decimal', metricCount: 1});
CREATE (:Field {id: 'project_id', type: 'string', metricCount: 7});
CREATE (:Field {id: 'project_milestone_id', type: 'string', metricCount: 1});
CREATE (:Field {id: 'project_revenue', type: 'decimal', metricCount: 1});
CREATE (:Field {id: 'project_start_date', type: 'date', metricCount: 3});
CREATE (:Field {id: 'qbr_completed', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'qbr_due', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'quota', type: 'decimal', metricCount: 3});
CREATE (:Field {id: 'quote_id', type: 'string', metricCount: 3});
CREATE (:Field {id: 'quote_requested_at', type: 'timestamp', metricCount: 1});
CREATE (:Field {id: 'quote_sent_at', type: 'timestamp', metricCount: 5});
CREATE (:Field {id: 'quoted_price', type: 'decimal', metricCount: 1});
CREATE (:Field {id: 'ramped_date', type: 'date', metricCount: 1});
CREATE (:Field {id: 'recognition_correct', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'recognized_revenue', type: 'decimal', metricCount: 4});
CREATE (:Field {id: 'record_id', type: 'string', metricCount: 0});
CREATE (:Field {id: 'recovery_time', type: 'integer', metricCount: 1});
CREATE (:Field {id: 'referenceable', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'registration_date', type: 'date', metricCount: 3});
CREATE (:Field {id: 'registration_id', type: 'string', metricCount: 2});
CREATE (:Field {id: 'release_date', type: 'date', metricCount: 2});
CREATE (:Field {id: 'release_id', type: 'string', metricCount: 1});
CREATE (:Field {id: 'renewal_amount', type: 'decimal', metricCount: 2});
CREATE (:Field {id: 'renewal_complete_date', type: 'date', metricCount: 1});
CREATE (:Field {id: 'renewal_notified_on_time', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'renewal_trigger_date', type: 'date', metricCount: 1});
CREATE (:Field {id: 'renewed', type: 'boolean', metricCount: 2});
CREATE (:Field {id: 'reopened', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'rep_id', type: 'string', metricCount: 1});
CREATE (:Field {id: 'request_count', type: 'integer', metricCount: 1});
CREATE (:Field {id: 'required_field_count', type: 'integer', metricCount: 1});
CREATE (:Field {id: 'required_fields_complete', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'requisition_id', type: 'string', metricCount: 2});
CREATE (:Field {id: 'requisition_opened_date', type: 'date', metricCount: 1});
CREATE (:Field {id: 'requisition_status', type: 'enum', metricCount: 1, values: 'open|filled|closed'});
CREATE (:Field {id: 'resolution_due_at', type: 'timestamp', metricCount: 1});
CREATE (:Field {id: 'resolved_at', type: 'timestamp', metricCount: 3});
CREATE (:Field {id: 'resolved_first_contact', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'resource_id', type: 'string', metricCount: 1});
CREATE (:Field {id: 'response_id', type: 'string', metricCount: 1});
CREATE (:Field {id: 'response_time_ms', type: 'integer', metricCount: 1});
CREATE (:Field {id: 'revenue', type: 'decimal', metricCount: 23});
CREATE (:Field {id: 'revenue_type', type: 'enum', metricCount: 8, values: 'subscription|services|usage|other'});
CREATE (:Field {id: 'revision_count', type: 'integer', metricCount: 1});
CREATE (:Field {id: 'reworked', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'roadmap_item_completed', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'roadmap_item_id', type: 'string', metricCount: 1});
CREATE (:Field {id: 'salary', type: 'decimal', metricCount: 2});
CREATE (:Field {id: 'satisfaction_score', type: 'integer', metricCount: 3});
CREATE (:Field {id: 'scope_changed', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'service_id', type: 'string', metricCount: 1});
CREATE (:Field {id: 'session_duration', type: 'integer', metricCount: 2});
CREATE (:Field {id: 'session_id', type: 'string', metricCount: 2});
CREATE (:Field {id: 'segment', type: 'string', metricCount: 20});
CREATE (:Field {id: 'severity', type: 'enum', metricCount: 2, values: 'sev1|sev2|sev3|sev4'});
CREATE (:Field {id: 'signup_date', type: 'date', metricCount: 4});
CREATE (:Field {id: 'sla_met', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'snapshot_date', type: 'date', metricCount: 171});
CREATE (:Field {id: 'sql_date', type: 'date', metricCount: 3});
CREATE (:Field {id: 'stage_accurate', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'stage_probability', type: 'decimal', metricCount: 1});
CREATE (:Field {id: 'standard_rate', type: 'decimal', metricCount: 1});
CREATE (:Field {id: 'started_at', type: 'timestamp', metricCount: 6});
CREATE (:Field {id: 'state_category', type: 'enum', metricCount: 1, values: 'activation|onboarding_complete|healthy|at_risk|churned|reactivated'});
CREATE (:Field {id: 'steps_completed', type: 'integer', metricCount: 1});
CREATE (:Field {id: 'steps_total', type: 'integer', metricCount: 1});
CREATE (:Field {id: 'subscription_id', type: 'string', metricCount: 3});
CREATE (:Field {id: 'subscription_status', type: 'enum', metricCount: 16, values: 'active|cancelled|expired|paused'});
CREATE (:Field {id: 'survey_completed', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'survey_date', type: 'date', metricCount: 12});
CREATE (:Field {id: 'survey_type', type: 'enum', metricCount: 11, values: 'customer|onboarding|project|partner|employee|prospect'});
CREATE (:Field {id: 'sync_status', type: 'enum', metricCount: 1, values: 'matched|mismatched|missing'});
CREATE (:Field {id: 'target_date', type: 'date', metricCount: 3});
CREATE (:Field {id: 'tcv', type: 'decimal', metricCount: 1});
CREATE (:Field {id: 'termination_date', type: 'date', metricCount: 5});
CREATE (:Field {id: 'termination_type', type: 'enum', metricCount: 3, values: 'voluntary|involuntary'});
CREATE (:Field {id: 'ticket_id', type: 'string', metricCount: 12});
CREATE (:Field {id: 'ticket_status', type: 'enum', metricCount: 3, values: 'open|pending|resolved|closed'});
CREATE (:Field {id: 'ticket_type', type: 'enum', metricCount: 3, values: 'how_to|bug|billing|account|feature_request|other'});
CREATE (:Field {id: 'time_entry_type', type: 'enum', metricCount: 2, values: 'billable|training|pre_sales|internal'});
CREATE (:Field {id: 'traffic_source', type: 'enum', metricCount: 1, values: 'organic_search|paid_search|paid_social|social|email|referral|direct|other'});
CREATE (:Field {id: 'training_completed', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'trial_end_date', type: 'date', metricCount: 1});
CREATE (:Field {id: 'trial_id', type: 'string', metricCount: 1});
CREATE (:Field {id: 'trial_start_date', type: 'date', metricCount: 1});
CREATE (:Field {id: 'trial_status', type: 'enum', metricCount: 1, values: 'active|converted|expired|cancelled'});
CREATE (:Field {id: 'underrepresented_group', type: 'boolean', metricCount: 4});
CREATE (:Field {id: 'unique_visitors', type: 'integer', metricCount: 3});
CREATE (:Field {id: 'updated_within_sla', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'upgrade_eligible', type: 'boolean', metricCount: 1});
CREATE (:Field {id: 'usage_count', type: 'integer', metricCount: 3});
CREATE (:Field {id: 'user_id', type: 'string', metricCount: 14});
CREATE (:Field {id: 'user_status', type: 'enum', metricCount: 1, values: 'active|dormant|deactivated'});
CREATE (:Field {id: 'utilization', type: 'decimal', metricCount: 2});
CREATE (:Field {id: 'vulnerability_id', type: 'string', metricCount: 1});
CREATE (:Field {id: 'vulnerability_status', type: 'enum', metricCount: 1, values: 'open|patched|accepted'});
CREATE (:Field {id: 'written_off_hours', type: 'decimal', metricCount: 1});

// ─── Metric Relationships (91) ──────────────────
MATCH (a:Metric {id: 'net_new_mrr'}), (b:Metric {id: 'mrr'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'mqls'}), (b:Metric {id: 'sqls'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'sqls'}), (b:Metric {id: 'pipeline_value'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'marketing_cac'}), (b:Metric {id: 'cac'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'pipeline_value'}), (b:Metric {id: 'new_mrr'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'win_rate'}), (b:Metric {id: 'new_mrr'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'acv'}), (b:Metric {id: 'new_mrr'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'quota_attainment'}), (b:Metric {id: 'new_mrr'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'sales_cycle'}), (b:Metric {id: 'win_rate'})
CREATE (a)-[:REDUCES]->(b);
MATCH (a:Metric {id: 'partner_sourced_revenue'}), (b:Metric {id: 'pipeline_value'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'partner_sourced_revenue'}), (b:Metric {id: 'new_mrr'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'pqas'}), (b:Metric {id: 'pipeline_value'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'feature_adoption'}), (b:Metric {id: 'pqas'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'acv'}), (b:Metric {id: 'arpa'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'ttfv'}), (b:Metric {id: 'onboarding_completion'})
CREATE (a)-[:REDUCES]->(b);
MATCH (a:Metric {id: 'onboarding_completion'}), (b:Metric {id: 'activation_rate'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'activation_rate'}), (b:Metric {id: 'feature_adoption'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'feature_adoption'}), (b:Metric {id: 'dau_mau'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'feature_adoption'}), (b:Metric {id: 'health_score'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'dau_mau'}), (b:Metric {id: 'health_score'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'health_score'}), (b:Metric {id: 'renewal_rate'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'health_score'}), (b:Metric {id: 'logo_churn_rate'})
CREATE (a)-[:REDUCES]->(b);
MATCH (a:Metric {id: 'health_score'}), (b:Metric {id: 'at_risk_rate'})
CREATE (a)-[:REDUCES]->(b);
MATCH (a:Metric {id: 'health_score'}), (b:Metric {id: 'expansion_mrr'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'nps'}), (b:Metric {id: 'logo_churn_rate'})
CREATE (a)-[:PREDICTS {inverse: true}]->(b);
MATCH (a:Metric {id: 'nps'}), (b:Metric {id: 'churned_mrr'})
CREATE (a)-[:PREDICTS {inverse: true}]->(b);
MATCH (a:Metric {id: 'csat'}), (b:Metric {id: 'nps'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'ticket_volume'}), (b:Metric {id: 'csat'})
CREATE (a)-[:REDUCES]->(b);
MATCH (a:Metric {id: 'frt'}), (b:Metric {id: 'csat'})
CREATE (a)-[:REDUCES]->(b);
MATCH (a:Metric {id: 'qbr_completion'}), (b:Metric {id: 'health_score'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'qbr_completion'}), (b:Metric {id: 'expansion_mrr'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'renewal_rate'}), (b:Metric {id: 'grr'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'logo_churn_rate'}), (b:Metric {id: 'churned_mrr'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'at_risk_rate'}), (b:Metric {id: 'logo_churn_rate'})
CREATE (a)-[:PREDICTS]->(b);
MATCH (a:Metric {id: 'pqas'}), (b:Metric {id: 'expansion_mrr'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'uptime'}), (b:Metric {id: 'csat'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'uptime'}), (b:Metric {id: 'nps'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'mttr'}), (b:Metric {id: 'uptime'})
CREATE (a)-[:REDUCES]->(b);
MATCH (a:Metric {id: 'deployment_frequency'}), (b:Metric {id: 'feature_adoption'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'gross_margin'}), (b:Metric {id: 'fcf'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'operating_margin'}), (b:Metric {id: 'fcf'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'burn_rate'}), (b:Metric {id: 'fcf'})
CREATE (a)-[:REDUCES]->(b);
MATCH (a:Metric {id: 'mrr'}), (b:Metric {id: 'burn_rate'})
CREATE (a)-[:REDUCES]->(b);
MATCH (a:Metric {id: 'gross_margin'}), (b:Metric {id: 'burn_rate'})
CREATE (a)-[:REDUCES]->(b);
MATCH (a:Metric {id: 'deployment_frequency'}), (b:Metric {id: 'mttr'})
CREATE (a)-[:REDUCES]->(b);
MATCH (a:Metric {id: 'dso'}), (b:Metric {id: 'fcf'})
CREATE (a)-[:REDUCES]->(b);
MATCH (a:Metric {id: 'forecast_accuracy'}), (b:Metric {id: 'pipeline_coverage'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'new_customers'}), (b:Metric {id: 'new_mrr'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'churned_customers'}), (b:Metric {id: 'churned_mrr'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'trial_to_paid_conversion_rate'}), (b:Metric {id: 'new_customers'})
CREATE (a)-[:DRIVES]->(b);
MATCH (a:Metric {id: 'enps'}), (b:Metric {id: 'employee_turnover'})
CREATE (a)-[:REDUCES]->(b);
MATCH (a:Metric {id: 'employee_turnover'}), (b:Metric {id: 'revenue_per_employee'})
CREATE (a)-[:REDUCES]->(b);
MATCH (a:Metric {id: 'employee_turnover'}), (b:Metric {id: 'quota_attainment'})
CREATE (a)-[:REDUCES]->(b);
MATCH (a:Metric {id: 'mrr'}), (b:Metric {id: 'arpa'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'total_customers'}), (b:Metric {id: 'arpa'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'mrr'}), (b:Metric {id: 'arr'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'new_customers'}), (b:Metric {id: 'cac'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'arpa'}), (b:Metric {id: 'cac_payback'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'cac'}), (b:Metric {id: 'cac_payback'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'gross_margin'}), (b:Metric {id: 'cac_payback'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'expansion_mrr'}), (b:Metric {id: 'expansion_rate'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'mrr'}), (b:Metric {id: 'expansion_rate'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'churned_mrr'}), (b:Metric {id: 'grr'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'contraction_mrr'}), (b:Metric {id: 'grr'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'mrr'}), (b:Metric {id: 'grr'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'churned_customers'}), (b:Metric {id: 'logo_churn_rate'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'total_customers'}), (b:Metric {id: 'logo_churn_rate'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'arpa'}), (b:Metric {id: 'ltv'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'gross_margin'}), (b:Metric {id: 'ltv'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'revenue_churn_rate'}), (b:Metric {id: 'ltv'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'cac'}), (b:Metric {id: 'ltv_cac_ratio'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'ltv'}), (b:Metric {id: 'ltv_cac_ratio'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'mqls'}), (b:Metric {id: 'lvr'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'arr'}), (b:Metric {id: 'magic_number'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'mrr'}), (b:Metric {id: 'mrr_growth_rate'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'churned_mrr'}), (b:Metric {id: 'net_new_mrr'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'contraction_mrr'}), (b:Metric {id: 'net_new_mrr'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'expansion_mrr'}), (b:Metric {id: 'net_new_mrr'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'new_mrr'}), (b:Metric {id: 'net_new_mrr'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'reactivation_mrr'}), (b:Metric {id: 'net_new_mrr'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'churned_mrr'}), (b:Metric {id: 'nrr'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'contraction_mrr'}), (b:Metric {id: 'nrr'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'expansion_mrr'}), (b:Metric {id: 'nrr'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'mrr'}), (b:Metric {id: 'nrr'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'gross_margin'}), (b:Metric {id: 'operating_margin'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'churned_mrr'}), (b:Metric {id: 'revenue_churn_rate'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'contraction_mrr'}), (b:Metric {id: 'revenue_churn_rate'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'mrr'}), (b:Metric {id: 'revenue_churn_rate'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'arr'}), (b:Metric {id: 'revenue_per_employee'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'arr'}), (b:Metric {id: 'rule_of_40'})
CREATE (a)-[:COMPONENT_OF]->(b);
MATCH (a:Metric {id: 'ticket_volume'}), (b:Metric {id: 'self_service_rate'})
CREATE (a)-[:COMPONENT_OF]->(b);

// ─── MEASURES Edges (79) ──────────────────────────
MATCH (m:Metric {id: 'activation_rate'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'acv'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'arpa'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'at_risk_rate'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'cac'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'cac_payback'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'churned_customers'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'churned_mrr'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'contraction_mrr'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'expansion_mrr'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'expansion_rate'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'grr'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'health_score'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'logo_churn_rate'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'ltv'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'ltv_cac_ratio'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'marketing_cac'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'net_new_mrr'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'new_customers'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'new_mrr'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'nrr'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'onboarding_completion'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'pqas'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'qbr_completion'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'reactivation_mrr'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'revenue_churn_rate'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'total_customers'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'trial_to_paid_conversion_rate'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'ttfv'}), (e:Entity {id: 'customer'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'acv'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'arpa'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'arr'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'cac'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'cac_payback'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'churned_customers'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'churned_mrr'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'contraction_mrr'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'expansion_mrr'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'expansion_rate'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'grr'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'logo_churn_rate'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'ltv'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'ltv_cac_ratio'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'magic_number'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'marketing_cac'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'mrr'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'mrr_growth_rate'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'net_new_mrr'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'new_customers'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'new_mrr'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'nrr'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'reactivation_mrr'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'renewal_rate'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'revenue_churn_rate'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'revenue_per_employee'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'rule_of_40'}), (e:Entity {id: 'subscription'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'cpl'}), (e:Entity {id: 'lead'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'lvr'}), (e:Entity {id: 'lead'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'mqls'}), (e:Entity {id: 'lead'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'sqls'}), (e:Entity {id: 'lead'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'marketing_sourced_pipeline'}), (e:Entity {id: 'opportunity'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'partner_sourced_revenue'}), (e:Entity {id: 'opportunity'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'pipeline_coverage'}), (e:Entity {id: 'opportunity'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'pipeline_value'}), (e:Entity {id: 'opportunity'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'sales_cycle'}), (e:Entity {id: 'opportunity'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'win_rate'}), (e:Entity {id: 'opportunity'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'dau_mau'}), (e:Entity {id: 'user'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'feature_adoption'}), (e:Entity {id: 'user'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'frt'}), (e:Entity {id: 'ticket'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'self_service_rate'}), (e:Entity {id: 'ticket'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'ticket_volume'}), (e:Entity {id: 'ticket'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'employee_turnover'}), (e:Entity {id: 'employee'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'pipeline_coverage'}), (e:Entity {id: 'employee'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'quota_attainment'}), (e:Entity {id: 'employee'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'revenue_per_employee'}), (e:Entity {id: 'employee'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'mttr'}), (e:Entity {id: 'incident'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'deployment_frequency'}), (e:Entity {id: 'deployment'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'feature_adoption'}), (e:Entity {id: 'feature'})
CREATE (m)-[:MEASURES]->(e);
MATCH (m:Metric {id: 'self_service_rate'}), (e:Entity {id: 'kb_article'})
CREATE (m)-[:MEASURES]->(e);

// ─── BELONGS_TO Edges (395) ─────────────────────────────
MATCH (f:Field {id: 'accounts_receivable'}), (d:Dataset {id: 'balance_sheet'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'acknowledged_at'}), (d:Dataset {id: 'incident'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'acquisition_date'}), (d:Dataset {id: 'customer'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'activation_date'}), (d:Dataset {id: 'customer'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'activation_date'}), (d:Dataset {id: 'user'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'activity_date'}), (d:Dataset {id: 'partner_activity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'activity_id'}), (d:Dataset {id: 'partner_activity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'actual_date'}), (d:Dataset {id: 'feature'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'actual_date'}), (d:Dataset {id: 'project_milestone'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'actual_revenue'}), (d:Dataset {id: 'forecast'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'acv'}), (d:Dataset {id: 'contract_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'ad_spend'}), (d:Dataset {id: 'campaign'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'advanced_to_next_stage'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'agent_id'}), (d:Dataset {id: 'ticket'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'amendment_type'}), (d:Dataset {id: 'amendment_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'article_id'}), (d:Dataset {id: 'kb_article'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'attendees'}), (d:Dataset {id: 'onboarding_session'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'auto_renewed'}), (d:Dataset {id: 'subscription'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'available_hours'}), (d:Dataset {id: 'consultant'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'bad_debt_expense'}), (d:Dataset {id: 'financials'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'billed_amount'}), (d:Dataset {id: 'revenue_schedule'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'billed_hours'}), (d:Dataset {id: 'time_entry'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'billed_revenue'}), (d:Dataset {id: 'time_entry'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'billing_trigger_date'}), (d:Dataset {id: 'invoice'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'campaign_id'}), (d:Dataset {id: 'campaign'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'capital_expenditures'}), (d:Dataset {id: 'financials'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'cash_balance'}), (d:Dataset {id: 'balance_sheet'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'certification_status'}), (d:Dataset {id: 'partner'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'ces_score'}), (d:Dataset {id: 'survey_response'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'change_nature'}), (d:Dataset {id: 'revenue_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'change_nature'}), (d:Dataset {id: 'amendment_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'channel'}), (d:Dataset {id: 'campaign'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'channel'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'close_date'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'close_date'}), (d:Dataset {id: 'deal_registration'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'close_date'}), (d:Dataset {id: 'project'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'close_date_valid'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'closed_revenue'}), (d:Dataset {id: 'sales_rep'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'committed_at'}), (d:Dataset {id: 'deployment'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'composite_score'}), (d:Dataset {id: 'customer'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'consultant_id'}), (d:Dataset {id: 'consultant'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'consultant_id'}), (d:Dataset {id: 'time_entry'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'consultant_id'}), (d:Dataset {id: 'project'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'contract_end'}), (d:Dataset {id: 'contract_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'contract_end'}), (d:Dataset {id: 'subscription'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'contract_event_type'}), (d:Dataset {id: 'contract_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'contract_start'}), (d:Dataset {id: 'contract_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'contract_start'}), (d:Dataset {id: 'subscription'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'contract_start'}), (d:Dataset {id: 'onboarding'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'contract_start'}), (d:Dataset {id: 'onboarding_milestone'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'core_features_adopted'}), (d:Dataset {id: 'user'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'cost'}), (d:Dataset {id: 'cost_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'cost_centre'}), (d:Dataset {id: 'cost_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'cost_function'}), (d:Dataset {id: 'cost_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'cost_type'}), (d:Dataset {id: 'cost_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'created_at'}), (d:Dataset {id: 'ticket'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'created_at'}), (d:Dataset {id: 'issue'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'credit_memo_count'}), (d:Dataset {id: 'invoice'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'criteria_met'}), (d:Dataset {id: 'customer'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'csm_id'}), (d:Dataset {id: 'customer'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'currency'}), (d:Dataset {id: 'revenue_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'currency'}), (d:Dataset {id: 'cost_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'currency'}), (d:Dataset {id: 'contract_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'currency'}), (d:Dataset {id: 'invoice'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'customer_id'}), (d:Dataset {id: 'revenue_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'customer_id'}), (d:Dataset {id: 'cost_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'customer_id'}), (d:Dataset {id: 'contract_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'customer_id'}), (d:Dataset {id: 'amendment_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'customer_id'}), (d:Dataset {id: 'lifecycle_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'customer_id'}), (d:Dataset {id: 'customer'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'customer_id'}), (d:Dataset {id: 'subscription'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'customer_id'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'customer_id'}), (d:Dataset {id: 'user'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'customer_id'}), (d:Dataset {id: 'ticket'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'customer_id'}), (d:Dataset {id: 'project'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'customer_id'}), (d:Dataset {id: 'invoice'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'customer_id'}), (d:Dataset {id: 'onboarding'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'customer_id'}), (d:Dataset {id: 'survey_response'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'customer_id'}), (d:Dataset {id: 'product_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'customer_id'}), (d:Dataset {id: 'revenue_schedule'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'customer_id'}), (d:Dataset {id: 'contact'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'customer_id'}), (d:Dataset {id: 'trial'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'customer_status'}), (d:Dataset {id: 'customer'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'deflections'}), (d:Dataset {id: 'kb_article'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'deliverable_id'}), (d:Dataset {id: 'deliverable'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'department'}), (d:Dataset {id: 'employee'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'deploy_date'}), (d:Dataset {id: 'deployment'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'deployment_id'}), (d:Dataset {id: 'deployment'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'detected_at'}), (d:Dataset {id: 'incident'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'discovered_at'}), (d:Dataset {id: 'vulnerability'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'downtime_minutes'}), (d:Dataset {id: 'service_metrics'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'ebitda'}), (d:Dataset {id: 'financials'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'employee_id'}), (d:Dataset {id: 'survey_response'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'employee_id'}), (d:Dataset {id: 'employee'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'employee_status'}), (d:Dataset {id: 'employee'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'engagement_score'}), (d:Dataset {id: 'survey_response'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'entry_date'}), (d:Dataset {id: 'time_entry'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'entry_id'}), (d:Dataset {id: 'time_entry'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'error_count'}), (d:Dataset {id: 'service_metrics'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'escalated'}), (d:Dataset {id: 'ticket'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'escalated'}), (d:Dataset {id: 'project'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'event_date'}), (d:Dataset {id: 'revenue_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'event_date'}), (d:Dataset {id: 'cost_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'event_date'}), (d:Dataset {id: 'contract_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'event_date'}), (d:Dataset {id: 'amendment_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'event_date'}), (d:Dataset {id: 'lifecycle_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'event_date'}), (d:Dataset {id: 'product_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'event_id'}), (d:Dataset {id: 'revenue_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'event_id'}), (d:Dataset {id: 'cost_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'event_id'}), (d:Dataset {id: 'contract_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'event_id'}), (d:Dataset {id: 'amendment_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'event_id'}), (d:Dataset {id: 'lifecycle_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'event_id'}), (d:Dataset {id: 'product_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'event_type'}), (d:Dataset {id: 'revenue_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'expansion_classification'}), (d:Dataset {id: 'revenue_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'expansion_classification'}), (d:Dataset {id: 'amendment_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'feature_created_date'}), (d:Dataset {id: 'feature'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'feature_id'}), (d:Dataset {id: 'product_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'feature_id'}), (d:Dataset {id: 'feature'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'filled_date'}), (d:Dataset {id: 'requisition'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'first_response_at'}), (d:Dataset {id: 'ticket'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'first_response_due_at'}), (d:Dataset {id: 'ticket'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'first_use_date'}), (d:Dataset {id: 'user'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'first_use_date'}), (d:Dataset {id: 'feature'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'forecast_category'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'forecast_renewal_amount'}), (d:Dataset {id: 'subscription'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'forecasted_revenue'}), (d:Dataset {id: 'forecast'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'has_error'}), (d:Dataset {id: 'order'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'contact_id'}), (d:Dataset {id: 'contact'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'contact_role'}), (d:Dataset {id: 'contact'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'contact_engaged'}), (d:Dataset {id: 'contact'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'plan_id'}), (d:Dataset {id: 'subscription'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'plan_id'}), (d:Dataset {id: 'plan'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'plan_name'}), (d:Dataset {id: 'plan'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'billing_period'}), (d:Dataset {id: 'plan'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'product_id'}), (d:Dataset {id: 'license'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'product_id'}), (d:Dataset {id: 'product'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'product_name'}), (d:Dataset {id: 'product'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'product_line'}), (d:Dataset {id: 'product'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'license_id'}), (d:Dataset {id: 'license'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'license_status'}), (d:Dataset {id: 'license'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'seats_purchased'}), (d:Dataset {id: 'license'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'seats_assigned'}), (d:Dataset {id: 'license'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'application_date'}), (d:Dataset {id: 'employee'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'hire_date'}), (d:Dataset {id: 'sales_rep'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'hire_date'}), (d:Dataset {id: 'employee'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'hire_date'}), (d:Dataset {id: 'requisition'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'hire_source'}), (d:Dataset {id: 'employee'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'hours'}), (d:Dataset {id: 'time_entry'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'hours'}), (d:Dataset {id: 'onboarding'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'hours_actual'}), (d:Dataset {id: 'project'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'hours_budgeted'}), (d:Dataset {id: 'project'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'incident_id'}), (d:Dataset {id: 'incident'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'incident_id'}), (d:Dataset {id: 'deployment'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'incident_type'}), (d:Dataset {id: 'incident'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'includes_services'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'invoice_amount'}), (d:Dataset {id: 'invoice'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'invoice_corrected'}), (d:Dataset {id: 'invoice'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'invoice_date'}), (d:Dataset {id: 'invoice'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'invoice_disputed'}), (d:Dataset {id: 'invoice'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'invoice_id'}), (d:Dataset {id: 'invoice'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'is_competitor'}), (d:Dataset {id: 'brand_mention'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'is_high_performer'}), (d:Dataset {id: 'employee'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'issue_environment'}), (d:Dataset {id: 'issue'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'issue_id'}), (d:Dataset {id: 'issue'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'issue_source'}), (d:Dataset {id: 'issue'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'issue_type'}), (d:Dataset {id: 'issue'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'job_level'}), (d:Dataset {id: 'employee'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'last_active_date'}), (d:Dataset {id: 'customer'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'last_active_date'}), (d:Dataset {id: 'user'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'lead_created_date'}), (d:Dataset {id: 'lead'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'lead_id'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'lead_id'}), (d:Dataset {id: 'lead'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'lead_id'}), (d:Dataset {id: 'survey_response'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'lead_source'}), (d:Dataset {id: 'lead'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'lead_stage'}), (d:Dataset {id: 'lead'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'lifecycle_attribution'}), (d:Dataset {id: 'revenue_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'lifecycle_attribution'}), (d:Dataset {id: 'cost_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'lifecycle_attribution'}), (d:Dataset {id: 'amendment_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'list_price'}), (d:Dataset {id: 'quote'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'market_midpoint'}), (d:Dataset {id: 'employee'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'marketing_influenced'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'marketing_source'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'mention_count'}), (d:Dataset {id: 'brand_mention'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'mention_source'}), (d:Dataset {id: 'brand_mention'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'milestone_date'}), (d:Dataset {id: 'onboarding_milestone'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'milestone_due_date'}), (d:Dataset {id: 'onboarding_milestone'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'mql_date'}), (d:Dataset {id: 'lead'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'mrr'}), (d:Dataset {id: 'subscription'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'mrr_change'}), (d:Dataset {id: 'revenue_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'mrr_change'}), (d:Dataset {id: 'amendment_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'mrr_end'}), (d:Dataset {id: 'subscription'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'mrr_start'}), (d:Dataset {id: 'subscription'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'net_income'}), (d:Dataset {id: 'financials'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'new_mrr'}), (d:Dataset {id: 'revenue_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'new_state'}), (d:Dataset {id: 'lifecycle_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'nps_score'}), (d:Dataset {id: 'survey_response'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'offer_status'}), (d:Dataset {id: 'requisition'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'onboarding_completion_date'}), (d:Dataset {id: 'onboarding'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'onboarding_completion_date'}), (d:Dataset {id: 'customer'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'onboarding_id'}), (d:Dataset {id: 'onboarding'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'onboarding_id'}), (d:Dataset {id: 'onboarding_milestone'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'onboarding_id'}), (d:Dataset {id: 'onboarding_session'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'onboarding_milestone'}), (d:Dataset {id: 'onboarding_milestone'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'onboarding_session_date'}), (d:Dataset {id: 'onboarding_session'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'onboarding_start_date'}), (d:Dataset {id: 'onboarding'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'operating_cash_flow'}), (d:Dataset {id: 'financials'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'opportunity_amount'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'opportunity_created_date'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'opportunity_id'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'opportunity_id'}), (d:Dataset {id: 'deal_registration'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'opportunity_stage'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'opportunity_stage'}), (d:Dataset {id: 'deal_registration'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'order_completed_at'}), (d:Dataset {id: 'order'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'order_id'}), (d:Dataset {id: 'order'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'order_received_at'}), (d:Dataset {id: 'order'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'outstanding_amount'}), (d:Dataset {id: 'invoice'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'partner_activity_type'}), (d:Dataset {id: 'partner_activity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'partner_churn_date'}), (d:Dataset {id: 'partner'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'partner_id'}), (d:Dataset {id: 'cost_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'partner_id'}), (d:Dataset {id: 'partner'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'partner_id'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'partner_id'}), (d:Dataset {id: 'partner_activity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'partner_id'}), (d:Dataset {id: 'deal_registration'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'partner_id'}), (d:Dataset {id: 'survey_response'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'partner_recruited_date'}), (d:Dataset {id: 'partner'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'partner_sourced'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'partner_status'}), (d:Dataset {id: 'partner'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'partner_tier'}), (d:Dataset {id: 'partner'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'patched_at'}), (d:Dataset {id: 'vulnerability'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'payment_date'}), (d:Dataset {id: 'invoice'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'payment_method'}), (d:Dataset {id: 'invoice'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'payment_status'}), (d:Dataset {id: 'invoice'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'performance_rating'}), (d:Dataset {id: 'employee'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'period_start'}), (d:Dataset {id: 'financials'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'period_start'}), (d:Dataset {id: 'forecast'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'period_start'}), (d:Dataset {id: 'campaign'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'period_start'}), (d:Dataset {id: 'sales_rep'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'period_start'}), (d:Dataset {id: 'consultant'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'period_start'}), (d:Dataset {id: 'kb_article'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'period_start'}), (d:Dataset {id: 'service_metrics'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'period_start'}), (d:Dataset {id: 'revenue_schedule'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'period_start'}), (d:Dataset {id: 'web_traffic'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'period_start'}), (d:Dataset {id: 'brand_mention'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'planned_date'}), (d:Dataset {id: 'feature'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'planned_date'}), (d:Dataset {id: 'project_milestone'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'populated_field_count'}), (d:Dataset {id: 'crm_record'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'prior_mrr'}), (d:Dataset {id: 'revenue_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'prior_state'}), (d:Dataset {id: 'lifecycle_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'product_event_type'}), (d:Dataset {id: 'product_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'project_completion_date'}), (d:Dataset {id: 'project'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'project_cost'}), (d:Dataset {id: 'project'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'project_id'}), (d:Dataset {id: 'cost_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'project_id'}), (d:Dataset {id: 'project'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'project_id'}), (d:Dataset {id: 'project_milestone'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'project_id'}), (d:Dataset {id: 'time_entry'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'project_id'}), (d:Dataset {id: 'deliverable'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'project_id'}), (d:Dataset {id: 'survey_response'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'project_milestone_id'}), (d:Dataset {id: 'project_milestone'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'project_revenue'}), (d:Dataset {id: 'project'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'project_start_date'}), (d:Dataset {id: 'project'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'qbr_completed'}), (d:Dataset {id: 'customer'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'qbr_due'}), (d:Dataset {id: 'customer'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'quota'}), (d:Dataset {id: 'sales_rep'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'quote_id'}), (d:Dataset {id: 'quote'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'quote_id'}), (d:Dataset {id: 'order'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'quote_requested_at'}), (d:Dataset {id: 'quote'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'quote_sent_at'}), (d:Dataset {id: 'quote'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'quoted_price'}), (d:Dataset {id: 'quote'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'ramped_date'}), (d:Dataset {id: 'sales_rep'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'recognition_correct'}), (d:Dataset {id: 'revenue_schedule'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'recognized_revenue'}), (d:Dataset {id: 'revenue_schedule'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'record_id'}), (d:Dataset {id: 'crm_record'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'recovery_time'}), (d:Dataset {id: 'incident'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'referenceable'}), (d:Dataset {id: 'project'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'registration_date'}), (d:Dataset {id: 'deal_registration'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'registration_id'}), (d:Dataset {id: 'deal_registration'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'release_date'}), (d:Dataset {id: 'release'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'release_date'}), (d:Dataset {id: 'feature'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'release_id'}), (d:Dataset {id: 'release'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'release_id'}), (d:Dataset {id: 'feature'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'renewal_amount'}), (d:Dataset {id: 'subscription'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'renewal_complete_date'}), (d:Dataset {id: 'subscription'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'renewal_notified_on_time'}), (d:Dataset {id: 'subscription'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'renewal_trigger_date'}), (d:Dataset {id: 'subscription'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'renewed'}), (d:Dataset {id: 'subscription'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'reopened'}), (d:Dataset {id: 'ticket'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'rep_id'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'rep_id'}), (d:Dataset {id: 'sales_rep'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'request_count'}), (d:Dataset {id: 'service_metrics'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'required_field_count'}), (d:Dataset {id: 'crm_record'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'required_fields_complete'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'requisition_id'}), (d:Dataset {id: 'requisition'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'requisition_opened_date'}), (d:Dataset {id: 'requisition'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'requisition_status'}), (d:Dataset {id: 'requisition'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'resolution_due_at'}), (d:Dataset {id: 'ticket'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'resolved_at'}), (d:Dataset {id: 'ticket'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'resolved_at'}), (d:Dataset {id: 'incident'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'resolved_first_contact'}), (d:Dataset {id: 'ticket'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'resource_id'}), (d:Dataset {id: 'onboarding'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'response_id'}), (d:Dataset {id: 'survey_response'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'response_time_ms'}), (d:Dataset {id: 'service_metrics'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'revenue'}), (d:Dataset {id: 'financials'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'revenue_type'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'revenue_type'}), (d:Dataset {id: 'financials'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'revision_count'}), (d:Dataset {id: 'quote'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'reworked'}), (d:Dataset {id: 'deliverable'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'roadmap_item_completed'}), (d:Dataset {id: 'roadmap_item'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'roadmap_item_id'}), (d:Dataset {id: 'roadmap_item'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'salary'}), (d:Dataset {id: 'employee'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'satisfaction_score'}), (d:Dataset {id: 'survey_response'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'scope_changed'}), (d:Dataset {id: 'project'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'service_id'}), (d:Dataset {id: 'service_metrics'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'session_duration'}), (d:Dataset {id: 'product_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'session_id'}), (d:Dataset {id: 'product_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'segment'}), (d:Dataset {id: 'revenue_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'segment'}), (d:Dataset {id: 'contract_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'segment'}), (d:Dataset {id: 'amendment_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'segment'}), (d:Dataset {id: 'customer'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'segment'}), (d:Dataset {id: 'subscription'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'severity'}), (d:Dataset {id: 'incident'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'signup_date'}), (d:Dataset {id: 'user'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'signup_date'}), (d:Dataset {id: 'product_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'sla_met'}), (d:Dataset {id: 'service_metrics'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'balance_sheet'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'customer'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'subscription'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'lead'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'user'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'employee'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'partner'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'project'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'invoice'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'requisition'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'vulnerability'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'feature'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'roadmap_item'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'project_milestone'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'deliverable'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'onboarding'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'quote'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'order'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'crm_record'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'deal_registration'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'contact'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'plan'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'product'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'snapshot_date'}), (d:Dataset {id: 'license'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'sql_date'}), (d:Dataset {id: 'lead'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'stage_accurate'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'stage_probability'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'standard_rate'}), (d:Dataset {id: 'time_entry'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'started_at'}), (d:Dataset {id: 'incident'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'state_category'}), (d:Dataset {id: 'lifecycle_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'steps_completed'}), (d:Dataset {id: 'onboarding'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'steps_total'}), (d:Dataset {id: 'onboarding'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'subscription_id'}), (d:Dataset {id: 'revenue_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'subscription_id'}), (d:Dataset {id: 'contract_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'subscription_id'}), (d:Dataset {id: 'amendment_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'subscription_id'}), (d:Dataset {id: 'subscription'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'subscription_id'}), (d:Dataset {id: 'revenue_schedule'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'subscription_id'}), (d:Dataset {id: 'license'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'subscription_status'}), (d:Dataset {id: 'subscription'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'survey_completed'}), (d:Dataset {id: 'survey_response'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'survey_date'}), (d:Dataset {id: 'survey_response'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'survey_type'}), (d:Dataset {id: 'survey_response'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'sync_status'}), (d:Dataset {id: 'crm_record'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'target_date'}), (d:Dataset {id: 'project'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'target_date'}), (d:Dataset {id: 'onboarding'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'tcv'}), (d:Dataset {id: 'contract_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'termination_date'}), (d:Dataset {id: 'employee'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'termination_type'}), (d:Dataset {id: 'employee'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'ticket_id'}), (d:Dataset {id: 'ticket'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'ticket_status'}), (d:Dataset {id: 'ticket'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'ticket_type'}), (d:Dataset {id: 'ticket'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'time_entry_type'}), (d:Dataset {id: 'time_entry'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'traffic_source'}), (d:Dataset {id: 'web_traffic'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'training_completed'}), (d:Dataset {id: 'partner'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'trial_end_date'}), (d:Dataset {id: 'trial'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'trial_id'}), (d:Dataset {id: 'trial'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'trial_start_date'}), (d:Dataset {id: 'trial'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'trial_status'}), (d:Dataset {id: 'trial'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'underrepresented_group'}), (d:Dataset {id: 'employee'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'unique_visitors'}), (d:Dataset {id: 'web_traffic'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'updated_within_sla'}), (d:Dataset {id: 'opportunity'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'upgrade_eligible'}), (d:Dataset {id: 'customer'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'usage_count'}), (d:Dataset {id: 'product_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'user_id'}), (d:Dataset {id: 'user'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'user_id'}), (d:Dataset {id: 'product_event'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'user_status'}), (d:Dataset {id: 'user'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'utilization'}), (d:Dataset {id: 'service_metrics'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'vulnerability_id'}), (d:Dataset {id: 'vulnerability'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'vulnerability_status'}), (d:Dataset {id: 'vulnerability'})
CREATE (f)-[:BELONGS_TO]->(d);
MATCH (f:Field {id: 'written_off_hours'}), (d:Dataset {id: 'time_entry'})
CREATE (f)-[:BELONGS_TO]->(d);

// ─── SOURCED_FROM Edges (360) ─────────────────────────────
MATCH (f:Field {id: 'accounts_receivable'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'accounts_receivable'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'acknowledged_at'}), (s:SourceCategory {id: 'incident_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'acquisition_date'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'acquisition_date'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'activation_date'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'activation_date'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'activity_date'}), (s:SourceCategory {id: 'partner_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'activity_id'}), (s:SourceCategory {id: 'partner_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'actual_date'}), (s:SourceCategory {id: 'cicd'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'actual_date'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'actual_revenue'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'actual_revenue'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'acv'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'acv'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'ad_spend'}), (s:SourceCategory {id: 'ad_platforms'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'advanced_to_next_stage'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'agent_id'}), (s:SourceCategory {id: 'help_desk'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'amendment_type'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'article_id'}), (s:SourceCategory {id: 'knowledge_base'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'attendees'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'auto_renewed'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'available_hours'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'bad_debt_expense'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'billed_amount'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'billed_amount'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'billed_hours'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'billed_revenue'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'billing_trigger_date'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'campaign_id'}), (s:SourceCategory {id: 'ad_platforms'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'campaign_id'}), (s:SourceCategory {id: 'marketing_automation'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'capital_expenditures'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'cash_balance'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'certification_status'}), (s:SourceCategory {id: 'partner_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'certification_status'}), (s:SourceCategory {id: 'lms'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'ces_score'}), (s:SourceCategory {id: 'survey_tool'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'ces_score'}), (s:SourceCategory {id: 'help_desk'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'change_nature'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'channel'}), (s:SourceCategory {id: 'ad_platforms'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'channel'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'channel'}), (s:SourceCategory {id: 'marketing_automation'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'close_date'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'close_date'}), (s:SourceCategory {id: 'partner_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'close_date'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'close_date_valid'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'closed_revenue'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'committed_at'}), (s:SourceCategory {id: 'cicd'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'composite_score'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'consultant_id'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'contract_end'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'contract_end'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'contract_event_type'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'contract_start'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'contract_start'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'contract_start'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'core_features_adopted'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'core_features_adopted'}), (s:SourceCategory {id: 'derived'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'cost'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'cost_centre'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'cost_function'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'cost_type'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'created_at'}), (s:SourceCategory {id: 'help_desk'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'created_at'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'credit_memo_count'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'criteria_met'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'csm_id'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'currency'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'currency'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'customer_id'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'customer_id'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'customer_id'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'customer_id'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'customer_id'}), (s:SourceCategory {id: 'help_desk'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'customer_id'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'customer_id'}), (s:SourceCategory {id: 'survey_tool'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'customer_status'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'customer_status'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'deflections'}), (s:SourceCategory {id: 'knowledge_base'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'deliverable_id'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'department'}), (s:SourceCategory {id: 'hris'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'deploy_date'}), (s:SourceCategory {id: 'cicd'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'deployment_id'}), (s:SourceCategory {id: 'cicd'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'detected_at'}), (s:SourceCategory {id: 'incident_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'detected_at'}), (s:SourceCategory {id: 'monitoring'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'discovered_at'}), (s:SourceCategory {id: 'security_scanner'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'downtime_minutes'}), (s:SourceCategory {id: 'monitoring'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'ebitda'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'employee_id'}), (s:SourceCategory {id: 'hris'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'employee_id'}), (s:SourceCategory {id: 'survey_tool'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'employee_status'}), (s:SourceCategory {id: 'hris'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'engagement_score'}), (s:SourceCategory {id: 'survey_tool'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'entry_date'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'entry_id'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'error_count'}), (s:SourceCategory {id: 'monitoring'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'escalated'}), (s:SourceCategory {id: 'help_desk'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'escalated'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'event_date'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'event_date'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'event_date'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'event_date'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'event_id'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'event_id'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'event_id'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'event_id'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'event_type'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'expansion_classification'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'feature_created_date'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'feature_created_date'}), (s:SourceCategory {id: 'cicd'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'feature_id'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'filled_date'}), (s:SourceCategory {id: 'ats'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'first_response_at'}), (s:SourceCategory {id: 'help_desk'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'first_response_due_at'}), (s:SourceCategory {id: 'help_desk'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'first_use_date'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'forecast_category'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'forecast_renewal_amount'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'forecast_renewal_amount'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'forecasted_revenue'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'forecasted_revenue'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'has_error'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'contact_id'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'contact_id'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'contact_role'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'contact_role'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'contact_engaged'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'contact_engaged'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'plan_id'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'plan_name'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'billing_period'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'product_id'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'product_name'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'product_line'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'license_id'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'license_status'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'seats_purchased'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'seats_assigned'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'seats_assigned'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'application_date'}), (s:SourceCategory {id: 'ats'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'hire_date'}), (s:SourceCategory {id: 'hris'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'hire_date'}), (s:SourceCategory {id: 'ats'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'hire_source'}), (s:SourceCategory {id: 'ats'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'hire_source'}), (s:SourceCategory {id: 'hris'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'hours'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'hours'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'hours_actual'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'hours_budgeted'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'incident_id'}), (s:SourceCategory {id: 'incident_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'incident_id'}), (s:SourceCategory {id: 'cicd'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'incident_type'}), (s:SourceCategory {id: 'incident_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'includes_services'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'invoice_amount'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'invoice_corrected'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'invoice_date'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'invoice_disputed'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'invoice_id'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'is_competitor'}), (s:SourceCategory {id: 'web_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'is_high_performer'}), (s:SourceCategory {id: 'hris'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'issue_environment'}), (s:SourceCategory {id: 'cicd'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'issue_id'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'issue_id'}), (s:SourceCategory {id: 'help_desk'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'issue_id'}), (s:SourceCategory {id: 'cicd'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'issue_source'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'issue_source'}), (s:SourceCategory {id: 'help_desk'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'issue_type'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'issue_type'}), (s:SourceCategory {id: 'cicd'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'job_level'}), (s:SourceCategory {id: 'hris'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'last_active_date'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'lead_created_date'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'lead_created_date'}), (s:SourceCategory {id: 'marketing_automation'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'lead_id'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'lead_id'}), (s:SourceCategory {id: 'marketing_automation'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'lead_id'}), (s:SourceCategory {id: 'survey_tool'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'lead_source'}), (s:SourceCategory {id: 'marketing_automation'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'lead_stage'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'lead_stage'}), (s:SourceCategory {id: 'marketing_automation'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'lifecycle_attribution'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'lifecycle_attribution'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'list_price'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'list_price'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'market_midpoint'}), (s:SourceCategory {id: 'hris'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'marketing_influenced'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'marketing_influenced'}), (s:SourceCategory {id: 'marketing_automation'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'marketing_source'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'marketing_source'}), (s:SourceCategory {id: 'marketing_automation'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'mention_count'}), (s:SourceCategory {id: 'web_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'mention_source'}), (s:SourceCategory {id: 'web_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'milestone_date'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'milestone_due_date'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'mql_date'}), (s:SourceCategory {id: 'marketing_automation'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'mrr'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'mrr_change'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'mrr_end'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'mrr_end'}), (s:SourceCategory {id: 'derived'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'mrr_start'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'mrr_start'}), (s:SourceCategory {id: 'derived'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'net_income'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'new_mrr'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'new_state'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'nps_score'}), (s:SourceCategory {id: 'survey_tool'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'offer_status'}), (s:SourceCategory {id: 'ats'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'onboarding_completion_date'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'onboarding_id'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'onboarding_milestone'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'onboarding_session_date'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'onboarding_start_date'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'operating_cash_flow'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'opportunity_amount'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'opportunity_created_date'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'opportunity_id'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'opportunity_stage'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'opportunity_stage'}), (s:SourceCategory {id: 'partner_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'order_completed_at'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'order_id'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'order_received_at'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'outstanding_amount'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'partner_activity_type'}), (s:SourceCategory {id: 'partner_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'partner_churn_date'}), (s:SourceCategory {id: 'partner_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'partner_id'}), (s:SourceCategory {id: 'partner_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'partner_id'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'partner_id'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'partner_id'}), (s:SourceCategory {id: 'survey_tool'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'partner_recruited_date'}), (s:SourceCategory {id: 'partner_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'partner_sourced'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'partner_sourced'}), (s:SourceCategory {id: 'partner_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'partner_status'}), (s:SourceCategory {id: 'partner_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'partner_tier'}), (s:SourceCategory {id: 'partner_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'patched_at'}), (s:SourceCategory {id: 'security_scanner'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'payment_date'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'payment_method'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'payment_status'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'performance_rating'}), (s:SourceCategory {id: 'hris'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'period_start'}), (s:SourceCategory {id: 'derived'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'planned_date'}), (s:SourceCategory {id: 'cicd'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'planned_date'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'populated_field_count'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'prior_mrr'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'prior_state'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'product_event_type'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'project_completion_date'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'project_cost'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'project_cost'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'project_id'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'project_id'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'project_id'}), (s:SourceCategory {id: 'survey_tool'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'project_milestone_id'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'project_revenue'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'project_revenue'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'project_start_date'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'qbr_completed'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'qbr_due'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'quota'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'quote_id'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'quote_id'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'quote_requested_at'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'quote_sent_at'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'quoted_price'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'quoted_price'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'ramped_date'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'ramped_date'}), (s:SourceCategory {id: 'hris'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'recognition_correct'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'recognized_revenue'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'record_id'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'recovery_time'}), (s:SourceCategory {id: 'incident_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'referenceable'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'referenceable'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'registration_date'}), (s:SourceCategory {id: 'partner_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'registration_id'}), (s:SourceCategory {id: 'partner_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'release_date'}), (s:SourceCategory {id: 'cicd'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'release_id'}), (s:SourceCategory {id: 'cicd'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'renewal_amount'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'renewal_complete_date'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'renewal_complete_date'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'renewal_notified_on_time'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'renewal_notified_on_time'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'renewal_trigger_date'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'renewal_trigger_date'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'renewed'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'reopened'}), (s:SourceCategory {id: 'help_desk'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'rep_id'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'request_count'}), (s:SourceCategory {id: 'monitoring'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'required_field_count'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'required_fields_complete'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'requisition_id'}), (s:SourceCategory {id: 'ats'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'requisition_opened_date'}), (s:SourceCategory {id: 'ats'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'requisition_status'}), (s:SourceCategory {id: 'ats'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'resolution_due_at'}), (s:SourceCategory {id: 'help_desk'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'resolved_at'}), (s:SourceCategory {id: 'help_desk'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'resolved_at'}), (s:SourceCategory {id: 'incident_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'resolved_first_contact'}), (s:SourceCategory {id: 'help_desk'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'resource_id'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'response_id'}), (s:SourceCategory {id: 'survey_tool'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'response_time_ms'}), (s:SourceCategory {id: 'monitoring'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'revenue'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'revenue_type'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'revenue_type'}), (s:SourceCategory {id: 'finance'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'revision_count'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'reworked'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'roadmap_item_completed'}), (s:SourceCategory {id: 'derived'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'roadmap_item_id'}), (s:SourceCategory {id: 'derived'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'salary'}), (s:SourceCategory {id: 'hris'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'satisfaction_score'}), (s:SourceCategory {id: 'survey_tool'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'satisfaction_score'}), (s:SourceCategory {id: 'help_desk'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'scope_changed'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'service_id'}), (s:SourceCategory {id: 'monitoring'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'session_duration'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'session_id'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'segment'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'segment'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'severity'}), (s:SourceCategory {id: 'incident_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'signup_date'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'sla_met'}), (s:SourceCategory {id: 'monitoring'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'snapshot_date'}), (s:SourceCategory {id: 'derived'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'sql_date'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'stage_accurate'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'stage_probability'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'standard_rate'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'started_at'}), (s:SourceCategory {id: 'incident_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'started_at'}), (s:SourceCategory {id: 'monitoring'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'state_category'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'state_category'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'steps_completed'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'steps_total'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'subscription_id'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'subscription_status'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'survey_completed'}), (s:SourceCategory {id: 'survey_tool'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'survey_date'}), (s:SourceCategory {id: 'survey_tool'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'survey_type'}), (s:SourceCategory {id: 'survey_tool'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'sync_status'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'target_date'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'target_date'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'tcv'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'tcv'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'termination_date'}), (s:SourceCategory {id: 'hris'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'termination_type'}), (s:SourceCategory {id: 'hris'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'ticket_id'}), (s:SourceCategory {id: 'help_desk'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'ticket_status'}), (s:SourceCategory {id: 'help_desk'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'ticket_type'}), (s:SourceCategory {id: 'help_desk'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'time_entry_type'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'traffic_source'}), (s:SourceCategory {id: 'web_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'training_completed'}), (s:SourceCategory {id: 'lms'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'training_completed'}), (s:SourceCategory {id: 'partner_management'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'trial_end_date'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'trial_end_date'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'trial_id'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'trial_id'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'trial_start_date'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'trial_start_date'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'trial_status'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'trial_status'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'underrepresented_group'}), (s:SourceCategory {id: 'hris'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'unique_visitors'}), (s:SourceCategory {id: 'web_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'updated_within_sla'}), (s:SourceCategory {id: 'crm'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'upgrade_eligible'}), (s:SourceCategory {id: 'cs_platform'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'upgrade_eligible'}), (s:SourceCategory {id: 'billing'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'usage_count'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'user_id'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'user_status'}), (s:SourceCategory {id: 'product_analytics'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'utilization'}), (s:SourceCategory {id: 'cloud_provider'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'vulnerability_id'}), (s:SourceCategory {id: 'security_scanner'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'vulnerability_status'}), (s:SourceCategory {id: 'security_scanner'})
CREATE (f)-[:SOURCED_FROM]->(s);
MATCH (f:Field {id: 'written_off_hours'}), (s:SourceCategory {id: 'psa'})
CREATE (f)-[:SOURCED_FROM]->(s);

// ─── Entity Relationships (30) ──────────────
// Structural
MATCH (s:Entity {id: 'customer'}), (t:Entity {id: 'subscription'})
CREATE (s)-[:OWNS {cardinality: '1:N', provenance: 'Schema.org owns, Zuora/Stripe Account→Subscription'}]->(t);
MATCH (s:Entity {id: 'subscription'}), (t:Entity {id: 'license'})
CREATE (s)-[:GRANTS {cardinality: '1:N', provenance: 'Zuora Rate Plan→Entitlement, Stripe SubscriptionItem→Price'}]->(t);
MATCH (s:Entity {id: 'customer'}), (t:Entity {id: 'customer'})
CREATE (s)-[:PARENT_OF {cardinality: '1:N', provenance: 'Salesforce Parent Account, Zuora Account hierarchy'}]->(t);
MATCH (s:Entity {id: 'subscription'}), (t:Entity {id: 'plan'})
CREATE (s)-[:PRICED_BY {cardinality: 'N:1', provenance: 'Stripe Subscription→Price, Zuora Rate Plan, Chargebee Plan'}]->(t);
MATCH (s:Entity {id: 'license'}), (t:Entity {id: 'product'})
CREATE (s)-[:GRANTS {cardinality: 'N:M', provenance: 'Auth0 entitlements, Stripe Entitlements API, custom IAM'}]->(t);
MATCH (s:Entity {id: 'project'}), (t:Entity {id: 'project_milestone'})
CREATE (s)-[:OWNS {cardinality: '1:N', provenance: 'PSA tools (Kantata, Rocketlane) Project→Milestone'}]->(t);
// Behavioral
MATCH (s:Entity {id: 'customer'}), (t:Entity {id: 'user'})
CREATE (s)-[:ENGAGES_VIA {cardinality: '1:N', provenance: 'SaaS-native concept (B2B multi-user model)'}]->(t);
MATCH (s:Entity {id: 'customer'}), (t:Entity {id: 'ticket'})
CREATE (s)-[:SUBMITS {cardinality: '1:N', provenance: 'Salesforce Account→Case, HubSpot Company→Ticket'}]->(t);
MATCH (s:Entity {id: 'partner'}), (t:Entity {id: 'deal_registration'})
CREATE (s)-[:SUBMITS {cardinality: '1:N', provenance: 'PRM tools (Impartner, PartnerStack) Partner→Deal Registration'}]->(t);
// Lifecycle
MATCH (s:Entity {id: 'lead'}), (t:Entity {id: 'opportunity'})
CREATE (s)-[:CONVERTS_TO {cardinality: '1:1', provenance: 'Salesforce Lead Conversion process'}]->(t);
MATCH (s:Entity {id: 'opportunity'}), (t:Entity {id: 'customer'})
CREATE (s)-[:CONVERTS_TO {cardinality: '1:1', provenance: 'Salesforce Opportunity→Account (closed-won)'}]->(t);
MATCH (s:Entity {id: 'quote'}), (t:Entity {id: 'order'})
CREATE (s)-[:CONVERTS_TO {cardinality: '1:N', provenance: 'Salesforce CPQ Quote→Order, NetSuite Estimate→Sales Order'}]->(t);
MATCH (s:Entity {id: 'deal_registration'}), (t:Entity {id: 'opportunity'})
CREATE (s)-[:CONVERTS_TO {cardinality: '1:1', provenance: 'Salesforce PRM Deal Registration→Opportunity'}]->(t);
MATCH (s:Entity {id: 'requisition'}), (t:Entity {id: 'employee'})
CREATE (s)-[:CONVERTS_TO {cardinality: '1:1', provenance: 'ATS (Greenhouse, Lever) Requisition→Hire, HRIS employee record'}]->(t);
// Assignment
MATCH (s:Entity {id: 'partner'}), (t:Entity {id: 'opportunity'})
CREATE (s)-[:SOURCES {cardinality: '1:N', provenance: 'Salesforce Partner object→Opportunity'}]->(t);
MATCH (s:Entity {id: 'employee'}), (t:Entity {id: 'customer'})
CREATE (s)-[:MANAGES {cardinality: '1:N', provenance: 'Salesforce OwnerId pattern, CS Platform assignment'}]->(t);
MATCH (s:Entity {id: 'project'}), (t:Entity {id: 'customer'})
CREATE (s)-[:SERVES {cardinality: 'N:1', provenance: 'PSA (Professional Services Automation) models'}]->(t);
MATCH (s:Entity {id: 'customer'}), (t:Entity {id: 'contact'})
CREATE (s)-[:REPRESENTED_BY {cardinality: '1:N', provenance: 'Salesforce Account→Contact, HubSpot Company→Contact'}]->(t);
MATCH (s:Entity {id: 'campaign'}), (t:Entity {id: 'lead'})
CREATE (s)-[:SOURCES {cardinality: '1:N', provenance: 'Salesforce Campaign→Lead, HubSpot Campaign attribution'}]->(t);
// Generative
MATCH (s:Entity {id: 'subscription'}), (t:Concept {id: 'revenue'})
CREATE (s)-[:GENERATES {cardinality: 'N:1', provenance: 'REA stockflow (Economic Event→Economic Resource)'}]->(t);
MATCH (s:Entity {id: 'subscription'}), (t:Entity {id: 'invoice'})
CREATE (s)-[:GENERATES {cardinality: '1:N', provenance: 'Stripe Subscription→Invoice, Zuora Subscription→Invoice'}]->(t);
MATCH (s:Entity {id: 'opportunity'}), (t:Concept {id: 'bookings'})
CREATE (s)-[:PRODUCES {cardinality: 'N:1', provenance: 'CRM reporting: Opportunity Amount at close'}]->(t);
MATCH (s:Entity {id: 'opportunity'}), (t:Concept {id: 'pipeline'})
CREATE (s)-[:CONTRIBUTES_TO {cardinality: 'N:1', provenance: 'Salesforce Pipeline reporting'}]->(t);
MATCH (s:Entity {id: 'subscription'}), (t:Concept {id: 'cogs'})
CREATE (s)-[:INCURS {cardinality: 'N:1', provenance: 'REA duality: give-event paired with take-event'}]->(t);
MATCH (s:Entity {id: 'customer'}), (t:Concept {id: 'cohort'})
CREATE (s)-[:BELONGS_TO {cardinality: 'N:1', provenance: 'SaaS cohort analysis methodology'}]->(t);
MATCH (s:Entity {id: 'customer'}), (t:Concept {id: 'segment'})
CREATE (s)-[:BELONGS_TO {cardinality: 'N:1', provenance: 'Common GTM segmentation practice'}]->(t);
MATCH (s:Entity {id: 'opportunity'}), (t:Concept {id: 'tcv'})
CREATE (s)-[:PRODUCES {cardinality: 'N:1', provenance: 'Salesforce Opportunity Amount across full term, CFO reporting'}]->(t);
MATCH (s:Entity {id: 'deployment'}), (t:Entity {id: 'incident'})
CREATE (s)-[:GENERATES {cardinality: 'N:1', provenance: 'DORA change failure rate, incident post-mortems'}]->(t);
MATCH (s:Entity {id: 'feature'}), (t:Entity {id: 'release'})
CREATE (s)-[:BELONGS_TO {cardinality: 'N:1', provenance: 'Jira Fix Version, Linear Project, GitHub Release'}]->(t);
MATCH (s:Entity {id: 'project'}), (t:Entity {id: 'deliverable'})
CREATE (s)-[:PRODUCES {cardinality: '1:N', provenance: 'PSA tools Project→Deliverable, SOW acceptance criteria'}]->(t);

// ─── Indexes ──────────────────────────────────────────
CREATE INDEX metric_id IF NOT EXISTS FOR (m:Metric) ON (m.id);
CREATE INDEX metric_dept IF NOT EXISTS FOR (m:Metric) ON (m.department);
CREATE INDEX metric_signal IF NOT EXISTS FOR (m:Metric) ON (m.signalType);
CREATE INDEX entity_id IF NOT EXISTS FOR (e:Entity) ON (e.id);
CREATE INDEX concept_id IF NOT EXISTS FOR (c:Concept) ON (c.id);
CREATE INDEX dataset_id IF NOT EXISTS FOR (d:Dataset) ON (d.id);
CREATE INDEX field_id IF NOT EXISTS FOR (f:Field) ON (f.id);
CREATE INDEX source_id IF NOT EXISTS FOR (s:SourceCategory) ON (s.id);
