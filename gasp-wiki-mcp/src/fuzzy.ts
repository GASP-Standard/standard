/**
 * Word matching shared by search and the "Did you mean" suggestions.
 *
 * Exact lookups never use this: it only ranks candidates to offer back to the
 * caller. Matching works on whole words, so "burn" does not hit "burnout" and
 * "NDR" does not hit "fundraising".
 */

/** Lowercase words: "LTV:CAC Ratio" → ["ltv", "cac", "ratio"], "net_new_mrr" → ["net", "new", "mrr"] */
export function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A matcher for the query as a phrase of whole words. The last word may carry a
 * plural or verb ending ("churn" matches "churned", "renewals"), nothing more.
 * Underscores count as word breaks so field ids match too.
 */
export function phraseMatcher(query: string): (text: string | null | undefined) => boolean {
  const ws = words(query);
  if (ws.length === 0) return () => false;
  const body = ws.map(escape).join("[^a-z0-9]+");
  const re = new RegExp(`(?:^|[^a-z0-9])${body}(?:s|es|ed|d|ing)?(?![a-z0-9])`);
  return (text) => !!text && re.test(text.toLowerCase().replace(/_/g, " "));
}

/** Optimal string alignment distance: Levenshtein plus adjacent transpositions ("chrun" → "churn" is 1). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Similarity of two words in 0..1. Words of three letters or fewer must match exactly; longer ones allow one edit per four letters. */
function wordSimilarity(q: string, c: string): number {
  if (q === c) return 1;
  if (q.length <= 3 || c.length <= 3) return 0;
  const dist = editDistance(q, c);
  if (dist > Math.floor(Math.max(q.length, c.length) / 4)) return 0;
  return 1 - dist / Math.max(q.length, c.length);
}

/**
 * How closely a query matches a name, in 0..1, or 0 when it does not. Every
 * query word must match a distinct word of the name, exactly or within the edit
 * budget; names with words the query does not cover score lower.
 */
export function fuzzyScore(query: string, name: string): number {
  const qw = words(query);
  const nw = words(name);
  if (qw.length === 0 || nw.length === 0) return 0;
  const used = new Set<number>();
  let total = 0;
  for (const w of qw) {
    let best = 0, at = -1;
    nw.forEach((c, i) => {
      if (used.has(i)) return;
      const s = wordSimilarity(w, c);
      if (s > best) { best = s; at = i; }
    });
    if (at < 0) return 0;
    used.add(at);
    total += best;
  }
  const coverage = qw.length / nw.length;
  return (total / qw.length) * (0.6 + 0.4 * Math.min(1, coverage));
}

/**
 * The candidates closest to the query, best first. Each candidate offers
 * several names (its name, aliases, abbreviation); the best one counts.
 */
export function closest<T>(query: string, candidates: Array<{ item: T; names: string[] }>, limit: number, min = 0.5): Array<{ item: T; score: number }> {
  return candidates
    .map(({ item, names }) => ({ item, score: Math.max(0, ...names.map((n) => fuzzyScore(query, n))) }))
    .filter((c) => c.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
