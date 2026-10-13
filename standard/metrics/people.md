# People (HR) Metrics

Metrics for measuring workforce health, engagement and organizational effectiveness.

---

## Headcount Metrics

### Total Headcount

**Definition:** Total number of employees.

**Formula:**
```
Headcount = Total active employees at end of period
```

Include: Full-time, part-time employees
Exclude: Contractors (track separately)

---

### Headcount Growth Rate

**Definition:** Percentage change in headcount over a period.

**Formula:**
```
Growth Rate = (Headcount end - Headcount start) / Headcount start × 100
```

**What it tells you:** Organizational scaling velocity.

---

### Headcount by Department

**Definition:** Distribution of employees across functions.

**Typical breakdown for SaaS:**
| Department | % of Headcount |
|------------|----------------|
| Engineering | 25-35% |
| Sales | 20-30% |
| Customer Success/Support | 15-25% |
| Marketing | 5-10% |
| G&A (Finance, HR, Legal, Ops) | 10-15% |
| Product | 5-10% |

**What it tells you:** Resource allocation and organizational structure.

---

### Revenue per Employee

See [Finance](finance.md#revenue-per-employee) for the canonical definition: ARR over total headcount.

---

## Retention Metrics

### Employee Turnover Rate

**Definition:** Percentage of employees who left in a period.

**Formula:**
```
Turnover Rate = Employees departed / Average headcount × 100
```

Calculate monthly or annually. Annualize for comparability.

**Benchmarks (Annual):**
- Below 10%: Excellent retention
- 10-15%: Good
- 13-20%: Average for tech (tech runs higher than other industries)
- 20-25%: High for tech, investigate
- Above 25%: Critical

**Context:** US voluntary turnover averaged 13.5% in 2025 (down from 17.3% in 2023). Tech sector runs 13-25% due to competitive demand for specialized skills. Average tech tenure is 2-3 years vs 4.1 years overall.

**Sources:**
- [BambooHR: Turnover Benchmarks 2025](https://www.bamboohr.com/resources/guides/turnover-benchmarks)
- [Mercer: 2025 US Turnover Survey](https://www.imercer.com/articleinsights/workforce-turnover-trends)

---

### Voluntary Turnover Rate

**Definition:** Turnover due to employee choice (resignations).

**Formula:**
```
Voluntary Turnover = Voluntary departures / Average headcount × 100
```

**What it tells you:** Employee satisfaction and competitiveness of employment.

---

### Involuntary Turnover Rate

**Definition:** Turnover due to company decision (terminations, layoffs).

**Formula:**
```
Involuntary Turnover = Involuntary departures / Average headcount × 100
```

**What it tells you:** Hiring quality and performance management.

---

### Regrettable Turnover

**Definition:** Voluntary departures of high performers.

**Formula:**
```
Regrettable Turnover = High performer departures / Total high performers × 100
```

**Target:** <5%

**What it tells you:** Are you losing your best people?

---

### Average Tenure

**Definition:** Average length of employment.

**Formula:**
```
Average Tenure = Sum of employee tenure / Total employees
```

Measured in months or years.

**What it tells you:** Workforce stability and institutional knowledge.

---

### 90-Day Turnover

**Definition:** Percentage of new hires who leave within 90 days.

**Formula:**
```
90-Day Turnover = Departures within 90 days / New hires × 100
```

**Benchmarks:**
- Below 5%: Good onboarding and hiring
- 5-10%: Average
- Above 10%: Hiring or onboarding issues

**What it tells you:** Hiring quality and onboarding effectiveness.

---

## Engagement Metrics

### Employee Net Promoter Score (eNPS)

**Definition:** Likelihood of employees recommending the company as a place to work.

**Formula:**
```
eNPS = % Promoters (9-10) - % Detractors (0-6)
```

Based on: "How likely are you to recommend [company] as a place to work?" (0-10)

**Benchmarks:**
- Below 0: Poor engagement (investigate immediately)
- 0-10: Below average
- 10-30: Average (overall benchmark ~12-27)
- 30-50: Good, leading companies
- Above 50: Excellent

**Tech industry:** Average eNPS is 26, but top tech companies score 50-75+.

**Company size effect:** Smaller companies (0-250) average 30; larger companies (5000+) average 9.

**What it tells you:** Employee satisfaction and advocacy.

**Sources:**
- [AIHR: Employee Net Promoter Score Guide](https://www.aihr.com/blog/employee-net-promoter-score-enps/)
- [Perceptyx: eNPS Guide](https://blog.perceptyx.com/employee-net-promoter-score)

---

### Engagement Score

**Definition:** Composite score from engagement survey.

**Measurement:** Typically annual or quarterly survey covering:
- Job satisfaction
- Manager relationship
- Growth opportunities
- Company direction
- Work-life balance

**Benchmarks:**
- Below 60%: Low engagement
- 60-70%: Average
- 70-80%: Good
- Above 80%: High engagement

---

### Survey Participation Rate

**Definition:** Percentage of employees completing engagement surveys.

**Formula:**
```
Participation Rate = Surveys completed / Surveys sent × 100
```

**Target:** >80%

**What it tells you:** Trust in feedback process and engagement with company.

---

## Recruiting Metrics

### Open Positions

**Definition:** Number of unfilled roles.

**What it tells you:** Hiring backlog and growth plans.

---

### Time to Fill

**Definition:** Days from job opening to accepted offer.

**Formula:**
```
Time to Fill = Average of (Offer accepted date - Job posted date)
```

**Benchmarks:**
- Below 30 days: Fast
- 30-45 days: Good
- 45-60 days: Average
- Above 60 days: Slow, may impact growth

---

### Time to Hire

**Definition:** Days from candidate application to accepted offer.

**Formula:**
```
Time to Hire = Average of (Offer accepted date - Application date)
```

**What it tells you:** Candidate experience and process efficiency.

---

### Offer Acceptance Rate

**Definition:** Percentage of offers accepted.

**Formula:**
```
Acceptance Rate = Offers accepted / Offers extended × 100
```

**Benchmarks:**
- Below 70%: Low, may indicate compensation or culture issues
- 70-85%: Average
- Above 85%: Strong employer brand

---

### Quality of Hire

**Definition:** Performance rating of new hires after defined period.

**Formula:**
```
Quality of Hire = Average performance rating of hires at 6-12 months
```

Or: Percentage of new hires meeting/exceeding expectations.

**What it tells you:** Recruiting effectiveness at finding good candidates.

---

### Cost per Hire

**Definition:** Total recruiting cost divided by hires made.

**Formula:**
```
Cost per Hire = (Internal recruiting costs + External recruiting costs) / Total hires
```

**Benchmarks:**
- IC roles: $3,000-$7,000
- Technical roles: $7,000-$15,000
- Executive roles: $20,000-$50,000+

---

### Source of Hire

**Definition:** Where successful candidates came from.

**Channels:**
- Employee referrals
- Job boards
- LinkedIn/direct sourcing
- Agencies
- Career page
- Internal transfers

**What it tells you:** Most effective recruiting channels.

---

## Compensation Metrics

### Compa-Ratio

**Definition:** Employee salary relative to market midpoint.

**Formula:**
```
Compa-Ratio = Actual salary / Market midpoint × 100
```

**Interpretation:**
- Below 90%: Below market
- 90-110%: At market
- Above 110%: Above market

---

### Pay Equity Ratio

**Definition:** Pay comparison across demographic groups for same role.

**Formula:**
```
Pay Equity = Average pay (Group A) / Average pay (Group B)
```

**Target:** 0.98-1.02 (within 2%)

**What it tells you:** Fairness in compensation practices.

---

## Diversity Metrics

### Diversity Representation

**Definition:** Percentage of workforce from underrepresented groups.

**Dimensions:**
- Gender
- Race/ethnicity
- Age
- Disability status
- Veteran status

Track overall and by department/level.

---

### Diversity in Leadership

**Definition:** Representation at manager+ levels.

**Formula:**
```
Leadership Diversity = URG in leadership / Total leadership × 100
```

**What it tells you:** Pipeline to leadership for underrepresented groups.

---

### Diversity Hiring Rate

**Definition:** Percentage of new hires from underrepresented groups.

**Formula:**
```
Diversity Hiring = URG hires / Total hires × 100
```

**What it tells you:** Progress on diversifying the workforce.

---

## Summary Table

| Metric | Type | Primary Indicator Of |
|--------|------|---------------------|
| Headcount | Size | Organizational scale |
| Revenue per Employee | Productivity | Workforce efficiency |
| Employee Turnover | Retention | Workforce stability |
| Regrettable Turnover | Retention | High performer retention |
| eNPS | Engagement | Employee satisfaction |
| Time to Fill | Recruiting | Hiring velocity |
| Offer Acceptance Rate | Recruiting | Employer competitiveness |
| Quality of Hire | Recruiting | Recruiting effectiveness |
| Compa-Ratio | Compensation | Market competitiveness |
