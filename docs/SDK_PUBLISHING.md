# Future SDK releases

The current next prerelease is fresh402-sdk@0.5.0-rc.1 under client-only MIT; latest remains 0.4.0-rc.1. Its archive integrity, clean public-registry installation, exports, twelve-tool discovery and all eleven authenticated quotes were verified. Earlier prereleases remain historical. See [current installation](SDK_PACKAGE.md) and [recorded integrity](SDK_RELEASE.json). No SDK publication is needed for prose changes.

The optional npm-sdk-stage.yml workflow is manual and **does not directly publish a new public version**. It verifies an exact reviewed commit and immutable sdk-v tag descended from public main, runs client/docs checks, packs only public client files and stages the next release. A maintainer must review/promote that stage using npm 2FA. Existing versions cannot be overwritten. No long-lived npm token, backend source, Cloudflare permission or wallet authority is needed.

One-time owner setup before enabling this optional path:

1. Protect the GitHub environment `npm-sdk-release` with an owner reviewer and prevent self-review. Limit it to the main release workflow.
2. In npm settings for **fresh402-sdk**, configure a GitHub Actions trusted publisher for owner `kirillradchenko96`, repository `fresh402`, workflow filename `npm-sdk-stage.yml`, environment `npm-sdk-release`.
3. Permit staged publishing only. Leave direct publishing and dist-tag management disabled unless separately reviewed. Use npm CLI 11.15 or later. Do not add an npm token secret.
4. For a future reviewed version, supply its immutable tag and exact commit SHA through workflow_dispatch, review the package/stage, then promote with 2FA in npm. Verify the public `next` tag, absence of unintended `latest`, registry integrity and clean installation before documenting a release.

This workflow has been prepared, not configured or executed through an npm OIDC trust relationship. Its presence is not evidence that trusted publication is active. The current already-published prerelease must not be republished.
