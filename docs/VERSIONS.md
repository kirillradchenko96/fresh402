# Component versions

Verified November 25, 2026 UTC; versions describe different components and need not match.

| Component | Current version / authority | Distribution and compatibility |
|---|---|---|
| Hosted REST API and MCP server | 3.1.0; live root, MCP initialize | Hosted service; current implementation private |
| OpenAPI | info.version 3.1.0; OpenAPI 3.1.0 | Reviewed public snapshot in openapi.json; refresh only from canonical live OpenAPI |
| Efficiency source SDK | 0.3.6; examples/efficiency/package.json and efficiency-sdk-v0.3.6 | Node>=24 source distribution; existing immutable tag preserved |
| Compiled npm SDK | fresh402-sdk@0.7.0 (`next`); 0.4.0-rc.1 remains `latest` | MIT public client package, Node>=24 ESM/declarations, root/workflows exports; compatible with current API. See [verified package](SDK_RELEASE.json) |
| Framework adapters | 0.1.0; each adapter manifest | Optional source integrations with separately pinned dependencies |
| MCP Registry manifest | 3.1.4 catalog revision; server.json. [Live existing server identity](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.kirillradchenko96%2Ffresh402/versions/latest) | Manifest describing API 3.1.0; official publication/propagation is checked separately, same Registry identity |
| Website | No independent product SemVer | Presents current hosted API and source-client versions; deployment IDs are infrastructure identities |
| Public repository | Documentation/client Git commits | No fabricated backend release archive; no GitHub Releases currently published |
| Historical application | v1.1.0/v1.1.1 tags | Historical public source only, not a supported production deployment |

Worker deployment UUIDs are not product versions. Directory cards may lag; runtime discovery is authoritative. Documentation maintenance and compatible implementation fixes do not invent an API version bump. Existing tags/releases are not deleted or moved.

The [live release definition](https://api.fresh402.com/release.json) records API contract revision 2026-11-25.1, API/MCP 3.1.0, the Registry metadata version at build time and source SDK compatibility 0.3.6. Check the live Registry entry for the current listing. Public quotes advertise Base and Solana x402 and standalone MPP. Solana MPP uses native USDC and a client-paid SOL fee. Prepaid MPP funding remains Base-only.
