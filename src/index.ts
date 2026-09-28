interface ResourceRow {
	url: string;
	hash: string;
	normalized_content: string;
	created_at: string;
	updated_at: string;
	check_count: number;
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

function normalizeHtml(html: string): string {
	return html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
		.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/\s+/g, " ")
		.trim();
}

export default {
	async fetch(request, env): Promise<Response> {
		const requestUrl = new URL(request.url);

		if (request.method === "GET" && requestUrl.pathname === "/") {
			return json({
				name: "Fresh402",
				status: "ok",
				version: "0.4.0",
				endpoints: {
					check: "POST /v1/check",
					history: "GET /v1/history?url=https://example.com",
				},
			});
		}

		// HISTORY
		if (request.method === "GET" && requestUrl.pathname === "/v1/history") {
			const targetUrl = requestUrl.searchParams.get("url");

			if (!targetUrl) {
				return json(
					{
						error: "missing_url",
						message: "Provide ?url=https://example.com",
					},
					400,
				);
			}

			const snapshots = await env.DB.prepare(
				`
				SELECT
					id,
					url,
					hash,
					created_at
				FROM snapshots
				WHERE url = ?
				ORDER BY id DESC
				LIMIT 50
				`,
			)
				.bind(targetUrl)
				.all();

			return json({
				url: targetUrl,
				count: snapshots.results.length,
				snapshots: snapshots.results,
			});
		}
		// DIFF BETWEEN THE TWO MOST RECENT SNAPSHOTS
		if (request.method === "GET" && requestUrl.pathname === "/v1/diff") {
			const targetUrl = requestUrl.searchParams.get("url");

			if (!targetUrl) {
				return json(
					{
						error: "missing_url",
						message: "Provide ?url=https://example.com",
					},
					400,
				);
			}

			const result = await env.DB.prepare(
				`
				SELECT
					id,
					hash,
					normalized_content,
					created_at
				FROM snapshots
				WHERE url = ?
				ORDER BY id DESC
				LIMIT 2
				`,
			)
				.bind(targetUrl)
				.all<{
					id: number;
					hash: string;
					normalized_content: string;
					created_at: string;
				}>();

			if (result.results.length < 2) {
				return json(
					{
						url: targetUrl,
						changed: false,
						message: "At least two snapshots are required to generate a diff.",
						snapshots_available: result.results.length,
					},
					200,
				);
			}

			const after = result.results[0];
			const before = result.results[1];

			const oldText = before.normalized_content;
			const newText = after.normalized_content;

			let prefix = 0;

			while (
				prefix < oldText.length &&
				prefix < newText.length &&
				oldText[prefix] === newText[prefix]
			) {
				prefix++;
			}

			let suffix = 0;

			while (
				suffix < oldText.length - prefix &&
				suffix < newText.length - prefix &&
				oldText[oldText.length - 1 - suffix] ===
					newText[newText.length - 1 - suffix]
			) {
				suffix++;
			}

			const removed = oldText.slice(
				prefix,
				oldText.length - suffix,
			);

			const added = newText.slice(
				prefix,
				newText.length - suffix,
			);

			return json({
				url: targetUrl,
				changed: before.hash !== after.hash,

				from: {
					snapshot_id: before.id,
					hash: before.hash,
					created_at: before.created_at,
				},

				to: {
					snapshot_id: after.id,
					hash: after.hash,
					created_at: after.created_at,
				},

				removed,
				added,

				before: oldText,
				after: newText,
			});
		}
		// CHECK
		if (request.method === "POST" && requestUrl.pathname === "/v1/check") {
			let body: { url?: string };

			try {
				body = (await request.json()) as { url?: string };
			} catch {
				return json(
					{
						error: "invalid_json",
						message: "Request body must be valid JSON.",
					},
					400,
				);
			}

			if (!body.url) {
				return json(
					{
						error: "missing_url",
						message: 'Provide a URL, for example: {"url":"https://example.com"}',
					},
					400,
				);
			}

			let target: URL;

			try {
				target = new URL(body.url);
			} catch {
				return json(
					{
						error: "invalid_url",
						message: "The supplied URL is invalid.",
					},
					400,
				);
			}

			if (target.protocol !== "http:" && target.protocol !== "https:") {
				return json(
					{
						error: "unsupported_protocol",
						message: "Only HTTP and HTTPS URLs are supported.",
					},
					400,
				);
			}

			try {
				const startedAt = Date.now();

				const response = await fetch(target.toString(), {
					redirect: "follow",
					headers: {
						"user-agent": "Fresh402/0.3",
					},
				});

				if (!response.ok) {
					return json(
						{
							error: "upstream_error",
							message: `Target returned HTTP ${response.status}.`,
							status: response.status,
						},
						502,
					);
				}

				const contentType = response.headers.get("content-type") ?? "";

				if (
					!contentType.includes("text/html") &&
					!contentType.includes("text/plain")
				) {
					return json(
						{
							error: "unsupported_content_type",
							message: `Unsupported content type: ${contentType || "unknown"}`,
						},
						415,
					);
				}

				const html = await response.text();

				if (html.length > 5_000_000) {
					return json(
						{
							error: "content_too_large",
							message: "Target content exceeds the 5 MB MVP limit.",
						},
						413,
					);
				}

				const normalized = normalizeHtml(html);
				const currentHash = await sha256(normalized);

				const canonicalUrl = target.toString();
				const now = new Date().toISOString();

				const existing = await env.DB.prepare(
					`
					SELECT
						url,
						hash,
						normalized_content,
						created_at,
						updated_at,
						check_count
					FROM resources
					WHERE url = ?
					`,
				)
					.bind(canonicalUrl)
					.first<ResourceRow>();

				// FIRST EVER CHECK
				if (!existing) {
					await env.DB.batch([
						env.DB.prepare(
							`
							INSERT INTO resources (
								url,
								hash,
								normalized_content,
								created_at,
								updated_at,
								check_count
							)
							VALUES (?, ?, ?, ?, ?, 1)
							`,
						).bind(
							canonicalUrl,
							currentHash,
							normalized,
							now,
							now,
						),

						env.DB.prepare(
							`
							INSERT INTO snapshots (
								url,
								hash,
								normalized_content,
								created_at
							)
							VALUES (?, ?, ?, ?)
							`,
						).bind(
							canonicalUrl,
							currentHash,
							normalized,
							now,
						),
					]);

					return json({
						url: canonicalUrl,
						final_url: response.url,
						first_seen: true,
						changed: false,
						hash: currentHash,
						check_count: 1,
						snapshot_saved: true,
						content_length: normalized.length,
						fetch_time_ms: Date.now() - startedAt,
						checked_at: now,
					});
				}

				const changed = existing.hash !== currentHash;
				const newCheckCount = existing.check_count + 1;

				// RESOURCE CHANGED
				if (changed) {
					await env.DB.batch([
						env.DB.prepare(
							`
							UPDATE resources
							SET
								hash = ?,
								normalized_content = ?,
								updated_at = ?,
								check_count = ?
							WHERE url = ?
							`,
						).bind(
							currentHash,
							normalized,
							now,
							newCheckCount,
							canonicalUrl,
						),

						env.DB.prepare(
							`
							INSERT INTO snapshots (
								url,
								hash,
								normalized_content,
								created_at
							)
							VALUES (?, ?, ?, ?)
							`,
						).bind(
							canonicalUrl,
							currentHash,
							normalized,
							now,
						),
					]);
				} else {
					await env.DB.prepare(
						`
						UPDATE resources
						SET
							updated_at = ?,
							check_count = ?
						WHERE url = ?
						`,
					)
						.bind(now, newCheckCount, canonicalUrl)
						.run();
				}

				return json({
					url: canonicalUrl,
					final_url: response.url,
					first_seen: false,
					changed,
					previous_hash: existing.hash,
					hash: currentHash,
					check_count: newCheckCount,
					first_seen_at: existing.created_at,
					snapshot_saved: changed,
					content_length: normalized.length,
					fetch_time_ms: Date.now() - startedAt,
					checked_at: now,
				});
			} catch (error) {
				console.error(error);

				return json(
					{
						error: "check_failed",
						message:
							error instanceof Error
								? error.message
								: "Unable to check the target.",
					},
					500,
				);
			}
		}

		return json(
			{
				error: "not_found",
			},
			404,
		);
	},
} satisfies ExportedHandler<Env>;
