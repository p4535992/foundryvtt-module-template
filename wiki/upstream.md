# Following upstream development

This project adapts [DFreds Module Template TS](https://github.com/DFreds/dfreds-module-template-ts) as an English JavaScript template. It keeps its own source layout, packaging contract, and release workflow.

The initial source review was recorded on **19 November 2026** against the upstream main branch. upstream.json records the Git blob hash of each reviewed file, its local counterpart, and the reason for retaining or changing its behavior. A blob hash identifies file content; it is not a claim that a moving branch will remain unchanged.

## Compare explicitly

When you choose to contact GitHub to check for changes, run:

```sh
npm run upstream:check
```

The command makes read-only requests to GitHub's contents endpoint for the 26 files listed in the baseline. These cover the entry point, lifecycle hooks, settings, logging, helpers, manifest, shim, build tools, configuration, and release workflows. It compares their content hashes with the recorded values and prints unchanged, changed, or removed. It does not update files or merge upstream code.

An optional GITHUB_TOKEN can be provided for GitHub API rate limits. It is sent only to the fixed GitHub API host and is never printed.

To validate the baseline without accessing the network:

```sh
npm run upstream:check -- --offline
```

Add `--json` for machine-readable comparison output. Exit code 0 means all reviewed files match, 2 means a file changed or was removed, and 1 means the comparison could not complete.

There is no scheduled check, update bot, automatic merge, or automatic release action associated with this command. It does not access pull requests, their reviews or comments, workflow runs, or commit history.

## Review the change before incorporating it

When a reviewed file changes:

1. Read that exact upstream source file and compare it with the previous reviewed content.
2. Decide whether the change applies to this JavaScript template.
3. Implement the relevant local change, retaining deliberate differences.
4. Run the local checks and any Foundry runtime checks affected by the change.
5. Update the file's recorded blob hash, review date, and decision in upstream.json.

Changing a baseline hash records a review decision. Do not update it automatically merely to make the command return success.

## Mapping and deliberate differences

| Upstream area                           | Local approach                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript source and helpers           | JavaScript modules, JSDoc, and Node.js build helpers                                                                                  |
| Separate static and TypeScript trees    | A unified src/ tree with module.json, module.js, lang/, styles/, templates/, assets/, and scripts/                                    |
| Vite ES module build                    | ES module output and Foundry globals, with module files under dist/&lt;module-id&gt;/; TypeScript-only path aliases are omitted       |
| Upstream ZIP name and root layout       | module.zip containing one directory named after the module id                                                                         |
| Tag-triggered draft release             | Separate manual stable/prerelease workflows that validate a selected commit, create its tag, and publish verified assets              |
| GitHub-generated release notes          | Curated version entries from CHANGELOG.md and maintained English installation instructions, preserving unrelated author-written notes |
| Discord and Foundry website publication | Omitted                                                                                                                               |
| Development hot updates                 | Local rebuild and reload behavior documented for this implementation; no claim of identical behavior to every upstream HMR feature    |

Upstream publish.yml remains in the comparison allowlist to track its Discord and Foundry website publication role. Locally, the single release.yml publishes verified GitHub release assets for both stable and prerelease channels; it does not publish to those external destinations.

The upstream compatibility shim is adapted into src/scripts/lib/libwrapper-shim.js. Its Rui Pinheiro MIT notice is retained in THIRD_PARTY_NOTICES.md. The root LICENSE preserves the DFreds MIT notice.

The Pin Cushion repository informed the requested release layout. Its runtime code and dependencies are not included; the package builder and verifier here implement the required behavior independently.

## Action pins

The GitHub workflows pin checkout, Node setup, artifact upload, and artifact download actions to reviewed commit SHAs. Their exact tag references and action metadata were checked on the recorded review date, and the hashes are recorded in upstream.json.

Review action updates explicitly. The upstream comparison command deliberately stays within the DFreds source-file allowlist; it does not silently update action pins or check other services.
