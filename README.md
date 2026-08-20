# dsh-obsidian

`dsh-obsidian` is a host-only Obsidian integration for DeepSeek Harness (DSH). The main branch targets DSH `0.1.0-rc.8` exactly. The rc.7 implementation is preserved on `legacy/dsh-rc7` and tag `dsh-obsidian-v0.2.0`; the older rc.6 implementation remains on `legacy/dsh-rc6` and tag `v0.1.0`.

The plugin exposes 25 `obsidian_*` tools. Tools and guidance are injected only into the agent whose message matches the configured trigger vocabulary; unrelated sessions do not receive the schemas.

Current release line: `dsh-obsidian-v0.3.0`, built for DSH [`dsh-v0.1.0-rc.8`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.0-rc.8). DSH rc.8 is currently a prerelease published under npm dist-tag `next`, not `latest`.

## Capabilities

**Vault tools, available without Obsidian:**

`obsidian_status` · `obsidian_list` · `obsidian_stat` · `obsidian_read` · `obsidian_write` · `obsidian_edit` · `obsidian_append` · `obsidian_mkdir` · `obsidian_copy` · `obsidian_move` · `obsidian_delete`

The filesystem layer uses vault-relative paths, canonical realpath containment, protected dot directories, atomic writes, serialized appends, SHA-256 revisions, optimistic `if_match` conflicts, binary size limits, cancellation, and an internal trash by default.

**Knowledge and Obsidian semantic tools:**

`obsidian_search` · `obsidian_metadata` · `obsidian_frontmatter_update` · `obsidian_link_resolve` · `obsidian_links` · `obsidian_link_insert`

Search is bounded and paginated. Metadata, frontmatter processing, backlinks, unresolved links, and Obsidian-generated links use the companion's native metadata cache and file manager when available.

**Attachments:**

`obsidian_attachment_add` · `obsidian_attachment_read`

Attachments accept a DSH durable image reference or a vault-relative source path. Host absolute paths, URLs, dot directories, and unbounded binary payloads are rejected.

**Editor and command tools, requiring the companion:**

`obsidian_active` · `obsidian_inline_edit` · `obsidian_open` · `obsidian_commands_list` · `obsidian_command` · `obsidian_notice`

Inline edits carry the active path, document revision, selection offsets, and expected text. A concurrent user edit or note switch returns a conflict instead of overwriting content.

## Install

Install the DSH host package into the profile that actually runs your agent. Use DSH `0.1.0-rc.8` explicitly (`@next` or the exact version); npm's DSH `latest` dist-tag still points to rc.7. DSH supports npm, GitHub, and local link package specs:

```bash
# Preferred: prebuilt tarball attached to the GitHub Release
dsh plugin --profile <profile> add "https://github.com/gxpppp/dsh-obsidian/releases/download/dsh-obsidian-v0.3.0/deepseek-ai-dsh-client-ui-obsidian-0.3.0.tgz"

# Exact GitHub tag; requires a build-capable npm environment because prepare builds from source
dsh plugin --profile <profile> add "github:gxpppp/dsh-obsidian#dsh-obsidian-v0.3.0"

# npm registry, when the package has been published by an account with @deepseek-ai scope access
dsh plugin --profile <profile> add @deepseek-ai/dsh-client-ui-obsidian@0.3.0

# Local development checkout
dsh plugin --profile <profile> add "link:E:\\path\\to\\dsh-obsidian"
```

Replace `<profile>` with the profile you actually boot, such as `web` or `headless`; the profile must use DSH `0.1.0-rc.8`. After adding or upgrading, restart that profile. The exact release tag is `dsh-obsidian-v0.3.0`; rc.7 is archived at `legacy/dsh-rc7` / `dsh-obsidian-v0.2.0`, and rc.6 at `legacy/dsh-rc6` / `v0.1.0`. Do not mix host and companion release lines.

The host package and Obsidian companion are separate artifacts. The package remains host-only: it does not export a browser client and does not install React, REST API, or HTTP server dependencies.

The package is a DSH bundle because `package.json` declares `dsh.bundle.patch` and `cordis.patch.yml` inserts the `ui-obsidian` Cordis row. DSH discovers this metadata during `dsh plugin ... add`; no special Git tag is required for installation.

Install the Obsidian companion into the vault. From a checkout or unpacked host tarball:

```bash
node scripts/install-companion.mjs --vault "C:\\path\\to\\vault"
```

A standalone `dsh-obsidian-bridge-0.3.0.zip` is also attached to the GitHub Release; extract `main.js` and `manifest.json` into `<vault>/.obsidian/plugins/dsh-obsidian-bridge/`, then enable the plugin. Verify release asset hashes against `SHA256SUMS` before installation.

Reload Obsidian after installation. The companion stores its token in its own `data.json`; the host reads it automatically only when the configured `vaultPath` resolves to the same canonical vault.

## Configuration

The `obsidian` namespace is rendered by DSH settings and applies live:

```yaml
obsidian:
  vaultPath: 'C:\\path\\to\\vault'
  mode: auto                 # auto | fs | companion
  companionEndpoint: ''      # optional named-pipe/socket override
  protectedPaths: [.obsidian, .trash, .git, .claudian]
  maxTextBytes: 5242880
  attachmentFolder: Attachments
  maxAttachmentBytes: 26214400
  approvalMode: dangerous    # none | dangerous | writes | all
  commandPolicy: approval    # deny | allowlist | approval
  commandAllowlist: []
  announceToAgent: true
  autoActivate: true
  triggerKeywords: [obsidian, vault, 笔记, 日记, 知识库, 当前笔记, 选中文本]
  enabled: true
```

