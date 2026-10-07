export const NORMALIZER_VERSION = 2;
export const FRESH402_VERSION = "1.1.0";

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 5_000_000;
const MAX_STORED_CONTENT = 200_000;
const MAX_SNAPSHOTS_PER_WATCH = 20;
const MAX_SELECTOR_LENGTH = 256;
const MAX_IGNORE_RULES = 20;
const MAX_JSON_PATH_LENGTH = 256;
const MAX_CACHE_AGE_SECONDS = 86_400;
const DIFF_EXCERPT_LIMIT = 1_200;

export interface FreshnessEnv {
    DB: D1Database;
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

class TargetNotAllowedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TargetNotAllowedError";
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

async function normalizeHtml(
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
        const output: Record<string, unknown> = {};

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

    if (!(segment in record)) {
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

function isLocalDevelopmentRequest(requestUrl: URL): boolean {
    return (
        requestUrl.hostname === "127.0.0.1" ||
        requestUrl.hostname === "localhost" ||
        requestUrl.hostname === "::1"
    );
}

function isPrivateIpv4(hostname: string): boolean {
    const parts = hostname.split(".").map(Number);

    if (
        parts.length !== 4 ||
        parts.some(
            (part) =>
                !Number.isInteger(part) ||
                part < 0 ||
                part > 255,
        )
    ) {
        return false;
    }

    const [a, b] = parts;

    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;

    return false;
}

function isPrivateHostname(hostname: string): boolean {
    const host = hostname
        .toLowerCase()
        .replace(/^\[/, "")
        .replace(/\]$/, "");

    if (
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        host.endsWith(".internal") ||
        host.endsWith(".lan")
    ) {
        return true;
    }

    if (isPrivateIpv4(host)) {
        return true;
    }

    if (
        host === "::1" ||
        host === "::" ||
        host.startsWith("fc") ||
        host.startsWith("fd") ||
        host.startsWith("fe8") ||
        host.startsWith("fe9") ||
        host.startsWith("fea") ||
        host.startsWith("feb")
    ) {
        return true;
    }

    if (host.startsWith("::ffff:")) {
        return isPrivateIpv4(host.slice(7));
    }

    return false;
}

function validateTarget(
    target: URL,
    allowPrivate: boolean,
): string | null {
    if (
        target.protocol !== "http:" &&
        target.protocol !== "https:"
    ) {
        return "Only HTTP and HTTPS URLs are supported.";
    }

    if (target.username || target.password) {
        return "URLs containing usernames or passwords are not supported.";
    }

    const sensitiveQueryNames = new Set([
        "access_token",
        "api_key",
        "apikey",
        "auth",
        "authorization",
        "token",
        "signature",
        "x-amz-signature",
        "x-goog-signature",
    ]);

    for (const name of target.searchParams.keys()) {
        if (sensitiveQueryNames.has(name.toLowerCase())) {
            return "URLs containing likely credentials in query parameters are not supported.";
        }
    }

    const allowedPorts = new Set([
        "",
        "80",
        "443",
        "8080",
        "8443",
    ]);

    if (!allowPrivate && !allowedPorts.has(target.port)) {
        return "This port is not allowed.";
    }

    if (
        !allowPrivate &&
        isPrivateHostname(target.hostname)
    ) {
        return "Private, local, and internal network targets are not allowed.";
    }

    return null;
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
): Promise<void> {
    const stored = storedContent(payload.normalized);

    await db.batch([
        db.prepare(
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
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
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
        db.prepare(
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
            watchId,
            payload.hash,
            payload.raw_hash,
            stored.value,
            stored.truncated ? 1 : 0,
            payload.content_kind,
            now,
            NORMALIZER_VERSION,
        ),
    ]);
}

async function updateWatchAfterFetch(
    db: D1Database,
    row: WatchRow,
    payload: NormalizedPayload,
    now: string,
): Promise<boolean> {
    const storedChanged = row.hash !== payload.hash;
    const newCheckCount = row.check_count + 1;

    if (!storedChanged) {
        await db
            .prepare(
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
            )
            .run();

        return false;
    }

    const stored = storedContent(payload.normalized);

    await db.batch([
        db.prepare(
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
        db.prepare(
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
    ]);

    await pruneSnapshots(db, row.watch_id);

    return true;
}

async function markRevalidated(
    db: D1Database,
    row: WatchRow,
    now: string,
): Promise<void> {
    await db
        .prepare(
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
        )
        .run();
}

async function pruneSnapshots(
    db: D1Database,
    watchId: string,
): Promise<void> {
    await db
        .prepare(
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
        )
        .run();
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

    const contentLengthHeader =
        response.headers.get("content-length");

    if (
        contentLengthHeader &&
        Number(contentLengthHeader) > MAX_BODY_BYTES
    ) {
        throw new Fresh402InputError(
            "content_too_large",
            `Target content exceeds the ${MAX_BODY_BYTES / 1_000_000} MB limit.`,
            413,
        );
    }

    const body = await response.text();

    if (body.length > MAX_BODY_BYTES) {
        throw new Fresh402InputError(
            "content_too_large",
            `Target content exceeds the ${MAX_BODY_BYTES / 1_000_000} MB limit.`,
            413,
        );
    }

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
            response.url || config.url,
    };
}

async function fetchTarget(
    target: URL,
    allowPrivate: boolean,
    validators?: {
        etag?: string | null;
        last_modified?: string | null;
    },
): Promise<Response> {
    let current = new URL(target.toString());

    for (
        let hop = 0;
        hop <= MAX_REDIRECTS;
        hop++
    ) {
        const validationError =
            validateTarget(current, allowPrivate);

        if (validationError) {
            throw new TargetNotAllowedError(
                validationError,
            );
        }

        const controller =
            new AbortController();

        const timeout =
            setTimeout(() => {
                controller.abort();
            }, 10_000);

        const headers: Record<string, string> = {
            "user-agent": "Fresh402/1.1.0",
            accept:
                "text/html,application/json,text/plain,application/*+json;q=0.9,text/*;q=0.8,*/*;q=0.1",
        };

        if (validators?.etag) {
            headers["if-none-match"] =
                validators.etag;
        }

        if (validators?.last_modified) {
            headers["if-modified-since"] =
                validators.last_modified;
        }

        let response: Response;

        try {
            response = await fetch(
                current.toString(),
                {
                    redirect: "manual",
                    signal: controller.signal,
                    headers,
                },
            );
        } finally {
            clearTimeout(timeout);
        }

        const redirectStatuses =
            new Set([
                301,
                302,
                303,
                307,
                308,
            ]);

        if (
            !redirectStatuses.has(
                response.status,
            )
        ) {
            return response;
        }

        const location =
            response.headers.get("location");

        if (!location) {
            return response;
        }

        if (hop >= MAX_REDIRECTS) {
            throw new TargetNotAllowedError(
                `Too many redirects. Maximum allowed is ${MAX_REDIRECTS}.`,
            );
        }

        const next =
            new URL(location, current);

        if (
            current.protocol === "https:" &&
            next.protocol === "http:"
        ) {
            throw new TargetNotAllowedError(
                "HTTPS to HTTP redirects are not allowed.",
            );
        }

        const nextValidationError =
            validateTarget(
                next,
                allowPrivate,
            );

        if (nextValidationError) {
            throw new TargetNotAllowedError(
                `Redirect target rejected: ${nextValidationError}`,
            );
        }

        current = next;
    }

    throw new TargetNotAllowedError(
        "Redirect limit exceeded.",
    );
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
    try {
        const body =
            await request.json<unknown>();

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
        return json({
            ...publicWatchConfig(
                watchId,
                configFromWatch(existing),
            ),
            created: false,
            baseline_created: false,
            hash: existing.hash,
            content_kind:
                existing.content_kind,
            first_seen_at:
                existing.created_at,
            checked_at:
                existing.checked_at,
            normalizer_version:
                existing.normalizer_version,
            note:
                "Existing baseline returned without refetching. Use the paid check endpoint to refresh it.",
        });
    }

    const startedAt = Date.now();
    const response =
        await fetchTarget(
            new URL(config.url),
            allowPrivate,
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
        );

    const now =
        new Date().toISOString();

    await saveNewWatch(
        env.DB,
        watchId,
        config,
        payload,
        now,
    );

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

    const response =
        await fetchTarget(
            new URL(config.url),
            allowPrivate,
            existing
                ? {
                      etag: existing.etag,
                      last_modified:
                          existing.last_modified,
                  }
                : undefined,
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
        );

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

    if (!existing) {
        await saveNewWatch(
            env.DB,
            watchId,
            config,
            payload,
            now,
        );

        snapshotSaved = true;
    } else {
        snapshotSaved =
            await updateWatchAfterFetch(
                env.DB,
                existing,
                payload,
                now,
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
            firstSeenAt === now,
        baseline_created:
            firstSeenAt === now,
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

    const allowPrivate =
        isLocalDevelopmentRequest(
            requestUrl,
        );

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
                },
                endpoints: {
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
        console.error(error);

        if (
            error instanceof
            Fresh402InputError
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
                message:
                    error instanceof Error
                        ? error.message
                        : "Unable to process the target.",
            },
            500,
        );
    }
}

