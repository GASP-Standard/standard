# Customer Success Metrics

Metrics for measuring customer health, retention and expansion.

**Note:** NRR and GRR definitions are defined in [Core Metrics](core.md).

---

## Retention Metrics

### Net Revenue Retention (NRR)

See [Core Metrics](core.md#net-revenue-retention-nrr) for full definition.

Customer Success owns NRR as the primary outcome metric.

---

### Gross Revenue Retention (GRR)

See [Core Metrics](core.md#gross-revenue-retention-grr) for full definition.

GRR isolates the retention component, removing the influence of expansion.

---

### Logo Retention Rate

**Definition:** The percentage of customers retained over a period.

**Formula:**
```
Logo Retention Rate = (Customers at end - New customers) / Customers at start × 100
```

Or simply:
```
Logo Retention Rate = 100% - Logo Churn Rate
```

**What it tells you:** Customer retention independent of revenue. Are you keeping relationships?

---

## Health Metrics

### Customer Health Score

**Definition:** A composite score predicting likelihood of retention or churn.

**Formula:**
```
Health Score = Weighted average of health indicators
```

**Core indicators (choose 5-10):**
| Indicator | Typical Weight | What it measures |
|-----------|----------------|------------------|
| Product usage frequency | 25-35% | Are they using it regularly? |
| Feature adoption depth | 15-25% | Are they using key features? |
| Support sentiment | 10-20% | Are support interactions positive? |
| Engagement/responsiveness | 10-15% | Do they respond to outreach? |
| Contract/renewal status | 5-15% | How long until renewal? |
| Payment health | 5-10% | Do they pay on time? |
| Onboarding completion | 5-10% | Did they fully onboard? |

**Important:** Weights should be customized based on correlation with actual churn in your business. Usage and adoption typically carry the most weight. Segment customers (by size, industry, lifecycle stage) for more accurate scoring.

**Scoring:**
- 0-40: At risk (red)
- 40-70: Needs attention (yellow)
- 70-100: Healthy (green)

**What it tells you:** Which customers need attention before they churn.

**Industry adoption:** Only ~42% of CS teams track health scores, despite evidence that AI-enhanced scoring can predict churn 3-6 months in advance with 85%+ accuracy.

**Sources:**
- [Gainsight: Customer Health Score](https://www.gainsight.com/blog/customer-health-score/)
- [Vitally: Customer Health Score Guide](https://www.vitally.io/post/how-to-create-a-customer-health-score-with-four-metrics)
- [Custify: Customer Health Score Guide](https://www.custify.com/blog/customer-health-score-guide/)

---

### Health Score Coverage

**Definition:** The percentage of customers with a health score calculated.

**Formula:**
```
Health Score Coverage = Customers with health score / Total customers × 100
```

**Target:** 100% of managed accounts, or all accounts above a revenue threshold.

**What it tells you:** Whether you have visibility into customer health.

---

### At-Risk Customer Rate

**Definition:** The percentage of customers flagged as at-risk.

**Formula:**
```
At-Risk Rate = Customers with health score < 40 / Total scored customers × 100
```

**Variant `entered_at_risk`:** the share of customers active at period start that entered the `at_risk` state in the period. The `state_category = 'at_risk'` transition is the leading indicator of churn, and this variant measures it.

**Benchmarks:**
- Below 5%: Healthy portfolio
- 5-10%: Normal, requires attention
- 10-20%: Elevated risk
- Above 20%: Portfolio in trouble

---

## Engagement Metrics

### Quarterly Business Review (QBR) Completion Rate

**Definition:** The percentage of eligible accounts that completed a QBR.

**Formula:**
```
QBR Completion = Accounts with a completed QBR / Accounts due a QBR × 100
```

A QBR counts as completed when it is held in the period. Eligible accounts are those due a QBR in the period.

**Target:** 90%+ for enterprise/strategic accounts

**What it tells you:** Are you maintaining strategic relationships?

---

### Executive Sponsor Coverage

**Definition:** The percentage of active accounts with an engaged contact whose role is executive sponsor.

**Formula:**
```
Exec Sponsor Coverage = Accounts with an engaged executive sponsor contact / Active accounts × 100
```

**Population:** Contacts come from the contact dataset (one row per named person at an account, with a role and an engaged flag). An account counts once however many sponsors it has. Restrict to managed accounts by filtering the denominator.

**What it tells you:** Do you have senior relationships? Predicts resilience during renewals.

---

### Contact Coverage

**Definition:** Average number of engaged contacts per active account.

**Formula:**
```
Contact Coverage = Engaged contacts / Active accounts
```

**Population:** Engaged contacts are rows of the contact dataset with the engaged flag set at period end (engaged means activity in the last 90 days, however the CRM defines activity). The denominator is active accounts, so an account with no contacts pulls the average down rather than disappearing from it.

**Target:** 3+ contacts per account

**What it tells you:** Are you single-threaded? Multi-threading reduces churn risk.

---

## Expansion Metrics

### Expansion Revenue Rate

**Definition:** Expansion MRR as a percentage of beginning MRR.

**Formula:**
```
Expansion Rate = Expansion MRR / Beginning MRR × 100
```

**Benchmarks:**
- Below 10%: Limited expansion motion
- 10-20%: Moderate, typical for early-stage
- 20-30%: Strong, solid benchmark for growth stage
- 30-40%: Excellent, typical at $15M+ ARR
- 40%+: Exceptional, common in usage-based or high-ARPA models

**By company stage:**
- Early stage (<$1M ARR): ~10% from expansion (90% new customers)
- Growth stage ($1M-$20M ARR): 20-30% from expansion
- Scale stage ($20M+ ARR): 35%+ from expansion
- Mature ($200M+ ARR): Up to 66% from expansion

**What it tells you:** Are you growing existing customers? As companies mature, expansion becomes the dominant growth driver.

**Sources:**
- [Ordway: New vs Expansion ARR](https://ordwaylabs.com/blog/new-versus-expansion-arr/)
- [High Alpha: 2025 SaaS Benchmarks](https://www.highalpha.com/saas-benchmarks)
- [ChartMogul: SaaS Benchmarks Report](https://chartmogul.com/reports/saas-benchmarks-report/)

---

### License Utilization

**Definition:** The share of purchased seats that are assigned to a user, across active licenses at period end.

**Formula:**
```
License Utilization = Seats assigned / Seats purchased × 100
```

**Population:** Active licenses (the license dataset: one row per entitlement a subscription grants, with the product it covers, seats purchased and seats assigned). Reported for the whole base and per product.

**Target:** 70 to 90 percent. Below 70 percent the account is paying for seats it does not use and is a downgrade risk at renewal. Above 90 percent the account is close to needing more seats, which is an expansion signal.

**What it tells you:** Whether customers are growing into what they bought. The earliest hard signal of both contraction and expansion for seat-priced products.

---

### Upsell Rate

**Definition:** The percentage of eligible customers who upgraded.

**Formula:**
```
Upsell Rate = Customers who upgraded / Customers eligible for upgrade × 100
```

**What it tells you:** Upgrade conversion effectiveness.

---

### Cross-sell Rate

**Definition:** The percentage of customers who purchased additional products.

**Formula:**
```
Cross-sell Rate = Customers who bought additional product / Total customers × 100
```

**What it tells you:** Multi-product adoption and stickiness.

---

## Renewal Metrics

### Renewal Rate

**Definition:** The percentage of contracts renewed at term.

**Formula (by logo):**
```
Renewal Rate = Contracts renewed / Contracts up for renewal × 100
```

**Formula (by value):**
```
Renewal Rate = ARR renewed / ARR up for renewal × 100
```

Always specify logo or value basis.

**Benchmarks:**
- Below 85%: Concerning, indicates retention problem
- 85-90%: Below average
- 90-95%: Good (90% is the industry norm per 2025 data)
- 95%+: Excellent, top-quartile performance

**By segment:**
- SMB: 85%+ is good (higher churn expected)
- Mid-market: 90%+ is good
- Enterprise: 95%+ expected

**Sources:**
- [Maxio: 2025 B2B SaaS Benchmarks](https://www.maxio.com/resources/2025-saas-benchmarks-report)
- [Recurly: Churn Rate Benchmarks](https://recurly.com/research/churn-rate-benchmarks/)

---

### Renewal Forecast Accuracy

**Definition:** How accurately renewals were predicted.

**Formula:**
```
Forecast Accuracy = 1 - |Forecasted renewals - Actual renewals| / Actual renewals
```

**Target:** >90%

**What it tells you:** Can you predict revenue? Important for planning.

---

### Days to Renewal

**Definition:** Average number of days until upcoming renewals.

**What it tells you:** Renewal workload distribution. If clustered, capacity may be strained.

---

## Productivity Metrics

### Accounts per CSM

**Definition:** The number of accounts assigned to each Customer Success Manager.

**Formula:**
```
Accounts per CSM = Total managed accounts / Number of CSMs
```

**Benchmarks by touch model:**
| Model | Accounts per CSM | Typical ACV |
|-------|------------------|-------------|
| High-touch Enterprise | 10-50 (median ~22) | $100K+ |
| Mid-touch | 50-100 (median ~49) | $25K-$100K |
| Low-touch/SMB | 100-250 | $5K-$25K |
| Tech-touch/Digital | 300-500+ | <$5K |

**By account value:**
- <$25K ACV: Up to 200 accounts
- $25K-$100K: 100-150 accounts
- $100K-$500K: 50-100 accounts
- $500K+: 10-25 accounts (high-touch required)

**Important:** There's no universal standard. The right ratio depends on product complexity, customer needs and engagement model. Calculate based on capacity: reserve ~2/3 of CSM time for customer-facing work.

**Sources:**
- [Gainsight: CSM Ratio Benchmarks](https://www.gainsight.com/blog/gainsight-horizon-ai-labs-what-is-the-right-csm-to-customer-ratio/)
- [Vitally: CSM to Customer Ratio](https://www.vitally.io/post/what-is-the-golden-ratio-of-customer-success-managers-to-customers)
- [ChurnZero: CSM Coverage Ratio](https://churnzero.com/blog/customer-success-manager-coverage-ratio-arr/)

---

### ARR per CSM

**Definition:** Total ARR managed by each CSM.

**Formula:**
```
ARR per CSM = Total managed ARR / Number of CSMs
```

**Benchmarks:**
| Segment | ARR per CSM |
|---------|-------------|
| Enterprise | $2M-$5M (69% manage >$2M) |
| Mid-market | $2M-$5M (spread across more accounts) |
| SMB | $1M-$2M |

**Distribution (Gainsight data):**
- Median (50th percentile): $1.4M
- Top quartile (75th percentile): $4.2M

**Common rule of thumb:** Hire 1 CSM per $2M ARR.

**CS team cost benchmark:** Customer Success should cost 5-15% of ARR (under 10% for companies >$100M ARR).

**What it tells you:** CSM productivity and capacity planning.

**Sources:**
- [Gainsight: CS Team Planning & Cost Benchmarks](https://www.gainsight.com/blog/customer-success-team-planning-cost-benchmarks/)
- [ChurnZero: CS Capacity Planning](https://churnzero.com/blog/customer-success-capacity-planning-and-budget-guide/)
- [Tomasz Tunguz: How Much ARR Can a CSM Manage?](https://tomtunguz.com/how-much-arr-can-a-csm-manage/)

---

## Summary Table

| Metric | Type | Primary Indicator Of |
|--------|------|---------------------|
| NRR | Retention | Revenue sustainability |
| GRR | Retention | Baseline retention health |
| Customer Health Score | Health | Churn risk prediction |
| At-Risk Rate | Health | Portfolio risk level |
| Expansion Rate | Growth | Upsell/cross-sell effectiveness |
| License Utilization | Growth | Seat usage, contraction and expansion signal |
| Renewal Rate | Retention | Contract renewal success |
| Accounts per CSM | Productivity | Team capacity |
