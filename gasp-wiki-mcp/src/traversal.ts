/**
 * Graph-traversal reasoning over the canonical GASP standard.
 *
 * Operates directly on /standard/ontology.json + relationships.json. Direction
 * flips at denominator/subtrahend formula inputs (read from structuredFormulas).
 * Edge attenuation is bucketed by edgeTypeClassification for entity edges and
 * by canonical metric-edge type for metric signal edges.
 *
 * A baseline input (read under `at period_start` or inside `lag`, so it is fixed
 * before the period starts: NRR reads MRR at period start) is still a direct
 * component of its metric, but traversal does not continue through it: nothing
 * that moves the input during the period moves the metric.
 */
import { analyzeFormula, parseFormula } from "./formula.js";

import type {
  OntologyData,
  RelationshipEdge,
  RelationshipNode,
} from "./types.js";

export type Direction = 1 | -1;

export type EdgeClassification =
  | "metric_signal"
  | "structural"
  | "lifecycle"
  | "behavioral"
  | "assignment"
  | "generative";

/** A single edge step on a traversal path. */
export interface PathStep {
  from: string;
  to: string;
  edgeType: string;
  classification: EdgeClassification;
  attenuation: number;
  /** True if this step inverts signal direction (denominator/subtrahend or `reduces`). */
  directionFlip: boolean;
}

/** Shared output shape across infer_drivers, explain_path, coverage_gap. */
export interface TraversalCandidate {
  id: string;
  label?: string;
  direction: Direction;
  /** Product of edge attenuations along the chosen path. Range (0, 1]. */
  score: number;
  path: PathStep[];
}

interface InternalContext {
  edgesBySource: Map<string, RelationshipEdge[]>;
  edgesByTarget: Map<string, RelationshipEdge[]>;
  nodeById: Map<string, RelationshipNode>;
  classification: Map<string, EdgeClassification>;
  /** "source|target" → -1 if denominator/subtrahend. */
  pairOverrides: Map<string, Direction>;
  /** "input|metric" pairs where the metric reads the input only as a baseline. */
  baselinePairs: Set<string>;
  metricNodeIds: Set<string>;
}

// ---------------------------------------------------------------------------
// Canonical edge tables
// ---------------------------------------------------------------------------

/** Default direction per edge type before per-pair overrides. */
const EDGE_BASE_DIRECTION: Record<string, Direction> = {
  drives: 1,
  component: 1,
  predicts: 1,
  reduces: -1,
  measures: 1,
  // Entity edges all default to +1 (carrying signal forward); structural shape
  // does not invert direction. Inversions come from the formula-role lookup.
};

/** Attenuation multiplier per edge classification. */
const CLASSIFICATION_ATTENUATION: Record<EdgeClassification, number> = {
  metric_signal: 0.8, // overridden per metric edge type below
  structural: 0.95,
  lifecycle: 0.85,
  behavioral: 0.75,
  assignment: 0.9,
  generative: 0.9,
};

/** Per-type override for metric_signal edges (tighter than the bucket default). */
const METRIC_EDGE_ATTENUATION: Record<string, number> = {
  component: 0.9,
  drives: 0.75,
  reduces: 0.75,
  predicts: 0.6,
  measures: 0.95,
};

const MIN_SCORE = 0.01;
const DEFAULT_MAX_DEPTH = 6;

// ---------------------------------------------------------------------------
// Context construction
// ---------------------------------------------------------------------------

