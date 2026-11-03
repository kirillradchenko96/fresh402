# Public source and history

This repository contains public client documentation, an OpenAPI snapshot and intentionally public Node source clients. It does not contain the current hosted production backend, deployment configuration, customer database or privileged operational reports. There is no backend deployment command in the current root package.

Client paths under `examples/efficiency` and `examples/knowledge-base`, immutable SDK tags, existing branches and historical release tags are retained. `v1.1.0`, `v1.1.1` and earlier application branches describe historical source, not current production. Removing their files from main does **not** erase publication, clones, forks or cached copies. [Pre-cleanup tree](https://github.com/kirillradchenko96/fresh402/tree/2d83fa3dc13008df75081980484aca724e9bd607). Do not deploy historical code over Fresh402.

`npm ci --ignore-scripts`, `npm run check:docs`, `npm test` and `npm run typecheck` validate clients and public content without production secrets. `npm run check:live` explicitly reads public metadata only. Optional adapters have separate manifests and tests. No npm package or public backend release artifact is implied.

Before publication, run the explicit allowlist/private-file guard. Publish only reviewed files from a client-only checkout; never copy a private working tree or backend branch into this repository. Existing Registry identity and deep-link compatibility guides remain. [Version matrix](VERSIONS.md).
