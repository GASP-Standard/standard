# Sales Metrics

Metrics for measuring sales team performance and pipeline health.

---

## Pipeline Metrics

### Pipeline Value

**Definition:** Total value of all active sales opportunities.

**Formula (weighted):**
```
Pipeline Value = Sum of (Deal value × Stage probability) for all open opportunities
```

**Formula (unweighted):**
```
Pipeline Value = Sum of (Deal value) for all open opportunities
```

Always specify whether weighted or unweighted.

**Weighted vs unweighted:**
- **Weighted:** More realistic, accounts for deal stage. A $100K deal at 50% stage = $50K weighted value.
- **Unweighted:** Simpler, shows total potential. Useful for capacity planning.

**What it tells you:** The potential revenue if deals close at expected rates.

**Sources:** [Clari](https://www.clari.com/blog/pipeline-coverage-best-practices/), [Salesforce](https://www.salesforce.com/blog/sales-velocity/)

---

### Pipeline Coverage Ratio

**Definition:** The ratio of pipeline value to quota for the period.

**Formula:**
```
Pipeline Coverage = Total Pipeline Value / Quota for Period
```

Express as multiple (e.g., "3x" or "3:1").

**Why 3x-4x works:** The math is 1 / Win Rate. If you win 25% of deals, you need 4x coverage (1 ÷ 0.25 = 4). If you win 33%, you need 3x.

**Benchmarks:**
- Below 2x: Insufficient pipeline, high risk of missing quota
- 2-3x: Light, acceptable for high win rate teams
- 3-4x: Healthy for typical 25-33% win rates
- Above 4x: Strong, but may indicate pipeline hygiene issues or low win rates

**By segment:**
- SMB/high-velocity: 2-3x may suffice
- Mid-market: 2.5-4x typical
- Enterprise: 3-5x (longer cycles, more stakeholders)

**What it tells you:** Whether there's enough pipeline to hit targets given historical conversion rates.

**Calculate your ideal:** Use your actual win rate, not generic benchmarks.

**Sources:**
- [Clari: Pipeline Coverage Best Practices](https://www.clari.com/blog/pipeline-coverage-best-practices/)
- [Outreach: Sales Pipeline Coverage Ratio](https://www.outreach.io/resources/blog/sales-pipeline-coverage-ratio)
- [Mosaic: Pipeline Coverage Ratio](https://www.mosaic.tech/financial-metrics/pipeline-coverage-ratio)

---

### Pipeline Velocity

**Definition:** The speed at which pipeline converts to revenue. Also called Sales Velocity or Deal Velocity.

**Formula:**
```
Pipeline Velocity = (# Opportunities × Win Rate × Average Deal Size) / Sales Cycle Length
```

Result is revenue per day (or per period).

**The four levers:**
1. **Opportunities** - Number of qualified opportunities in pipeline
2. **Win Rate** - Conversion rate from opportunity to close
3. **Deal Size** - Average deal value (ACV)
4. **Cycle Length** - Days from opportunity to close

**Example:** 50 opportunities × 35% win rate × $2,500 deal size ÷ 28 days = **$1,562/day**

**What it tells you:** The theoretical throughput of your sales engine. Improving any component improves velocity.

**How to use:** Identify which lever is the bottleneck. Not enough leads? Improve opportunities. Deals stuck in negotiation? Reduce cycle length.

**Sources:**
- [HubSpot: Sales Velocity](https://blog.hubspot.com/sales/sales-velocity)
- [Salesforce: Sales Velocity](https://www.salesforce.com/blog/sales-velocity/)
- [Drivetrain: Sales Velocity in SaaS](https://www.drivetrain.ai/strategic-finance-glossary/sales-velocity-in-saas-what-it-is-why-its-important-and-how-to-calculate-it)

---

## Conversion Metrics

### Win Rate

**Definition:** The percentage of qualified opportunities that close as won.

**Formula:**
```
Win Rate = Deals Won / (Deals Won + Deals Lost) × 100
```

Exclude open deals and deals disqualified before reaching qualified stage.

**Overall Benchmarks:**
- Below 15%: Low, investigate qualification or competitive issues
- 15-25%: Average (industry average ~22-25%)
- 25-35%: Good
- 35-50%: Strong/top performer

**By deal size:**
- <$10K ACV: 28-35%
- $10K-$50K: 20-28%
- $50K-$100K: 15-22%
- >$100K: 12-18%

**By segment:**
- SMB: 30-40%
- Mid-market: 25-35%
- Enterprise: 20-25%

**What it tells you:** How effective the sales team is at closing qualified opportunities.

**Common mistakes:**
- Including unqualified leads (inflates denominator, deflates rate)
- Not specifying stage (win rate from MQL vs SQL vs Qualified Opp will differ dramatically)
- Comparing across deal sizes without adjusting expectations

**Key insight:** Focus on improvement over time, not hitting arbitrary targets.

**Sources:**
- [Walnut: B2B Benchmarks for SaaS Sales](https://www.walnut.io/blog/sales-tips/saas-and-b2b-sales-benchmarks-what-to-measure-and-how/)
- [Outreach: Win Rate vs Close Rate](https://www.outreach.io/resources/blog/win-rate-vs-close-rate)
- [Kixie: SaaS Win Rate Benchmark](https://www.kixie.com/sales-blog/saas-win-rate-benchmark-proven-sales-strategies/)

---

### Lead-to-Opportunity Rate

**Definition:** The percentage of leads that become qualified opportunities.

**Formula:**
```
Lead-to-Opportunity = Opportunities created / Leads received × 100
```

**Benchmarks:**
- 5-15%: Typical for inbound leads
- 1-5%: Typical for outbound/cold leads
- Varies significantly by lead source and ICP fit

**What it tells you:** Lead quality and SDR/qualification effectiveness.

**Sources:** [HubSpot](https://blog.hubspot.com/sales/sales-velocity), [Databox](https://databox.com/b2b-sales-cycle-length)

---

### Opportunity-to-Close Rate

**Definition:** The percentage of qualified opportunities that close as won. Also called Close Rate.

**Formula:**
```
Opportunity-to-Close = Closed Won / (Closed Won + Closed Lost) × 100
```

**Note:** This is essentially Win Rate measured from the opportunity stage.

**What it tells you:** AE effectiveness at converting qualified pipeline.

**Sources:** [Outreach](https://www.outreach.io/resources/blog/win-rate-vs-close-rate)

---

## Deal Metrics

### ACV (Annual Contract Value)

**Definition:** The annualized value of a contract, normalizing multi-year deals to a single year. Also used to describe average deal size when aggregated.

**Formula (single contract):**
```
ACV = (Total Contract Value - One-time fees) / Contract term in years
```

**Formula (average across deals):**
```
Average ACV = Sum of ACV for all deals / Number of deals
```

**Example:** A 3-year contract worth $150K (excluding setup fees) = $50K ACV.

For monthly contracts, annualize: Monthly value × 12

**Excludes:** One-time fees (setup, implementation, training)

**ACV vs ARR:**
- **ACV** = Value of a single contract, annualized
- **ARR** = Total recurring revenue across all customers at a point in time

**Typical ranges:**
- SMB: <$5K
- Mid-market: $25K-$100K
- Enterprise: $100K+

**What it tells you:** Deal size and customer segment. Important for CAC analysis and go-to-market strategy.

**Sources:**
- [Paddle: Annual Contract Value](https://www.paddle.com/resources/annual-contract-value)
- [ChurnZero: Annual Contract Value](https://churnzero.com/churnopedia/annual-contract-value-acv/)
- [Chargebee: ACV vs ARR](https://www.chargebee.com/resources/glossaries/acv-vs-arr/)

---

### Average Deal Size

**Definition:** The average total value of closed deals (total contract value, not annualized).

**Formula:**
```
Average Deal Size = Total contract value of closed deals / Number of deals
```

**Difference from ACV:** Average Deal Size uses total contract value (TCV). ACV annualizes multi-year deals.

**Example:** A 3-year, $150K deal = $150K deal size, but $50K ACV.

**What it tells you:** Raw deal size. Useful when contract lengths vary significantly.

**Sources:** [Paddle](https://www.paddle.com/resources/annual-contract-value), [ChurnZero](https://churnzero.com/churnopedia/annual-contract-value-acv/)

---

### Sales Cycle Length

**Definition:** The average time from opportunity creation to close.

**Formula:**
```
Sales Cycle = Average of (Close date - Opportunity created date) for won deals
```

Measured in days. Use median rather than average to reduce outlier skew.

**Benchmarks by segment:**
- SMB: 14-40 days
- Mid-market: 60-90 days
- Enterprise: 90-180+ days

**Benchmarks by ACV:**
- <$2K ACV: ~14 days (1-2 call close)
- <$5K ACV: ~30-40 days
- $5K-$25K ACV: ~60-90 days
- $25K-$100K ACV: 90-180 days
- >$100K ACV: 170+ days (often 6-12 months)
- >$500K ACV: 6-18+ months (annual budget cycles)

**Overall median:** ~84 days across B2B SaaS

**What it tells you:** How long deals take to close. Longer cycles require more pipeline coverage.

**Recent trends (2024-2025):**
- Cycles 22% longer since 2022 due to budget scrutiny
- Average B2B deal involves 6.8 stakeholders (up from 5.4 in 2020)
- CFO involvement in software purchases up 40%
- Negotiation → Close accounts for 35-40% of enterprise cycle time

**Sources:**
- [SaaStr: B2B Sales Cycle Benchmarks](https://www.saastr.com/dear-saastr-whats-a-good-benchmark-for-b2b-sales-cycles/)
- [Databox: B2B Sales Cycle Length](https://databox.com/b2b-sales-cycle-length)
- [Drivetrain: Sales Cycle Length](https://www.drivetrain.ai/strategic-finance-glossary/sales-cycle-length-scl)

---

## Productivity Metrics

### Quota Attainment

**Definition:** The percentage of quota achieved by a rep or team.

**Formula (individual):**
```
Quota Attainment = Revenue Closed / Quota × 100
```

**Formula (team):**
```
Team Attainment = Total Team Revenue / Total Team Quota × 100
```

Or: Average of individual rep attainment rates.

**Reality check:** Industry data shows most reps don't hit quota:
- Average individual attainment: 43-50%
- Only 24% of reps exceed annual quota
- 69% of B2B reps fall short of quota

**Benchmarks (individual rep):**
- Below 50%: Below average
- 50-80%: Average range
- 80-100%: Strong performer
- 100%+: Top performer / exceeding

**Benchmarks (team/company):**
- 50%: Average (median rep at quota)
- 60-70%: Good
- 80-90%: Strong
- 90%+: Exceptional (or quotas may be too low)

**What it tells you:** Sales rep and team performance against targets.

**Quota setting rule of thumb:** Quota = 5x rep OTE (ranges from 3x to 8x depending on company stage).

**Sources:**
- [Forrester: Quota Attainment](https://www.forrester.com/blogs/your-companys-quota-attainment-is-probably-around-50-and-thats-not-a-bad-thing/)
- [Wall Street Prep: Quota Attainment](https://www.wallstreetprep.com/knowledge/quota-attainment/)
- [QuotaPath: Quota Attainment Rate](https://www.quotapath.com/blog/quota-attainment-rate/)

---

### Revenue per Rep

**Definition:** Total revenue generated divided by number of quota-carrying reps.

**Formula:**
```
Revenue per Rep = Total New Revenue / Number of Quota-Carrying Reps
```

**Benchmarks (Annual, New Business):**

By company stage:
- Seed: $250K-$400K
- Series A: $400K-$600K
- Series B+: $600K-$1M+

By segment:
- SMB: $400K-$600K
- Mid-market: $600K-$800K
- Enterprise: $800K-$1.5M+

**Median B2B SaaS:** $500K-$700K quota capacity

**Top performers:** $1M+ annually

**What it tells you:** Sales team productivity and efficiency.

**Factors affecting output:**
- ACV (higher = more per rep possible)
- Sales cycle length (longer = less per rep)
- Market maturity and brand recognition
- Sales support infrastructure (SDRs, tools)

**Sources:**
- [Optifai: Revenue Per Sales Rep Benchmark 2025](https://optif.ai/learn/questions/revenue-per-sales-rep-benchmark/)
- [Revenue.io: Revenue per Rep](https://www.revenue.io/inside-sales-glossary/what-is-revenue-per-rep)

---

### Ramp Time

**Definition:** Time for a new sales rep to reach full productivity (carrying full quota).

**Formula:**
```
Ramp Time = Time from start date to consistently achieving quota
```

**Common calculation:** Average sales cycle + 90 days (for onboarding/training)

Measured in months.

**Benchmarks by role:**
- SDR: 2-3 months
- Inside Sales/SMB AE: 3-4 months
- Mid-market AE: 4-6 months
- Enterprise AE: 6-9 months

**Industry averages:**
- Average SaaS ramp: 3.2-5 months
- 41% of companies report 5+ months
- Top performers target 3-4 months

**Ramp quota structure (typical):**
- Month 1: 25% quota
- Month 2: 50% quota
- Month 3: 75% quota
- Month 4+: 100% quota

**What it tells you:** How quickly new hires become productive. Impacts hiring planning and capacity forecasting.

**Sources:**
- [Mosaic: Sales Rep Ramp](https://www.mosaic.tech/financial-metrics/sales-rep-ramp)
- [Revenue.io: Sales Ramp Time](https://www.revenue.io/blog/heres-how-long-it-should-take-for-your-sales-reps-to-be-at-fully-ramped-quota)
- [Everstage: Sales Ramp Time](https://www.everstage.com/blog/how-to-determine-the-right-sales-ramp-up-time-for-reps)

---

### Activity Metrics (Diagnostic)

These are inputs, not outcomes. Track for diagnostics, not reporting.

| Metric | Definition |
|--------|------------|
| Calls per day | Outbound calls made |
| Emails per day | Outbound emails sent |
| Meetings booked | Discovery/demo meetings scheduled |
| Demos delivered | Product demonstrations completed |

---

## Summary Table

| Metric | Type | Primary Indicator Of |
|--------|------|---------------------|
| Pipeline Value | Pipeline | Total opportunity |
| Pipeline Coverage | Pipeline | Risk to hitting quota |
| Win Rate | Conversion | Sales effectiveness |
| Lead-to-Opportunity | Conversion | Lead quality + qualification |
| ACV | Deal | Deal size, segmentation |
| Sales Cycle | Deal | Time to revenue |
| Quota Attainment | Productivity | Rep performance |
| Revenue per Rep | Productivity | Team efficiency |
