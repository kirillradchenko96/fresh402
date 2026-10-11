import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Workers tests run here; the standalone Node client has its own CI job.
  test: { include: ["test/**/*.spec.ts"] },
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
			miniflare: {
				bindings: { TEST_MIGRATIONS: await readD1Migrations("./migrations") },
			},
		}),
	],
});