export function buildContext(
  nodes: RelationshipNode[],
  edges: RelationshipEdge[],
  ontology: OntologyData | undefined,
): InternalContext {
  const edgesBySource = new Map<string, RelationshipEdge[]>();
  const edgesByTarget = new Map<string, RelationshipEdge[]>();
  for (const e of edges) {
    if (!edgesBySource.has(e.source)) edgesBySource.set(e.source, []);
    edgesBySource.get(e.source)!.push(e);
    if (!edgesByTarget.has(e.target)) edgesByTarget.set(e.target, []);
    edgesByTarget.get(e.target)!.push(e);
  }

  const nodeById = new Map<string, RelationshipNode>();
  for (const n of nodes) nodeById.set(n.id, n);

  const metricNodeIds = new Set<string>();
  for (const n of nodes) {
    if (!n.nodeType) metricNodeIds.add(n.id);
  }

  const classification = new Map<string, EdgeClassification>();
  // Metric signal edge types
  for (const t of ["drives", "component", "reduces", "predicts", "measures"]) {
    classification.set(t, "metric_signal");
  }
  // Entity edges from canonical edgeTypeClassification (lowercase the keys to
  // match relationships.json edge types, which are lowercase).
  const cls = ontology?.entityRelationships?.edgeTypeClassification;
  if (cls) {
    for (const [bucket, types] of Object.entries(cls)) {
      for (const t of types) {
        classification.set(t.toLowerCase(), bucket as EdgeClassification);
      }
    }
  }

  // Direction overrides: walk structuredFormulas, flip any input whose derived
  // polarity is negative (older data without polarity: denominator or subtrahend role).
  const pairOverrides = new Map<string, Direction>();
  const baselinePairs = new Set<string>();
  const sf = ontology?.structuredFormulas;
  if (sf) {
    for (const [target, formula] of Object.entries(sf)) {
      if (target === "description" || typeof formula !== "object" || formula === null) continue;
      const f = formula as { expression?: string; inputs?: Array<{ ref: string; role: string; polarity?: string; baseline?: boolean }> };
      if (!f.inputs) continue;
      // `baseline` is derived onto each input by npm run derive; the expression gives the same answer before then.
      let analyzed: Record<string, boolean> | undefined;
      try { analyzed = f.expression ? analyzeFormula(parseFormula(f.expression)).metricBaseline : undefined; } catch { analyzed = undefined; }
      for (const input of f.inputs) {
        if (input.baseline ?? analyzed?.[input.ref]) baselinePairs.add(`${input.ref}|${target}`);
        const negative = input.polarity ? input.polarity === "negative" : input.role === "denominator" || input.role === "subtrahend";
        if (negative) {
          pairOverrides.set(`${input.ref}|${target}`, -1);
        }
      }
    }
  }

  return { edgesBySource, edgesByTarget, nodeById, classification, pairOverrides, baselinePairs, metricNodeIds };
}

// ---------------------------------------------------------------------------
// Edge classification + attenuation
// ---------------------------------------------------------------------------

function classify(edgeType: string, ctx: InternalContext): EdgeClassification {
  return ctx.classification.get(edgeType) ?? "metric_signal";
}

function attenuationFor(edgeType: string, ctx: InternalContext): number {
  if (edgeType in METRIC_EDGE_ATTENUATION) return METRIC_EDGE_ATTENUATION[edgeType];
  const cls = classify(edgeType, ctx);
  return CLASSIFICATION_ATTENUATION[cls];
}

function edgeDirection(edge: RelationshipEdge, ctx: InternalContext): Direction {
  // 1. Per-pair override from structuredFormulas (denominator/subtrahend role).
  const override = ctx.pairOverrides.get(`${edge.source}|${edge.target}`);
  if (override !== undefined) return override;
  // 2. Edge-level `inverse: true` flag (canonical inverse-correlation marker).
  const base: Direction = EDGE_BASE_DIRECTION[edge.type] ?? 1;
  return edge.inverse ? ((base * -1) as Direction) : base;
}

function makeStep(edge: RelationshipEdge, ctx: InternalContext): PathStep {
  const dir = edgeDirection(edge, ctx);
  return {
    from: edge.source,
    to: edge.target,
    edgeType: edge.type,
    classification: classify(edge.type, ctx),
    attenuation: attenuationFor(edge.type, ctx),
    directionFlip: dir === -1,
  };
}

// ---------------------------------------------------------------------------
// Public API: infer_drivers
// ---------------------------------------------------------------------------

