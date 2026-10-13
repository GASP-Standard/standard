import { Metric, Definition, DualLens, DualLensForm, DualLensBridge } from "./types.js";

/** Map of file basenames to department display names */
const DEPARTMENT_NAMES: Record<string, string> = {
  core: "Core",
  sales: "Sales",
  marketing: "Marketing",
  "customer-success": "Customer Success",
  support: "Support",
  product: "Product",
  engineering: "Engineering",
  finance: "Finance",
  onboarding: "Onboarding",
  people: "People",
  revops: "RevOps",
  partnerships: "Partnerships",
  "professional-services": "Professional Services",
};

/** Known abbreviation → full name mapping */
const ABBREVIATION_MAP: Record<string, string[]> = {
  MRR: ["Monthly Recurring Revenue"],
  ARR: ["Annual Recurring Revenue"],
  NRR: ["Net Revenue Retention", "NDR", "Net Dollar Retention"],
  NDR: ["Net Dollar Retention", "NRR", "Net Revenue Retention"],
  GRR: ["Gross Revenue Retention"],
  CAC: ["Customer Acquisition Cost"],
  LTV: ["Customer Lifetime Value", "CLV", "CLTV"],
  CLV: ["Customer Lifetime Value", "LTV", "CLTV"],
  CLTV: ["Customer Lifetime Value", "LTV", "CLV"],
  NPS: ["Net Promoter Score"],
  CSAT: ["Customer Satisfaction Score"],
  CES: ["Customer Effort Score"],
  ARPA: ["Average Revenue Per Account"],
  ACV: ["Annual Contract Value"],
  TTFV: ["Time to First Value"],
  FRT: ["First Response Time"],
  MTTR: ["Mean Time to Resolve", "Mean Time to Recovery"],
  DAU: ["Daily Active Users"],
  MAU: ["Monthly Active Users"],
  WAU: ["Weekly Active Users"],
  MQL: ["Marketing Qualified Lead"],
  SQL: ["Sales Qualified Lead"],
  DSO: ["Days Sales Outstanding"],
  EBITDA: ["Earnings Before Interest Taxes Depreciation and Amortization"],
  COGS: ["Cost of Goods Sold"],
  DORA: ["DevOps Research and Assessment"],
};

/**
 * Extract abbreviation from metric name heading.
 * e.g. "MRR (Monthly Recurring Revenue)" → ["MRR"]
 * e.g. "Net Revenue Retention (NRR)" → ["NRR", "NDR"]
 */
function extractAliases(name: string): string[] {
  const aliases: string[] = [];

  // Match abbreviation at start: "MRR (Monthly Recurring Revenue)"
  const leadingMatch = name.match(/^([A-Z]{2,})\s/);
  if (leadingMatch) {
    aliases.push(leadingMatch[1]);
  }

  // Match abbreviation in parens: "Net Revenue Retention (NRR)"
  const parenMatch = name.match(/\(([A-Z]{2,})\)/);
  if (parenMatch) {
    aliases.push(parenMatch[1]);
  }

  // Add known aliases for any found abbreviation
  for (const alias of [...aliases]) {
    const known = ABBREVIATION_MAP[alias];
    if (known) {
      for (const k of known) {
        if (k.length <= 5 && !aliases.includes(k)) {
          aliases.push(k);
        }
      }
    }
  }

  return aliases;
}

/** Slugify a heading for anchor links */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

/**
 * Parse a single metric markdown file into an array of Metric objects.
 * Splits on ### headings and extracts fields.
 */
