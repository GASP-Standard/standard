# Engineering & Platform Metrics

Metrics for measuring platform health, reliability and engineering productivity.

**DORA Framework:** Delivery metrics follow the [DORA (DevOps Research and Assessment)](https://dora.dev/) framework, the industry standard for measuring software delivery performance. DORA research shows that high-performing teams are 2x more likely to exceed profitability targets.

---

## Reliability Metrics

### Uptime (Availability)

**Definition:** The percentage of time the service is operational.

**Formula:**
```
Uptime = (Total time - Downtime) / Total time × 100
```

**Benchmarks (Monthly):**
- 99.0%: ~7.3 hours downtime (unacceptable for most SaaS)
- 99.9%: ~43 minutes downtime (three nines)
- 99.95%: ~22 minutes downtime (typical SLA)
- 99.99%: ~4.3 minutes downtime (four nines, high reliability)

**What it tells you:** Basic platform reliability.

**Common mistakes:**
- Excluding "scheduled maintenance" (customers don't care why it's down)
- Measuring only core service, not dependencies
- Not weighting by traffic/usage

---

### SLA Adherence

**Definition:** Percentage of time SLA commitments were met.

**Formula:**
```
SLA Adherence = Periods meeting SLA / Total periods × 100
```

**Target:** 100% (SLA breaches have contractual and trust implications)

---

### Error Rate

**Definition:** Percentage of requests that result in errors.

**Formula:**
```
Error Rate = Error responses (5xx) / Total requests × 100
```

**Benchmarks:**
- Below 0.1%: Excellent
- 0.1-0.5%: Good
- 0.5-1%: Acceptable
- Above 1%: Needs attention

**What it tells you:** Service reliability from user perspective.

---

### Latency (Response Time)

**Definition:** Time taken to respond to requests.

**Formula:**
```
P50 Latency = Median response time
P95 Latency = 95th percentile response time
P99 Latency = 99th percentile response time
```

Always report P95 or P99, not averages (averages hide tail latency).

**Benchmarks (API):**
- P50: < 100ms
- P95: < 500ms
- P99: < 1000ms

**What it tells you:** User experience. Slow responses impact satisfaction and conversion.

---

## Incident Metrics

### Incident Count

**Definition:** Number of incidents in a period.

**Formula:**
```
Incident Count = Total incidents reported
```

Incident Count is reported per severity and per incident type (availability, performance, security and data).

Categorize by severity:
- SEV1/P1: Critical, full outage
- SEV2/P2: Major, significant degradation
- SEV3/P3: Minor, limited impact
- SEV4/P4: Cosmetic, no customer impact

**What it tells you:** System stability. Trend matters.

---

### Mean Time to Detect (MTTD)

**Definition:** Time from incident start to detection.

**Formula:**
```
MTTD = Average of (Detection time - Incident start time)
```

**Target:** < 5 minutes for critical services

**What it tells you:** Monitoring and alerting effectiveness.

---

### Mean Time to Acknowledge (MTTA)

**Definition:** Time from alert to human acknowledgment.

**Formula:**
```
MTTA = Average of (Acknowledgment time - Alert time)
```

**Target:** < 15 minutes

**What it tells you:** On-call responsiveness.

---

### Mean Time to Resolve (MTTR)

**Definition:** Time from incident start to resolution.

**Formula:**
```
MTTR = Average of (Resolution time - Incident start time)
```

MTTR is reported per severity and per incident type, since resolution targets differ by severity.

**Benchmarks:**
- SEV1: < 1 hour
- SEV2: < 4 hours
- SEV3: < 24 hours

**What it tells you:** Incident response capability.

---

### Change Failure Rate

**Definition:** Percentage of deployments that cause incidents.

**Formula:**
```
Change Failure Rate = Deployments causing incidents / Total deployments × 100
```

**Benchmarks (DORA):**
- Elite: 0-15%
- High: 16-30%
- Medium: 31-45%
- Low: 46-60%

**What it tells you:** Deployment quality and release process health.

---

## Delivery Metrics (DORA)

The four key DORA metrics measure software delivery performance. In 2024, DORA added a fifth metric (Rework Rate), though benchmarks are still emerging.

**Sources:**
- [DORA: Metrics Guide](https://dora.dev/guides/dora-metrics-four-keys/)
- [Google Cloud: Four Keys](https://cloud.google.com/blog/products/devops-sre/using-the-four-keys-to-measure-your-devops-performance)

### Deployment Frequency

**Definition:** How often code is deployed to production.

**Formula:**
```
Deployment Frequency = Deployments / Time period
```

**Benchmarks (DORA):**
- Elite: On-demand or multiple times per day
- High: Once per day to once per week
- Medium: Once per week to once per month
- Low: Less than once per month

**What it tells you:** Ability to deliver value quickly.

---

### Lead Time for Changes

**Definition:** Time from code commit to production deployment.

**Formula:**
```
Lead Time = Median of (Deploy time - Commit time)
```

**Benchmarks (DORA):**
- Elite: Less than 1 day
- High: 1 day to 1 week
- Medium: 1 week to 1 month
- Low: 1 month to 6 months

**What it tells you:** Development and release pipeline efficiency.

---

### Mean Time to Recovery (MTTR)

**Definition:** Time to restore service after a failure.

**Formula:**
```
MTTR = Average of (Recovery time - Failure time)
```

**Benchmarks (DORA):**
- Elite: Less than 1 hour
- High: Less than 1 day
- Medium: 1 day to 1 week
- Low: More than 1 week

**What it tells you:** Resilience and recovery capability.

---

## Capacity Metrics

### Infrastructure Utilization

**Definition:** Percentage of provisioned capacity being used.

**Formula:**
```
Utilization = Actual usage / Provisioned capacity × 100
```

Measure for CPU, memory, storage, network.

**Targets:**
- Below 40%: Over-provisioned, wasting money
- 40-70%: Healthy headroom
- 70-85%: Efficient, monitoring needed
- Above 85%: At risk, scale soon

---

### Infrastructure Cost per Customer

**Definition:** Total infrastructure cost divided by active customers.

**Formula:**
```
Cost per Customer = Total infrastructure cost / Active customers
```

**What it tells you:** Unit economics of delivery. Should decrease or stay flat as you scale.

---

### Headroom

**Definition:** Available capacity before scaling is required.

**Formula:**
```
Headroom = (Max capacity - Current usage) / Max capacity × 100
```

**Target:** Maintain 20-30% headroom for traffic spikes.

---

## Security Metrics

### Vulnerability Count

**Definition:** Number of known vulnerabilities in systems.

**Categorize by severity:** Critical, High, Medium, Low

**Targets:**
- Critical: 0 (fix immediately)
- High: < 10 (fix within days)
- Medium: < 50 (fix within weeks)

---

### Time to Patch

**Definition:** Time from vulnerability disclosure to patch deployment.

**Formula:**
```
Time to Patch = Average of (Patch deploy time - Disclosure time)
```

**Targets:**
- Critical: < 24 hours
- High: < 7 days
- Medium: < 30 days

---

### Security Incident Count

**Definition:** Number of security incidents in a period.

**Target:** Zero breaches. Track and reduce attempted attacks.

---

## Summary Table

| Metric | Type | Primary Indicator Of |
|--------|------|---------------------|
| Uptime | Reliability | Platform availability |
| Error Rate | Reliability | Service quality |
| P95 Latency | Reliability | User experience |
| Incident Count | Incidents | System stability |
| MTTR | Incidents | Recovery capability |
| Deployment Frequency | Delivery | Release velocity |
| Lead Time for Changes | Delivery | Pipeline efficiency |
| Change Failure Rate | Delivery | Release quality |
| Infrastructure Cost per Customer | Capacity | Delivery economics |