/**
 * Walk reverse from `metricId` through incoming edges. Each upstream metric
 * gets a direction (consistent with the observed movement) and an attenuation
 * score. Multiple paths to the same upstream collapse to the highest score.
 *
 * Only metric nodes are returned as candidates — entity/concept nodes appear
 * in paths but aren't ranked as drivers.
 */
export function inferDrivers(
  metricId: string,
  observedDirection: Direction,
  ctx: InternalContext,
  options: { maxDepth?: number; metricsOnly?: boolean } = {},
): TraversalCandidate[] {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const metricsOnly = options.metricsOnly ?? true;

  // Best candidate per node id: highest score wins; on tie keep shorter path.
  const best = new Map<string, TraversalCandidate>();

  interface QueueItem {
    nodeId: string;
    direction: Direction;
    score: number;
    path: PathStep[];
    visited: Set<string>;
  }

  const seed: QueueItem = {
    nodeId: metricId,
    direction: observedDirection,
    score: 1,
    path: [],
    visited: new Set([metricId]),
  };
  const queue: QueueItem[] = [seed];

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.path.length >= maxDepth) continue;

    const incoming = ctx.edgesByTarget.get(item.nodeId) ?? [];
    for (const edge of incoming) {
      if (item.visited.has(edge.source)) continue;

      const step = makeStep(edge, ctx);
      // Reverse traversal: source's implied direction = current direction × edge direction
      const stepDir: Direction = step.directionFlip ? -1 : 1;
      const newDirection: Direction = (item.direction * stepDir > 0 ? 1 : -1) as Direction;
      const newScore = item.score * step.attenuation;
      if (newScore < MIN_SCORE) continue;

      // Reverse pass: prepend step so path reads source → target chain.
      const newPath: PathStep[] = [step, ...item.path];

      const sourceNode = ctx.nodeById.get(edge.source);
      const isMetric = ctx.metricNodeIds.has(edge.source);

      if (!metricsOnly || isMetric) {
        const existing = best.get(edge.source);
        if (!existing || newScore > existing.score) {
          best.set(edge.source, {
            id: edge.source,
            label: sourceNode?.label,
            direction: newDirection,
            score: newScore,
            path: newPath,
          });
        }
      }

      // A baseline input is a driver itself; its own drivers move it during the period, not the metric.
      if (ctx.baselinePairs.has(`${edge.source}|${edge.target}`)) continue;

      queue.push({
        nodeId: edge.source,
        direction: newDirection,
        score: newScore,
        path: newPath,
        visited: new Set([...item.visited, edge.source]),
      });
    }
  }

  // Rank by score descending, then by path length ascending.
  return [...best.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.path.length - b.path.length;
  });
}

/**
 * What to say when inferDrivers returns nothing: either the graph has no edge
 * into the metric at all, or every chain falls below the score or depth limit.
 */
export function noDriversMessage(metricId: string, ctx: InternalContext): string {
  const label = ctx.nodeById.get(metricId)?.label ?? metricId;
  if ((ctx.edgesByTarget.get(metricId) ?? []).length === 0) {
    return `No upstream drivers in the graph: no edge leads into ${label}, so the graph cannot say what moves it.`;
  }
  return `No upstream drivers of ${label} found within the traversal depth limit.`;
}

// ---------------------------------------------------------------------------
// Public API: explain_path
// ---------------------------------------------------------------------------

/**
 * Find chains of edges from `fromId` to `toId`. Returns up to `maxPaths`
 * distinct paths sorted by length ascending, then score descending. Empty if
 * the nodes are disconnected in the forward direction.
 */
