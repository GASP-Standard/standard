# Customer Support Metrics

Metrics for measuring support team performance and customer service quality.

**Benchmark context:** B2B SaaS companies typically spend ~8% of Annual Recurring Revenue (ARR) on support and success combined.

---

## Volume Metrics

### Ticket Volume

**Definition:** Total number of support tickets received in a period.

**Formula:**
```
Ticket Volume = Count of tickets created in period
```

Ticket Volume is reported per ticket type. Teams that staff by channel (email, chat, phone) add that split from their help desk. Questions answered without a ticket are counted by Self-Service Rate instead.

**What it tells you:** Support demand. Trend matters more than absolute number.

---

### Tickets per Customer

**Definition:** Average tickets created per active customer.

**Formula:**
```
Tickets per Customer = Total tickets / Active customers
```

**Benchmarks:**
- Below 0.5/month: Low touch, efficient product
- 0.5-1.0/month: Typical
- Above 1.0/month: High touch, may indicate product issues

**What it tells you:** Support burden relative to the customer base. A rising ratio usually points to product or onboarding issues.

---

### Ticket Backlog

**Definition:** Number of tickets open or pending at the end of the period.

**Formula:**
```
Backlog = Count of open tickets
```

**What it tells you:** Current support debt. It should hold steady or fall.

---

### Ticket Distribution by Type

**Definition:** Breakdown of tickets by category.

**Formula:**
```
Type share = Tickets of the type created in period / Ticket Volume
```

**Categories (typical):**
- How-to / Usage questions
- Bug reports
- Feature requests
- Billing inquiries
- Account issues
- Other (including outage or incident related)

Ticket Distribution by Type is reported per ticket type: one share for each type, with the shares summing to 100%.

**What it tells you:** What's driving support volume. High "how-to" suggests onboarding or documentation gaps.

---

## Response Metrics

### First Response Time (FRT)

**Definition:** Time from ticket creation to first human response.

**Formula:**
```
FRT = Median of (First response timestamp - Ticket created timestamp)
```

Use median, not average (outliers skew averages).

**Benchmarks:**
| Channel | Target | Reality |
|---------|--------|---------|
| Chat | < 1 minute | Best channel for speed |
| Email (B2B) | 4-6 hours | Industry average is 12+ hours |
| Email (Enterprise) | < 1 hour | Premium SLA expected |
| Phone | < 30 seconds (80% within 20 sec) | "80/20 rule" standard |

**Customer expectations:** 52% expect email responses within 1 hour, 32% within 30 minutes.

**What it tells you:** How quickly customers get acknowledged. Impacts satisfaction.

