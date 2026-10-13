# Revenue Operations / Order to Cash Metrics

Metrics for measuring the revenue lifecycle from quote to cash collection.

---

## Pipeline Operations

### Pipeline Hygiene Score

**Definition:** Quality assessment of pipeline data and process adherence.

**Components:**
- Opportunities with required fields complete
- Opportunities updated within SLA
- Opportunities with valid close dates
- Opportunities with accurate stage assignment

**Formula:**
```
Hygiene Score = (Complete opps + Updated opps + Valid dates + Accurate stages) / 4
```

Each component scored as percentage meeting criteria.

**Target:** >90%

**What it tells you:** Can you trust your pipeline data?

---

### Forecast Accuracy

**Definition:** How closely forecasted revenue matched actual revenue.

**Formula:**
```
Forecast Accuracy = 1 - |Forecasted - Actual| / Actual
```

**Benchmarks:**
- Below 70%: Poor forecasting
- 70-85%: Average
- 85-95%: Good
- Above 95%: Excellent

**What it tells you:** Predictability of revenue. Critical for planning.

---

### Commit Accuracy

**Definition:** Percentage of committed deals that close.

**Formula:**
```
Commit Accuracy = Deals closed from commit / Deals in commit × 100
```

**Target:** >80%

---

### Stage Conversion Rates

**Definition:** Conversion rate between each pipeline stage.

**Formula:**
```
Stage Conversion = Opportunities advancing to next stage / Opportunities in stage × 100
```

Track for each stage transition.

**What it tells you:** Where deals get stuck or leak.

---

## Quote-to-Order

### Quote Volume

**Definition:** Number of quotes generated in a period.

**Formula:**
```
Quote Volume = Count of quotes created
```

---

### Quote-to-Order Rate

**Definition:** Percentage of quotes that convert to orders.

**Formula:**
```
Quote-to-Order = Orders / Quotes × 100
```

**Benchmarks:**
- Below 20%: Low conversion
- 20-40%: Average
- 40-60%: Good
- Above 60%: Strong

---

### Quote Cycle Time

**Definition:** Time from quote request to quote delivery.

**Formula:**
```
Quote Cycle Time = Median of (Quote sent date - Quote requested date)
```

**Target:** <24 hours for standard quotes

**What it tells you:** Speed of quote generation process.

---

### Quote Accuracy

**Definition:** Percentage of quotes requiring no revision.

**Formula:**
```
Quote Accuracy = Quotes with no revision / Total quotes × 100
```

**Target:** >90%

---

### Discount Rate

**Definition:** Average discount applied to deals.

**Formula:**
```
Discount Rate = (List price - Sold price) / List price × 100
```

**What it tells you:** Pricing discipline and competitive pressure.

---

## Order Processing

### Order-to-Activation Time

**Definition:** Time from signed order to customer activation/provisioning.

**Formula:**
```
Order-to-Activation = Median of (Activation date - Order signed date)
```

**What it tells you:** How quickly customers get access after buying.

---

### Order Processing Time

**Definition:** Time to process an order through internal systems.

**Formula:**
```
Processing Time = Median of (Order complete in system - Order received)
```

**Target:** Same day for standard orders.

---

### Order Error Rate

**Definition:** Percentage of orders with processing errors.

**Formula:**
```
Order Error Rate = Orders with errors / Total orders × 100
```

**Target:** <2%

**What it tells you:** Process quality and system reliability.

---

## Billing Operations

### Billing Accuracy

**Definition:** Percentage of invoices generated correctly on first attempt.

**Formula:**
```
Billing Accuracy = Invoices without correction / Total invoices × 100
```

**Target:** >98%

**What it tells you:** Billing process reliability.

---

### Invoice Cycle Time

**Definition:** Time from billing event to invoice delivery.

**Formula:**
```
Invoice Cycle Time = Median of (Invoice sent - Billing trigger date)
```

**Target:** <5 business days

---

### Billing Disputes

**Definition:** Percentage of invoices disputed by customers.

**Formula:**
```
Dispute Rate = Invoices disputed / Total invoices × 100
```

**Target:** <1%

**What it tells you:** Invoice accuracy and customer alignment.

---

### Credit Memo Rate

**Definition:** Percentage of invoices requiring credit memos.

**Formula:**
```
Credit Memo Rate = Credit memos issued / Total invoices × 100
```

