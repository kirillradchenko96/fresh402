# Security and responsible use

Fresh402's hosted backend, secrets, payment proofs and customer financial records are private. Public client documentation does not grant access to those records.

Use public HTTPS sources only. Do not submit private content or credentials in URLs. The service uses bounded fetching, public-peer and TLS checks, redirect validation, finite capacity and payment recovery. Read [operational limitations](https://fresh402.com/security) and the [live API contract](https://fresh402.kirilllabs.workers.dev/openapi.json).

Support and security reports: fresh402@proton.me. Describe the reproducible issue with redacted evidence. Never include wallet seeds, private keys, API keys, payment signatures, private recovery tokens or sensitive page contents in a public issue or support request.

An HTTP402 challenge does not establish payment or revenue. Preserve original payment evidence and recover the same operation after uncertainty; never sign a replacement solely because of a timeout. No uptime or complete semantic-security guarantee is implied.
