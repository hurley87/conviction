---
name: publish-getconviction-mcp
description: >-
  Publish or release the @getconviction/mcp npm package. Use when the user asks
  to publish MCP, release @getconviction/mcp, bump the MCP package version, cut
  an mcp-v* tag, or update the published package after merging MCP changes.
  Maintainer workflow only — not for operator setup (see packages/mcp/skills).
---

# Publish `@getconviction/mcp`

Merge to `main` does **not** publish npm. Publish is **tag-gated** by
`.github/workflows/publish-mcp.yml` on tags matching `mcp-v*`.

Do not confuse this with `packages/mcp/skills/conviction-mcp-setup` (operator
install / doctor / host config).

## Preconditions

- Changes landed on `main` (or will land via the PR you open before tagging).
- `NPM_TOKEN` repo secret exists (`gh secret list --repo hurley87/conviction`).
- Package name stays `@getconviction/mcp` (npm org `getconviction`; `@conviction`
  is unavailable). Binary name stays `conviction-mcp`.

## Release steps

1. Bump `packages/mcp/package.json` `version` (semver).
2. Update `packages/mcp/CHANGELOG.md` for that version.
3. **Major vs minor/patch** (ADR 0046):
   - Breaking tool contract, schemas, or safety boundaries → **major** bump.
     Update `PACKAGE_MAJOR_PIN` in `packages/mcp/src/setup-contract.ts` and all
     generated host docs/skill pins to `@getconviction/mcp@N`.
   - Compatible fixes/additions within the same major → keep
     `@getconviction/mcp@1` (or current major).
4. Run `npm test --workspace @getconviction/mcp` and fix failures.
5. Open a PR, merge to `main`.
6. From updated `main`, create and push a tag matching the package version:

   ```sh
   git checkout main && git pull origin main
   git tag mcp-vX.Y.Z
   git push origin mcp-vX.Y.Z
   ```

   Example: version `1.0.1` → tag `mcp-v1.0.1`.

7. Confirm **Publish @getconviction/mcp** succeeds in GitHub Actions.
8. Verify: `npm view @getconviction/mcp version`

## Dry run

```sh
gh workflow run "Publish @getconviction/mcp" --repo hurley87/conviction
# default dry_run=true
```

Real publish via workflow_dispatch: `-f dry_run=false` (prefer tag push).

## Do not

- Publish from a feature branch without merging (tag should point at release `main`).
- Rely on merge alone for npm.
- Rename the `conviction-mcp` binary without a planned migration.
- Put publish instructions into the public operator setup skill.
- Commit or paste `NPM_TOKEN` / keystore secrets.

## References

- `.github/workflows/publish-mcp.yml`
- `docs/mcp-compatibility-matrix.md` (post-merge publish)
- `docs/adr/0042-publish-the-mcp-package-as-conviction-mcp.md`
- `docs/adr/0046-generated-host-configs-pin-the-v1-major.md`
- `packages/mcp/CHANGELOG.md`
