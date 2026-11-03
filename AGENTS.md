# Fresh402 public clients and documentation

This checkout contains client resources, not the hosted backend. Never copy private source, operational reports, credentials, database exports or deployment configuration into this tree. Do not deploy a Worker from this repository. Historical application files remain in existing Git history and version tags.

Use Node.js 24+. Run `npm ci --ignore-scripts`, `npm run check:docs`, `npm test` and `npm run typecheck`. Optional framework adapters have their own package manifests and tests. `npm run check:live` reads public discovery only; it does not fetch a target, sign, buy or execute a product.

Prices and tool schemas come from the reviewed public OpenAPI snapshot. Versions of API, source clients and Registry metadata are distinct; see docs/VERSIONS.md. Run the explicit public publication guard before publishing. Never force-push, change repository visibility, replace existing catalog identities, or initiate payments as documentation validation.