**Sources:**
- [Zendesk: Customer Service Benchmark](https://www.zendesk.com/blog/first-contact-resolution-friend-foe-frenemy/)
- [Freshworks: Customer Service Benchmark 2024](https://www.freshworks.com/resources/customer-service-benchmark-report-2024/)

---

### First Response SLA Adherence

**Definition:** Percentage of tickets meeting FRT SLA target.

**Formula:**
```
FRT SLA Adherence = Tickets meeting FRT target / Total tickets × 100
```

**Target:** >95%

---

## Resolution Metrics

### Resolution Time (Time to Resolution)

**Definition:** Time from ticket creation to final resolution.

**Formula:**
```
Resolution Time = Median of (Resolution timestamp - Ticket created timestamp)
```

Resolution Time is reported per ticket type.

**Benchmarks:**
- Simple issues: < 4 hours
- Moderate issues: < 24 hours
- Complex issues: < 72 hours

**What it tells you:** How quickly problems are actually solved.

---

### First Contact Resolution (FCR)

**Definition:** Percentage of tickets resolved in a single interaction.

**Formula:**
```
FCR = Tickets resolved without reopening or follow-up / Total tickets × 100
```

**Benchmarks:**
- Below 60%: Low, investigate agent training or issue complexity
- 60-70%: Below average
- 70%: Industry average (SQM Group 2024 data)
- 70-80%: Good, competitive for SaaS
- 80%+: World-class

**Industry variation:** Retail/simple products achieve 73-75%. Complex tech support often 50-65%.

**Impact:** FCR improvements reduce churn by up to 67%.

**What it tells you:** Support efficiency and agent capability.

**Sources:**
- [SQM Group: FCR Benchmark 2024](https://www.sqmgroup.com/resources/library/blog/call-center-fcr-benchmark-2024-results-by-industry)
- [Geckoboard: FCR Rate](https://www.geckoboard.com/best-practice/kpi-examples/first-contact-resolution-rate/)

---

### Resolution SLA Adherence

**Definition:** Percentage of tickets resolved within SLA timeframe.

**Formula:**
```
Resolution SLA Adherence = Tickets meeting resolution target / Total tickets × 100
```

**Target:** >90%

---

### Reopen Rate

**Definition:** Percentage of resolved tickets that are reopened.

**Formula:**
```
Reopen Rate = Tickets reopened / Tickets resolved × 100
```

**Benchmarks:**
- Below 5%: Good
- 5-10%: Acceptable
- Above 10%: Investigate resolution quality

**What it tells you:** Resolution quality. High reopen rate means problems aren't actually being solved.

---

## Quality Metrics

### Customer Satisfaction Score (CSAT)

**Definition:** Customer rating of support interaction.

**Formula:**
```
CSAT = Positive responses / Total responses × 100
```

GASP uses a 5-point scale and counts the top two ratings (4 and 5) as positive.

**Benchmarks:**
- Below 70%: Poor, requires immediate attention
- 70-80%: Below average (B2B SaaS average is ~68-78%)
- 80-90%: Good
- 90%+: Excellent
- 95%+: World-class

**By channel:**
- Live chat: 87% average (highest)
- Email: 61% average
- Phone: 44% average

**Segment variation:** Enterprise customers typically rate 72-75% (dedicated support), SMB customers 60-65%.

**What it tells you:** Customer perception of support quality.

**Common mistakes:**
- Low response rates (<10% makes data unreliable)
- Survey fatigue
- Not following up on negative feedback

**Sources:**
- [Retently: CSAT Benchmarks 2025](https://www.retently.com/blog/customer-satisfaction-score-csat/)
- [Fullview: CSAT Benchmarks by Industry](https://www.fullview.io/blog/csat-benchmarks-by-industry)

---

### Customer Effort Score (CES)

**Definition:** How easy it was for the customer to get help.

**Formula:**
```
CES = Average rating on "How easy was it to resolve your issue?" (1-7 scale)
```

Or as the percentage of respondents scoring 5 or above on the same 1-7 scale:
```
CES % = Respondents who agree it was easy / Total respondents × 100
```

**Benchmarks (1-7 scale):**
- Below 4: High effort, frustrating
- 4-5: Moderate
- 5-6: Good
- Above 6: Easy, effortless

**Benchmarks (percentage):**
- Below 70%: Needs improvement (per Gartner)
- 70-90%: Good
- Above 90%: Excellent, strong position

**Why CES matters:** CES is 1.8x more effective than CSAT at predicting customer loyalty, so cutting friction does more for repeat business than raising satisfaction.

**What it tells you:** Support friction. Lower effort correlates with retention.

**Sources:**
- [Gartner: Customer Effort Score](https://www.gartner.com/en/customer-service-support/insights/customer-effort-score)
- [Userpilot: Customer Satisfaction Benchmarking](https://userpilot.com/blog/customer-satisfaction-benchmarking/)

---

### Escalation Rate

**Definition:** Percentage of tickets escalated to higher tier or engineering.

**Formula:**
```
Escalation Rate = Escalated tickets / Total tickets × 100
```

**Benchmarks:**
- Below 5%: Well-handled at Tier 1
- 5-15%: Normal
- Above 15%: May indicate training gaps or product issues

**What it tells you:** Issue complexity and Tier 1 capability.

---

## Efficiency Metrics

### Tickets per Agent

**Definition:** Average tickets handled per support agent.

**Formula:**
```
Tickets per Agent = Total tickets handled / Number of agents
```

**Benchmarks:**
- Chat: 300-500/month
- Email: 400-600/month
- Phone: 200-400/month

**What it tells you:** Agent productivity and capacity planning.

---

### Cost per Ticket

**Definition:** Total support cost divided by tickets resolved.

**Formula:**
```
Cost per Ticket = Total support team cost / Total tickets resolved
```

**Benchmarks:**
- Chat: $3-8
- Email: $5-15
- Phone: $10-25

**What it tells you:** Support efficiency. It should fall over time.

---

### Self-Service Rate (Ticket Deflection)

**Definition:** Percentage of support needs resolved through self-service.

**Formula:**
```
Self-Service Rate = Self-service resolutions / (Self-service + Tickets) × 100
```

Self-service resolutions are deflections: help center or chatbot sessions that ended without a ticket. Raw help center views overstate the rate.

**Benchmarks:**
- Below 20%: Low self-service adoption
- 20-40%: Moderate
- 40-60%: Good
- Above 60%: Excellent

**What it tells you:** Documentation and tooling effectiveness.

---

## Summary Table

| Metric | Type | Primary Indicator Of |
|--------|------|---------------------|
| Ticket Volume | Volume | Support demand |
| Tickets per Customer | Volume | Product/support burden |
| First Response Time | Response | Initial responsiveness |
| Resolution Time | Resolution | Problem-solving speed |
| First Contact Resolution | Resolution | Efficiency |
| CSAT | Quality | Customer satisfaction |
| Escalation Rate | Quality | Issue complexity |
| Cost per Ticket | Efficiency | Support economics |
| Self-Service Rate | Efficiency | Deflection effectiveness |
