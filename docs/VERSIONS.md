# Component versions

Verified November 4, 2026 UTC; versions describe different components and need not match.

| Component | Current version / authority | Distribution and compatibility |
|---|---|---|
| Hosted REST API and MCP server | 3.0.2; live root, MCP initialize | Hosted service; current implementation private |
| OpenAPI | info.version 3.0.2; OpenAPI 3.1.0 | Reviewed public snapshot in openapi.json; refresh only from canonical live OpenAPI |
| Efficiency source SDK | 0.3.6; examples/efficiency/package.json and efficiency-sdk-v0.3.6 | Node>=24 source distribution; existing immutable tag preserved |
| Compiled npm SDK | fresh402-sdk@0.4.0-rc.1 | MIT public client package, Node>=24 ESM/declarations, root/workflows exports; compatible with current API. See [verified package](SDK_RELEASE.json) |
| Framework adapters | 0.1.0; each adapter manifest | Optional source integrations with separately pinned dependencies |
| MCP Registry manifest | 3.0.3; server.json | Metadata-only revision describing API 3.0.2, same Registry identity |
| Website | No independent product SemVer | Presents current hosted API and source-client versions; deployment IDs are infrastructure identities |
| Public repository | Documentation/client Git commits | No fabricated backend release archive; no GitHub Releases currently published |
| Historical application | v1.1.0/v1.1.1 tags | Historical public source only, not a supported production deployment |

Worker deployment UUIDs are not product versions. Directory cards may lag; runtime discovery is authoritative. Documentation maintenance and compatible implementation fixes do not invent an API version bump. Existing tags/releases are not deleted or moved.