export function parseMetricsFile(
  content: string,
  filename: string
): Metric[] {
  const dept =
    DEPARTMENT_NAMES[filename.replace(".md", "")] || filename.replace(".md", "");

  const metrics: Metric[] = [];
  let currentCategory = "";

  // Split into lines and walk through
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Track ## section headings as categories
    if (line.startsWith("## ") && !line.startsWith("### ")) {
      currentCategory = line.replace("## ", "").trim();
      i++;
      continue;
    }

    // Found a ### metric heading
    if (line.startsWith("### ")) {
      const name = line.replace("### ", "").trim();
      const slug = slugify(name);
      const aliases = extractAliases(name);

      // Collect all lines until next ### or ## or end
      const sectionLines: string[] = [];
      i++;
      while (
        i < lines.length &&
        !lines[i].startsWith("### ") &&
        !(lines[i].startsWith("## ") && !lines[i].startsWith("### "))
      ) {
        sectionLines.push(lines[i]);
        i++;
      }

      const rawMarkdown = sectionLines.join("\n").trim();
      const metric = parseSectionFields(
        name,
        slug,
        rawMarkdown,
        dept,
        currentCategory,
        aliases
      );
      metrics.push(metric);
      continue;
    }

    i++;
  }

  return metrics;
}

/** Extract structured fields from a metric section's markdown body */
function parseSectionFields(
  name: string,
  slug: string,
  raw: string,
  department: string,
  category: string,
  aliases: string[]
): Metric {
  const definition = extractField(raw, "Definition");
  const insight = extractField(raw, "What it tells you");
  const benchmarks = extractBenchmarks(raw);
  const formulas = extractFormulas(raw);
  const commonMistakes = extractListField(raw, "Common mistakes");
  const sources = extractSources(raw);
  const { dualLens, dualLensNote } = parseDualLens(raw);

  return {
    name,
    slug,
    definition: definition || "",
    formulas,
    benchmarks,
    insight,
    commonMistakes,
    sources,
    department,
    category,
    aliases,
    rawMarkdown: `### ${name}\n\n${raw}`,
    signalType: "operational",
    signalTypeSecondary: null,
    dualLens,
    dualLensNote,
  };
}

/** Extract a **FieldName:** value from markdown */
function extractField(text: string, fieldName: string): string | null {
  const fence = "\\`\\`\\`";
  const pattern = new RegExp(
    "\\*\\*" + fieldName + ":\\*\\*\\s*(.+?)(?=\\n\\n|\\n\\*\\*|\\n" + fence + "|$)",
    "s"
  );
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

/** Extract all code block formulas */
function extractFormulas(text: string): string[] {
  const formulas: string[] = [];
  const fence = "```";
  const codeBlockRegex = new RegExp(fence + "\\n?([\\s\\S]*?)" + fence, "g");
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const formula = match[1].trim();
    if (formula) {
      formulas.push(formula);
    }
  }
  return formulas;
}

/** Extract benchmarks section — everything after **Benchmarks until next field */
function extractBenchmarks(text: string): string | null {
  const pattern =
    /\*\*Benchmarks[^*]*\*\*\s*([\s\S]*?)(?=\n\*\*[A-Z]|\n##|\n---|\n\*\*Sources|$)/;
  const match = text.match(pattern);
  if (!match) return null;
  return match[1].trim() || null;
}

/** Extract a bulleted list after **FieldName:** */
function extractListField(
  text: string,
  fieldName: string
): string[] | null {
  const pattern = new RegExp(
    `\\*\\*${fieldName}:\\*\\*\\s*\\n((?:- .+\\n?)+)`,
    "m"
  );
  const match = text.match(pattern);
  if (!match) return null;
  return match[1]
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.replace(/^- /, "").trim());
}

/** Extract source URLs */
function extractSources(text: string): string[] {
  const sources: string[] = [];
  const pattern =
    /\*\*Sources:\*\*\s*\n([\s\S]*?)(?=\n\*\*[A-Z]|\n##|\n---|\n$|$)/;
  const match = text.match(pattern);
  if (!match) return sources;

  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(match[1])) !== null) {
    sources.push(`${linkMatch[1]}: ${linkMatch[2]}`);
  }
  return sources;
}

/**
 * Extract a field value from a dual-lens subsection.
 * Terminates at next bold field (**X), code fence, or #### heading — not at \n\n.
 */
function extractSubsectionField(text: string, fieldName: string): string {
  const fence = "\\`\\`\\`";
  const pattern = new RegExp(
    "\\*\\*" + fieldName + ":\\*\\*\\s*([\\s\\S]*?)(?=\\n\\*\\*[A-Z]|\\n" + fence + "|\\n####|$)",
    ""
  );
  const match = text.match(pattern);
  return match ? match[1].trim() : "";
}

