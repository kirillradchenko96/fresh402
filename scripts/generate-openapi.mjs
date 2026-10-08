import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
await mkdir("dist", { recursive:true });
await build({ entryPoints:["src/discovery.ts"],bundle:true,platform:"node",format:"esm",outfile:"dist/openapi-generator.mjs" });
const { buildOpenApiDocument } = await import(pathToFileURL(resolve("dist/openapi-generator.mjs")).href);
await writeFile("docs/openapi.json",JSON.stringify(buildOpenApiDocument("http://localhost:8787"),null,2)+"\n");