The schema rejects relative/nonexistent vaults, invalid sizes, unsafe protected-path entries, invalid attachment folders, and an empty command allowlist when allowlist mode is selected.

## Development

Requirements: Node.js `>=22.19.0`, npm `>=11`, TypeScript 5.7, DSH `0.1.0-rc.8`, and an Obsidian desktop API-compatible development environment.

```bash
npm install --ignore-scripts
npm run typecheck
npm run check:companion
npm test
npm run build
npm run install:companion -- --vault "C:\\path\\to\\vault"
npm run smoke:companion -- --vault "C:\\path\\to\\vault"  # requires Obsidian + companion
```

`npm test` compiles the host and tests with `tsconfig.tests.json`, then runs every compiled `*.spec.js` with Node's built-in test runner. The current suite covers 38 tests across activation, DSH IPC, editor context, vault security, revisions, binary limits, cancellation, and path normalization.

## Architecture

- `src/index.ts`: rc.8 settings, runtime lifecycle, skill facade, and per-agent activation.
- `src/activation.ts`: trigger matching, 25-tool scoped injection, approval policy, and reversible disposers.
- `src/vault/`: canonical path boundary and persistent `VaultFs`.
- `src/bridge/`: versioned JSON-lines IPC client and vault identity verification.
- `companion/`: desktop-only Obsidian plugin using a Windows named pipe or Unix socket.
- `src/tools/`: Vault, knowledge, attachment, link, editor, and command tool definitions.

See [ARCHITECTURE.md](ARCHITECTURE.md), [MIGRATION.md](MIGRATION.md), [SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md) for design, migration, security, and release history.

## Publishing and DSH ecosystem

DeepSeek Harness does not require community plugins to use a special Git tag, npm dist-tag, or pull request to the official Harness repository. The official repository's guidance is to add the GitHub repository topic [`dsh-plugin`](https://github.com/topics/dsh-plugin) for discoverability. This repository has that GitHub Topic and publishes its own plugin-scoped release tags such as `dsh-obsidian-v0.3.0`; the core Harness tag format `dsh-v0.1.0-rc.8` belongs to the Harness repository, not this plugin.

For a release, keep these values synchronized:

- `package.json.version`
- `companion/manifest.json.version`
- the companion runtime version and smoke-test expectation
- the plugin-scoped Git tag `dsh-obsidian-v<version>`
- the DSH compatibility version documented in this README and `MIGRATION.md`

The package must retain the `dsh.bundle.patch` metadata and `cordis.patch.yml` entry so DSH can discover it as a bundle. Validate with `npm run typecheck`, `npm run check:companion`, `npm test`, `npm run build`, `npm run verify:release`, `npm pack --dry-run`, and an isolated DSH profile dump before pushing a release. Tag pushes build a verified host tarball, companion ZIP, and `SHA256SUMS` through the release workflow. Publishing the scoped npm package additionally requires an npm account authorized for the `@deepseek-ai` scope; GitHub Release assets do not depend on that permission.

## Compatibility

| dsh-obsidian | DSH host | Companion | Obsidian | Status |
|---|---|---|---|---|
| `0.3.x` / `dsh-obsidian-v0.3.0` | `0.1.0-rc.8` | `0.3.0` | Desktop `>=1.4.0` | Supported |
| `0.2.x` / `dsh-obsidian-v0.2.0` | `0.1.0-rc.7` | `0.2.0` | Desktop `>=1.4.0` | Legacy branch `legacy/dsh-rc7` |
| `0.1.x` / `v0.1.0` | rc.6 line | `0.1.0` | Desktop `>=1.4.0` | Legacy branch `legacy/dsh-rc6` |
| `0.3.x` | rc.7 or another unsupported DSH version | any | any | Unsupported |

The host and companion major/minor versions must match. The companion also requires protocol version 1 and a canonical vault identity match. `companionToken` is normally read from the matching vault's plugin `data.json`; set it explicitly only when deployment-managed secret configuration is required.

## Package identities

- DSH host package: `@deepseek-ai/dsh-client-ui-obsidian`
- DSH bundle row: `ui-obsidian`
- Obsidian companion plugin: `dsh-obsidian-bridge`
- GitHub discovery topic: `dsh-plugin`

The official DeepSeek Harness repository does not require a special Git tag, npm dist-tag, or pull request for community plugins. Its explicit ecosystem guidance is the `dsh-plugin` GitHub topic. The core tag `dsh-v0.1.0-rc.8` belongs to the Harness repository; this plugin uses `dsh-obsidian-v0.3.0`.

### DSH rc.8 upgrade warning

DSH rc.8 is a prerelease and its release notes explicitly state that the optional SQLite session-persistence storage format is incompatible with the previous build and has no in-place migration. Back up the DSH home/session data before upgrading a real profile, and validate this plugin first with an isolated `DSH_HOME`. This warning does not concern Obsidian vault files or the companion IPC data. The rc.8 API Proxy-to-Remote migration note is marked `proposed`; this plugin uses neither API Proxy nor `ctx.remote`, so no Remote migration is applied here.

## Security

The companion never requests a URL. It listens only on an OS-local IPC endpoint, requires a random 32-byte token, uses constant-time token comparison, caps messages at 1 MiB, and verifies the canonical vault identity on every session. Server-side request URLs elsewhere in the project are not used by the current main branch.

Vault tools fail closed on traversal, absolute paths, control characters, protected dot directories, symlink/junction escapes, stale revisions, oversized payloads, unauthorized commands, and cancellation.

## License

[MIT](LICENSE)
