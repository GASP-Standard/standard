# Product Metrics

Metrics for measuring product usage, adoption and delivery.

---

## Usage Metrics

### Daily Active Users (DAU)

**Definition:** Unique users who performed a meaningful action in the product on a given day.

**Formula:**
```
DAU = Count of unique users with qualifying activity in 24-hour period
```

**Qualifying activity:** Defined per product. Must be intentional engagement, not passive (e.g., not just logging in, but performing a core action).

**What it tells you:** Daily engagement level.

---

### Weekly Active Users (WAU)

**Definition:** Unique users who performed a meaningful action in the product within a 7-day period.

**Formula:**
```
WAU = Count of unique users with qualifying activity in 7-day period
```

---

### Monthly Active Users (MAU)

**Definition:** Unique users who performed a meaningful action in the product within a 30-day period.

**Formula:**
```
MAU = Count of unique users with qualifying activity in 30-day period
```

**What it tells you:** Monthly engagement breadth.

---

### DAU/MAU Ratio (Stickiness)

**Definition:** The ratio of daily to monthly active users, indicating how often users return.

**Formula:**
```
Stickiness = DAU / MAU × 100
```

**Benchmarks:**
- Below 10%: Low stickiness, investigate product-market fit
- 10-13%: Average for B2B SaaS (Mixpanel data: 13% median)
- 13-20%: Good for B2B SaaS
- 20-25%: Strong engagement
- 25%+: Exceptional (top-quartile products)
- 50%+: World-class (communication/collaboration tools like Slack)

**Important context:** DAU/MAU is misleading for products not designed for daily use (accounting tools, signature apps, seasonal products). For B2B tools used weekly, WAU/MAU is more appropriate.

**What it tells you:** How habit-forming the product is. Higher = users come back more frequently.

