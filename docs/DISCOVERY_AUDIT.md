# Fresh402 2.0 discovery audit

Verified October 10, 2026 (America/Anchorage), after the authorized discovery compatibility release. This records live validation and catalog results; a payment challenge, an accepted refresh and actual indexing are different outcomes.

## Verified production contract

The [production service](https://fresh402.kirilllabs.workers.dev/) reports **2.0.0**. [OpenAPI](https://fresh402.kirilllabs.workers.dev/openapi.json) has the stable 2.0.0 description, input/output schemas and all three prices. The [x402 manifest](https://fresh402.kirilllabs.workers.dev/.well-known/x402) contains their canonical URLs. [MCP](https://fresh402.kirilllabs.workers.dev/mcp) initialize/tools/list exposes **fresh402_register**, **fresh402_check**, **fresh402_extract** and **fresh402_smart_diff**.

| Product | REST resource | Atomic USDC | Price | Live nonpaying verification |
|---|---|---:|---:|---|
| Register | POST /v1/register | 0 | Free | Schema verified; no new registration performed in this audit |
| Check | POST /v1/check | 5000 | $0.005 | Empty and valid-input POST return 402; CDP valid=true, simulation accepted |
| Extract | POST /v2/extract | 10000 | $0.01 | Empty and valid-input POST return 402; CDP valid=true, simulation accepted |
| Smart Diff | POST /v2/smart-diff | 15000 | $0.015 | Empty and valid-input POST return 402; CDP valid=true, simulation accepted |

The challenges use x402 v2, exact native USDC on Base mainnet, the unchanged recipient and valid POST Bazaar metadata. Unsigned MCP calls to the three paid tools also return correct payment requirements. Discovery performs no target fetch or application-data mutation. Smart Diff requires free registration first; example watch IDs are illustrative and must be replaced with the returned ID. Payment/recovery guidance is in [API.md](API.md) and [MCP.md](MCP.md).

## Resolved probe incompatibility

Before this release, empty paid POST probes could return 400 because required application parameters were validated before the payment challenge. The official CDP validator rejected Extract and Smart Diff, and x402scan omitted Smart Diff.

Unsigned discovery now returns SDK-generated payment requirements when required target parameters are absent. Supplied invalid fields, malformed or oversized bodies, unsafe URLs, unsupported methods and abuse limits still receive their appropriate errors. Signed requests retain full validation, prerequisite checks, verification, capacity admission, settlement and durable recovery. Known-invalid operations are rejected before settlement. This change does not provide free paid execution or bypass payment verification.

After deployment, the official public CDP validator returned **valid=true**, **simulation outcome accepted**, and no failed or advisory checks for all three resources. This is actual external nonpaying validation, not a mocked payment result. No new real payment was made. Historical settled transactions were used only for read-only recovery verification; those tests do not certify a fresh paid execution on the new build.

## Publication and catalog status

**VERIFIED UPDATED** means the result was observed on the public interface. **AWAITING REINDEX** means a previous request or upstream update has not yet appeared downstream. **NOT INDEXED** means the exact resource was absent from the complete result. **PENDING APPLICATION** is distinct from an approved listing.

| Platform / existing listing | Current verified result | Remaining action |
|---|---|---|
| [GitHub](https://github.com/kirillradchenko96/fresh402) | Hosted-service documentation, server.json, four tools and three prices published through docs-only [PR #9](https://github.com/kirillradchenko96/fresh402/pull/9); follow-up [PR #10](https://github.com/kirillradchenko96/fresh402/pull/10) recorded earlier results | Keep unpublished backend fixes private; Draft PR #8 remains unmerged |
| [Official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.kirillradchenko96%2Ffresh402/versions/latest) | **VERIFIED UPDATED**: active latest 2.0.0, Web Intelligence title, all three prices; repository, MCP URL and identifier unchanged | None; historical 1.1.1 retained |
| [Smithery](https://smithery.ai/servers/kirillradchenko96/fresh402) | **AWAITING REINDEX**: public page still lists Register/Check and cached description | Existing October 10 support request pending; no duplicate request. If necessary, owner can use the existing server's supported metadata controls; preserve slug and run.tools alias |
| [Glama domain connector](https://glama.ai/mcp/connectors/dev.workers.kirilllabs.fresh402/fresh402) | Four current tools, correct prices, Healthy and Ownership verified; old Check-only description remains | Existing support ticket **#144004140**, Submitted; await description update |
| [Glama Registry connector](https://glama.ai/mcp/connectors/io.github.kirillradchenko96/fresh402) | **VERIFIED UPDATED**: Web Intelligence title, free baseline and all three prices in description, four tools, Healthy and Ownership verified | No new claim or ticket needed; historical two-tool scoring is not the current tool count |
| [MCPServers.org](https://mcpservers.org/servers/kirillradchenko96/fresh402) | **AWAITING REINDEX**: browser still shows imported 1.1.1 README and Check-only summary | Existing Documentation Request update was accepted earlier; no repeat submission. Verify documentation and summary after provider refresh |
| [MCP Server Finder](https://www.mcpserverfinder.com/search?q=fresh402) | **PENDING APPLICATION**: no approved canonical listing established | October 7 application updated October 10 in the original thread; await review |
| [x402scan](https://www.x402scan.com/server/dfd5b14d-f56d-4d5a-adb0-8511f02537ab) | **VERIFIED UPDATED**: in-place refresh reported **3 registered, 9 public, 2 skipped**; persisted listing has Check, Extract and Smart Diff separately, stable 2.0.0 description, same UUID | None for registration. Compact price badges round small amounts; exact descriptions/challenges specify $0.005 / $0.010 / $0.015 |
| [Coinbase Bazaar merchant view](https://api.cdp.coinbase.com/platform/v2/x402/discovery/merchant?payTo=0x58B4b483fBE31860335eCeB12CCCF4338b251085&limit=100&offset=0) | All three resources pass official validation; merchant and filtered search still return **only /v1/check**, with cached legacy metadata. Extract and Smart Diff **NOT INDEXED** | Genuine authorized production settlement carrying resource and Bazaar extension, followed by index verification; no new payment authorized in this audit |
| [AgentBIT](https://agentbit.app/api/discover?q=fresh402) | Bazaar-derived Check item only; no Extract/Smart Diff | Upstream indexing and mirror refresh. A nullable mirror price does not change live pricing |
| [MCP Harbor](https://ai.mcpharbor.dev/servers/io.github.kirillradchenko96/fresh402) | **AWAITING REINDEX**: public JSON API still reports Registry 1.1.1 and two tools | Await upstream 2.0.0 sync; preserve canonical identity |
| [Agent402 former marketplace](https://marketplace.agent402.app/marketplace) | **NOT SUPPORTED**: earlier verified HTTP 410 retirement response; no established Fresh402 canonical record | No supported listing update at that retired URL |

## Coinbase Bazaar: validation is not indexing

The post-release public merchant API and filtered [search API](https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=Fresh402&payTo=0x58B4b483fBE31860335eCeB12CCCF4338b251085&limit=20) each returned one resource: **/v1/check**. Its price is 5000 atomic USDC, but cached description, service name and schema remain older than the live contract. **/v2/extract** and **/v2/smart-diff** were absent from the complete merchant result (total=1).

CDP documents asynchronous indexing after successful settlement carrying both `resource` and the Bazaar extension. The current SDK-generated extensions include the canonical URL, POST method, input schema/example and output schema/example; examples were checked against their schemas. Public validator acceptance demonstrates eligibility, not settlement or catalog inclusion. No payment was made to force indexing, and no asynchronous registration acceptance is claimed.

A new Extract settlement costs $0.010 and Smart Diff $0.015; refreshing Check through the same documented mechanism would add $0.005, for $0.030 in service amounts. Any such execution requires separate explicit owner payment authorization and subsequent verification of settlement, returned extension status and actual public indexing. There is no known supported nonpaying interface that guarantees settlement-based index registration.

References: [CDP seller discovery](https://docs.cdp.coinbase.com/x402/seller/get-discovered), [public discovery APIs](https://docs.cdp.coinbase.com/x402/buyer/discover-services), [x402scan discovery specification](https://github.com/Merit-Systems/x402scan/blob/main/docs/DISCOVERY.md).

## Communication continuity

Existing Smithery request, Glama ticket #144004140 and Finder application thread were checked, including complete relevant conversations. No new outgoing support email, reminder or duplicate application was sent during remediation. x402scan used the existing server's supported refresh control. No provider escalation is necessary for the resolved empty-probe defect; remaining CDP indexing is a financial authorization boundary, not a failed validator.

## Publication and compatibility safeguards

- Production URLs, MCP tool names, official Registry identity, Glama ownership proof, receiving wallet, Base network, exact prices and payment recovery contract are preserved.
- No schema migration was required for the compatibility release. Discovery checks left application and payment data unchanged.
- New backend code/tests remain in a local private patch. This public update contains only API documentation and this audit; no internal operational report, staging access instructions, secrets or financial evidence is published.
- Public main's legacy source/package remains 1.1.1; the hosted service is 2.0.0. This documentation publication does not relabel legacy source, change repository visibility or merge backend Draft PR #8.
- Provider refreshes must retain established listings and aliases. Confirm exact resource URLs after any future CDP settlement; never infer indexing from HTTP 402 or manufacture commercial metrics.

Official update references: [MCP publisher commands](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/cli/commands.md), [Smithery metadata update](https://smithery.ai/docs/api-reference/servers/update-a-server), [Glama ownership and upstream synchronization](https://glama.ai/mcp/faq). Raw execution evidence remains private.
