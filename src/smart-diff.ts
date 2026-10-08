import { analyzeContent, normalizeText, digest, checkJsonComplexity, type Block, type IntelligenceDocument } from "./extract";
import { ServiceError, type SmartDiffInput } from "./contracts";
import { fetchTarget } from "./safe-fetch";
import { stableJsonStringify, normalizeHtml } from "./freshness";

type Change = { path: string; before?: unknown; after?: unknown };
export interface Changes { added: Change[]; removed: Change[]; modified: Change[] }
const MAX_CHANGES = 200;
const MAX_DOCUMENT = 200000;
const pointer = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const cosmetic = (text: string) => normalizeText(text).normalize("NFKC").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
function preview(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  return serialized && serialized.length > 1000 ? { excerpt: serialized.slice(0, 1000), truncated: true } : value;
}

export function compareDocuments(before: IntelligenceDocument, after: IntelligenceDocument) {
  const changes: Changes = { added: [], removed: [], modified: [] };
  const counts = { added: 0, removed: 0, modified: 0 };
  let visited = 0;
  const reasons = new Set<string>();
  let numeric = false, availability = false;
  function add(kind: keyof Changes, path: string, left?: unknown, right?: unknown) {
    counts[kind]++;
    const values = `${JSON.stringify(left) ?? ""} ${JSON.stringify(right) ?? ""}`;
    if (/\d/.test(values) || /price|cost|amount|quantity|stock/i.test(path)) numeric = true;
    if (/available|availability|stock|sold.out|discontinued/i.test(path + values)) availability = true;
    if (changes.added.length + changes.removed.length + changes.modified.length < MAX_CHANGES) {
      changes[kind].push({ path, ...(left === undefined ? {} : { before: preview(left) }), ...(right === undefined ? {} : { after: preview(right) }) });
    }
  }
  function walk(left: unknown, right: unknown, path: string, depth = 0) {
    if (++visited > 20000 || depth > 64) throw new ServiceError("content_too_complex", "Comparison exceeds the structural complexity limit.", 422);
    if (Object.is(left, right)) return;
    if (record(left) && record(right)) {
      for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
        const child = `${path}/${pointer(key)}`;
        if (!Object.hasOwn(left, key)) add("added", child, undefined, right[key]);
        else if (!Object.hasOwn(right, key)) add("removed", child, left[key]);
        else walk(left[key], right[key], child, depth + 1);
      }
    } else if (Array.isArray(left) && Array.isArray(right)) {
      // Ordered arrays retain index semantics; never guess an identity field.
      for (let i = 0; i < Math.max(left.length, right.length); i++) {
        if (i >= left.length) add("added", `${path}/${i}`, undefined, right[i]);
        else if (i >= right.length) add("removed", `${path}/${i}`, left[i]);
        else walk(left[i], right[i], `${path}/${i}`, depth + 1);
      }
    } else add("modified", path || "/", left, right);
  }
  const legacy = before.fidelity === "legacy_text" || after.fidelity === "legacy_text";
  if (before.kind !== after.kind) {
    add("modified", "/content_kind", before.kind, after.kind);
    reasons.add("content_type_changed");
  } else if (before.kind === "json") {
    walk(before.data, after.data, "");
  } else {
    // Legacy snapshots have no DOM boundaries. Both sides use the same sentence segmentation.
    const sentences = (text: string): Block[] => cosmetic(text).split(/(?<=[.!?;])\s+/u).map(text => ({ kind: "text", key: null, text }));
    const left = (legacy ? sentences(before.text) : before.blocks).map(b => ({ ...b, text: cosmetic(b.text) }));
    const right = (legacy ? sentences(after.text) : after.blocks).map(b => ({ ...b, text: cosmetic(b.text) }));
    if (left.length > 1000 || right.length > 1000) throw new ServiceError("content_too_complex", "At most 1,000 content blocks can be compared.", 422);
    const unused = new Set(right.map((_, i) => i));
    const unmatched: Array<[Block, number]> = [];
    // Exact content matches ignore DOM wrappers, attributes and block reordering.
    for (const [i, block] of left.entries()) {
      const match = right.findIndex((b, j) => unused.has(j) && b.text === block.text);
      if (match >= 0) unused.delete(match); else unmatched.push([block, i]);
    }
    let similarityWork = 0;
    const rightWords = right.map(b => new Set(b.text.toLowerCase().split(/\s+/).slice(0, 1000)));
    for (const [block, i] of unmatched) {
      const tokens = new Set(block.text.toLowerCase().split(/\s+/).slice(0, 1000));
      let best = -1, bestScore = 0.45;
      for (const j of unused) {
        const other = right[j];
        const words = rightWords[j];
        similarityWork += words.size;
        if (similarityWork > 250000) throw new ServiceError("content_too_complex", "Block comparison exceeds the CPU work budget. Use a narrower scope.", 422);
        let common = 0; for (const word of words) if (tokens.has(word)) common++;
        const similarity = common / Math.max(1, tokens.size + words.size - common);
        const score = block.key && block.key === other.key ? 2 : block.kind === other.kind ? similarity : 0;
        if (score > bestScore) { bestScore = score; best = j; }
      }
      const path = `/blocks/${i}`;
      if (best >= 0) { unused.delete(best); add("modified", path, block.text, right[best].text); }
      else add("removed", path, block.text);
    }
    for (const j of unused) add("added", `/blocks/${j}`, undefined, right[j].text);
  }
  const total = counts.added + counts.removed + counts.modified;
  let score = total ? 20 : 0;
  if (total) reasons.add("content_changed");
  if (numeric) { score += 25; reasons.add("numeric_or_price_change"); }
  if (availability) { score += 30; reasons.add("availability_language_or_field_changed"); }
  if (counts.removed) { score += 10; reasons.add("content_removed"); }
  if (total >= 10) { score += 20; reasons.add("ten_or_more_changes"); }
  if (before.kind !== after.kind) score = Math.max(score, 80);
  return {
    changed: total > 0, changes, counts, changes_truncated: total > MAX_CHANGES,
    significance: { score: Math.min(score, 100), level: score >= 60 ? "high" : score >= 30 ? "medium" : score ? "low" : "none", reasons: [...reasons], rules_version: 1 },
    comparison_quality: legacy ? "legacy_text" : "structural",
    algorithm: "deterministic-v1", semantic_model_used: false,
  };
}

