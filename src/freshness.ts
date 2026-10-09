import { sql, statements as buildStatements, type SqlWrite } from "./sql";
﻿import { BodyReadError, readRequestBody } from "./body";

import { fetchTarget, validateTarget, TargetNotAllowedError } from "./safe-fetch";
import {gatewayFromBindings,type EgressBindings} from "./egress";
import {ServiceError} from "./contracts";
import type {CapacityBindings} from './capacity-config';

export const NORMALIZER_VERSION = 2;
export const FRESH402_VERSION = "2.0.0-rc.1";

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 5_000_000;
const MAX_STORED_CONTENT = 200_000;
const MAX_SNAPSHOTS_PER_WATCH = 20;
const MAX_SELECTOR_LENGTH = 256;
const MAX_IGNORE_RULES = 20;
const MAX_JSON_PATH_LENGTH = 256;
const MAX_CACHE_AGE_SECONDS = 86_400;
const DIFF_EXCERPT_LIMIT = 1_200;

type DeferredWrites = (statements: SqlWrite[]) => void;

async function writeBatch(db: D1Database, statements: SqlWrite[], defer?: DeferredWrites): Promise<void> {
    if (defer) defer(statements); else await db.batch(buildStatements(db, statements));
}

export interface FreshnessEnv extends EgressBindings, CapacityBindings {
    requestSignal?: AbortSignal;
    beforeRegisterFetch?: () => Promise<FreshnessEnv>;
    TARGET_HOST_ALLOWLIST?: string;
    deferWrites?: DeferredWrites;
    DB: D1Database;
    REGISTER_TARGET_LIMITER: RateLimit;
    REGISTER_GLOBAL_LIMITER: RateLimit;
}

type ContentKind = "html" | "json" | "text";

interface WatchConfig {
    url: string;
    selector: string | null;
    ignore_selectors: string[];
    ignore_json_paths: string[];
}

export interface Fresh402RegisterInput {
    url?: string;
    selector?: string;
    ignore_selectors?: string[];
    ignore_json_paths?: string[];
}

export interface Fresh402CheckInput extends Fresh402RegisterInput {
    watch_id?: string;
    previous_hash?: string;
    max_age_seconds?: number;
    include_diff?: boolean;
}

interface WatchRow {
    watch_id: string;
    url: string;
    final_url: string;
    selector: string | null;
    ignore_selectors_json: string;
    ignore_json_paths_json: string;
    content_kind: ContentKind;
    hash: string;
    raw_hash: string | null;
    normalized_content: string;
    content_truncated: number;
    etag: string | null;
    last_modified: string | null;
    created_at: string;
    updated_at: string;
    checked_at: string;
    check_count: number;
    normalizer_version: number;
}

interface WatchSnapshotRow {
    id: number;
    watch_id: string;
    hash: string;
    raw_hash: string | null;
    normalized_content: string;
    content_truncated: number;
    content_kind: ContentKind;
    created_at: string;
    normalizer_version: number;
}

interface LegacySnapshotRow {
    id: number;
    hash: string;
    raw_hash: string | null;
    normalized_content: string;
    created_at: string;
    normalizer_version: number;
}

interface NormalizedPayload {
    content_kind: ContentKind;
    normalized: string;
    raw_normalized: string;
    hash: string;
    raw_hash: string;
    etag: string | null;
    last_modified: string | null;
    final_url: string;
}

interface StoredContent {
    value: string;
    truncated: boolean;
}

class Fresh402InputError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly status = 400,
    ) {
        super(message);
        this.name = "Fresh402InputError";
    }
}

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "content-type": "application/json; charset=UTF-8",
        },
    });
}

async function sha256(text: string): Promise<string> {
    const bytes = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);

    return Array.from(new Uint8Array(hashBuffer))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

function normalizeWhitespace(value: string): string {
    return value
        .replace(/\r\n/g, "\n")
        .replace(/\s+/g, " ")
        .trim();
}

function decodeBasicEntities(value: string): string {
    return value
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">");
}

function htmlToText(html: string): string {
    return normalizeWhitespace(
        decodeBasicEntities(
            html
                .replace(/<!--[\s\S]*?-->/g, " ")
                .replace(/<[^>]+>/g, " "),
        ),
    );
}

const BASE_REMOVE_SELECTORS = [
    "script",
    "style",
    "noscript",
    "template",
    "svg",
    "canvas",
    "[hidden]",
    '[aria-hidden="true"]',
    '[class*="cookie"]',
    '[id*="cookie"]',
    '[class*="consent"]',
    '[id*="consent"]',
    '[class*="advertisement"]',
    '[id*="advertisement"]',
];

const FULL_PAGE_REMOVE_SELECTORS = [
    "nav",
    "footer",
    "aside",
];

async function stripHtmlNoise(
    html: string,
    ignoreSelectors: string[],
    scoped: boolean,
): Promise<string> {
    const removeHandler = {
        element(element: Element) {
            element.remove();
        },
    };

    let rewriter = new HTMLRewriter();

    for (const selector of [
        ...BASE_REMOVE_SELECTORS,
        ...(scoped
            ? []
            : FULL_PAGE_REMOVE_SELECTORS),
        ...ignoreSelectors,
    ]) {
        try {
            rewriter = rewriter.on(selector, removeHandler);
        } catch {
            throw new Fresh402InputError(
                "invalid_selector",
                `Invalid CSS selector: ${selector}`,
            );
        }
    }

    return rewriter
        .transform(
            new Response(html, {
                headers: {
                    "content-type": "text/html; charset=UTF-8",
                },
            }),
        )
        .text();
}

export async function normalizeHtml(
    html: string,
    config: WatchConfig,
): Promise<string> {
    const cleanedHtml = await stripHtmlNoise(
        html,
        config.ignore_selectors,
        Boolean(config.selector),
    );

    if (!config.selector) {
        return htmlToText(cleanedHtml);
    }

    let matches = 0;
    const chunks: string[] = [];

    let rewriter = new HTMLRewriter();

    try {
        rewriter = rewriter.on(config.selector, {
            element() {
                matches++;
            },
            text(text) {
                chunks.push(text.text);
            },
        });
    } catch {
        throw new Fresh402InputError(
            "invalid_selector",
            `Invalid CSS selector: ${config.selector}`,
        );
    }

    await rewriter
        .transform(
            new Response(cleanedHtml, {
                headers: {
                    "content-type": "text/html; charset=UTF-8",
                },
            }),
        )
        .text();

    if (matches === 0) {
        throw new Fresh402InputError(
            "selector_not_found",
            `The selector did not match any element: ${config.selector}`,
            422,
        );
    }

    return normalizeWhitespace(
        decodeBasicEntities(chunks.join(" ")),
    );
}

function sortJsonValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortJsonValue);
    }

    if (
        value !== null &&
        typeof value === "object"
    ) {
        const input = value as Record<string, unknown>;
        const output: Record<string, unknown> = Object.create(null);

        for (const key of Object.keys(input).sort()) {
            output[key] = sortJsonValue(input[key]);
        }

        return output;
    }

    return value;
}

export function stableJsonStringify(value: unknown): string {
    return JSON.stringify(sortJsonValue(value));
}

function decodeJsonPointerSegment(segment: string): string {
    return segment
        .replace(/~1/g, "/")
        .replace(/~0/g, "~");
}

function removeJsonPath(
    target: unknown,
    segments: string[],
    index = 0,
): void {
    if (
        target === null ||
        target === undefined ||
        index >= segments.length
    ) {
        return;
    }

    const segment = segments[index];
    const last = index === segments.length - 1;

    if (Array.isArray(target)) {
        if (segment === "*") {
            if (last) {
                target.splice(0, target.length);
                return;
            }

            for (const item of target) {
                removeJsonPath(item, segments, index + 1);
            }

            return;
        }

        if (!/^\d+$/.test(segment)) {
            return;
        }

        const arrayIndex = Number(segment);

        if (
            !Number.isSafeInteger(arrayIndex) ||
            arrayIndex < 0 ||
            arrayIndex >= target.length
        ) {
            return;
        }

        if (last) {
            target.splice(arrayIndex, 1);
            return;
        }

        removeJsonPath(
            target[arrayIndex],
            segments,
            index + 1,
        );

        return;
    }

    if (typeof target !== "object") {
        return;
    }

    const record = target as Record<string, unknown>;

    if (segment === "*") {
        if (last) {
            for (const key of Object.keys(record)) {
                delete record[key];
            }

            return;
        }

        for (const value of Object.values(record)) {
            removeJsonPath(value, segments, index + 1);
        }

        return;
    }

    if (!Object.hasOwn(record, segment)) {
        return;
    }

    if (last) {
        delete record[segment];
        return;
    }

    removeJsonPath(
        record[segment],
        segments,
        index + 1,
    );
}

export function applyJsonIgnorePaths(
    value: unknown,
    paths: string[],
): unknown {
    const cloned = structuredClone(value);

    for (const path of paths) {
        if (!path.startsWith("/")) {
            throw new Fresh402InputError(
                "invalid_json_path",
                `JSON ignore paths must use JSON Pointer syntax, for example /updated_at. Invalid path: ${path}`,
            );
        }

        const segments = path
            .slice(1)
            .split("/")
            .map(decodeJsonPointerSegment);

        removeJsonPath(cloned, segments);
    }

    return cloned;
}

function clipDiffExcerpt(
    value: string,
    limit = DIFF_EXCERPT_LIMIT,
): string {
    if (value.length <= limit) {
        return value;
    }

    const half = Math.floor((limit - 5) / 2);

    return `${value.slice(0, half)} ... ${value.slice(-half)}`;
}

export function buildTextDiff(
    before: string,
    after: string,
) {
    if (before === after) {
        return {
            available: true,
            changed: false,
            change_ratio: 0,
            removed_excerpt: "",
            added_excerpt: "",
            excerpt_truncated: false,
        };
    }

    let prefix = 0;

    while (
        prefix < before.length &&
        prefix < after.length &&
        before[prefix] === after[prefix]
    ) {
        prefix++;
    }

    let suffix = 0;

    while (
        suffix < before.length - prefix &&
        suffix < after.length - prefix &&
        before[before.length - 1 - suffix] ===
            after[after.length - 1 - suffix]
    ) {
        suffix++;
    }

    const removed = before.slice(
        prefix,
        before.length - suffix,
    );

    const added = after.slice(
        prefix,
        after.length - suffix,
    );

    return {
        available: true,
        changed: true,
        change_ratio:
            Number(
                (
                    (removed.length + added.length) /
                    Math.max(1, before.length + after.length)
                ).toFixed(4),
            ),
        removed_excerpt:
            clipDiffExcerpt(removed),
        added_excerpt:
            clipDiffExcerpt(added),
        excerpt_truncated:
            removed.length > DIFF_EXCERPT_LIMIT ||
            added.length > DIFF_EXCERPT_LIMIT,
    };
}

function canonicalizeUrl(target: URL): string {
    const canonical = new URL(target.toString());
    canonical.hash = "";
    return canonical.toString();
}

function normalizeStringArray(
    value: unknown,
    field: string,
    maxItemLength: number,
): string[] {
    if (value === undefined) {
        return [];
    }

    if (!Array.isArray(value)) {
        throw new Fresh402InputError(
            "invalid_input",
            `${field} must be an array of strings.`,
        );
    }

    if (value.length > MAX_IGNORE_RULES) {
        throw new Fresh402InputError(
            "too_many_rules",
            `${field} supports at most ${MAX_IGNORE_RULES} items.`,
        );
    }

    const items = value.map((item) => {
        if (typeof item !== "string") {
            throw new Fresh402InputError(
                "invalid_input",
                `${field} must contain only strings.`,
            );
        }

        const normalized = item.trim();

        if (
            !normalized ||
            normalized.length > maxItemLength
        ) {
            throw new Fresh402InputError(
                "invalid_input",
                `${field} contains an empty or oversized item.`,
            );
        }

        return normalized;
    });

    return Array.from(new Set(items)).sort();
}

function parseSelector(value: unknown): string | null {
    if (value === undefined || value === null) {
        return null;
    }

    if (typeof value !== "string") {
        throw new Fresh402InputError(
            "invalid_selector",
            "selector must be a string.",
        );
    }

    const selector = value.trim();

    if (
        !selector ||
        selector.length > MAX_SELECTOR_LENGTH
    ) {
        throw new Fresh402InputError(
            "invalid_selector",
            `selector must be between 1 and ${MAX_SELECTOR_LENGTH} characters.`,
        );
    }

    return selector;
}

