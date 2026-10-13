/**
 * Canonical gaspwiki.com URLs for standard content.
 *
 * Mirrors the website's routing (gasp-wiki-frontend/src/pages and
 * utils/metric-helpers.ts) so agents get working links instead of guessing.
 * test/urls.test.ts checks every emitted URL against the site's routes.
 */
import type { Metric, Definition } from "./types.js";

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