/** Extract the first code block from text */
function extractFirstCodeBlock(text: string): string | null {
  const fence = "```";
  const regex = new RegExp(fence + "\\n?([\\s\\S]*?)" + fence);
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Parse dual-lens content from a metric's raw markdown.
 * Returns { dualLens, dualLensNote }.
 *
 * Pattern 1 — Standard O/M: #### Operating Form: ... / #### Market Form: ... / #### Bridge:
 * Pattern 2 — Shared Churn:  #### Dual-Lens: ... with **Operating Form:** / **Market Form:** bold labels
 * Pattern 3 — Note only:     #### Dual-Lens Note
 */
function parseDualLens(raw: string): { dualLens: DualLens | null; dualLensNote: string | null } {
  // --- Pattern 3: Note only ---
  const noteHeadingMatch = raw.match(/#### Dual-Lens Note\s*\n([\s\S]*?)(?=\n---|\n####|\n###|$)/);
  if (noteHeadingMatch) {
    const noteText = noteHeadingMatch[1].trim();
    return { dualLens: null, dualLensNote: noteText || null };
  }

  // --- Pattern 1: Standard O/M ---
  const opHeadingMatch = raw.match(/#### Operating Form:\s*(.+)/);
  if (opHeadingMatch) {
    // Split into Operating, Market, Bridge sections
    const opStart = raw.indexOf(opHeadingMatch[0]);
    const mktMatch = raw.match(/#### Market Form:\s*(.+)/);
    const bridgeMatch = raw.match(/#### Bridge:/);

    if (!mktMatch || !bridgeMatch) {
      return { dualLens: null, dualLensNote: null };
    }

    const mktStart = raw.indexOf(mktMatch[0]);
    const bridgeStart = raw.indexOf(bridgeMatch[0]);

    const opSection = raw.substring(opStart + opHeadingMatch[0].length, mktStart).trim();
    const mktSection = raw.substring(mktStart + mktMatch[0].length, bridgeStart).trim();
    const bridgeSection = raw.substring(bridgeStart + bridgeMatch[0].length).trim();

    const operating = parseStandardForm(opHeadingMatch[1].trim(), opSection);
    const market = parseStandardForm(mktMatch[1].trim(), mktSection);
    const bridge = parseBridgeSection(bridgeSection);

    return { dualLens: { operating, market, bridge }, dualLensNote: null };
  }

  // --- Pattern 2: Shared Churn ---
  const dualLensHeadingMatch = raw.match(/#### Dual-Lens:/);
  if (dualLensHeadingMatch) {
    const dlStart = raw.indexOf(dualLensHeadingMatch[0]);
    const dlSection = raw.substring(dlStart + dualLensHeadingMatch[0].length).trim();

    // Split on bold Operating Form / Market Form / Bridge labels
    const opBoldMatch = dlSection.match(/\*\*Operating Form:\s*([^*]+)\*\*/);
    const mktBoldMatch = dlSection.match(/\*\*Market Form:\s*([^*]+)\*\*/);
    const bridgeBoldMatch = dlSection.match(/\*\*Bridge:\*\*/);

    if (!opBoldMatch || !mktBoldMatch || !bridgeBoldMatch) {
      return { dualLens: null, dualLensNote: null };
    }

    const opBoldStart = dlSection.indexOf(opBoldMatch[0]);
    const mktBoldStart = dlSection.indexOf(mktBoldMatch[0]);
    const bridgeBoldStart = dlSection.indexOf(bridgeBoldMatch[0]);

    const opText = dlSection.substring(opBoldStart + opBoldMatch[0].length, mktBoldStart).trim();
    const mktText = dlSection.substring(mktBoldStart + mktBoldMatch[0].length, bridgeBoldStart).trim();
    const bridgeText = dlSection.substring(bridgeBoldStart + bridgeBoldMatch[0].length).trim();

    const operating = parseSharedForm(opBoldMatch[1].trim(), opText);
    const market = parseSharedForm(mktBoldMatch[1].trim(), mktText);
    const bridge: DualLensBridge = {
      reconciliation: null,
      diagnostic: bridgeText,
    };

    return { dualLens: { operating, market, bridge }, dualLensNote: null };
  }

  return { dualLens: null, dualLensNote: null };
}

/** Parse an Operating/Market form from a Standard O/M section (Pattern 1) */
function parseStandardForm(label: string, section: string): DualLensForm {
  // Description = text before the first **bold** field
  const firstBoldIdx = section.search(/\*\*[A-Z]/);
  const description = firstBoldIdx > 0 ? section.substring(0, firstBoldIdx).trim() : "";

  const celSource = extractSubsectionField(section, "CEL Source");
  const atlInclusion = extractSubsectionField(section, "ATL Inclusion(?:[^:]*)?");
  const formula = extractFirstCodeBlock(section);
  const insight = extractSubsectionField(section, "What it tells you");

  return { label, description, celSource, atlInclusion, formula, insight };
}

/** Parse an Operating/Market form from a Shared Churn section (Pattern 2) */
function parseSharedForm(label: string, section: string): DualLensForm {
  // Description = text before the first **bold** field
  const firstBoldIdx = section.search(/\*\*[A-Z]/);
  const description = firstBoldIdx > 0 ? section.substring(0, firstBoldIdx).trim() : "";

  const celSource = extractSubsectionField(section, "CEL Source");
  const insight = extractSubsectionField(section, "What it tells you");

  return { label, description, celSource, atlInclusion: "", formula: null, insight };
}

/** Parse a Bridge section */
function parseBridgeSection(section: string): DualLensBridge {
  const reconciliation = extractFirstCodeBlock(section);
  const diagnostic = extractSubsectionField(section, "Diagnostic");

  return { reconciliation, diagnostic };
}

/**
 * Parse definitions.md into Definition objects.
 * Each ### heading is a term.
 */
export function parseDefinitions(content: string): Definition[] {
  const definitions: Definition[] = [];
  const lines = content.split("\n");
  let currentSection = "";
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("## ") && !line.startsWith("### ")) {
      currentSection = line.replace("## ", "").trim();
      i++;
      continue;
    }

    if (line.startsWith("### ")) {
      const term = line.replace("### ", "").trim();
      const slug = slugify(term);

      const sectionLines: string[] = [];
      i++;
      while (
        i < lines.length &&
        !lines[i].startsWith("### ") &&
        !(lines[i].startsWith("## ") && !lines[i].startsWith("### "))
      ) {
        sectionLines.push(lines[i]);
        i++;
      }

      const raw = sectionLines.join("\n").trim();

      // First non-empty line after heading is the definition
      const defLine = raw.split("\n").find((l) => l.trim() && !l.startsWith("---"));
      const definition = defLine?.trim() || "";

      // Extract canonical link
      const linkMatch = raw.match(
        /\*\*Canonical definition:\*\*\s*\[([^\]]+)\]\(([^)]+)\)/
      );
      const canonicalLink = linkMatch ? linkMatch[2] : null;

      // Extract reference link (framework terms point at a site page instead)
      const refMatch = raw.match(/\*\*Reference:\*\*\s*\[([^\]]+)\]\(([^)]+)\)/);
      const referenceLink = refMatch ? refMatch[2] : null;

      // Remaining body (bullets, examples) minus the link/metadata lines
      const bodyLines = raw.split("\n").filter((l) => l !== defLine && !l.startsWith("---"));
      const body = bodyLines
        .filter((l) => !/\*\*(Canonical definition|Reference|Used in):\*\*/.test(l))
        .join("\n")
        .trim();

      // Extract "Used in" departments
      const usedInMatch = raw.match(/\*\*Used in:\*\*\s*(.+)/);
      const usedIn = usedInMatch
        ? usedInMatch[1].split(",").map((s) => s.trim())
        : [];

      definitions.push({
        term,
        slug,
        definition,
        section: currentSection,
        canonicalLink,
        referenceLink,
        body: body || null,
        usedIn,
      });

      continue;
    }

    i++;
  }

  return definitions;
}
