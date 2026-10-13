# Metric Relationships

How metrics connect and influence each other, with the order to check them in when one moves.

---

## The Core Model

Revenue is the outcome that every other metric here drives. The diagram starts from Annual Recurring Revenue (ARR) and the Monthly Recurring Revenue (MRR) movements that change it.

```
                                    ┌─────────────────┐
                                    │      ARR        │
                                    │   (Outcome)     │
                                    └────────┬────────┘
                                             │
              ┌──────────────────────────────┼──────────────────────────────┐
              │                              │                              │
              ▼                              ▼                              ▼
       ┌─────────────┐              ┌─────────────┐              ┌─────────────┐
       │   New MRR   │              │ Expansion   │              │  Churned    │
       │             │              │    MRR      │              │    MRR      │
       └──────┬──────┘              └──────┬──────┘              └──────┬──────┘
              │                            │                            │
              │                            │                            │
    ┌─────────┴─────────┐        ┌────────┴────────┐          ┌────────┴────────┐
    │                   │        │                 │          │                 │
    ▼                   ▼        ▼                 ▼          ▼                 ▼
┌───────┐         ┌─────────┐  ┌──────┐      ┌─────────┐  ┌───────┐      ┌─────────┐
│Pipeline│         │Win Rate │  │Health│      │Expansion│  │ Churn │      │  NPS    │
│       │         │         │  │Score │      │  Rate   │  │ Rate  │      │         │
└───┬───┘         └────┬────┘  └───┬──┘      └────┬────┘  └───┬───┘      └────┬────┘
    │                  │           │              │           │               │
    ▼                  ▼           ▼              ▼           ▼               ▼
┌───────┐         ┌─────────┐  ┌──────────┐   ┌───────┐  ┌─────────┐    ┌─────────┐
│  MQL  │         │ Sales   │  │ Product  │   │  CSM  │  │ Support │    │ Product │
│Volume │         │Execution│  │ Adoption │   │ Touch │  │ Quality │    │ Quality │
└───────┘         └─────────┘  └──────────┘   └───────┘  └─────────┘    └─────────┘
```

---

## Reading the Map