function parsePreviousHash(value: unknown): string | null {
    if (value === undefined || value === null) {
        return null;
    }

    if (
        typeof value !== "string" ||
        !/^[a-fA-F0-9]{64}$/.test(value)
    ) {
        throw new Fresh402InputError(
            "invalid_previous_hash",
            "previous_hash must be a 64-character SHA-256 hex string returned by Fresh402.",
        );
    }

    return value.toLowerCase();
}

function parseMaxAge(value: unknown): number {
    if (value === undefined || value === null) {
        return 0;
    }

    if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > MAX_CACHE_AGE_SECONDS
    ) {
        throw new Fresh402InputError(
            "invalid_max_age_seconds",
            `max_age_seconds must be an integer from 0 to ${MAX_CACHE_AGE_SECONDS}.`,
        );
    }

    return value;
}

function parseIncludeDiff(value: unknown): boolean {
    if (value === undefined || value === null) {
        return true;
    }

    if (typeof value !== "boolean") {
        throw new Fresh402InputError(
            "invalid_include_diff",
            "include_diff must be a boolean.",
        );
    }

    return value;
}

function parseUrlConfig(
    body: Record<string, unknown>,
    allowPrivate: boolean,
): WatchConfig {
    if (typeof body.url !== "string" || !body.url) {
        throw new Fresh402InputError(
            "missing_url",
            'Provide a URL, for example: {"url":"https://example.com"}',
        );
    }

    let target: URL;

    try {
        if (!allowPrivate && (/[\u0000-\u0020\u007f\\]/.test(body.url) || !/^https:\/\//i.test(body.url))) throw new Error();
        target = new URL(body.url);
    } catch {
        throw new Fresh402InputError(
            "invalid_url",
            "The supplied URL is invalid.",
        );
    }

    const validationError =
        validateTarget(target, allowPrivate);

    if (validationError) {
        throw new Fresh402InputError(
            "target_not_allowed",
            validationError,
        );
    }

    const selector = parseSelector(body.selector);

    const ignoreSelectors =
        normalizeStringArray(
            body.ignore_selectors,
            "ignore_selectors",
            MAX_SELECTOR_LENGTH,
        );

    const ignoreJsonPaths =
        normalizeStringArray(
            body.ignore_json_paths,
            "ignore_json_paths",
            MAX_JSON_PATH_LENGTH,
        );

    for (const path of ignoreJsonPaths) {
        if (!path.startsWith("/")) {
            throw new Fresh402InputError(
                "invalid_json_path",
                `JSON ignore paths must use JSON Pointer syntax. Invalid path: ${path}`,
            );
        }
    }

    return {
        url: canonicalizeUrl(target),
        selector,
        ignore_selectors: ignoreSelectors,
        ignore_json_paths: ignoreJsonPaths,
    };
}

async function watchIdForConfig(
    config: WatchConfig,
): Promise<string> {
    const digest = await sha256(
        JSON.stringify({
            url: config.url,
            selector: config.selector,
            ignore_selectors:
                config.ignore_selectors,
            ignore_json_paths:
                config.ignore_json_paths,
        }),
    );

    return `w_${digest.slice(0, 32)}`;
}

function configFromWatch(row: WatchRow): WatchConfig {
    return {
        url: row.url,
        selector: row.selector,
        ignore_selectors:
            JSON.parse(
                row.ignore_selectors_json,
            ) as string[],
        ignore_json_paths:
            JSON.parse(
                row.ignore_json_paths_json,
            ) as string[],
    };
}

async function getWatch(
    db: D1Database,
    watchId: string,
): Promise<WatchRow | null> {
    return db
        .prepare(
            `SELECT
                watch_id,
                url,
                final_url,
                selector,
                ignore_selectors_json,
                ignore_json_paths_json,
                content_kind,
                hash,
                raw_hash,
                normalized_content,
                content_truncated,
                etag,
                last_modified,
                created_at,
                updated_at,
                checked_at,
                check_count,
                normalizer_version
             FROM watches
             WHERE watch_id = ?`,
        )
        .bind(watchId)
        .first<WatchRow>();
}

function storedContent(value: string): StoredContent {
    if (value.length <= MAX_STORED_CONTENT) {
        return {
            value,
            truncated: false,
        };
    }

    return {
        value: value.slice(0, MAX_STORED_CONTENT),
        truncated: true,
    };
}

async function saveNewWatch(
    db: D1Database,
    watchId: string,
    config: WatchConfig,
    payload: NormalizedPayload,
    now: string,
    defer?: DeferredWrites,
): Promise<boolean> {
    const stored = storedContent(payload.normalized);

    const statements = [
        sql(
            `INSERT INTO watches (
                watch_id,
                url,
                final_url,
                selector,
                ignore_selectors_json,
                ignore_json_paths_json,
                content_kind,
                hash,
                raw_hash,
                normalized_content,
                content_truncated,
                etag,
                last_modified,
                created_at,
                updated_at,
                checked_at,
                check_count,
                normalizer_version
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
            ON CONFLICT(watch_id) DO NOTHING`,
        ).bind(
            watchId,
            config.url,
            payload.final_url,
            config.selector,
            JSON.stringify(config.ignore_selectors),
            JSON.stringify(config.ignore_json_paths),
            payload.content_kind,
            payload.hash,
            payload.raw_hash,
            stored.value,
            stored.truncated ? 1 : 0,
            payload.etag,
            payload.last_modified,
            now,
            now,
            now,
            NORMALIZER_VERSION,
        ),
        sql(
            `INSERT INTO watch_snapshots (
                watch_id,
                hash,
                raw_hash,
                normalized_content,
                content_truncated,
                content_kind,
                created_at,
                normalizer_version
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
        ).bind(
            watchId,
            payload.hash,
            payload.raw_hash,
            stored.value,
            stored.truncated ? 1 : 0,
            payload.content_kind,
            now,
            NORMALIZER_VERSION,
        ),
    ];
    if (defer) { defer(statements); return true; }
    const results = await db.batch(buildStatements(db, statements));

    // D1 batch is transactional: only the winning insert creates a snapshot.
    return results[0].meta.changes === 1;
}

async function updateWatchAfterFetch(
    db: D1Database,
    row: WatchRow,
    payload: NormalizedPayload,
    now: string,
    defer?: DeferredWrites,
): Promise<boolean> {
    const storedChanged = row.hash !== payload.hash;
    const newCheckCount = row.check_count + 1;

    if (!storedChanged) {
        await writeBatch(db, [sql(
                `UPDATE watches
                 SET
                    final_url = ?,
                    raw_hash = ?,
                    etag = ?,
                    last_modified = ?,
                    checked_at = ?,
                    check_count = ?,
                    content_kind = ?,
                    normalizer_version = ?
                 WHERE watch_id = ?`,
            )
            .bind(
                payload.final_url,
                payload.raw_hash,
                payload.etag,
                payload.last_modified,
                now,
                newCheckCount,
                payload.content_kind,
                NORMALIZER_VERSION,
                row.watch_id,
            )], defer);

        return false;
    }

    const stored = storedContent(payload.normalized);

    await writeBatch(db, [
        sql(
            `UPDATE watches
             SET
                final_url = ?,
                content_kind = ?,
                hash = ?,
                raw_hash = ?,
                normalized_content = ?,
                content_truncated = ?,
                etag = ?,
                last_modified = ?,
                updated_at = ?,
                checked_at = ?,
                check_count = ?,
                normalizer_version = ?
             WHERE watch_id = ?`,
        ).bind(
            payload.final_url,
            payload.content_kind,
            payload.hash,
            payload.raw_hash,
            stored.value,
            stored.truncated ? 1 : 0,
            payload.etag,
            payload.last_modified,
            now,
            now,
            newCheckCount,
            NORMALIZER_VERSION,
            row.watch_id,
        ),
        sql(
            `INSERT INTO watch_snapshots (
                watch_id,
                hash,
                raw_hash,
                normalized_content,
                content_truncated,
                content_kind,
                created_at,
                normalizer_version
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
            row.watch_id,
            payload.hash,
            payload.raw_hash,
            stored.value,
            stored.truncated ? 1 : 0,
            payload.content_kind,
            now,
            NORMALIZER_VERSION,
        ),
    ], defer);

    await pruneSnapshots(db, row.watch_id, defer);

    return true;
}

async function markRevalidated(
    db: D1Database,
    row: WatchRow,
    now: string,
    defer?: DeferredWrites,
): Promise<void> {
    await writeBatch(db, [sql(
            `UPDATE watches
             SET
                checked_at = ?,
                check_count = ?
             WHERE watch_id = ?`,
        )
        .bind(
            now,
            row.check_count + 1,
            row.watch_id,
        )], defer);
}

async function pruneSnapshots(
    db: D1Database,
    watchId: string,
    defer?: DeferredWrites,
): Promise<void> {
    await writeBatch(db, [sql(
            `DELETE FROM watch_snapshots
             WHERE watch_id = ?
               AND id NOT IN (
                   SELECT id
                   FROM watch_snapshots
                   WHERE watch_id = ?
                   ORDER BY id DESC
                   LIMIT ?
               )`,
        )
        .bind(
            watchId,
            watchId,
            MAX_SNAPSHOTS_PER_WATCH,
        )], defer);
}

async function findSnapshotByHash(
    db: D1Database,
    watchId: string,
    hash: string,
): Promise<WatchSnapshotRow | null> {
    return db
        .prepare(
            `SELECT
                id,
                watch_id,
                hash,
                raw_hash,
                normalized_content,
                content_truncated,
                content_kind,
                created_at,
                normalizer_version
             FROM watch_snapshots
             WHERE watch_id = ?
               AND hash = ?
             ORDER BY id DESC
             LIMIT 1`,
        )
        .bind(watchId, hash)
        .first<WatchSnapshotRow>();
}

async function buildDiffForComparison(
    db: D1Database,
    row: WatchRow | null,
    previousHash: string | null,
    currentHash: string,
    currentContent: string,
    currentTruncated: boolean,
) {
    if (!previousHash || previousHash === currentHash) {
        return {
            available: true,
            changed: false,
            change_ratio: 0,
            removed_excerpt: "",
            added_excerpt: "",
            excerpt_truncated: false,
            content_truncated:
                currentTruncated,
        };
    }

    if (!row) {
        return {
            available: false,
            reason:
                "previous_content_unavailable",
        };
    }

    let previousContent: string | null = null;
    let previousTruncated = false;

    if (row.hash === previousHash) {
        previousContent = row.normalized_content;
        previousTruncated =
            row.content_truncated === 1;
    } else {
        const snapshot =
            await findSnapshotByHash(
                db,
                row.watch_id,
                previousHash,
            );

        if (snapshot) {
            previousContent =
                snapshot.normalized_content;
            previousTruncated =
                snapshot.content_truncated === 1;
        }
    }

    if (previousContent === null) {
        return {
            available: false,
            reason:
                "previous_content_unavailable",
        };
    }

    return {
        ...buildTextDiff(
            previousContent,
            currentContent,
        ),
        content_truncated:
            previousTruncated ||
            currentTruncated,
    };
}

function validateContentConfiguration(
    kind: ContentKind,
    config: WatchConfig,
): void {
    if (
        kind !== "html" &&
        (
            config.selector ||
            config.ignore_selectors.length > 0
        )
    ) {
        throw new Fresh402InputError(
            "html_scope_requires_html",
            "selector and ignore_selectors can only be used with HTML resources.",
            422,
        );
    }

    if (
        kind !== "json" &&
        config.ignore_json_paths.length > 0
    ) {
        throw new Fresh402InputError(
            "json_paths_require_json",
            "ignore_json_paths can only be used with JSON resources.",
            422,
        );
    }
}

function contentKindFromType(
    contentType: string,
): ContentKind | null {
    const normalized =
        contentType
            .split(";")[0]
            .trim()
            .toLowerCase();

    if (
        normalized === "text/html" ||
        normalized === "application/xhtml+xml"
    ) {
        return "html";
    }

    if (
        normalized === "application/json" ||
        normalized.endsWith("+json")
    ) {
        return "json";
    }

    if (
        normalized.startsWith("text/") ||
        normalized === "application/xml" ||
        normalized.endsWith("+xml")
    ) {
        return "text";
    }

    return null;
}

async function normalizeResponse(
    response: Response,
    config: WatchConfig,
    body: string,
    finalUrl: string,
): Promise<NormalizedPayload> {
    const contentType =
        response.headers.get("content-type") ?? "";

    const kind =
        contentKindFromType(contentType);

    if (!kind) {
        throw new Fresh402InputError(
            "unsupported_content_type",
            `Unsupported content type: ${contentType || "unknown"}`,
            415,
        );
    }

    validateContentConfiguration(kind, config);

    let normalized: string;

    if (kind === "html") {
        normalized =
            await normalizeHtml(body, config);
    } else if (kind === "json") {
        let parsed: unknown;

        try {
            parsed = JSON.parse(body);
        } catch {
            throw new Fresh402InputError(
                "invalid_upstream_json",
                "The target declares JSON but returned invalid JSON.",
                502,
            );
        }

        normalized =
            stableJsonStringify(
                applyJsonIgnorePaths(
                    parsed,
                    config.ignore_json_paths,
                ),
            );
    } else {
        normalized =
            normalizeWhitespace(body);
    }

    const rawNormalized =
        normalizeWhitespace(body);

    return {
        content_kind: kind,
        normalized,
        raw_normalized: rawNormalized,
        hash: await sha256(normalized),
        raw_hash:
            await sha256(rawNormalized),
        etag:
            response.headers.get("etag"),
        last_modified:
            response.headers.get(
                "last-modified",
            ),
        final_url:
            finalUrl,
    };
}

function ageSeconds(iso: string): number {
    const timestamp = Date.parse(iso);

    if (!Number.isFinite(timestamp)) {
        return Number.POSITIVE_INFINITY;
    }

    return Math.max(
        0,
        (Date.now() - timestamp) / 1000,
    );
}

function publicWatchConfig(
    watchId: string,
    config: WatchConfig,
) {
    return {
        watch_id: watchId,
        url: config.url,
        selector: config.selector,
        ignore_selectors:
            config.ignore_selectors,
        ignore_json_paths:
            config.ignore_json_paths,
    };
}

async function parseRequestBody(
    request: Request,
): Promise<Record<string, unknown>> {
    const bytes = await readRequestBody(request);
    try {
        const body =
            JSON.parse(new TextDecoder().decode(bytes)) as unknown;

        if (
            !body ||
            typeof body !== "object" ||
            Array.isArray(body)
        ) {
            throw new Error(
                "Body must be an object.",
            );
        }

        return body as Record<string, unknown>;
    } catch {
        throw new Fresh402InputError(
            "invalid_json",
            "Request body must be a valid JSON object.",
        );
    }
}

function existingRegistration(existing: WatchRow, concurrent = false): Response {
    return json({
        ...publicWatchConfig(existing.watch_id, configFromWatch(existing)),
        created: false,
        baseline_created: false,
        hash: existing.hash,
        content_kind: existing.content_kind,
        first_seen_at: existing.created_at,
        checked_at: existing.checked_at,
        normalizer_version: existing.normalizer_version,
        note: concurrent
            ? "Concurrent registration returned the stored baseline. Use the paid check endpoint to refresh it."
            : "Existing baseline returned without refetching. Use the paid check endpoint to refresh it.",
    });
}

async function limitNewRegistration(env: FreshnessEnv, url: string): Promise<Response | null> {
    try {
        // The core path also serves MCP. Keys cannot be reset by changing selectors,
        // URL paths/queries, caller-supplied headers or transport.
        const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
        const target = await env.REGISTER_TARGET_LIMITER.limit({ key: `fresh402:register:host:${host}` });
        const allowed = target.success && (await env.REGISTER_GLOBAL_LIMITER.limit({
            key: "fresh402:register:all",
        })).success;
        if (allowed) return null;
        const response = json({
            error: "registration_rate_limited",
            message: "Too many new free registrations. Retry in 60 seconds.",
        }, 429);
        response.headers.set("retry-after", "60");
        return response;
    } catch {
        // Missing/unavailable bindings must never silently enable unbounded fetches.
        return json({
            error: "registration_unavailable",
            message: "Free registration is temporarily unavailable. Try again later.",
        }, 503);
    }
}

async function handleRegister(
    request: Request,
    env: FreshnessEnv,
    allowPrivate: boolean,
): Promise<Response> {
    const body =
        await parseRequestBody(request);

    const config =
        parseUrlConfig(
            body,
            allowPrivate,
        );

    const watchId =
        await watchIdForConfig(config);

    const existing =
        await getWatch(
            env.DB,
            watchId,
        );

    if (existing) {
        return existingRegistration(existing);
    }

    const limited = await limitNewRegistration(env, config.url);
    if (limited) return limited;

    // Existing baselines return above. Only a new external fetch consumes the
    // global/free budget or reserves a Container admission slot.
    if(env.beforeRegisterFetch)env={...env,...await env.beforeRegisterFetch()};

    const startedAt = Date.now();
    const { response, body: responseBody, finalUrl } =
        await fetchTarget(
            new URL(config.url),
            allowPrivate,
            undefined,
            env.TARGET_HOST_ALLOWLIST,
            gatewayFromBindings(env),
            env.requestSignal ?? request.signal,
        );

    if (!response.ok) {
        return json(
            {
                error: "upstream_error",
                message:
                    `Target returned HTTP ${response.status}.`,
                status: response.status,
            },
            502,
        );
    }

    const payload =
        await normalizeResponse(
            response,
            config,
            responseBody,
            finalUrl,
        );

    const now =
        new Date().toISOString();

    const created = await saveNewWatch(
        env.DB,
        watchId,
        config,
        payload,
        now,
    );

    if (!created) {
        const winner = await getWatch(env.DB, watchId);
        if (!winner) throw new Error("Concurrent baseline could not be loaded.");
        return existingRegistration(winner, true);
    }

    return json({
        ...publicWatchConfig(
            watchId,
            config,
        ),
        created: true,
        baseline_created: true,
        hash: payload.hash,
        raw_hash: payload.raw_hash,
        content_kind:
            payload.content_kind,
        final_url:
            payload.final_url,
        content_length:
            payload.normalized.length,
        snapshot_truncated:
            payload.normalized.length >
            MAX_STORED_CONTENT,
        fetch_time_ms:
            Date.now() - startedAt,
        checked_at: now,
        normalizer_version:
            NORMALIZER_VERSION,
        next_step:
            "Call POST /v1/check or MCP fresh402_check with this watch_id. Checks cost $0.005 USDC.",
    });
}

async function resolveCheckTarget(
    body: Record<string, unknown>,
    env: FreshnessEnv,
    allowPrivate: boolean,
): Promise<{
    watch_id: string;
    config: WatchConfig;
    existing: WatchRow | null;
}> {
    const hasWatchId =
        body.watch_id !== undefined &&
        body.watch_id !== null;

    const hasUrl =
        body.url !== undefined &&
        body.url !== null;

    if (hasWatchId && hasUrl) {
        throw new Fresh402InputError(
            "ambiguous_target",
            "Provide either watch_id or url, not both.",
        );
    }

    if (hasWatchId) {
        if (
            typeof body.watch_id !== "string" ||
            !/^w_[a-f0-9]{32}$/.test(
                body.watch_id,
            )
        ) {
            throw new Fresh402InputError(
                "invalid_watch_id",
                "watch_id is invalid.",
            );
        }

        if (
            body.selector !== undefined ||
            body.ignore_selectors !== undefined ||
            body.ignore_json_paths !== undefined
        ) {
            throw new Fresh402InputError(
                "watch_config_conflict",
                "When watch_id is supplied, selector and ignore rules come from the stored watch and must not be supplied again.",
            );
        }

        const existing =
            await getWatch(
                env.DB,
                body.watch_id,
            );

        if (!existing) {
            throw new Fresh402InputError(
                "watch_not_found",
                "Unknown watch_id. Register the URL first or call check with a URL and previous_hash.",
                404,
            );
        }

        return {
            watch_id:
                existing.watch_id,
            config:
                configFromWatch(existing),
            existing,
        };
    }

    if (!hasUrl) {
        throw new Fresh402InputError(
            "missing_target",
            "Provide either watch_id or url.",
        );
    }

    const config =
        parseUrlConfig(
            body,
            allowPrivate,
        );

    const watchId =
        await watchIdForConfig(config);

    return {
        watch_id: watchId,
        config,
        existing:
            await getWatch(
                env.DB,
                watchId,
            ),
    };
}

function comparisonSource(
    previousHash: string | null,
    existing: WatchRow | null,
): "caller_hash" | "stored_watch" | "none" {
    if (previousHash) {
        return "caller_hash";
    }

    if (existing) {
        return "stored_watch";
    }

    return "none";
}

async function makeCachedCheckResponse(
    env: FreshnessEnv,
    row: WatchRow,
    config: WatchConfig,
    previousHash: string | null,
    includeDiff: boolean,
    maxAgeSeconds: number,
) {
    const comparisonHash =
        previousHash ?? row.hash;

    const changed =
        comparisonHash !== row.hash;

    const diff =
        includeDiff && changed
            ? await buildDiffForComparison(
                  env.DB,
                  row,
                  comparisonHash,
                  row.hash,
                  row.normalized_content,
                  row.content_truncated === 1,
              )
            : undefined;

    return {
        ...publicWatchConfig(
            row.watch_id,
            config,
        ),
        final_url: row.final_url,
        first_seen: false,
        baseline_created: false,
        rebaselined: false,
        changed,
        raw_changed: false,
        noise_detected: false,
        comparison_source:
            comparisonSource(
                previousHash,
                row,
            ),
        previous_hash:
            comparisonHash,
        hash: row.hash,
        raw_hash: row.raw_hash,
        content_kind:
            row.content_kind,
        check_count:
            row.check_count,
        first_seen_at:
            row.created_at,
        snapshot_saved: false,
        snapshot_truncated:
            row.content_truncated === 1,
        normalizer_version:
            row.normalizer_version,
        cached: true,
        cache_status: "fresh",
        network_fetched: false,
        max_age_seconds:
            maxAgeSeconds,
        age_seconds:
            Math.floor(
                ageSeconds(row.checked_at),
            ),
        checked_at:
            row.checked_at,
        ...(diff
            ? { diff }
            : {}),
    };
}

async function handleCheck(
    request: Request,
    env: FreshnessEnv,
    allowPrivate: boolean,
): Promise<Response> {
    const body =
        await parseRequestBody(request);

    const previousHash =
        parsePreviousHash(
            body.previous_hash,
        );

    const maxAgeSeconds =
        parseMaxAge(
            body.max_age_seconds,
        );

    const includeDiff =
        parseIncludeDiff(
            body.include_diff,
        );

    const resolved =
        await resolveCheckTarget(
            body,
            env,
            allowPrivate,
        );

    let existing =
        resolved.existing;

    const config =
        resolved.config;

    const watchId =
        resolved.watch_id;

    if (
        existing &&
        maxAgeSeconds > 0 &&
        ageSeconds(existing.checked_at) <=
            maxAgeSeconds
    ) {
        return json(
            await makeCachedCheckResponse(
                env,
                existing,
                config,
                previousHash,
                includeDiff,
                maxAgeSeconds,
            ),
        );
    }

    const startedAt = Date.now();

    const { response, body: responseBody, finalUrl } =
        await fetchTarget(
            new URL(config.url),
            allowPrivate,
            existing
                ? {
                      etag: existing.etag,
                      last_modified:
                          existing.last_modified,
                      origin: new URL(existing.final_url).origin,
                  }
                : undefined,
            env.TARGET_HOST_ALLOWLIST,
            gatewayFromBindings(env),
            env.requestSignal ?? request.signal,
        );

    const now =
        new Date().toISOString();

    if (
        response.status === 304 &&
        existing
    ) {
        await markRevalidated(
            env.DB,
            existing,
            now,
            env.deferWrites,
        );

        const comparisonHash =
            previousHash ??
            existing.hash;

        const changed =
            comparisonHash !==
            existing.hash;

        const diff =
            includeDiff && changed
                ? await buildDiffForComparison(
                      env.DB,
                      existing,
                      comparisonHash,
                      existing.hash,
                      existing.normalized_content,
                      existing.content_truncated === 1,
                  )
                : undefined;

        return json({
            ...publicWatchConfig(
                watchId,
                config,
            ),
            final_url:
                existing.final_url,
            first_seen: false,
            baseline_created: false,
            rebaselined: false,
            changed,
            raw_changed: false,
            noise_detected: false,
            comparison_source:
                comparisonSource(
                    previousHash,
                    existing,
                ),
            previous_hash:
                comparisonHash,
            hash: existing.hash,
            raw_hash:
                existing.raw_hash,
            content_kind:
                existing.content_kind,
            check_count:
                existing.check_count + 1,
            first_seen_at:
                existing.created_at,
            snapshot_saved: false,
            snapshot_truncated:
                existing.content_truncated === 1,
            normalizer_version:
                existing.normalizer_version,
            cached: false,
            cache_status:
                "revalidated_not_modified",
            network_fetched: true,
            upstream_not_modified: true,
            fetch_time_ms:
                Date.now() - startedAt,
            checked_at: now,
            ...(diff
                ? { diff }
                : {}),
        });
    }

    if (!response.ok) {
        return json(
            {
                error: "upstream_error",
                message:
                    `Target returned HTTP ${response.status}.`,
                status:
                    response.status,
            },
            502,
        );
    }

    const payload =
        await normalizeResponse(
            response,
            config,
            responseBody,
            finalUrl,
        );

    const baselineCreated = !existing && await saveNewWatch(
        env.DB, watchId, config, payload, now, env.deferWrites,
    );
    if (!existing && !baselineCreated) {
        existing = await getWatch(env.DB, watchId);
        if (!existing) throw new Error("Concurrent baseline could not be loaded.");
        resolved.existing = existing;
    }

    const comparisonHash =
        previousHash ??
        existing?.hash ??
        null;

    const changed =
        comparisonHash
            ? comparisonHash !==
              payload.hash
            : null;

    const rawChanged =
        existing?.raw_hash !== null &&
        existing?.raw_hash !== undefined
            ? existing.raw_hash !==
              payload.raw_hash
            : null;

    const noiseDetected =
        rawChanged === true &&
        existing !== null &&
        existing.hash ===
            payload.hash;

    const currentStored =
        storedContent(
            payload.normalized,
        );

    const diff =
        includeDiff &&
        changed === true
            ? await buildDiffForComparison(
                  env.DB,
                  existing,
                  comparisonHash,
                  payload.hash,
                  currentStored.value,
                  currentStored.truncated,
              )
            : undefined;

    let snapshotSaved = false;
    let checkCount = 1;
    let firstSeenAt = now;

    if (baselineCreated) {
        snapshotSaved = true;
    } else if (existing) {
        snapshotSaved =
            await updateWatchAfterFetch(
                env.DB,
                existing,
                payload,
                now,
                env.deferWrites,
            );

        checkCount =
            existing.check_count + 1;

        firstSeenAt =
            existing.created_at;
    }

    if (!existing) {
        existing =
            await getWatch(
                env.DB,
                watchId,
            );
    }

    return json({
        ...publicWatchConfig(
            watchId,
            config,
        ),
        final_url:
            payload.final_url,
        first_seen:
            baselineCreated,
        baseline_created:
            baselineCreated,
        rebaselined: false,
        changed,
        raw_changed:
            rawChanged,
        noise_detected:
            noiseDetected,
        comparison_source:
            comparisonSource(
                previousHash,
                resolved.existing,
            ),
        previous_hash:
            comparisonHash,
        hash: payload.hash,
        previous_raw_hash:
            resolved.existing?.raw_hash ??
            null,
        raw_hash:
            payload.raw_hash,
        content_kind:
            payload.content_kind,
        check_count:
            checkCount,
        first_seen_at:
            firstSeenAt,
        snapshot_saved:
            snapshotSaved,
        snapshot_truncated:
            currentStored.truncated,
        normalizer_version:
            NORMALIZER_VERSION,
        content_length:
            payload.normalized.length,
        cached: false,
        cache_status: "miss",
        network_fetched: true,
        fetch_time_ms:
            Date.now() - startedAt,
        checked_at: now,
        ...(diff
            ? { diff }
            : {}),
        ...(changed === null
            ? {
                  note:
                      "No comparable baseline was supplied. This paid call created the baseline; use the free register endpoint before first check when possible.",
              }
            : {}),
    });
}

async function resolveHistoryWatch(
    requestUrl: URL,
    db: D1Database,
): Promise<{
    watch: WatchRow | null;
    watch_id: string | null;
    legacy_url: string | null;
}> {
    const watchId =
        requestUrl.searchParams.get(
            "watch_id",
        );

    const targetUrl =
        requestUrl.searchParams.get(
            "url",
        );

    if (watchId) {
        return {
            watch:
                await getWatch(
                    db,
                    watchId,
                ),
            watch_id:
                watchId,
            legacy_url:
                null,
        };
    }

    if (!targetUrl) {
        throw new Fresh402InputError(
            "missing_target",
            "Provide ?watch_id=w_... or ?url=https://example.com",
        );
    }

    let target: URL;

    try {
        target = new URL(targetUrl);
    } catch {
        throw new Fresh402InputError(
            "invalid_url",
            "The supplied URL is invalid.",
        );
    }

    const config: WatchConfig = {
        url: canonicalizeUrl(target),
        selector: null,
        ignore_selectors: [],
        ignore_json_paths: [],
    };

    const defaultWatchId =
        await watchIdForConfig(
            config,
        );

    return {
        watch:
            await getWatch(
                db,
                defaultWatchId,
            ),
        watch_id:
            defaultWatchId,
        legacy_url:
            config.url,
    };
}

async function handleHistory(
    requestUrl: URL,
    env: FreshnessEnv,
): Promise<Response> {
    const resolved =
        await resolveHistoryWatch(
            requestUrl,
            env.DB,
        );

    if (resolved.watch) {
        const result =
            await env.DB
                .prepare(
                    `SELECT
                        id,
                        watch_id,
                        hash,
                        raw_hash,
                        content_kind,
                        content_truncated,
                        created_at,
                        normalizer_version
                     FROM watch_snapshots
                     WHERE watch_id = ?
                     ORDER BY id DESC
                     LIMIT 50`,
                )
                .bind(
                    resolved.watch.watch_id,
                )
                .all();

        return json({
            watch_id:
                resolved.watch.watch_id,
            url:
                resolved.watch.url,
            normalizer_version:
                resolved.watch.normalizer_version,
            count:
                result.results.length,
            snapshots:
                result.results,
        });
    }

    if (resolved.legacy_url) {
        const legacy =
            await env.DB
                .prepare(
                    `SELECT
                        id,
                        url,
                        hash,
                        raw_hash,
                        created_at,
                        normalizer_version
                     FROM snapshots
                     WHERE url = ?
                       AND normalizer_version = ?
                     ORDER BY id DESC
                     LIMIT 50`,
                )
                .bind(
                    resolved.legacy_url,
                    NORMALIZER_VERSION,
                )
                .all();

        return json({
            watch_id:
                resolved.watch_id,
            url:
                resolved.legacy_url,
            source: "legacy",
            normalizer_version:
                NORMALIZER_VERSION,
            count:
                legacy.results.length,
            snapshots:
                legacy.results,
        });
    }

    return json(
        {
            error: "watch_not_found",
            message:
                "No watch exists for this target.",
        },
        404,
    );
}

async function handleDiff(
    requestUrl: URL,
    env: FreshnessEnv,
): Promise<Response> {
    const resolved =
        await resolveHistoryWatch(
            requestUrl,
            env.DB,
        );

    if (resolved.watch) {
        const result =
            await env.DB
                .prepare(
                    `SELECT
                        id,
                        watch_id,
                        hash,
                        raw_hash,
                        normalized_content,
                        content_truncated,
                        content_kind,
                        created_at,
                        normalizer_version
                     FROM watch_snapshots
                     WHERE watch_id = ?
                     ORDER BY id DESC
                     LIMIT 2`,
                )
                .bind(
                    resolved.watch.watch_id,
                )
                .all<WatchSnapshotRow>();

        if (result.results.length < 2) {
            return json({
                watch_id:
                    resolved.watch.watch_id,
                url:
                    resolved.watch.url,
                changed: false,
                message:
                    "At least two comparable snapshots are required.",
                snapshots_available:
                    result.results.length,
                normalizer_version:
                    resolved.watch.normalizer_version,
            });
        }

        const after =
            result.results[0];

        const before =
            result.results[1];

        return json({
            watch_id:
                resolved.watch.watch_id,
            url:
                resolved.watch.url,
            changed:
                before.hash !==
                after.hash,
            normalizer_version:
                resolved.watch.normalizer_version,
            from: {
                snapshot_id:
                    before.id,
                hash:
                    before.hash,
                created_at:
                    before.created_at,
            },
            to: {
                snapshot_id:
                    after.id,
                hash:
                    after.hash,
                created_at:
                    after.created_at,
            },
            diff: {
                ...buildTextDiff(
                    before.normalized_content,
                    after.normalized_content,
                ),
                content_truncated:
                    before.content_truncated === 1 ||
                    after.content_truncated === 1,
            },
        });
    }

    if (!resolved.legacy_url) {
        return json(
            {
                error: "watch_not_found",
            },
            404,
        );
    }

    const legacy =
        await env.DB
            .prepare(
                `SELECT
                    id,
                    hash,
                    raw_hash,
                    normalized_content,
                    created_at,
                    normalizer_version
                 FROM snapshots
                 WHERE url = ?
                   AND normalizer_version = ?
                 ORDER BY id DESC
                 LIMIT 2`,
            )
            .bind(
                resolved.legacy_url,
                NORMALIZER_VERSION,
            )
            .all<LegacySnapshotRow>();

    if (legacy.results.length < 2) {
        return json({
            watch_id:
                resolved.watch_id,
            url:
                resolved.legacy_url,
            source: "legacy",
            changed: false,
            message:
                "At least two comparable snapshots are required.",
            snapshots_available:
                legacy.results.length,
            normalizer_version:
                NORMALIZER_VERSION,
        });
    }

    const after =
        legacy.results[0];

    const before =
        legacy.results[1];

    return json({
        watch_id:
            resolved.watch_id,
        url:
            resolved.legacy_url,
        source: "legacy",
        changed:
            before.hash !==
            after.hash,
        normalizer_version:
            NORMALIZER_VERSION,
        from: {
            snapshot_id:
                before.id,
            hash:
                before.hash,
            created_at:
                before.created_at,
        },
        to: {
            snapshot_id:
                after.id,
            hash:
                after.hash,
            created_at:
                after.created_at,
        },
        diff:
            buildTextDiff(
                before.normalized_content,
                after.normalized_content,
            ),
    });
}

export async function handleCoreRequest(
    request: Request,
    env: FreshnessEnv,
): Promise<Response> {
    const requestUrl =
        new URL(request.url);

    const allowPrivate = false;

    try {
        if (
            request.method === "GET" &&
            requestUrl.pathname === "/"
        ) {
            return json({
                name: "Fresh402",
                status: "ok",
                version:
                    FRESH402_VERSION,
                normalizer_version:
                    NORMALIZER_VERSION,
                pricing: {
                    register:
                        "free",
                    check:
                        "$0.005 USDC",
                    extract: "$0.01 USDC",
                    smart_diff: "$0.015 USDC",
                },
                endpoints: {
                    extract: "POST /v2/extract",
                    smart_diff: "POST /v2/smart-diff",
                    openapi: "GET /openapi.json",
                    register:
                        "POST /v1/register",
                    check:
                        "POST /v1/check",
                    history:
                        "GET /v1/history?watch_id=w_... or ?url=https://example.com",
                    diff:
                        "GET /v1/diff?watch_id=w_... or ?url=https://example.com",
                    stats:
                        "GET /v1/stats",
                    mcp:
                        "POST /mcp",
                },
                features: [
                    "bounded web extraction without JavaScript",
                    "structural JSON and HTML Smart Diff",
                    "free baseline registration",
                    "persistent watch_id",
                    "caller previous_hash comparison",
                    "HTML selector scoping",
                    "HTML ignore selectors",
                    "canonical JSON monitoring",
                    "JSON Pointer ignore paths with wildcard support",
                    "inline deterministic diff",
                    "shared freshness cache",
                    "ETag and Last-Modified revalidation",
                    "bounded snapshot retention",
                ],
            });
        }

        if (
            request.method === "POST" &&
            requestUrl.pathname ===
                "/v1/register"
        ) {
            return await handleRegister(
                request,
                env,
                allowPrivate,
            );
        }

        if (
            request.method === "POST" &&
            requestUrl.pathname ===
                "/v1/check"
        ) {
            return await handleCheck(
                request,
                env,
                allowPrivate,
            );
        }

        if (
            request.method === "GET" &&
            requestUrl.pathname ===
                "/v1/history"
        ) {
            return await handleHistory(
                requestUrl,
                env,
            );
        }

        if (
            request.method === "GET" &&
            requestUrl.pathname ===
                "/v1/diff"
        ) {
            return await handleDiff(
                requestUrl,
                env,
            );
        }

        return json(
            {
                error: "not_found",
            },
            404,
        );
    } catch (error) {
        console.error("fresh402_core_error", error instanceof Fresh402InputError || error instanceof BodyReadError || error instanceof ServiceError ? error.code : "internal_error");

        if (
            error instanceof
            Fresh402InputError || error instanceof BodyReadError || error instanceof ServiceError
        ) {
            return json(
                {
                    error:
                        error.code,
                    message:
                        error.message,
                },
                error.status,
            );
        }

        if (
            error instanceof
            TargetNotAllowedError
        ) {
            return json(
                {
                    error:
                        "target_not_allowed",
                    message:
                        error.message,
                },
                400,
            );
        }

        return json(
            {
                error:
                    "check_failed",
                message: "Unable to process the target. Retry later.",
            },
            500,
        );
    }
}