interface Watch {
  watch_id: string; url: string; selector: string | null; ignore_selectors_json: string; ignore_json_paths_json: string;
  normalized_content: string; content_kind: IntelligenceDocument["kind"]; content_truncated: number; normalizer_version: number; hash: string;
}
interface Snapshot { hash: string; document_json: string; created_at: string }
interface LegacySnapshot { hash: string; normalized_content: string; content_kind: IntelligenceDocument["kind"]; content_truncated: number; normalizer_version: number; created_at: string }
function legacyDocument(row: LegacySnapshot): IntelligenceDocument {
  if (row.content_truncated || row.normalizer_version !== 2) throw new ServiceError("baseline_incompatible", "The baseline is truncated or uses an unsupported normalizer. Register a narrower scope.", 409);
  const data: unknown = row.content_kind === "json" ? JSON.parse(row.normalized_content) : null;
  if (data !== null) checkJsonComplexity(data);
  return { kind: row.content_kind, text: row.normalized_content, data, blocks: [{ kind: "text", key: null, text: row.normalized_content }], fidelity: row.content_kind === "json" ? "structural" : "legacy_text" };
}
export async function prepareSmartDiff(db: D1Database, input: SmartDiffInput) {
  const watch = await db.prepare("SELECT * FROM watches WHERE watch_id = ?").bind(input.watch_id).first<Watch>();
  if (!watch) throw new ServiceError("watch_not_found", "Register a baseline with /v1/register first.", 404);
  let saved: Snapshot | null;
  if (input.previous_hash) {
    saved = await db.prepare("SELECT * FROM smart_snapshots WHERE watch_id = ? AND hash = ? ORDER BY id DESC LIMIT 1").bind(input.watch_id, input.previous_hash.toLowerCase()).first<Snapshot>();
    saved ??= await db.prepare("SELECT * FROM smart_baselines WHERE watch_id = ? AND hash = ?").bind(input.watch_id, input.previous_hash.toLowerCase()).first<Snapshot>();
  } else saved = input.compare_to === "baseline"
    ? await db.prepare("SELECT * FROM smart_baselines WHERE watch_id = ?").bind(input.watch_id).first<Snapshot>()
    : await db.prepare("SELECT * FROM smart_snapshots WHERE watch_id = ? ORDER BY id DESC LIMIT 1").bind(input.watch_id).first<Snapshot>();
  const earliest = await db.prepare("SELECT * FROM watch_snapshots WHERE watch_id = ? ORDER BY id LIMIT 1").bind(input.watch_id).first<LegacySnapshot>();
  let prior: IntelligenceDocument, previousHash: string, source: string;
  if (saved) { prior = JSON.parse(saved.document_json) as IntelligenceDocument; previousHash = saved.hash; source = "smart_snapshot"; }
  else {
    const row = input.previous_hash
      ? await db.prepare("SELECT * FROM watch_snapshots WHERE watch_id = ? AND hash = ? ORDER BY id DESC LIMIT 1").bind(input.watch_id, input.previous_hash.toLowerCase()).first<LegacySnapshot>()
      : input.compare_to === "baseline" ? earliest : { ...watch, created_at: "" };
    if (!row) throw new ServiceError("snapshot_not_found", "Requested snapshot is unavailable or outside retention.", 404);
    prior = legacyDocument(row); previousHash = row.hash; source = "v1_snapshot";
  }
  const fetched = await fetchTarget(new URL(watch.url), false);
  if (!fetched.response.ok) throw new ServiceError("upstream_error", `Target returned HTTP ${fetched.response.status}.`, 502);
  const { document: current } = await analyzeContent(fetched.body, fetched.response.headers.get("content-type") ?? "", fetched.finalUrl, {
    selector: watch.selector ?? undefined, ignore_selectors: JSON.parse(watch.ignore_selectors_json), ignore_json_paths: JSON.parse(watch.ignore_json_paths_json),
  });
  const serialized = JSON.stringify(current);
  if (serialized.length > MAX_DOCUMENT) throw new ServiceError("content_too_large_for_diff", "Smart Diff stores at most 200,000 characters per document. Register a narrower scope.", 413);
  const hash = await digest(stableJsonStringify({ kind: current.kind, data: current.data, blocks: current.blocks }));
  const baseline = earliest && !earliest.content_truncated && earliest.normalizer_version === 2 ? legacyDocument(earliest) : prior;
  const baselineHash = earliest && !earliest.content_truncated && earliest.normalizer_version === 2 ? earliest.hash : previousHash;
  const createdAt = new Date().toISOString();
  // Compare legacy snapshots using their exact normalizer; mixing v1 title/full-page
  // text with v2 main-content extraction would invent changes on an unchanged page.
  const comparable = prior.fidelity === "legacy_text" ? {
    ...current,
    text: current.kind === "html" ? await normalizeHtml(fetched.body, {
      url: watch.url, selector: watch.selector, ignore_selectors: JSON.parse(watch.ignore_selectors_json), ignore_json_paths: JSON.parse(watch.ignore_json_paths_json),
    }) : fetched.body.replace(/\s+/g, " ").trim(),
  } : current;
  return {
    result: {
      watch_id: input.watch_id, url: watch.url, final_url: fetched.finalUrl, content_kind: current.kind,
      previous_hash: previousHash, hash, comparison_source: source, compare_to: input.previous_hash ? "hash" : input.compare_to,
      ...compareDocuments(prior, comparable), fetched_at: createdAt,
      warnings: [...(prior.fidelity === "legacy_text" ? ["legacy_baseline_has_no_html_structure"] : []), "significance_is_a_rule_based_hint"],
    },
    // This is invoked exclusively by the payment boundary after successful settlement.
    async commit() {
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO smart_baselines(watch_id, hash, document_json, created_at) VALUES (?, ?, ?, ?)").bind(input.watch_id, baselineHash, JSON.stringify(baseline), createdAt),
        db.prepare("INSERT INTO smart_snapshots(watch_id, hash, document_json, created_at) VALUES (?, ?, ?, ?)").bind(input.watch_id, hash, serialized, createdAt),
        db.prepare("DELETE FROM smart_snapshots WHERE watch_id = ? AND id NOT IN (SELECT id FROM smart_snapshots WHERE watch_id = ? ORDER BY id DESC LIMIT 20)").bind(input.watch_id, input.watch_id),
      ]);
    },
  };
}
