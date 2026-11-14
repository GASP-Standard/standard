/**
 * Canonical gaspwiki.com URLs for standard content.
 *
 * Mirrors the website's routing (gasp-wiki-frontend/src/pages and
 * utils/metric-helpers.ts) so agents get working links instead of guessing.
 * test/urls.test.ts checks every emitted URL against the site's routes.
 */
import type { Metric, Definition, RelationshipNode } from "./types.js";

export const SITE = "https://gaspwiki.com";

function deptSlug(dept: string): string {
  return dept.toLowerCase().replace(/\s+/g, "-");
}

/** Every metric record has its own page, including cross-reference stubs */
export function metricUrl(m: Pick<Metric, "department" | "slug">): string {
  return `${SITE}/v1/metrics/${deptSlug(m.department)}/${m.slug}`;
}

export function definitionUrl(d: Pick<Definition, "slug">): string {
  return `${SITE}/v1/definitions/${d.slug}`;
}

/**
 * The page behind a relationship graph node, the same rule the site uses to
 * generate src/data/metric-links.ts: a metric node links to its canonical
 * metric page, an entity or concept node to its glossary page when it has one
 * and to the glossary index otherwise.
 */
export function nodeUrl(n: Pick<RelationshipNode, "nodeType" | "department" | "slug" | "definition">): string {
  if ((!n.nodeType || n.nodeType === "metric") && n.department && n.slug) return metricUrl({ department: n.department, slug: n.slug });
  return n.definition ? definitionUrl({ slug: n.definition }) : `${SITE}/v1/definitions`;
}

/**
 * Resolve a link found in the standard markdown to an absolute URL.
 * - Site paths (`/v1/adapter#metric-owners`) are absolutised.
 * - Standard files follow the website: `metrics/core.md#slug` → `/v1/metrics/core/slug`,
 *   `cel.md#anchor` → `/v1/cel#anchor`.
 * - Anything else (plain-text references) returns null.
 */
export function resolveDocLink(link: string): string | null {
  if (link.startsWith("/")) return `${SITE}${link}`;
  if (/^https?:\/\//.test(link)) return link;
  const [file, anchor] = link.split("#");
  if (!/^[\w/-]+\.md$/.test(file)) return null;
  const base = "/v1/" + file.replace(/\.md$/, "");
  if (!anchor) return `${SITE}${base}`;
  return file.startsWith("metrics/") ? `${SITE}${base}/${anchor}` : `${SITE}${base}#${anchor}`;
}