export function findPaths(
  fromId: string,
  toId: string,
  ctx: InternalContext,
  options: { maxDepth?: number; maxPaths?: number } = {},
): TraversalCandidate[] {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxPaths = options.maxPaths ?? 5;

  const found: TraversalCandidate[] = [];

  interface QueueItem {
    nodeId: string;
    direction: Direction;
    score: number;
    path: PathStep[];
    visited: Set<string>;
  }

  const seed: QueueItem = {
    nodeId: fromId,
    direction: 1,
    score: 1,
    path: [],
    visited: new Set([fromId]),
  };
  const queue: QueueItem[] = [seed];

  while (queue.length > 0 && found.length < maxPaths) {
    const item = queue.shift()!;
    if (item.path.length >= maxDepth) continue;

    const outgoing = ctx.edgesBySource.get(item.nodeId) ?? [];
    for (const edge of outgoing) {
      if (item.visited.has(edge.target)) continue;
      // A baseline edge only starts a path: a path that reached the input through its drivers stops there.
      if (item.path.length > 0 && ctx.baselinePairs.has(`${edge.source}|${edge.target}`)) continue;

      const step = makeStep(edge, ctx);
      const stepDir: Direction = step.directionFlip ? -1 : 1;
      const newDirection: Direction = (item.direction * stepDir > 0 ? 1 : -1) as Direction;
      const newScore = item.score * step.attenuation;
      if (newScore < MIN_SCORE) continue;

      const newPath: PathStep[] = [...item.path, step];
      const newVisited = new Set([...item.visited, edge.target]);

      if (edge.target === toId) {
        const targetNode = ctx.nodeById.get(toId);
        found.push({
          id: toId,
          label: targetNode?.label,
          direction: newDirection,
          score: newScore,
          path: newPath,
        });
        if (found.length >= maxPaths) break;
        continue;
      }

      queue.push({
        nodeId: edge.target,
        direction: newDirection,
        score: newScore,
        path: newPath,
        visited: newVisited,
      });
    }
  }

  return found.sort((a, b) => {
    if (a.path.length !== b.path.length) return a.path.length - b.path.length;
    return b.score - a.score;
  });
}

// ---------------------------------------------------------------------------
// Public API: coverage_gap
// ---------------------------------------------------------------------------

export interface CoverageGapResult {
  upstreamMissing: string[];
  downstreamMissing: string[];
  disconnected: string[];
}

/**
 * Diagnose coverage of a metric set. Operates on the metric subgraph only —
 * entities and concepts are ignored.
 *
 * - upstreamMissing: metrics with at least one outgoing edge into the set,
 *   that are not themselves in the set. One hop only, so a baseline input is
 *   listed as a direct component and its own drivers are not.
 * - downstreamMissing: metrics with at least one incoming edge from the set,
 *   that are not themselves in the set.
 * - disconnected: in-graph metrics with no path (in either direction) to the set.
 */
export function coverageGap(
  metricSet: Set<string>,
  ctx: InternalContext,
): CoverageGapResult {
  const upstream = new Set<string>();
  const downstream = new Set<string>();

  for (const id of metricSet) {
    // upstream of `id` = sources of incoming edges
    for (const edge of ctx.edgesByTarget.get(id) ?? []) {
      if (!metricSet.has(edge.source) && ctx.metricNodeIds.has(edge.source)) {
        upstream.add(edge.source);
      }
    }
    // downstream of `id` = targets of outgoing edges
    for (const edge of ctx.edgesBySource.get(id) ?? []) {
      if (!metricSet.has(edge.target) && ctx.metricNodeIds.has(edge.target)) {
        downstream.add(edge.target);
      }
    }
  }

  // Disconnected: full transitive reachability test (undirected) from the set.
  const reachable = new Set<string>(metricSet);
  const queue: string[] = [...metricSet];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const edge of ctx.edgesBySource.get(id) ?? []) {
      if (!reachable.has(edge.target)) {
        reachable.add(edge.target);
        queue.push(edge.target);
      }
    }
    for (const edge of ctx.edgesByTarget.get(id) ?? []) {
      if (!reachable.has(edge.source)) {
        reachable.add(edge.source);
        queue.push(edge.source);
      }
    }
  }

  const disconnected: string[] = [];
  for (const id of ctx.metricNodeIds) {
    if (!reachable.has(id)) disconnected.push(id);
  }

  return {
    upstreamMissing: [...upstream].sort(),
    downstreamMissing: [...downstream].sort(),
    disconnected: disconnected.sort(),
  };
}