The [interactive diagram](https://gaspwiki.com/v1/relationships) ([relationships.json](relationships.json)) and the MCP traversal tools read the same graph. Its edges come in three groups:

- **Component** edges say A is an input to B's formula. They are generated from the canonical formulas rather than drawn by hand, so they always match them.
- **Drives**, **reduces** and **predicts** edges are curated. A drives B when A rising pushes B up. A reduces B when A rising pushes B down, which lets a lower-is-better metric such as First Response Time, or a cost, point at what it affects. A predicts B when A moves first and forecasts where B goes.
- **Measures** edges link a metric to the business entity it tracks (Logo Churn Rate measures Customer) and are derived from the datasets each formula reads. Entity edges such as owns, converts_to and generates describe how the business objects relate.

Two rules shape how the tools walk the graph:

- **One direction per pair.** The graph has no two-way edges. A rate computed from an amount does not also claim to move that amount, so a walk upstream never loops back through a ratio's own inputs.
- **Baseline inputs end the walk.** A metric read at period start or inside `lag()` is a baseline: NRR, for example, reads MRR at the start of the period over the customers active then. Driver traversal lists the baseline as a component and stops there, because whatever moved it did so before the period began. New business reaches MRR and enters NRR only as next period's baseline, which is why the tools leave New MRR, Win Rate and pipeline out of NRR's drivers.

---

## Revenue Drivers

### ARR Growth

**What increases it:**
- New MRR (acquisition)
- Expansion MRR (upsell/cross-sell)

**What decreases it:**
- Churned MRR (lost customers)
- Contraction MRR (downgrades)

**Formula:**
```
Net New MRR = New MRR + Expansion MRR - Churned MRR - Contraction MRR
```

ARR moves by twelve times Net New MRR, because ARR is MRR × 12.

---

### New MRR Drivers

```
New MRR = Deals Won × Average Deal Size

Deals Won = Pipeline × Win Rate

Pipeline = MQLs × MQL-to-SQL Rate × SQL-to-Opp Rate × ACV

MQLs = Leads × Lead-to-MQL Rate

Leads = Traffic × Conversion Rate
```

**Levers:**
| To Increase New MRR | Action |
|---------------------|--------|
| More deals | Increase MQLs (marketing) |
| Better conversion | Improve win rate (sales) |
| Bigger deals | Increase ACV (pricing, product) |
| Faster deals | Reduce sales cycle (process) |

---

### Expansion MRR Drivers

```
Expansion MRR = Customers × Expansion Rate × Average Expansion Size
```

**Levers:**
| Driver | What Influences It |
|--------|-------------------|
| Expansion Rate | Product adoption, health score, CSM engagement |
| Expansion Size | Pricing tiers, usage growth, additional seats |
| Eligible customers | Contract structure, feature gating |

**Key relationship:** High product adoption → high health scores → higher expansion probability.

---

### Churned MRR Drivers

```
Churned MRR = Customers × Churn Rate × Average Customer Value
```

**Levers:**
| Driver | What Influences It |
|--------|-------------------|
| Churn Rate | NPS, health score, support quality, product fit |
| Churn Timing | Contract length, renewal process, early warning |

**Key relationships:**
- Low Net Promoter Score (NPS) → higher churn (leading indicator by 3-6 months)
- Low health score → higher churn risk
- High support tickets → potential churn signal
- Poor onboarding → higher early churn

---

## Efficiency Drivers

### CAC (Customer Acquisition Cost)

```
CAC = Sales & Marketing Spend / New Customers
```

**What increases CAC:**
- Higher marketing spend without proportional lead increase
- Lower win rates
- Longer sales cycles
- More expensive channels

**What decreases CAC:**
- Better lead quality (higher conversion)
- More efficient channels
- Faster sales cycles
- Product-led growth

---

### LTV (Lifetime Value)

```
LTV = ARPA × Gross Margin / Revenue Churn Rate
```

**What increases LTV:**
- Higher Average Revenue per Account (ARPA) from pricing and upsell
- Better margins (lower COGS)
- Lower churn (better retention)

**Key relationship:** Read LTV against CAC. An LTV:CAC ratio above 3:1 indicates healthy unit economics.

---

### CAC Payback

```
CAC Payback (months) = CAC / (ARPA × Gross Margin)
```

**Influenced by:**
- CAC (higher = longer payback)
- ARPA (higher = faster payback)
- Gross Margin (higher = faster payback)

---

## Retention Chain

The retention chain runs from onboarding to Net Revenue Retention (NRR) and Gross Revenue Retention (GRR):

```
Onboarding Quality
       │
       ▼
Product Adoption ────► Health Score ────► Renewal Probability
       │                    │                     │
       ▼                    ▼                     ▼
  Engagement           NPS/CSAT              NRR / GRR
       │                    │                     │
       └────────────────────┴─────────────────────┘
                            │
                            ▼
                    Revenue Retention
```

**Key relationships:**
| If This Goes Down | These Follow |
|-------------------|--------------|
| Onboarding completion | Product adoption, early churn |
| Product adoption | Health scores, expansion, NPS |
| Health scores | Renewal probability, churn |
| NPS | Churn (lagged 3-6 months) |
| Support CSAT | NPS |

---

## Leading vs Lagging Indicators

### Leading Indicators (Early Warning)
These move before the outcomes do:

**Note:** Lead times are approximate ranges based on typical SaaS patterns. Actual lag varies by business model, sales cycle and customer segment. Calibrate to your own data.

| Metric | What It Predicts | Typical Lead Time |
|--------|------------------|-----------|
| Pipeline coverage | Revenue miss | 1-2 quarters |
| MQL volume | Future pipeline | 1-2 months |
| NPS trend | Churn | 3-6 months |
| Health score decline | Churn | 1-3 months |
| Support ticket spike | NPS decline, churn | 1-2 months |
| Product usage decline | Health decline, churn | 2-4 weeks |
| Onboarding completion | Early churn | 1-3 months |

### Lagging Indicators (Outcomes)
These confirm what happened:

| Metric | What It Confirms |
|--------|-----------------|
| Revenue | Overall performance |
| Churn | Retention failure |
| Win rate | Sales effectiveness |
| NRR | Customer value growth |

---

## Departmental Impact Map

### If Revenue Is Down

**Check in this order:**
1. **New MRR down?** → Sales problem
   - Check pipeline, win rate, cycle time
2. **Expansion down?** → CS/Product problem
   - Check health scores, adoption, CSM coverage
3. **Churn up?** → Retention problem
   - Check NPS, support metrics, product issues

---

### If Churn Is Up

**Investigation path:**
```
Churn Up
   │
   ├── Check NPS trend
   │   └── If declining → deeper customer satisfaction issue
   │
   ├── Check support metrics
   │   └── If tickets up / CSAT down → support or product quality
   │
   ├── Check onboarding metrics
   │   └── If completion down → onboarding process issue
   │
   ├── Check product adoption
   │   └── If declining → product-market fit or engagement
   │
   └── Check by segment (by_segment breakdowns on Logo Churn Rate,
       │   Revenue Churn Rate, Churned MRR, NRR and GRR)
       └── If concentrated → specific segment issue
```

---

### If Pipeline Is Light

**Investigation path:**
```
Pipeline Light
   │
   ├── Check MQL volume
   │   └── If down → marketing funnel issue
   │       ├── Check lead volume → awareness/traffic
   │       └── Check conversion → content/targeting
   │
   ├── Check SQL conversion
   │   └── If down → lead quality or SDR effectiveness
   │
   ├── Check ACV
   │   └── If down → deal size/pricing issue
   │
   └── Check source mix
       └── If channel shift → channel performance issue
```

---

## The Full System

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BUSINESS HEALTH                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ACQUIRE          ONBOARD           ADOPT            EXPAND        RETAIN  │
│                                                                             │
│  Traffic          TTFV              DAU/MAU          Expansion     GRR     │
│     │               │                  │             Rate          NRR     │
│     ▼               ▼                  ▼                │          Churn   │
│  Leads ─────► Onboarding ─────► Adoption ─────► Upsell  │            │     │
│     │         Completion        Health Score    Cross-sell           │     │
│     ▼               │                  │                │            │     │
│  MQLs              │                  ▼                ▼            ▼     │
│     │               └────────► NPS ◄───────────────────┴────────────┘     │
│     ▼                           │                                          │
│  SQLs                           │                                          │
│     │                           ▼                                          │
│     ▼               ┌──────────────────────┐                               │
│  Pipeline           │   REVENUE            │                               │
│     │               │   ARR, MRR, Growth   │                               │
│     ▼               └──────────────────────┘                               │
│  Closed Won                     ▲                                          │
│     │                           │                                          │
│     └───────────────────────────┘                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

Every department's metrics feed into this system, so when an outcome moves, the diagram above shows which stage to check first.
