# Marketing Metrics

Metrics for measuring marketing performance, demand generation and brand health.

---

## Funnel Metrics

### Visitors

**Definition:** Unique visitors to owned properties (website, app).

**Formula:**
```
Visitors = Sum of unique visitors in period across traffic sources
```

Web analytics report unique visitors per traffic source, so the GASP Standard sums the per-source counts. A visitor who arrives through two sources counts once in each. Load one figure per source per reporting period so a returning visitor counts once within a source.

**What it tells you:** Top of funnel awareness and reach.

---

### Visitor-to-Lead Rate

**Definition:** Percentage of website visitors who become leads.

**Formula:**
```
Visitor-to-Lead = Leads captured / Visitors × 100
```

**Benchmarks:**
- Below 2%: Below average, optimize capture
- 2-3%: Average for B2B websites
- 3-7%: Good (majority of SaaS market)
- 7-12%: Excellent / top performers

**By channel:**
- Referral traffic: ~2.9%
- Organic search: ~2.6%
- Email: ~2.4%
- Paid search: 1.5-3.2%
- Social: ~1% or less

**Free trial impact:**
- With credit card required: ~2%
- Without credit card: ~10%

**What it tells you:** Website and content effectiveness at capturing interest.

**Sources:**
- [First Page Sage: B2B SaaS Funnel Benchmarks](https://firstpagesage.com/seo-blog/b2b-saas-funnel-conversion-benchmarks-fc/)
- [Userpilot: B2B SaaS Funnel Conversion](https://userpilot.com/blog/b2b-saas-funnel-conversion-benchmarks/)

---

### Leads

**Definition:** Contacts who have expressed interest (form fill, signup, etc.).

**Formula:**
```
Leads = Total new leads captured in period
```

Leads are reported per lead source, such as organic, paid, referral, direct and events, and per lead stage as of period end.

---

### Marketing Qualified Leads (MQLs)

**Definition:** Leads that have demonstrated sufficient engagement and intent to warrant sales attention, based on criteria established between marketing and sales.

**MQL criteria (typical):**
- **Behavioral:** Demo requests, pricing page visits, content downloads, webinar attendance
- **Firmographic:** Company size, industry, role matches ICP
- **Engagement:** Lead score threshold reached

**High-intent signals (prioritize these):**
- Demo/trial requests
- Pricing page visits
- Buying guide downloads
- Contact sales form fills

**Formula:**
```
MQLs = Leads meeting MQL criteria in period
```

MQLs are reported per lead source.

**What it tells you:** Volume of potentially sales-ready prospects.

**Key distinction:** MQLs show engagement but not confirmed buying intent. SQLs pass sales qualification (BANT: Budget, Authority, Need, Timeline).

**Sources:**
- [Gartner: MQL vs SQL](https://www.gartner.com/en/digital-markets/insights/marketing-qualified-lead-vs-sales-qualified-lead)
- [MetricHQ: MQL to SQL](https://www.metrichq.org/marketing/mql-to-sql-conversion-rate/)

---

### Lead-to-MQL Rate

**Definition:** Percentage of leads that become MQLs.

**Formula:**
```
Lead-to-MQL = MQLs / Total leads × 100
```

Lead-to-MQL Rate is reported per lead source.

**Benchmarks:**
- Below 15%: Low quality leads or strict MQL criteria
- 15-30%: Average
- 30-50%: Good quality leads
- Above 50%: May indicate loose criteria

---

### Sales Qualified Leads (SQLs)

**Definition:** MQLs accepted by sales as worth pursuing.

**Formula:**
```
SQLs = MQLs accepted by sales in period
```

**What it tells you:** Marketing and sales alignment on lead quality.

---

### MQL-to-SQL Rate

**Definition:** Percentage of MQLs accepted by sales as qualified.

**Formula:**
```
MQL-to-SQL = SQLs / MQLs × 100
```

MQL-to-SQL Rate is reported per lead source.

**Benchmarks:**
- Overall average (all industries): ~13%
- B2B SaaS average: 20-30%
- B2B SaaS top performers: 40%+
- Website leads: ~31%
- Referral leads: Highest conversion

**By lead scoring approach:**
- Basic demographic scoring: ~20%
- Behavioral scoring models: 39-40%

**Speed-to-lead impact:**
- Response within 1 hour: 53% conversion
- Response after 24 hours: 17% conversion

**What it tells you:** Quality of MQLs from sales perspective and marketing-sales alignment.

**Sources:**
- [MetricHQ: MQL to SQL Conversion Rate](https://www.metrichq.org/marketing/mql-to-sql-conversion-rate/)
- [Geckoboard: MQL to SQL](https://www.geckoboard.com/best-practice/kpi-examples/mql-to-sql-conversion-rate/)
- [Data-Mania: MQL to SQL Benchmarks](https://www.data-mania.com/blog/mql-to-sql-conversion-rate-benchmarks-2025/)

---

### SQL-to-Opportunity Rate

**Definition:** Percentage of SQLs that become pipeline opportunities.

**Formula:**
```
SQL-to-Opp = Opportunities created / SQLs × 100
```

**Benchmarks:**
- Below 30%: Low conversion
- 30-50%: Average
- Above 50%: Good

---

### Lead Velocity Rate (LVR)

**Definition:** Month-over-month growth in qualified leads. Considered by many to be the most important leading indicator in SaaS.

**Formula:**
```
LVR = (Qualified leads this month - Qualified leads last month) / Qualified leads last month × 100
```

**Origin:** Popularized by Jason Lemkin (SaaStr), who calls it "the most important metric in SaaS" because it predicts future revenue 12-18 months out.

**Why it matters:** Revenue is a lagging indicator (tells you about the past). LVR is real-time and predicts the future.

**Benchmarks (per Jason Lemkin):**
- 10%/month: Target after $1M ARR
- 8%/month: Target after $3M ARR (supports 100%+ YoY growth)

**Critical:** Must use **qualified** leads (MQLs), not raw leads. Otherwise it becomes a vanity metric.

**What it tells you:** Pipeline growth momentum. If LVR is consistently positive, you have the raw ingredients for growth.

**Limitation:** Doesn't measure conversion quality. Track alongside MRR growth.

**Sources:**
- [SaaStr: Why LVR Is The Most Important Metric](https://www.saastr.com/why-lead-velocity-rate-lvr-is-the-most-important-metric-in-saas/)
- [Wall Street Prep: Lead Velocity Rate](https://www.wallstreetprep.com/knowledge/lead-velocity-rate-lvr/)
- [Corporate Finance Institute: LVR](https://corporatefinanceinstitute.com/resources/valuation/lead-velocity-rate-lvr/)

---

## Efficiency Metrics

### Customer Acquisition Cost (CAC)

See [Core Metrics](core.md#cac-customer-acquisition-cost) for full definition.

Marketing typically owns a portion of CAC (marketing spend / new customers).

---

### Marketing CAC

**Definition:** Marketing-only portion of acquisition cost.

**Formula:**
```
Marketing CAC = Marketing spend / New customers acquired
```

**What it tells you:** Marketing efficiency at generating customers.

---

### CAC by Channel

**Definition:** Customer acquisition cost broken down by marketing channel.

**Formula:**
```
Channel CAC = Channel ad spend / Deals won in period via channel
```

**Channels:** Paid ads, organic search, email, events, content, referral, direct and other.

CAC by Channel is reported per channel: one value for each channel. Spend is campaign ad spend, which records its channel, and new customers are deals won in the period attributed to their first-touch channel. The cost ledger has no channel, so ledger cost cannot be split this way; Marketing CAC remains the total.

**What it tells you:** Which channels are most efficient.

---

### Cost per Lead (CPL)

**Definition:** Cost to acquire a lead.

**Formula:**
```
CPL = Marketing spend / Leads generated
```

**What it tells you:** Top-of-funnel efficiency.

---

### Cost per MQL

**Definition:** Cost to acquire a marketing qualified lead.

**Formula:**
```
Cost per MQL = Marketing spend / MQLs generated
```

**Benchmarks (B2B SaaS 2025):**
- Average range: $30-$120
- SMB-focused: $50-$150
- Mid-market: $150-$400
- Enterprise: $400-$1000+

**Cost per Lead (CPL) for context:**
- B2B SaaS paid channels: ~$310
- B2B SaaS organic: ~$164
- Blended average: ~$237
- Demo request leads: $600-$800

**By channel:**
- Google Ads: $150-$250
- LinkedIn: $100-$200
- Bing: $80-$180
- SEO/Organic: Significantly lower

**What it tells you:** Lead generation efficiency and channel performance.

**Sources:**
- [SaaS Capital: Spending Benchmarks 2025](https://www.saas-capital.com/blog-posts/spending-benchmarks-for-private-b2b-saas-companies/)
- [Martal: B2B Marketing ROI Benchmarks](https://martal.ca/b2b-digital-marketing-benchmarks-lb/)

---

### Marketing Sourced Pipeline

**Definition:** Pipeline value attributed to marketing efforts (first-touch attribution).

**Formula:**
```
Marketing Sourced Pipeline = Sum of opportunity value where first touch = marketing
```

**Benchmark:** Strong programs generate 30-50% of sales pipeline from marketing.

**What it tells you:** Marketing's contribution to sales pipeline.

---

### Marketing Sourced Revenue

**Definition:** Closed revenue attributed to marketing efforts (first-touch attribution).

**Formula:**
```
Marketing Sourced Revenue = Sum of closed won revenue where first touch = marketing
```

**What it tells you:** Marketing's contribution to actual revenue.

---

### Marketing Influenced Pipeline/Revenue

**Definition:** Pipeline or revenue where marketing touched the deal at any point (multi-touch attribution).

**Formula:**
```
Marketing Influenced = Pipeline/Revenue where any touch = marketing
```

Typically 2-3x higher than sourced (multiple touches on most B2B deals).

**Note:** B2B buyers average 6-8 touches before purchase, so influenced is often more representative than sourced.

**Sources:**
- [SaaS Capital: Spending Benchmarks](https://www.saas-capital.com/blog-posts/spending-benchmarks-for-private-b2b-saas-companies/)
- [Digital Bloom: Pipeline Performance Benchmarks](https://thedigitalbloom.com/learn/pipeline-performance-benchmarks-2025/)

---

## Channel Metrics

### Organic Traffic

**Definition:** Visitors from unpaid search.

**Formula:**
```
Organic Traffic = Visitors where source = organic search
```

**What it tells you:** SEO effectiveness and brand awareness.

---

### Paid Media Efficiency (ROAS)

**Definition:** Return on ad spend.

**Formula:**
```
ROAS = Revenue attributed to ads / Ad spend
```

Express as ratio (e.g., "3:1" or "3x").

**B2B SaaS Benchmarks:**
- Below 2x: Below average, but may be acceptable if LTV is high
- 2-3x: Average for mid-market SaaS
- 3-4x: Good
- 4x+: Strong / top quartile

**By segment:**
- Enterprise: 2-3x typical (long sales cycles)
- Mid-market SaaS: 2.6x average, 4.1x top quartile
- SMB: Higher ROAS expected

**By channel:**
- Google Ads (Search): ~2.8x average
- LinkedIn: ~2.2x average
- Facebook: ~1.9x average
- Branded search: Very high (captures existing intent)

**Important:** Lower ROAS can be acceptable if customer LTV is high. Always consider LTV:CAC alongside ROAS.

**Sources:**
- [Varos: Google ROAS for B2B SaaS](https://varos.com/benchmarks/google-roas-for-b2b-saas)
- [Directive: B2B ROAS Benchmarks 2025](https://directiveconsulting.com/blog/b2b-roas-benchmarks-high-performing-campaigns-in-2025/)

---

### Email Metrics

| Metric | Formula | B2B SaaS Benchmark |
|--------|---------|-----------|
| Open Rate | Opens / Delivered × 100 | 25-40% |
| Click Rate (CTR) | Clicks / Delivered × 100 | 2-4% |
| Click-to-Open Rate | Clicks / Opens × 100 | 5-7% |
| Unsubscribe Rate | Unsubscribes / Delivered × 100 | <0.3% |
| Bounce Rate | Bounces / Sent × 100 | <2.5% |
| Spam Complaint Rate | Complaints / Delivered × 100 | <0.1% |

**Cold email/outbound (SaaS SDRs):**
- Open rate: 38-42%
- Reply rate: 3-8% (good: 5-10%)
- Meeting booked rate: 1-2%

**Important:** Apple Mail Privacy Protection (46% of email clients) inflates open rates by preloading images. Treat opens as directional only; focus on replies and conversions.

**Sources:**
- [HubSpot: Email Marketing Benchmarks](https://blog.hubspot.com/sales/average-email-open-rate-benchmark)
- [GetResponse: Email Marketing Benchmarks 2024](https://www.getresponse.com/resources/reports/email-marketing-benchmarks)
- [SalesHive: B2B SaaS Email Benchmarks 2025](https://saleshive.com/blog/b2b-benchmarks-email-marketing-saas-you-need-know-2025/)

---

### Content Performance

| Metric | Formula |
|--------|---------|
| Downloads | Content pieces downloaded |
| Engagement Rate | Engaged visitors / Total visitors × 100 |
| Content-to-MQL | MQLs from content / Content engagements × 100 |

---

## Brand Metrics

### Brand Awareness

**Definition:** Percentage of target market aware of brand.

**Measurement:** Survey-based or search volume proxy.

---

### Share of Voice

**Definition:** Brand mentions relative to competitors.

**Formula:**
```
Share of Voice = Brand mentions / (Brand + Competitor mentions) × 100
```

---

### NPS (Marketing context)

**Definition:** Net Promoter Score for prospects/market (vs customers).

**What it tells you:** Brand perception in broader market.

---

## Summary Table

| Metric | Type | Primary Indicator Of |
|--------|------|---------------------|
| MQLs | Funnel | Marketing output |
| MQL-to-SQL Rate | Funnel | Lead quality |
| Lead Velocity Rate | Funnel | Pipeline momentum |
| Marketing CAC | Efficiency | Marketing cost efficiency |
| Cost per MQL | Efficiency | Lead generation efficiency |
| Marketing Sourced Pipeline | Attribution | Marketing contribution |
| ROAS | Channel | Paid media efficiency |
| Organic Traffic | Channel | SEO and brand strength |
