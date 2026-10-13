# Core Business Metrics

These metrics describe the health of a SaaS business. Every SaaS business should track them.

**Foundation:** Core metric definitions follow industry consensus, informed by sources including the [SaaS Metrics Standards Board](https://www.saasmetricsboard.com/), SaaS Capital and KeyBanc.

---

## Revenue Metrics

### MRR (Monthly Recurring Revenue)

**Definition:** The total predictable revenue from active subscriptions, normalized to a monthly value.

**Formula:**
```
MRR = Sum of (Monthly subscription value for all active customers)
```

For annual contracts:
```
MRR contribution = Annual Contract Value / 12
```

**Include:**
- Recurring subscription fees
- Expansion and upgrade revenue
- Discounts (use discounted amount, not list price)

**Exclude:**
- One-time fees (setup, implementation, professional services)
- Trial accounts and free users
- Variable/usage-based fees (unless contractually guaranteed)
- Non-recurring charges

**Inputs:**
- Active customer list
- Subscription/contract value for each customer
- Contract term (monthly/annual)

MRR is reported per plan (by plan id and plan name) and per customer segment.

**What it tells you:** The current run rate of your recurring revenue engine.

**Important:** MRR is a business insights metric, not a GAAP/FASB accounting term. It is representative of, but not identical to, recognized revenue.

**Common mistakes:**
- Including one-time fees (setup, professional services)
- Including usage/consumption revenue that isn't guaranteed
- Double-counting customers during plan changes
- Not normalizing annual contracts to monthly
- Treating MRR as an accounting figure

**Related metrics:** ARR, MRR Growth Rate, New MRR, Expansion MRR, Churned MRR

**Sources:**
- [Baremetrics: MRR Definition](https://baremetrics.com/academy/saas-calculate-mrr)
- [Maxio: Monthly Recurring Revenue Defined](https://www.maxio.com/saaspedia/monthly-recurring-revenue-defined-for-a-saas-business)
- [ChurnZero: Monthly Recurring Revenue](https://churnzero.com/churnopedia/monthly-recurring-revenue-mrr/)

---

### ARR (Annual Recurring Revenue)

**Definition:** The annualized value of recurring revenue. ARR represents the yearly run rate of subscription revenue.

**Note:** ARR is used to mean two things in the industry:
1. **Annualized Run Rate** = MRR × 12 (common for monthly-billing companies)
2. **Annual Recurring Revenue** = Sum of annualized contract values (common for annual-contract companies)

Both are valid. The GASP Standard uses **MRR × 12** for consistency across business models.

**Formula:**
```
ARR = MRR × 12
```

**Include:** Same inclusions/exclusions as MRR, annualized.

ARR is reported per customer segment.

**What it tells you:** The scale of the business on an annual basis. Used for valuation, planning and investor reporting.

**Common mistakes:**
- Calculating from annual contracts directly without normalizing (leads to timing mismatches)
- Treating ARR as cash (it's a run rate, not collected revenue)
- Mixing definitions without declaring which one you're using

**Sources:**
- [SaaS Metrics Standards Board: ARR](https://www.saasmetricsboard.com/annual-recurring-revenue)
- [ChartMogul: ARR Definition](https://chartmogul.com/saas-metrics/arr/)
- [Maxio: Annual Recurring Revenue](https://www.maxio.com/saaspedia/arr)

#### Operating Form: ARR-O

ARR-O measures organic recurring revenue by excluding MRR changes that come from mechanical pricing or contract restructuring rather than genuine customer expansion.

**CEL Source:** `Revenue_Event`, `Amendment_Event`
**ATL Inclusion:** All `expansion_classification` values **except** `pricing_adjustment` and `recontracting`

**Formula:**
```
ARR-O = (MRR − TTM_Pricing_Adjustment_MRR − TTM_Recontracting_MRR) × 12
```
Where TTM_Pricing_Adjustment_MRR and TTM_Recontracting_MRR are the MRR changes tagged with `expansion_classification` `pricing_adjustment` or `recontracting` in the trailing 12 months, counted for customers active at period end. MRR is the period-end MRR used by ARR-M. ARR-O is therefore a trailing twelve month measure. Stripping price rises out of ARR is a GASP construct rather than an industry convention; where price and volume are separated elsewhere, it is a growth decomposition over the period.

**What it tells you:** The run rate of revenue that customers created by adopting and expanding, with price rises and recontracting taken out. It is the part of ARR most likely to last.

#### Market Form: ARR-M

ARR-M is total reported ARR including all sources of recurring revenue change. This is the number investors see and public comparables use.

**CEL Source:** `Revenue_Event`, `Amendment_Event`
**ATL Inclusion:** All `expansion_classification` values included

**Formula:**
```
ARR-M = MRR × 12
```
All MRR sources included.

**What it tells you:** The scale of the business as reported to the market. The number used in valuation multiples and investor benchmarks.

#### Bridge: ARR-O ↔ ARR-M

**Reconciliation:**
```
ARR-M = ARR-O + TTM_Pricing_Adjustment_MRR × 12 + TTM_Recontracting_MRR × 12
```

**Diagnostic:** The delta (ARR-M − ARR-O) is the **Durability Gap.** Because ARR-O subtracts only the trailing 12 months of tagged MRR change for customers active at period end, the Durability Gap is a trailing-year growth decomposition: it shows how much of reported ARR growth came from pricing and contract changes rather than organic customer expansion. A growing gap means ARR growth that may not last. KeyBanc tracks it implicitly in its annual SaaS survey. Public SaaS companies report total ARR (ARR-M), while internal planning teams strip out pricing actions to see the growth the product earned.

---

### ARPA (Average Revenue Per Account)

**Definition:** Average monthly recurring revenue per customer.

**Formula:**
```
ARPA = MRR / Active Customers
```

ARPA is reported per customer segment.

**What it tells you:** The average value of a customer on a monthly basis. Used in LTV and CAC Payback calculations.

**Note:** Some companies use ARPU (Average Revenue Per User) for user-based pricing. ARPA is account-level; ARPU is user-level.

---

### MRR Growth Rate

**Definition:** The month-over-month percentage change in MRR.

**Formula:**
```
MRR Growth Rate = (MRR this month - MRR last month) / MRR last month × 100
```

**Benchmarks:**
- Early stage (pre-$1M ARR): 15-20% MoM
- Growth stage ($1M-$10M ARR): 5-10% MoM
- Scale stage ($10M+ ARR): 2-5% MoM

**What it tells you:** The velocity of revenue growth.

**Sources:** [Baremetrics](https://baremetrics.com/academy/saas-calculate-mrr), [Chargebee](https://www.chargebee.com/resources/glossaries/what-is-net-mrr-growth/)

---

### New MRR

**Definition:** MRR generated from brand new customers acquired in the period.

**Formula:**
```
New MRR = Sum of (first month MRR from customers acquired this period)
```

**Example:** 5 new customers × $60/month plan = $300 New MRR

New MRR is reported per customer segment.

**What it tells you:** The output of your acquisition engine.

**Sources:** [Drivetrain](https://www.drivetrain.ai/strategic-finance-glossary/mrr-in-saas), [SaaS Academy](https://www.saasacademy.com/blog/what-is-mrr)

---

### Expansion MRR

**Definition:** Additional MRR from existing customers through upgrades, add-ons, seat increases or price increases.

**Formula:**
```
Expansion MRR = Sum of (MRR increase from existing customers this period)
```

**Includes:** Upsells, cross-sells, add-ons, seat expansion, plan upgrades

Expansion MRR is reported per customer segment.

**What it tells you:** How much revenue you grow from customers you already have, which usually costs far less than winning new ones.

**Key insight:** Expansion MRR rate should exceed churn rate for negative net churn.

**Sources:** [Wall Street Prep](https://www.wallstreetprep.com/knowledge/expansion-revenue-mrr/), [Drivetrain](https://www.drivetrain.ai/strategic-finance-glossary/mrr-in-saas)

---

### Churned MRR

**Definition:** MRR lost from customers who cancelled their subscriptions.

**Formula:**
```
Churned MRR = Sum of (MRR from customers who churned this period)
```

Churned MRR is reported per customer segment.

**What it tells you:** The leakage in your revenue bucket from customer attrition.

**Sources:** [Drivetrain](https://www.drivetrain.ai/strategic-finance-glossary/mrr-in-saas), [Baremetrics](https://baremetrics.com/academy/saas-calculate-mrr)

---

### Contraction MRR

**Definition:** MRR reduction from existing customers who downgraded but didn't churn.

**Formula:**
```
Contraction MRR = Sum of (MRR decrease from existing customers who remain active)
```

**Includes:** Plan downgrades, removed seats, dropped add-ons

Contraction MRR is reported per customer segment.

**What it tells you:** Revenue pressure from customers reducing usage/commitment.

**Sources:** [Drivetrain](https://www.drivetrain.ai/strategic-finance-glossary/mrr-in-saas), [SaaS Academy](https://www.saasacademy.com/blog/what-is-mrr)

---

### Carry MRR

**Definition:** The part of beginning MRR that existing customers kept paying in the period: beginning MRR less churned and contraction MRR, before any expansion.

**Formula:**
```
Carry MRR = Beginning MRR - Churned MRR - Contraction MRR
```

**Also known as:** Base MRR, Retained MRR, Renewal MRR

**What it tells you:** How much of last period's revenue base is still in place. Carry MRR is Gross Revenue Retention (GRR) in dollar terms: divide it by beginning MRR and you get GRR.

**Key insight:** If carry is declining while expansion masks it, you have a retention problem hiding behind growth.

**Sources:** [Baremetrics](https://baremetrics.com/academy/saas-calculate-mrr), [ChartMogul](https://chartmogul.com/blog/mrr-movements/)

---

### Net New MRR

**Definition:** The net change in MRR after accounting for all movements.

**Formula:**
```
Net New MRR = New MRR + Expansion MRR - Churned MRR - Contraction MRR
```

**Example:**
$50,000 starting + $2,500 new + $5,000 expansion - $1,000 churned - $500 contraction = $56,000 ending

**What it tells you:** Whether MRR grew or shrank over the period and by how much, after every movement is counted.

**Sources:** [Baremetrics](https://baremetrics.com/academy/saas-calculate-mrr), [Chargebee](https://www.chargebee.com/resources/glossaries/what-is-net-mrr-growth/)

---

### Bundle Pricing and MRR Allocation

**Definition:** When a subscription is sold as a bundle (a single SKU containing multiple products, features or services at one price), individual line items within the bundle have no explicit price. MRR must still be allocated to each component for accurate reporting of expansion, contraction and churn at the item level.

**The problem:** A customer pays $500/month for a "Growth Bundle" containing CRM, Analytics and Support. If they later remove Analytics, what was Analytics worth? Without allocation, you can't measure contraction MRR or product-level revenue.

**Industry standard method: Relative Standalone Selling Price (SSP)**

This is the method prescribed by ASC 606 / IFRS 15 for revenue recognition and used by Stripe, Zuora and Chargebee for bundle allocation:

```
Item MRR = (Item SSP / Sum of all item SSPs) × Bundle Price
```

**Steps:**
1. **Determine standalone selling price (SSP)** for each item. The price you would charge if the item were sold individually
2. **Calculate the allocation ratio.** Each item's SSP as a percentage of the total SSPs
3. **Apply the ratio to the bundle price.** This gives each item its allocated MRR

**Example:**

| Item | Standalone Price | Allocation % | Allocated MRR |
|------|-----------------|--------------|---------------|
| CRM | $300/mo | 50% | $250 |
| Analytics | $200/mo | 33% | $167 |
| Support | $100/mo | 17% | $83 |
| **Total SSP** | **$600/mo** | **100%** | **$500** |

The bundle discount ($100) is distributed proportionally across all items.

**When SSP is not observable:** If an item has never been sold individually, ASC 606 provides three estimation methods:
- **Adjusted market assessment.** Estimate what the market would pay
- **Expected cost plus margin.** Cost to deliver + target margin
- **Residual approach.** Allocate known SSPs first, remainder to the unknown item (use only when SSP is highly variable or uncertain)

**What this enables:**
- Accurate contraction/expansion MRR when bundle components change
- Product-level revenue attribution
- Meaningful churn analysis per product line
- Consistent reporting between finance (ASC 606) and operations (MRR)

**Common mistakes:**
- Allocating equally across items regardless of value
- Using cost as a proxy for value (low-cost items may have high customer value)
- Not updating SSPs when standalone pricing changes
- Treating the entire bundle as a single unit (hides component-level movements)

**Note:** MRR allocation for operational reporting should align with your ASC 606 / IFRS 15 revenue allocation where possible. Divergence between operational MRR and recognised revenue creates reconciliation problems.

**Sources:**
- [Stripe: Standalone Selling Prices](https://docs.stripe.com/revenue-recognition/standalone-selling-price)
- [Chargebee: Standalone Selling Price](https://www.chargebee.com/docs/revrec/revenue-recognition/standalone-selling-price)
- [Zuora: Fair Value / SSP in Multiple-Element Arrangements](https://www.zuora.com/resource/fair-value-standalone-selling-price-multiple-element-arrangements-revpro/)
- [Maxio: SaaS Revenue Recognition and ASC 606](https://www.maxio.com/blog/saas-revenue-recognition-asc-606)

---

## Retention Metrics

### Net Revenue Retention (NRR)

**Definition:** The percentage of revenue retained from existing customers over a period, including expansion, contraction and churn. Also known as Net Dollar Retention (NDR).

**Calculation Methods:**

Two methods are widely used. The **cohort method is preferred** because it keeps customers acquired during the period out by construction. The GASP Standard gets the same protection by running the formula method over the customers active at period start.

**1. Cohort Method (Preferred):**
Compare the MRR of a specific group of customers from one year ago to the MRR of those same customers today. New customers acquired during the period are excluded.

```
NRR = MRR of cohort today / MRR of same cohort 12 months ago × 100
```

**2. Formula Method:**
```
NRR = (Beginning MRR + Expansion MRR - Contraction MRR - Churned MRR) / Beginning MRR × 100
```

**Time period:** The GASP Standard measures NRR over the **trailing 12 months**, which smooths seasonality and is the basis boards and investors expect.

**Annualization:** If calculating over a shorter period, annualize by raising to the appropriate power:
- Monthly NRR annualized: `(Monthly NRR / 100) ^ 12 × 100`
- Quarterly NRR annualized: `(Quarterly NRR / 100) ^ 4 × 100`

**Does NOT include:** New customer revenue. NRR measures existing customer behavior only.

**Benchmarks (per KeyBanc 2024, SaaS Capital 2025):**
- Below 90%: Leaky bucket. Growth requires constant new acquisition.
- 90-100%: Stable. You keep what you have.
- 100-110%: Good. Existing customers grow. (Median for VC-backed SaaS: 101-106%)
- 110-120%: Great. Strong expansion motion.
- 120%+: Exceptional. Top quartile performance.

**Segment-specific benchmarks (per SaaS Capital 2025):**
- SMB-focused: 90-105% typical
- Mid-market: 105-115% typical
- Enterprise: 115-125% typical

NRR is reported per customer segment, each snapshot and event counting in the segment it carries.

**What it tells you:** Whether the customers you had a year ago are paying you more or less today. Above 100%, the existing base grows on its own and new customers add on top; below it, new sales first have to replace what the base lost.

**Common mistakes:**
- Calculating over inconsistent time periods
- Including new customer revenue (that's not NRR)
- Excluding small customers or segments
- Confusing with Gross Revenue Retention (GRR)

**Sources:**
- [SaaS Metrics Standards Board: NRR](https://www.saasmetricsboard.com/net-revenue-retention)
- [Wall Street Prep: Net Revenue Retention](https://www.wallstreetprep.com/knowledge/net-revenue-retention-nrr/)
- [ChurnZero: Net Revenue Retention](https://churnzero.com/churnopedia/net-revenue-retention/)

#### Operating Form: Cohort NRR (NRR-O)

NRR-O uses the cohort method and includes only organic expansion: growth on the same product and usage realisation. It excludes expansion from new modules, new buying centres, reactivation, recontracting and pricing actions.

**CEL Source:** `Revenue_Event`
**ATL Inclusion:**
- `lifecycle_attribution` ∈ (`retention`, `expansion`)
- `expansion_classification` ∈ (`same_product`, `usage_realisation`)
- Excludes: `expansion_classification` ∈ (`new_module`, `new_buying_centre`, `pricing_adjustment`, `recontracting`) and `lifecycle_attribution` = `reactivation`

**Formula:**
```
NRR-O = MRR of cohort today (organic only) / MRR of same cohort 12 months ago × 100
```

**What it tells you:** Whether customers expand because the product gives them more value, with cross-sell, reactivation and pricing taken out. It is the closest NRR gets to a product-market fit signal.

#### Market Form: Account NRR (NRR-M)

NRR-M uses the cohort method over the customers active at period start, the same construction public SaaS companies report and investors benchmark (Bessemer, KeyBanc). It includes all six `expansion_classification` values plus reactivation of cohort customers. A customer who churned before the window and returns inside it is new business, not retention. A customer who churns and returns inside the window is in the cohort, so that reactivation counts.

**CEL Source:** `Revenue_Event`
**ATL Inclusion:**
- All `expansion_classification` values included (`same_product`, `new_module`, `new_buying_centre`, `pricing_adjustment`, `recontracting`, `usage_realisation`)
- `event_type` = `reactivation` included for customers in the period-start cohort
- Excluded: `lifecycle_attribution` = `acquisition`; reactivation of customers who had already churned before period start (new business)

**Formula:**
```
NRR-M = MRR of cohort today (all expansion types and cohort reactivation) / MRR of same cohort 12 months ago × 100
```
Equivalently, as the formula method over the same cohort:
```
NRR-M = (Beginning MRR + All Expansion MRR + Cohort Reactivation MRR − Contraction MRR − Churned MRR) / Beginning MRR × 100
```

**What it tells you:** The total revenue retention and expansion picture that investors use for benchmarking and valuation.

#### Bridge: NRR-O ↔ NRR-M

**Reconciliation:**
```
NRR-M ≈ NRR-O + Reactivation + Cross-Module + New Buying Centre + Pricing Adjustment + Recontracting expansion
```
(Expressed as percentage-point contributions to the NRR rate.)

**Diagnostic:** The delta (NRR-M − NRR-O) is the **Expansion Integrity Gap.** It shows how much of reported NRR comes from commercial motion (cross-sell, reactivation, pricing) rather than organic product expansion. A wide gap means NRR depends on sales execution more than product-led growth. That can be a sound strategy. The board should still know which one drives retention. SaaS Metrics Standards Board recommends the cohort method. Public SaaS companies report cohort-based NRR (NRR-M), so both forms use the cohort method and differ only in which expansion counts.

---

### Gross Revenue Retention (GRR)

**Definition:** The percentage of revenue retained from existing customers, excluding expansion revenue. Also known as Gross Dollar Retention.

**Calculation Methods:**

Two methods are widely used. The GASP Standard uses the **formula method** as canonical. Both run over the customers active at the start of the period.

**1. Formula Method (Canonical):**
```
GRR = (Beginning MRR - Contraction MRR - Churned MRR) / Beginning MRR × 100
```

**2. Cohort Method (Alternative):**
Compare the MRR of a cohort, using the lesser of beginning MRR or current MRR for each customer (this mathematically eliminates expansion while capturing shrinkage and churn).

```
GRR = Sum of min(Beginning MRR, Current MRR) per customer / Beginning MRR × 100
```

**Why they differ:** The cohort method nets each customer's movements within the period, so a customer who contracts and then expands back to their starting MRR shows no loss. The formula method counts every contraction and churn event as it happens, so it is equal to or lower than the cohort method. The formula method is canonical because it reads the same contraction and churn events as Net Revenue Retention (NRR), keeping the two retention rates on one basis. It also needs no per-customer end-of-period snapshot. Report the cohort method as a labelled alternative.

**Time period:** Typically measured annually.

**Annualization:** If calculating over a shorter period, annualize by raising to the appropriate power:
- Monthly GRR annualized: `(Monthly GRR / 100) ^ 12 × 100`
- Quarterly GRR annualized: `(Quarterly GRR / 100) ^ 4 × 100`

**Critical:** GRR **cannot exceed 100%**. Unlike NRR, it does not include upsells, cross-sells or expansion. Maximum GRR = 100% (zero churn).

**Benchmarks (per SaaS Capital 2025):**
- Below 80%: Severe retention problem
- 80-85%: Below average for most segments
- 85-90%: Average for SMB-focused businesses (Median for bootstrapped SaaS: 92%)
- 90-95%: Good, typical for mid-market
- 95%+: Excellent, typical for enterprise (90th percentile: 98%)

**Segment-specific (per SaaS Capital 2025):**
- SMB: 85%+ is good
- Mid-market/Enterprise: 90%+ is good
- High ACV Enterprise: 95%+ expected

GRR is reported per customer segment, each snapshot and event counting in the segment it carries.

**What it tells you:** The baseline health of your customer relationships, independent of upsell. Investors examine GRR alongside NRR because strong expansion can mask high churn.

**Sources:**
- [SaaS Metrics Standards Board: GRR](https://www.saasmetricsboard.com/gross-revenue-retention)
- [Wall Street Prep: Gross Revenue Retention](https://www.wallstreetprep.com/knowledge/gross-revenue-retention/)
- [ChartMogul: GRR](https://chartmogul.com/saas-metrics/grr/)

#### Dual-Lens Note

GRR measures revenue retained from existing customers and leaves expansion out. The Operating and Market forms of other metrics differ in which expansion classifications they count, so GRR has nothing to filter. One calculation serves internal planning and investor reporting.

---

### Logo Churn Rate (Customer Churn)

**Definition:** The percentage of customers lost in a period. Also called customer churn or logo churn.

**Formula:**
```
Logo Churn Rate = Customers lost in period / Customers at start of period × 100
```

**Time period:** Monthly or annual basis. Always specify which.

**Benchmarks (Monthly, per OpenView/High Alpha 2024):**
- <1%: Good for established SaaS
- 1-2%: Acceptable
- 2-3%: Concerning
- >3%: Requires attention

**Benchmarks (Annual):**
- <5%: Excellent
- 5-7%: Good
- 7-10%: Average
- >10%: High churn

**By segment (per SaaS Capital 2025):**
- SMB: Higher churn is normal (3-5% monthly). SMB churn is ~8x higher than enterprise.
- Mid-market: 1-2% monthly typical
- Enterprise: <1% monthly expected

Logo Churn Rate is reported per customer segment.

**What it tells you:** How many customers are leaving, regardless of their value. Important for understanding customer experience separate from revenue impact.

**Logo vs Revenue Churn:** Logo churn counts customers equally. Revenue churn weights by value. Losing a few high-value customers may show low logo churn but high revenue churn.

**Sources:**
- [ChartMogul: Customer Churn](https://chartmogul.com/saas-metrics/customer-churn/)
- [ChurnZero: Churn Rate](https://churnzero.com/churnopedia/churn-rate/)
- [Maxio: Calculating Churn](https://www.maxio.com/saaspedia/calculating-churn-in-a-saas-business)

---

### Revenue Churn Rate

**Definition:** The percentage of MRR lost to churn and contraction in a period. Also called MRR Churn Rate.

**Formula:**
```
Revenue Churn Rate = (Churned MRR + Contraction MRR) / Beginning MRR × 100
```

This is gross revenue churn: it measures losses only, without netting against expansion. It is the canonical formula because it isolates the leakage.

**Note:** "Net Revenue Churn" (which subtracts expansion) can be calculated but conflates two distinct dynamics. Use NRR for the net view instead.

**Benchmarks (Monthly, per OpenView 2024):**
- <2%: Good
- 2-5%: Average
- >5%: High (average annual churn ~4.9% for B2B SaaS)

Revenue Churn Rate is reported per customer segment.

**What it tells you:** The revenue impact of churn. If revenue churn is lower than logo churn, you're losing smaller customers (often acceptable). If higher, you're losing larger customers (concerning).

**Sources:**
- [Wall Street Prep: Revenue Churn](https://www.wallstreetprep.com/knowledge/revenue-churn-mrr/)
- [ChartMogul: Revenue Churn](https://chartmogul.com/saas-metrics/revenue-churn/)
- [Maxio: MRR Churn](https://www.maxio.com/saaspedia/mrr-churn)

#### Dual-Lens: Revenue Churn (Churn-O) and Logo Churn (Churn-M)

Revenue Churn Rate and Logo Churn Rate (defined above) are the Operating and Market forms of the same underlying phenomenon: customer attrition.

**Operating Form: Revenue Churn Rate (Churn-O)**

MRR-weighted churn captures the economic impact of attrition. The formula is defined above: `(Churned MRR + Contraction MRR) / Beginning MRR × 100`.

**CEL Source:** `Revenue_Event` where `event_type` ∈ (`churn`, `contraction`)

**What it tells you:** The economic damage of attrition, which is why it is the operating form. Losing a $50K customer hits harder than losing a $500 customer.

**Market Form: Logo Churn Rate (Churn-M)**

Customer-count churn treats every logo equally. The formula is defined in the Logo Churn Rate section above: `Customers lost / Customers at start × 100`.

**CEL Source:** `Revenue_Event` where `event_type` = `churn` (full churn only. Contraction is not logo churn)

**What it tells you:** How many customers leave, counted the simple way investors benchmark, which is why it is the market form.

**Bridge:** Revenue Churn and Logo Churn are not additive. One measures dollars, the other measures logos. The diagnostic compares the two signals:
- **Churn-O high, Churn-M low →** Losing few but high-value customers (concentration risk)
- **Churn-M high, Churn-O low →** Losing many small customers (long-tail churn)
- Read the pattern by customer segment to see where retention work should go.

---

### NPS (Net Promoter Score)

**Definition:** A measure of customer loyalty based on likelihood to recommend.

**Origin:** Developed by Fred Reichheld, Bain & Company and Satmetrix (2003). Based on Harvard Business Review article "The One Number You Need to Grow."

**The Question:**
"How likely are you to recommend [product/company] to a friend or colleague?" (0-10 scale)

**Customer Categories:**
| Category | Score | Behavior |
|----------|-------|----------|
| Promoters | 9-10 | Loyal, enthusiastic, will refer, drive growth |
| Passives | 7-8 | Satisfied but vulnerable, may switch to competitors |
| Detractors | 0-6 | Unhappy, high churn, 80%+ of negative word-of-mouth |

**Formula:**
```
NPS = % Promoters - % Detractors
```

Passives are not included in the calculation.

**Score Range:** -100 to +100

**Benchmarks (per Bain & Company, CustomerGauge 2025):**
- Below 0: More detractors than promoters
- 0-30: Average (B2B SaaS average: 36-41)
- 30-50: Good
- 50-70: Excellent (top performers)
- 70+: World class

**What it tells you:** A leading indicator of retention and growth. A falling NPS often shows churn risk before it reaches the revenue metrics, early enough to act. Bain & Company research links NPS to organic growth through referrals and reduced churn.

**Common mistakes:**
- Low response rates (<20% makes data unreliable)
- Survey fatigue from over-asking
- Not closing the loop with detractors
- Comparing across industries (benchmarks vary significantly)

**Sources:**
- [Bain & Company: Measuring Your Net Promoter Score](https://www.netpromotersystem.com/about/measuring-your-net-promoter-score/)
- [Wikipedia: Net Promoter Score](https://en.wikipedia.org/wiki/Net_promoter_score)
- [Qualtrics: Net Promoter Score Guide](https://www.qualtrics.com/en-au/experience-management/customer/net-promoter-score/)

---

## Efficiency Metrics

### CAC (Customer Acquisition Cost)

**Definition:** The total cost to acquire a new customer.

**Formula:**
```
CAC = (Sales + Marketing spend in period) / New customers acquired in period
```

**Include:**
- Sales salaries and commissions (for new customer acquisition)
- Marketing salaries
- Advertising spend
- Marketing tools and software
- Events and content costs
- Trial/POC hosting costs

**Exclude:**
- Customer Success costs (retention, not acquisition)
- Costs for existing customer expansion
- General overhead (unless investor requires)

**Allocation:** If a salesperson splits time between new and existing customers (e.g., 70/30), allocate only the acquisition portion (70%) to CAC.

**By cost centre:** CAC can also be reported per cost centre, over all new customers: each row divides that centre's acquisition spend by every new customer in the period, so the rows sum to CAC.

**Timing:** For long sales cycles, consider lagged CAC: spend from 60-90 days ago / customers acquired today.

**What it tells you:** The investment required to acquire each customer.

**Benchmarks (per First Page Sage 2025):**
- SMB SaaS: $300-$1,000
- Mid-market: $1,000-$5,000
- Enterprise: $5,000-$50,000+
- Target LTV:CAC ratio: 3:1 or higher (see LTV:CAC Ratio)

**Common mistakes:**
- Excluding salaries (they're a real cost)
- Using wrong time period (customers acquired may not align with spend timing)
- Including Customer Success costs
- Mixing paid and organic (calculate separately for channel efficiency)

**Sources:**
- [Wall Street Prep: Customer Acquisition Cost](https://www.wallstreetprep.com/knowledge/customer-acquisition-cost-cac/)
- [Maxio: CAC Customer Acquisition Cost](https://www.maxio.com/saaspedia/cac-customer-acquisition-cost)
- [Paddle: Customer Acquisition Cost](https://www.paddle.com/resources/customer-acquisition-cost)

#### Operating Form: Fully Loaded CAC (CAC-O)

CAC-O includes all costs to make a customer productive: go-to-market spend plus implementation and onboarding. It is the full cost of turning a prospect into a customer who generates revenue. Implementation support during a trial or proof of concept is an activation cost: tag it `cost_function` = `implementation` and it counts in CAC-O and in the Activation Delta, outside the main CAC Include list.

**CEL Source:** `Cost_Event`
**ATL Inclusion:** `cost_function` ∈ (`gtm`, `implementation`, `onboarding`), the acquisition and activation lifecycle costs

**Formula:**
```
CAC-O = Total Cost (Acquisition + Activation lifecycle) / New Customers Acquired
```

**What it tells you:** The full investment required to get a customer generating value. It is the CAC to use in unit economics.

#### Market Form: GTM CAC (CAC-M)

CAC-M includes only go-to-market costs: sales and marketing spend. This matches the investor-comparable CAC used by KeyBanc, Benchmarkit and public SaaS benchmarks.

**CEL Source:** `Cost_Event`
**ATL Inclusion:** `cost_function` = `gtm` (all sales and marketing spend, the S&M basis investors use)

**Formula:**
```
CAC-M = S&M Spend / New Customers Acquired
```

**What it tells you:** The market-comparable acquisition cost used in LTV:CAC ratios and investor benchmarks.

#### Bridge: CAC-O ↔ CAC-M

**Reconciliation:**
```
CAC-O = CAC-M + Implementation_Cost_per_Customer + Onboarding_Cost_per_Customer
```

**Diagnostic:** The delta (CAC-O − CAC-M) is the **Activation Delta:** the cost of making customers productive, which S&M-based benchmarks leave out. A large Activation Delta means investor-comparable CAC understates what acquisition really costs. Implementation complexity, onboarding duration and services intensity drive it. SaaS Metrics Standards Board defines the Blended CAC Ratio as S&M-only (CAC-M). SaaS Capital and a16z recommend tracking fully loaded CAC (CAC-O) alongside for unit economics.

---

### LTV (Customer Lifetime Value)

**Definition:** The gross profit expected from a customer over their lifetime. Also known as CLV (Customer Lifetime Value) or CLTV.

**Formula:**
```
LTV = (ARPA × Gross Margin) / Revenue Churn Rate
```

Where:
- **ARPA** = Average Revenue Per Account (monthly)
- **Gross Margin** = typically 70-85% for SaaS
- **Revenue Churn Rate** = monthly churn rate

**Why gross margin is included:** LTV measures profit contribution, not just revenue. Using gross margin reflects what you actually retain after delivery costs. This is the canonical formula.

**What it tells you:** The upper bound of what you should spend to acquire a customer.

**Limitations:**
- Basic formula is optimistic (assumes linear churn)
- Doesn't account for expansion revenue (understates for high-NRR companies)
- Requires sufficient sample size for accuracy
- Consider applying 0.75x discount for conservatism

**Sources:**
- [ChartMogul: Customer Lifetime Value](https://chartmogul.com/saas-metrics/ltv/)
- [Baremetrics: Calculating LTV](https://baremetrics.com/academy/saas-calculating-ltv)
- [Wall Street Prep: Customer Lifetime Value](https://www.wallstreetprep.com/knowledge/lifetime-value-ltv/)

#### Operating Form: Contribution LTV (LTV-O)

LTV-O uses contribution margin: revenue minus every variable cost, including implementation, onboarding, support and customer success. It is the profit a customer contributes over their lifetime.

**CEL Source:** `Revenue_Event`, `Cost_Event`
**ATL Inclusion for costs:** All variable `cost_function` values per customer

**Formula:**
```
LTV-O = (ARPA × Contribution Margin) / Revenue Churn Rate
```
Where Contribution Margin = Revenue − COGS − Implementation − Onboarding − Support − Success Engineering costs.

**What it tells you:** The realistic lifetime profit from a customer after all variable delivery costs. The number to use for pricing and unit economics decisions.

#### Market Form: Gross Margin LTV (LTV-M)

LTV-M uses SaaS gross margin, revenue minus COGS only. This is the formula already defined above and matches investor benchmarks (the 3:1 LTV:CAC threshold uses this form).

**CEL Source:** `Revenue_Event`, `Cost_Event`
**ATL Inclusion for costs:** `cost_function` = `infrastructure` only (COGS)

**Formula:**
```
LTV-M = (ARPA × Gross Margin) / Revenue Churn Rate
```

**What it tells you:** The investor-comparable lifetime value. The number used in LTV:CAC ratios reported to the board and in fundraising materials.

**Note:** The formula defined above in this section is LTV-M. The Operating Form (LTV-O) substitutes Contribution Margin for Gross Margin.

#### Bridge: LTV-O ↔ LTV-M

**Reconciliation:**
```
LTV-M − LTV-O = Variable Service Costs per Customer × Customer Lifetime
```
The gap is the lifetime profit consumed by variable service costs (implementation, onboarding, support, CS).

**Diagnostic:** The delta (LTV-M − LTV-O) is the **Contribution Leakage.** Large leakage means the business model depends on services that erode unit economics. It points to services that could be productised or onboarding that could be self-serve. The canonical LTV formula in investor contexts uses gross margin (LTV-M). This is what a16z, Bessemer and SaaS Capital reference. Contribution margin LTV (LTV-O) is recommended by growth equity investors for deeper unit economics analysis.

---

### LTV:CAC Ratio

**Definition:** The ratio of customer lifetime value to acquisition cost. Measures the return on investment from sales and marketing spend.

**Formula:**
```
LTV:CAC = LTV / CAC
```

Express as ratio (e.g., "3:1" or "3.0x").

**Benchmarks (per Optifai 2025, Wall Street Prep):**
- Below 1:1: Losing money on every customer
- 1:1 to 2:1: Breaking even or marginal, concerning to investors
- 3:1 to 4:1: Industry standard, healthy sustainable growth (Median B2B SaaS: 3.2:1)
- 4:1 to 5:1: Strong business model
- Above 5:1: Under-investing in growth; could be growing faster

**What it tells you:** Unit economics health. Are customers worth more than they cost to acquire?

**Important:** Higher is not always better. A very high ratio (5:1+) suggests you're leaving growth on the table by not investing enough in acquisition.

**Sources:**
- [Wall Street Prep: LTV/CAC Ratio](https://www.wallstreetprep.com/knowledge/ltv-cac-ratio/)
- [SaaS Capital: LTV/CAC Benchmarks](https://www.saas-capital.com/blog-posts/ltv-to-cac-ratio/)
- [Corporate Finance Institute: LTV/CAC](https://corporatefinanceinstitute.com/resources/valuation/ltv-cac-ratio/)

#### Operating Form: Contribution LTV:CAC (LTV:CAC-O)

LTV:CAC-O divides Contribution LTV by Fully Loaded CAC. Both sides carry the cost of making a customer productive: the numerator loses the variable service costs over the lifetime and the denominator gains implementation and onboarding.

**CEL Source:** `Revenue_Event`, `Cost_Event`
**ATL Inclusion for costs:** LTV-O margin costs (`infrastructure`, `support`, `success_engineering`, `implementation`, `onboarding`); CAC-O costs (`gtm`, `implementation`, `onboarding`)

**Formula:**
```
LTV:CAC-O = LTV-O / CAC-O
```

**What it tells you:** The return on acquisition spend after every variable cost of acquiring and serving a customer. The ratio to use for pricing, packaging and services investment decisions.

#### Market Form: Gross Margin LTV:CAC (LTV:CAC-M)

LTV:CAC-M divides Gross Margin LTV by GTM CAC. This is the ratio investors benchmark and the form the 3:1 threshold above assumes.

**CEL Source:** `Revenue_Event`, `Cost_Event`
**ATL Inclusion for costs:** LTV-M margin costs (`infrastructure` only); CAC-M costs (`gtm` only)

**Formula:**
```
LTV:CAC-M = LTV-M / CAC-M
```

**What it tells you:** The investor-comparable unit economics ratio reported to the board and in fundraising materials.

#### Bridge: LTV:CAC-O ↔ LTV:CAC-M

**Reconciliation:**
```
LTV:CAC-O = LTV:CAC-M × (LTV-O / LTV-M) × (CAC-M / CAC-O)
```
The two factors are the Contribution Leakage on the LTV side and the Activation Delta on the CAC side.

**Diagnostic:** The gap between LTV:CAC-M and LTV:CAC-O shows how much of the headline ratio depends on human delivery costs that S&M-based benchmarks leave out. A business at 3:1 on the market form and well under 2:1 on the operating form is buying growth with services effort. Report LTV:CAC-M for comparability and manage to LTV:CAC-O.

---

### CAC Payback Period

**Definition:** The number of months required to recover the cost of acquiring a customer. Also called "Months to Recover CAC" or "Time to Recover CAC."

**Formula:**
```
CAC Payback = CAC / (ARPA × Gross Margin)
```

Result in months.

**Why include Gross Margin:** Using gross margin (not just revenue) reflects actual profit recovery. Without it, payback appears shorter than reality.

**Benchmarks (per Benchmarkit 2025, KeyBanc 2024):**
- Under 12 months: Good, investor-friendly target (best-in-class)
- 12-18 months: Acceptable (Median 2024: 18-20 months)
- 18-24 months: Concerning for most segments
- Over 24 months: Requires attention

**By segment:**
- SMB: 8-12 months typical
- Mid-market: 14-18 months typical
- Enterprise: 18-24 months typical (longer sales cycles)

**What it tells you:** How many months of gross profit a new customer takes to repay what it cost to win. Payback sets how much cash growth ties up, so it limits how fast a company can grow on its own money.

**Sources:**
- [Wall Street Prep: CAC Payback Period](https://www.wallstreetprep.com/knowledge/cac-payback-period/)
- [Maxio: CAC Payback](https://www.maxio.com/saaspedia/cac-payback)
- [Corporate Finance Institute: CAC Payback Period](https://corporatefinanceinstitute.com/resources/valuation/cac-payback-period/)

#### Operating Form: Fully Loaded CAC Payback (CAC Payback-O)

CAC Payback-O recovers Fully Loaded CAC from contribution margin. Implementation and onboarding cost raise the amount to recover and variable service costs lower the monthly margin that recovers it.

**CEL Source:** `Revenue_Event`, `Cost_Event`
**ATL Inclusion for costs:** CAC-O costs (`gtm`, `implementation`, `onboarding`); GM-O costs (`infrastructure`, `support`, `success_engineering`, `implementation`, `onboarding`)

**Formula:**
```
CAC Payback-O = CAC-O / (ARPA × GM-O)
```

**What it tells you:** How long a customer really takes to pay back everything spent to win and activate it. The number for cash planning.

#### Market Form: GTM CAC Payback (CAC Payback-M)

CAC Payback-M recovers GTM CAC from SaaS gross margin. It matches the payback period Benchmarkit and KeyBanc report and the benchmarks above.

**CEL Source:** `Revenue_Event`, `Cost_Event`
**ATL Inclusion for costs:** CAC-M costs (`gtm` only); GM-M costs (`infrastructure` only)

**Formula:**
```
CAC Payback-M = CAC-M / (ARPA × GM-M)
```

**What it tells you:** The investor-comparable payback period used in benchmarks and board reporting.

#### Bridge: CAC Payback-O ↔ CAC Payback-M

**Reconciliation:**
```
CAC Payback-O = CAC Payback-M × (CAC-O / CAC-M) × (GM-M / GM-O)
```
ARPA is the same in both forms, so the gap comes from the Activation Delta and the Services Drag alone.

**Diagnostic:** A payback that looks healthy on the market form and runs months longer on the operating form means activation and service costs are tying up cash the S&M view does not show. The ratio CAC-O / CAC-M isolates the acquisition side; GM-M / GM-O isolates the delivery side.

---

### Gross Margin

**Definition:** Revenue minus cost of goods sold (COGS), as a percentage of revenue. Measures profitability after direct delivery costs.

**Formula:**
```
Gross Margin = (Revenue (GAAP) - COGS) / Revenue (GAAP) × 100
```

**Note:** Use GAAP-recognized revenue, not MRR/ARR. Gross Margin is a financial statement metric.

**Include in COGS** (ATL `cost_function` = `infrastructure`):
- Hosting/infrastructure costs (AWS, Azure, etc.)
- DevOps team costs that keep the service running
- Payment processing fees
- Third-party software for product delivery
- Capitalized software amortization

**Exclude from COGS:**
- Customer Support and Customer Success teams (`cost_function` = `support`, `success_engineering`). These are subtracted in the Operating Form below, not in COGS.
- Implementation and onboarding (`cost_function` = `implementation`, `onboarding`). Also Operating Form.
- Sales & Marketing expenses (`gtm`)
- R&D (product development)
- G&A overhead

**COGS Test:** "Can customers still access and use the application if I don't pay this expense?" If no, include in COGS.

**Fully burdened:** COGS teams include all costs: wages, bonuses, payroll taxes, benefits, travel, training, internal tools.

The canonical Gross Margin is the Market Form (GM-M) below. Companies that allocate Support and CS to COGS in their financial statements should report that figure as GM-O (contribution margin), which is where those costs belong in GASP.

**Benchmarks (per CloudZero 2025, industry surveys):**
- Below 60%: Low, may indicate infrastructure-heavy or services-heavy business
- 60-70%: Moderate (Seed/Series A acceptable while scaling)
- 70-80%: Good, typical for SaaS (Most VCs require 70%+ for investment)
- 75-80%: Series B+ expected, attractive to investors
- 80-85%: Best-in-class (commands valuation premium)

**What it tells you:** How much of each dollar of revenue is available after delivery costs. Higher margins = more scalable business.

**Sources:**
- [The SaaS CFO: How to Calculate SaaS Gross Margin](https://www.thesaascfo.com/how-to-calculate-saas-gross-margin/)
- [CloudZero: SaaS Gross Margin](https://www.cloudzero.com/blog/saas-gross-margin/)
- [Drivetrain: SaaS Gross Margin](https://www.drivetrain.ai/strategic-finance-glossary/saas-gross-margin)

#### Operating Form: Contribution Margin (GM-O)

Contribution Margin is revenue minus every variable cost of serving customers. It shows what each customer earns after the costs that grow with the customer base.

**CEL Source:** `Revenue_Event`, `Cost_Event`
**ATL Inclusion for costs:** `cost_function` ∈ (`infrastructure`, `support`, `success_engineering`, `implementation`, `onboarding`)

**Formula:**
```
GM-O = (Revenue − COGS − Support − CS − Implementation − Onboarding) / Revenue × 100
```
Typical range: 50-70% for SaaS.

**What it tells you:** How much profit each customer generates after every variable delivery cost, which is why it is the operating form.

#### Market Form: SaaS Gross Margin (GM-M)

SaaS Gross Margin is revenue minus COGS only (hosting, infrastructure and payment processing). It matches financial statement reporting and investor benchmarks.

**CEL Source:** `Revenue_Event`, `Cost_Event`
**ATL Inclusion for costs:** `cost_function` = `infrastructure`

**Formula:**
```
GM-M = (Revenue − COGS) / Revenue × 100
```
Typical range: 70-85% for SaaS.

**What it tells you:** The market-comparable gross margin that investors expect at 70%+ for SaaS businesses.

**Note:** The canonical Gross Margin above equals GM-M. GM-O subtracts the human delivery costs (Support, CS, Implementation, Onboarding) that some companies allocate to COGS in their statements; GASP keeps them out of COGS so the two forms reconcile exactly through the bridge below.

#### Bridge: GM-O ↔ GM-M

**Reconciliation:**
```
GM-M = GM-O + (Support + CS + Implementation + Onboarding costs) / Revenue × 100
```

**Diagnostic:** The delta (GM-M − GM-O) is the **Services Drag:** the cost of running a customer operation that depends on people. A delta that declines over time points to more automation and self-serve adoption. SaaS Capital 2025 guidance on COGS allocation supports both approaches. VCs typically expect 70%+ SaaS gross margin (GM-M) while internal teams should track contribution margin (GM-O) for pricing and unit economics.

---

### Rule of 40

**Definition:** A heuristic that balances growth and profitability. A healthy SaaS company's growth rate plus profit margin should equal 40% or more.

**Formula:**
```
Rule of 40 = ARR Growth Rate (YoY %) + EBITDA Margin (%)
```

Where:
- **ARR Growth Rate** = (Current ARR - ARR 12 months ago) / ARR 12 months ago × 100
- **EBITDA Margin** = EBITDA / Revenue (GAAP) × 100

**Component definitions:**
- **ARR Growth Rate:** Year-over-year percentage change in ARR. Use ARR (not MRR or GAAP revenue) for consistency with SaaS valuation standards.
- **EBITDA Margin:** EBITDA as a percentage of GAAP revenue. EBITDA is the most common choice; FCF margin is an acceptable alternative but must be disclosed.

**Origin:** Coined by Brad Feld (2015), heard from a late-stage investor.

**Applicability:** Use when company reaches ~$1M MRR / $12M ARR. Not meaningful for early-stage startups.

**Examples of hitting 40%:**
- 60% growth + (-20%) margin = 40% (high growth, investing)
- 20% growth + 20% margin = 40% (balanced)
- 5% growth + 35% margin = 40% (mature, profitable)

**Benchmarks (per McKinsey, Meritech Capital 2024):**
- Below 20: Struggling (Median public SaaS Q1 2025: 12-15%)
- 20-40: Developing (Median mid-2024: 34%)
- 40+: Healthy balance of growth and profitability
- 60+: Elite (top quartile: 45%+ growth component)

**What it tells you:** Whether you're balancing growth and profitability appropriately. You can grow fast and lose money, or grow slow and be profitable, but the sum should hit 40.

**Limitations:**
- The "40" is arbitrary, not scientifically derived
- Should not be used as pass/fail
- Context matters (vertical vs horizontal, market conditions)

**Sources:**
- [Wall Street Prep: Rule of 40](https://www.wallstreetprep.com/knowledge/rule-of-40/)
- [The SaaS CFO: Rule of 40](https://www.thesaascfo.com/rule-of-40-saas/)
- [Corporate Finance Institute: Rule of 40](https://corporatefinanceinstitute.com/resources/valuation/rule-of-40/)

#### Dual-Lens Note

The Rule of 40 is a composite metric. Its dual-lens behaviour is inherited from its inputs:

- **Rule of 40-O** = ARR-O Growth Rate + Contribution Margin (GM-O)
- **Rule of 40-M** = ARR-M Growth Rate + EBITDA Margin

A company with 30% ARR growth and heavy implementation costs might report Rule of 40-M = 45 (healthy) while Rule of 40-O = 32 (below threshold). The gap shows whether the balance of growth and profitability holds once delivery costs are counted. No separate O/M inclusion rules are needed. Use the ARR and Gross Margin forms defined above.

---

## Summary Table

| Metric | Category | Primary Indicator Of |
|--------|----------|---------------------|
| MRR | Revenue | Business scale |
| MRR Growth Rate | Revenue | Growth velocity |
| NRR | Retention | Revenue sustainability |
| GRR | Retention | Customer relationship health |
| Logo Churn | Retention | Customer loss rate |
| NPS | Retention | Customer loyalty (leading) |
| CAC | Efficiency | Acquisition investment |
| LTV:CAC | Efficiency | Unit economics |
| CAC Payback | Efficiency | Cash efficiency |
| Gross Margin | Efficiency | Delivery efficiency |
| Rule of 40 | Efficiency | Growth/profit balance |

---

## Dual-Lens Reference

Core metrics serve two audiences. Operating forms are what management runs the business on and market forms match the benchmarks investors compare against. Both derive from the same [Commercial Event Ledger](../cel.md) using [Attribution Taxonomy Layer](../atl.md) tags.

| Metric | Operating (O) | Market (M) | Bridge Diagnostic |
|--------|--------------|------------|-------------------|
| ARR | ARR-O (excl. pricing/recontracting) | ARR-M (total reported) | Durability Gap |
| CAC | Fully Loaded CAC (CAC-O) | GTM CAC (CAC-M) | Activation Delta |
| NRR | Cohort NRR (NRR-O) | Account NRR (NRR-M) | Expansion Integrity Gap |
| LTV | Contribution LTV (LTV-O) | Gross Margin LTV (LTV-M) | Contribution Leakage |
| Churn | Revenue Churn Rate (Churn-O) | Logo Churn Rate (Churn-M) | Concentration vs Long-Tail |
| Gross Margin | Contribution Margin (GM-O) | SaaS Gross Margin (GM-M) | Services Drag |
| GRR | No O/M distinction. Uniform | n/a | n/a |
| Rule of 40 | Inherited from ARR-O + GM-O | Inherited from ARR-M + EBITDA | n/a |

For full CEL event classes and ATL tag definitions, see [Commercial Event Ledger](../cel.md) and [Attribution Taxonomy Layer](../atl.md).