**Sources:**
- [Mixpanel: Product Benchmarks 2024](https://mixpanel.com/blog/product-benchmarks/)
- [Gainsight: DAU/MAU Guide](https://www.gainsight.com/essential-guide/product-management-metrics/dau-mau/)

---

### WAU/MAU Ratio

**Definition:** Weekly to monthly active user ratio.

**Formula:**
```
WAU/MAU = WAU / MAU × 100
```

**Benchmarks:**
- Below 40%: Infrequent use
- 40-60%: Moderate use
- Above 60%: Regular weekly use

---

### Active Accounts

**Definition:** Customer accounts with at least one active user in the period.

**Formula:**
```
Active Accounts = Count of accounts with ≥1 active user in period
```

**What it tells you:** Account-level engagement (vs user-level).

---

### Activation Rate

**Definition:** Percentage of new users/accounts that reach the activation milestone.

**Formula:**
```
Activation Rate = Users reaching activation / New users × 100
```

**Activation milestone:** Product-specific moment when user has experienced core value. Define explicitly.

**Benchmarks:**
- Below 20%: Low activation, onboarding issue
- 20-40%: Average
- 40-60%: Good
- Above 60%: Strong activation

**What it tells you:** Is the product delivering value to new users?

---

## Adoption Metrics

### Feature Adoption Rate

**Definition:** Percentage of users/accounts using a specific feature.

**Formula:**
```
Feature Adoption = Users using feature / Total active users × 100
```

Track for each key feature.

**What it tells you:** Which features are being used, which are ignored.

---

### Core Feature Adoption

**Definition:** Percentage of users using the core features that define the product.

**Formula:**
```
Core Feature Adoption = Users using all core features / Total active users × 100
```

Define 3-5 "core" features that represent full product usage.

**Benchmarks:**
- Below 30%: Users not fully utilizing product
- 30-50%: Moderate adoption
- 50-70%: Good
- Above 70%: Strong full-product adoption

---

### Feature Depth

**Definition:** How extensively users engage with features (not just whether they use them).

**Formula:**
```
Feature Depth = Average feature actions per user per period
```

**What it tells you:** Intensity of usage, not just breadth.

---

### Time to Feature Adoption

**Definition:** Time from signup/activation to using a specific feature.

**Formula:**
```
Time to Adoption = Median of (First feature use date - Signup date)
```

**What it tells you:** Feature discovery and adoption speed.

---

### Breadth of Adoption

**Definition:** Average number of features used per account.

**Formula:**
```
Breadth = Distinct (account, feature) pairs used in period / Active accounts
```

Each account counts each feature it used once, so the result is the average number of distinct features per active account.

**What it tells you:** How much of the product is being utilized.

---

## Engagement Metrics

### Session Frequency

**Definition:** Average number of sessions per user per period.

**Formula:**
```
Session Frequency = Total sessions / Active users
```

**What it tells you:** How often users return.

---

### Session Duration

**Definition:** Average time spent per session.

**Formula:**
```
Session Duration = Total session time / Total sessions
```

**Benchmarks:** Highly product-dependent. Track trend over time.

**What it tells you:** Depth of engagement per visit.

---

### Time in Product

**Definition:** Total time spent in product per user per period.

**Formula:**
```
Time in Product = Sum of session duration per user
```

**What it tells you:** Overall engagement intensity.

---

### Actions per Session

**Definition:** Average number of meaningful actions per session.

**Formula:**
```
Actions per Session = Total actions / Total sessions
```

**What it tells you:** Productivity per session.

---

### Product Qualified Accounts (PQAs)

**Definition:** Accounts that have demonstrated product engagement indicating sales-readiness.

**Formula:**
```
PQA = Accounts meeting product engagement threshold
```

**Threshold criteria (examples):**
- Used product X times
- Activated Y features
- Added Z users
- Reached usage limit

**What it tells you:** Product-driven sales signals.

---

## Retention Metrics (Product)

### User Retention (Day N)

**Definition:** Percentage of users who return on day N after signup.

**Formula:**
```
Day N Retention = Users active on day N / Users who signed up N days ago × 100
```

Common intervals: Day 1, Day 7, Day 14, Day 30.

**Benchmarks (Day 30 for B2B SaaS):**
- Below 20%: Poor
- 20-40%: Average
- Above 40%: Good

---

### Cohort Retention

**Definition:** Retention tracked by signup cohort over time.

**Formula:**
```
Cohort Retention (Week N) = Active users in week N / Users in cohort × 100
```

**What it tells you:** How retention evolves and whether it is improving for newer cohorts.

---

### Resurrection Rate

**Definition:** Percentage of churned/dormant users who return.

**Formula:**
```
Resurrection Rate = Reactivated users / Dormant users × 100
```

**What it tells you:** Can you win back lost users?

---

## Delivery Metrics

### Release Frequency

**Definition:** How often new releases are shipped to customers.

**Formula:**
```
Release Frequency = Releases per period
```

**What it tells you:** Product development velocity.

**Note:** Related to Engineering's Deployment Frequency, but measured at feature/product level vs code deployment level.

---

### Feature Delivery Rate

**Definition:** Percentage of planned features delivered on schedule.

**Formula:**
```
Delivery Rate = Features shipped on time / Features planned × 100
```

**What it tells you:** Roadmap predictability.

---

### Roadmap Completion

**Definition:** Percentage of roadmap items completed in the period.

**Formula:**
```
Roadmap Completion = Roadmap items completed / Roadmap items planned × 100
```

---

### Time to Market

**Definition:** Time from feature concept to production release.

**Formula:**
```
Time to Market = Median of (Release date - Concept approval date)
```

**What it tells you:** How quickly product can respond to market needs.

---

## Quality Metrics (Product)

### Error Rate (User-Facing)

**Definition:** Percentage of user actions that result in errors.

**Formula:**
```
Error Rate = Error events / Total user actions × 100
```

**Target:** <1%

**Note:** Related to Engineering's Error Rate, but measured from user action perspective.

---

### Bug Escape Rate

**Definition:** Bugs found in production vs found in testing.

**Formula:**
```
Bug Escape Rate = Production bugs / (Production bugs + Bugs caught in QA) × 100
```

**Target:** <10%

---

### User-Reported Issues

**Definition:** Number of bugs/issues reported by users.

**Formula:**
```
User-Reported Issues = Count of user-submitted bug reports
```

**What it tells you:** Quality as perceived by users.

---

### Feature Request Volume

**Definition:** Number of feature requests received.

**Formula:**
```
Feature Request Volume = Count of feature requests per period
```

Track by theme/category to identify patterns.

---

## Summary Table

| Metric | Type | Primary Indicator Of |
|--------|------|---------------------|
| DAU/MAU (Stickiness) | Usage | User engagement frequency |
| MAU | Usage | User engagement breadth |
| Activation Rate | Adoption | New user success |
| Core Feature Adoption | Adoption | Full product utilization |
| Session Frequency | Engagement | Return rate |
| PQAs | Engagement | Product-driven sales signals |
| Day 30 Retention | Retention | User stickiness |
| Release Frequency | Delivery | Development velocity |
| Error Rate | Quality | Product reliability |