**Target:** <2%

**What it tells you:** Billing errors and adjustments.

---

## Collections

### Days Sales Outstanding (DSO)

**Definition:** Average days to collect payment after invoicing.

**Formula:**
```
DSO = (Accounts Receivable / Revenue) × Days in period
```

**Benchmarks:**
- Below 30 days: Excellent
- 30-45 days: Good
- 45-60 days: Average
- Above 60 days: Collection issues

**Note:** Also defined in [Finance metrics](finance.md). Same definition.

---

### Collection Effectiveness Index (CEI)

**Definition:** How effective collections are at collecting receivables.

**Formula:**
```
CEI = (Beginning AR + Credit sales - Ending AR) / (Beginning AR + Credit sales - Ending current AR) × 100
```

**Benchmarks:**
- Below 70%: Poor
- 70-80%: Average
- Above 80%: Good

---

### Aging Buckets

**Definition:** Distribution of receivables by age.

**Buckets:**
- Current (0-30 days)
- 31-60 days
- 61-90 days
- 90+ days

**Formula:**
```
Bucket % = AR in bucket / Total AR × 100
```

**Targets:**
- Current: >80%
- 31-60: <15%
- 61-90: <4%
- 90+: <1%

---

### Bad Debt Rate

See [Finance](finance.md#bad-debt-rate) for the canonical definition: write-offs over GAAP revenue.

---

### Payment Method Distribution

**Definition:** Breakdown of payments by method.

**Methods:**
- Credit card
- ACH/Direct debit
- Wire transfer
- Check

**What it tells you:** Collection risk and processing costs by method.

---

## Revenue Recognition

### Recognized vs Billed

**Definition:** Ratio of recognized revenue to billed revenue.

**Formula:**
```
Recognized/Billed = Recognized revenue / Billed revenue
```

**What it tells you:** Revenue recognition timing vs cash collection.

---

### Deferred Revenue Balance

**Definition:** Revenue billed but not yet recognized. A balance of cumulative billings less cumulative recognized revenue, independent of when cash is received.

**Formula:**
```
Deferred Revenue = Cumulative billings - Cumulative recognized revenue
```

**What it tells you:** Future revenue already billed and owed as service delivery.

---

### Unbilled Revenue

**Definition:** Revenue recognized but not yet invoiced.

**Formula:**
```
Unbilled Revenue = Recognized revenue - Billed revenue (where recognition > billing)
```

**What it tells you:** Revenue owed but not yet invoiced.

---

### Revenue Recognition Accuracy

**Definition:** Percentage of revenue correctly recognized per ASC 606.

**Formula:**
```
Recognition Accuracy = Revenue recognized correctly / Total revenue × 100
```

**Target:** 100%

---

## Renewal Operations

### Renewal Notification Rate

**Definition:** Percentage of renewals where customer was notified on time.

**Formula:**
```
Notification Rate = Renewals notified on time / Total renewals × 100
```

**Target:** 100%

---

### Auto-Renewal Rate

**Definition:** Percentage of renewals processed automatically.

**Formula:**
```
Auto-Renewal Rate = Auto-renewed contracts / Total renewals × 100
```

**What it tells you:** Renewal process efficiency.

---

### Renewal Processing Time

**Definition:** Time to process a renewal from trigger to completion.

**Formula:**
```
Processing Time = Median of (Renewal complete - Renewal trigger)
```

---

## Systems & Data Quality

### System Sync Accuracy

**Definition:** Data consistency across RevOps systems (CRM, billing, ERP).

**Formula:**
```
Sync Accuracy = Records matching across systems / Total records × 100
```

**Target:** >99%

---

### Data Completeness

**Definition:** Percentage of required fields populated in RevOps systems.

**Formula:**
```
Completeness = Fields populated / Required fields × 100
```

**Target:** >95%

---

## Summary Table

| Metric | Type | Primary Indicator Of |
|--------|------|---------------------|
| Forecast Accuracy | Pipeline Ops | Revenue predictability |
| Quote-to-Order Rate | Quote-to-Order | Sales process efficiency |
| Billing Accuracy | Billing | Invoice reliability |
| DSO | Collections | Cash collection speed |
| Bad Debt Rate | Collections | Collection effectiveness |
| Deferred Revenue | Recognition | Future revenue liability |
| Auto-Renewal Rate | Renewals | Process automation |
