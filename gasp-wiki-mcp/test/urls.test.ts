import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStandard, findDefinition, search } from "../src/loader.js";
import { SITE, metricUrl, definitionUrl, resolveDocLink } from "../src/urls.js";
import type { StandardData } from "../src/types.js";

// Regression: agents were handed definitions with no URL and guessed their
// own (/v1/definitions/signal_type, /v1/taxonomy/signal-type, ...), which 404.
// Every URL the MCP emits must be a real gaspwiki.com page.

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(__dirname, "..", "..", "gasp-wiki-frontend");
const PAGES = join(FRONTEND, "src", "pages");
const STANDARD_METRICS = join(__dirname, "..", "..", "standard", "metrics");
const DIST = join(FRONTEND, "dist");

let data: StandardData;

beforeAll(() => {
  data = loadStandard();
});

/** Every URL the tools can emit, with where it came from */
function emittedUrls(d: StandardData): Array<{ from: string; url: string }> {
  const out: Array<{ from: string; url: string }> = [];
  for (const m of d.metrics) out.push({ from: `metric ${m.name}`, url: metricUrl(m) });
  for (const def of d.definitions) {
    out.push({ from: `definition ${def.term}`, url: definitionUrl(def) });
    for (const link of [def.canonicalLink, def.referenceLink]) {
      const url = link ? resolveDocLink(link) : null;
      if (url) out.push({ from: `link on ${def.term}`, url });
    }
  }
  return out;
}

/** Static page routes from src/pages (files without [params]) */
function staticRoutes(): Set<string> {
  const routes = new Set<string>();
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}/${entry.name}`);
      else if (entry.name.endsWith(".astro") && !entry.name.includes("[")) {
        const name = entry.name.replace(/\.astro$/, "");
        routes.add(name === "index" ? prefix || "/" : `${prefix}/${name}`);
      }
    }
  };
  walk(PAGES, "");
  return routes;
}

describe("URL helpers", () => {
  it("gives the four framework terms their definition pages", () => {
    for (const slug of ["signal-type", "sensitivity-tier", "access-scope", "metric-owner"]) {
      const def = data.definitions.find((d) => d.slug === slug);
      expect(def, slug).toBeDefined();
      expect(definitionUrl(def!)).toBe(`${SITE}/v1/definitions/${slug}`);
    }
  });

  it("parses **Reference:** links on framework terms", () => {
    const bySlug = (s: string) => data.definitions.find((d) => d.slug === s)!;
    expect(bySlug("signal-type").referenceLink).toBe("/v1/taxonomy");
    expect(bySlug("sensitivity-tier").referenceLink).toBe("/v1/governance#sensitivity-tier");
    expect(bySlug("access-scope").referenceLink).toBe("/v1/governance#access-scope");
    expect(bySlug("metric-owner").referenceLink).toBe("/v1/adapter#metric-owners");
  });

  it("builds metric URLs from department and slug", () => {
    const nrr = data.metrics.find((m) => m.department === "Customer Success" && m.name.includes("NRR"));
    expect(nrr).toBeDefined();
    expect(metricUrl(nrr!)).toBe(`${SITE}/v1/metrics/customer-success/${nrr!.slug}`);
  });

  it("resolves standard file links the way the website does", () => {
    expect(resolveDocLink("metrics/core.md#mrr")).toBe(`${SITE}/v1/metrics/core/mrr`);
    expect(resolveDocLink("cel.md#change-nature")).toBe(`${SITE}/v1/cel#change-nature`);
    expect(resolveDocLink("/v1/adapter#metric-owners")).toBe(`${SITE}/v1/adapter#metric-owners`);
    expect(resolveDocLink("ontology.json in the GASP repository")).toBeNull();
  });
});

describe("findDefinition", () => {
  it("finds framework terms by name, case-insensitively", () => {
    expect(findDefinition(data, "signal type")?.slug).toBe("signal-type");
    expect(findDefinition(data, "Metric Owner")?.slug).toBe("metric-owner");
  });

  it("finds by slug and by abbreviation in parentheses", () => {
    expect(findDefinition(data, "sensitivity-tier")?.slug).toBe("sensitivity-tier");
    expect(findDefinition(data, "CEL")?.term).toContain("Commercial Event Ledger");
  });

  it("returns undefined for unknown terms", () => {
    expect(findDefinition(data, "xyzzy nonexistent")).toBeUndefined();
  });
});

describe("search results carry URLs", () => {
  it("links definition hits to their definition page", () => {
    const hit = search(data, "signal type", 5).find((r) => r.type === "definition");
    expect(hit?.url).toBe(`${SITE}/v1/definitions/signal-type`);
  });

  it("links metric hits to their metric page", () => {
    const hit = search(data, "NRR", 5).find((r) => r.type === "metric");
    expect(hit?.url).toMatch(new RegExp(`^${SITE}/v1/metrics/[a-z-]+/[a-z0-9-]+$`));
  });
});

// The route checks need the website source. A mirror holding only standard/
// and gasp-wiki-mcp/ skips them; the monorepo always runs them.
if (!existsSync(PAGES)) console.log(`urls.test: ${FRONTEND} not found, skipping route checks against the website`);

describe.skipIf(!existsSync(PAGES))("every emitted URL resolves", () => {
  it("points at a real route (source pages + standard data)", () => {
    const statics = staticRoutes();
    const metricPaths = new Set(data.metrics.map((m) => new URL(metricUrl(m)).pathname));
    const defPaths = new Set(data.definitions.map((d) => `/v1/definitions/${d.slug}`));
    // metrics/[...slug].astro: one department page per standard/metrics/*.md
    for (const f of readdirSync(STANDARD_METRICS)) {
      if (f.endsWith(".md")) statics.add(`/v1/metrics/${f.replace(/\.md$/, "")}`);
    }
    const bad = emittedUrls(data).filter(({ url }) => {
      expect(url.startsWith(`${SITE}/`)).toBe(true);
      const path = new URL(url).pathname;
      return !(statics.has(path) || metricPaths.has(path) || defPaths.has(path));
    });
    expect(bad).toEqual([]);
  });

  it.skipIf(!existsSync(DIST))("exists in the built site", () => {
    const missing = emittedUrls(data).filter(({ url }) => {
      const path = new URL(url).pathname;
      return !existsSync(join(DIST, path, "index.html")) && !existsSync(join(DIST, `${path}.html`));
    });
    expect(missing).toEqual([]);
  });
});
