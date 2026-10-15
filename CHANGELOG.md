# Hosted service release notes

These notes describe the deployed API, independently of the legacy source package version in this repository. Documentation publication does not deploy infrastructure or merge the backend release PR.

## 2.4.0 - October 14, 2026

- Submitted prepaid purchases reconcile automatically after canonical finalized Base settlement; session expiry and a closed browser do not require a replacement payment.
- Added a lightweight account page and bounded read-only customer polling. Ordinary top-ups preserve existing credentials.
- Check, Extract, Smart Diff and OpenAPI Contract Diff retain their exact prices, REST paths and MCP names. Public signup and purchasing remain closed pending approved terms and final launch gates.
- The successful Starter acceptance purchase was an owner test, not independent customer revenue.

## 2.2.0 - October 12, 2026

- The hosted runtime is 2.2.0; existing REST paths, four MCP tools and the three public x402 prices are unchanged.
- Gateway lifecycle handling passed bounded staging acceptance before release. Capacity and outbound security controls remain enforced.
- OpenAPI Contract Diff and prepaid purchasing/execution remain disabled previews, pending owner-controlled payment acceptance and commercial activation.

## 2.0.0 — October 9, 2026

- Four MCP tools at the existing endpoint: free fresh402_register, Freshness Check (fresh402_check, $0.005 USDC), Web Extract (fresh402_extract, $0.01 USDC) and Smart Diff (fresh402_smart_diff, $0.015 USDC).
- Web Extract returns bounded text, titles, metadata, headings, links and JSON-LD from supported public HTTPS content without executing JavaScript.
- Smart Diff reports structural changes and significance with explainable deterministic rules, without an LLM.
- Durable paid results and private client recovery allow retained results to be retried using identical input/payment/token without another settlement.
- Existing REST paths, MCP URL, Registry identity, Base network, native USDC and the Check price are preserved.
- Public OpenAPI and x402 discovery describe all three paid REST products. robots.txt, sitemap.xml and English llms.txt are live.

This is an on-demand API; continuous monitoring, push alerts, authenticated-site access and browser rendering are not released capabilities. A working payment challenge is distinct from external marketplace indexing; see [the discovery audit](docs/DISCOVERY_AUDIT.md).

## 1.1.1 — historical hosted release

Persistent watch IDs, free baseline registration without free refresh, paid $0.005 Check, HTML/JSON/text normalization, scoped noise filtering, caching, conditional HTTP and deterministic legacy diffs. The existing legacy source and history are retained.
