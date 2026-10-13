# Customer Onboarding Metrics

Metrics for measuring customer onboarding effectiveness and time to value.

**Key insight:** Effective onboarding reduces churn by up to 67% (Wyzowl research). Time to First Value and Activation Rate are the two most predictive onboarding metrics.

---

## Time Metrics

### Time to First Value (TTFV)

**Definition:** Time from customer signup/contract to achieving first meaningful value.

**Formula:**
```
TTFV = Median of (First value milestone date - Contract start date)
```

**First value milestone (examples):**
- First successful transaction processed
- First report generated
- First integration completed
- First core workflow executed

**Benchmarks (per Userpilot 2024 data):**

| Model | TTFV Target |
|-------|-------------|
| PLG/Self-serve | ~1.5 days (median: 1 day 2 hours) |
| SMB with implementation | 1-2 weeks |
| Mid-market | 2-4 weeks |
| Enterprise | 4-12 weeks |

**By industry:**
- CRM/Sales tools: Faster (simpler onboarding)
- Insurance/Martech: Longer (complex products)

**By growth model:**
- Sales-led: Slightly faster (paid upfront, motivated)
- Product-led: Longer (free trials attract less committed users)

**What it tells you:** How quickly customers realize value. Directly impacts retention.

**Sources:**
- [Userpilot: Time-to-Value Benchmark Report 2024](https://userpilot.com/blog/time-to-value-benchmark-report-2024/)
- [Userpilot: SaaS Product Metrics](https://userpilot.com/saas-product-metrics/)

---

### Time to Go-Live

**Definition:** Time from contract to production deployment.

**Formula:**
```
Time to Go-Live = Median of (Go-live date - Contract start date)
```

**What it tells you:** Implementation efficiency.

---

### Time to Full Adoption

**Definition:** Time from contract to using all purchased features/modules.

**Formula:**
```
Time to Full Adoption = Median of (Full adoption date - Contract start date)
```

**What it tells you:** How long until customers are fully utilizing what they paid for.

---

### Onboarding Duration

**Definition:** Time spent actively in onboarding process.

**Formula:**
```
Onboarding Duration = Median of (Onboarding complete date - Onboarding start date)
```

**What it tells you:** Length of onboarding program.

---

## Completion Metrics

### Onboarding Completion Rate

**Definition:** Percentage of customers who complete the onboarding program.

**Formula:**
```
Completion Rate = Customers completing onboarding / Customers starting onboarding × 100
```

**Benchmarks:**
- Below 70%: Low, investigate friction points
- 70-85%: Average
- 85-95%: Good
- Above 95%: Excellent

**What it tells you:** Onboarding program effectiveness.

---

### Milestone Completion Rate

**Definition:** Percentage of customers completing each onboarding milestone.

**Formula:**
```
Milestone Completion = Customers completing milestone / Customers reaching milestone × 100
```

Track for each milestone to identify drop-off points.

**Typical milestones:**
1. Kickoff completed
2. Data import completed
3. Configuration completed
4. Integration completed
5. Training completed
6. Go-live achieved

**What it tells you:** Where customers get stuck.

---

### On-Time Completion Rate

**Definition:** Percentage of customers completing onboarding within target timeframe.

**Formula:**
```
On-Time Rate = Customers completing on time / Total customers completing × 100
```

**Target:** >80%

**What it tells you:** Predictability of onboarding timeline.

---

## Engagement Metrics

### Onboarding Engagement Score

**Definition:** Level of customer engagement during onboarding.

**Components:**
- Attendance at scheduled sessions
- Response time to onboarding team
- Completion of assigned tasks
- Login frequency during onboarding

**Formula:**
```
Engagement Score = Weighted average of engagement indicators (0-100)
```

**What it tells you:** Customer investment in onboarding success.

---

### Session Attendance Rate

**Definition:** Percentage of scheduled onboarding sessions attended.

**Formula:**
```
Attendance Rate = Sessions attended / Sessions scheduled × 100
```

**Target:** >90%

---

### Task Completion Rate

**Definition:** Percentage of assigned onboarding tasks completed by customer.

**Formula:**
```
Task Completion = Tasks completed / Tasks assigned × 100
```

**What it tells you:** Customer follow-through on their responsibilities.

---

## Quality Metrics

### Onboarding CSAT

**Definition:** Customer satisfaction with the onboarding experience.

**Formula:**
```
Onboarding CSAT = Positive ratings / Total ratings × 100
```

Surveyed at onboarding completion.

**Benchmarks:**
- Below 80%: Investigate pain points
- 80-90%: Average
- Above 90%: Good
- Above 95%: Excellent

---

### Onboarding NPS

**Definition:** Net Promoter Score specifically for onboarding experience.

**Formula:**
```
Onboarding NPS = % Promoters - % Detractors
```

**What it tells you:** Onboarding experience quality.

---

### Implementation Quality Score

**Definition:** Assessment of implementation completeness and correctness.

**Components:**
- Configuration accuracy
- Data quality post-migration
- Integration health
- User setup completeness

**What it tells you:** Whether implementations are set up for success.

---

## Efficiency Metrics

### Onboardings per Resource

**Definition:** Number of onboardings handled per implementation resource.

**Formula:**
```
Onboardings per Resource = Completed onboardings / Implementation headcount
```

**What it tells you:** Team capacity and efficiency.

---

### Cost per Onboarding

**Definition:** Total onboarding cost divided by customers onboarded.

**Formula:**
```
Cost per Onboarding = Total onboarding team cost / Customers onboarded
```

**What it tells you:** Unit economics of implementation.

---

### Time Spent per Onboarding

**Definition:** Total hours invested per customer onboarding.

**Formula:**
```
Hours per Onboarding = Total onboarding hours / Customers onboarded
```

**Benchmarks:**
- Self-serve/digital: 0-2 hours
- SMB: 5-15 hours
- Mid-market: 20-50 hours
- Enterprise: 50-200+ hours

---

## Outcome Metrics

### Onboarding-to-Active Rate (Activation Rate)

**Definition:** Percentage of onboarded customers who become actively engaged.

**Formula:**
```
Activation Rate = Active customers post-onboarding / Customers completing onboarding × 100
```

Active = meeting defined usage thresholds (product-specific "aha moment").

**Benchmarks (Userpilot 2024 data):**
- Average across SaaS: 37.5%
- PLG companies: 34.6%
- Sales-led companies: 41.6%

**By company size:**
- $1-5M ARR: 41.6%
- $5-10M ARR: 36.9%
- $10-50M ARR: 17.6%
- $50M+ ARR: 43.1%

**Target:** Varies by model. For managed onboarding (enterprise), aim for >90%. For PLG/self-serve, 40%+ is strong.

**What it tells you:** Does onboarding translate to actual product usage?

**Sources:**
- [Userpilot: User Activation Rate Benchmark 2024](https://userpilot.com/blog/user-activation-rate-benchmark-report-2024/)
- [Userpilot: Activation Metrics for SaaS](https://userpilot.com/blog/activation-metrics-saas/)

---

### 30-Day Retention (Post-Onboarding)

**Definition:** Percentage of customers still active 30 days after onboarding completion.

**Formula:**
```
30-Day Retention = Customers active at day 30 / Customers completing onboarding × 100
```

**Target:** >95%

**What it tells you:** Near-term stickiness after onboarding.

---

### Onboarding Cohort Churn

**Definition:** Churn rate segmented by onboarding characteristics.

**Analysis dimensions:**
- Onboarding duration (fast vs slow)
- Onboarding completeness (full vs partial)
- Engagement level during onboarding

**What it tells you:** How onboarding experience predicts retention.

---

### Feature Adoption at Go-Live

**Definition:** Percentage of available features being used at go-live.

**Formula:**
```
Feature Adoption = Features in use / Total features available × 100
```

**What it tells you:** Are customers set up to use the product fully?

---

## Summary Table

| Metric | Type | Primary Indicator Of |
|--------|------|---------------------|
| Time to First Value | Time | Speed to value realization |
| Time to Go-Live | Time | Implementation speed |
| Onboarding Completion Rate | Completion | Program effectiveness |
| On-Time Completion | Completion | Timeline predictability |
| Onboarding CSAT | Quality | Experience quality |
| Cost per Onboarding | Efficiency | Unit economics |
| Onboarding-to-Active Rate | Outcome | Activation success |
| 30-Day Retention | Outcome | Post-onboarding stickiness |
