import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: { include: ["test/**/*.spec.ts"] },
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
			miniflare: {
				d1Databases: ["MIGRATION_DB", "MIGRATION_BETA_DB"],
				// Explicit closed mock targets; no live target or payment traffic in unit tests.
				bindings: { TARGET_HOST_ALLOWLIST: "public.example,public.example.,quota.example,fdocs.example,other.example,rebind.example,x.example,attacker.example,example.com", TEST_MIGRATIONS: await readD1Migrations("./migrations") },
			},
		}),
	],
});
