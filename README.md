# dsh-obsidian

`dsh-obsidian` is a host-only Obsidian integration for DeepSeek Harness (DSH). The main branch targets DSH `0.1.2-alpha.2` exactly. Earlier prerelease lines are preserved as immutable legacy branches and tags.

The plugin exposes 25 `obsidian_*` tools. Tools, guidance, and approval policy are injected only into the agent whose message matches the configured trigger vocabulary; unrelated agents do not receive the schemas.

Current release line: `dsh-obsidian-v0.4.0`, built for DSH [`dsh-v0.1.2-alpha.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.2). DSH alpha.2 is published under npm dist-tag `alpha`; `latest` and `next` still resolve to `0.1.1-rc.2`. Use the exact version for reproducible installations.

## Capabilities

**Vault tools, available without Obsidian:**

`obsidian_status` · `obsidian_list` · `obsidian_stat` · `obsidian_read` · `obsidian_write` · `obsidian_edit` · `obsidian_append` · `obsidian_mkdir` · `obsidian_copy` · `obsidian_move` · `obsidian_delete`

The filesystem layer uses vault-relative paths, canonical realpath containment, protected dot directories, atomic writes, serialized appends, SHA-256 revisions, optimistic `if_match` conflicts, binary size limits, cancellation, and internal trash by default.

**Knowledge and Obsidian semantic tools:**

`obsidian_search` · `obsidian_metadata` · `obsidian_frontmatter_update` · `obsidian_link_resolve` · `obsidian_links` · `obsidian_link_insert`

Search is bounded and paginated. Metadata, frontmatter processing, backlinks, unresolved links, and Obsidian-generated links use the companion's native APIs when available.

**Attachments:**

`obsidian_attachment_add` · `obsidian_attachment_read`

Attachments accept an alpha.2 durable image reference or a vault-relative source path. Host absolute paths, URLs, dot directories, unbounded binary payloads, and raw binary model output are rejected.

**Editor and command tools, requiring the companion:**

`obsidian_active` · `obsidian_inline_edit` · `obsidian_open` · `obsidian_commands_list` · `obsidian_command` · `obsidian_notice`

Inline edits carry the active path, document revision, selection offsets, and expected text. A concurrent user edit or note switch returns a conflict instead of overwriting content.

## Install

First install DSH `0.1.2-alpha.2` explicitly. Do not rely on npm `latest` or `next` for this line:

```bash
npm install --global @deepseek-ai/dsh@0.1.2-alpha.2 pnpm@11.7.0
```

Install the host package into the profile that runs the agent:

```bash
# Preferred: prebuilt tarball attached to the GitHub Release
dsh plugin --profile <profile> add "https://github.com/gxpppp/dsh-obsidian/releases/download/dsh-obsidian-v0.4.0/deepseek-ai-dsh-client-ui-obsidian-0.4.0.tgz"

# Exact GitHub tag; requires a build-capable npm environment
dsh plugin --profile <profile> add "github:gxpppp/dsh-obsidian#dsh-obsidian-v0.4.0"

# npm registry, after publication by an account authorized for @deepseek-ai
dsh plugin --profile <profile> add @deepseek-ai/dsh-client-ui-obsidian@0.4.0

# Local development checkout
dsh plugin --profile <profile> add "link:E:\\path\\to\\dsh-obsidian"
```

Replace `<profile>` with the profile you actually boot, such as `web` or `headless`. Alpha.2 profiles record `dsh.profile.patchReload`: `web` uses `live`; shipped `headless`, `acp`, `sdk`, and `sdk-minimal` profiles use `startup`. Restart startup-only profiles after adding or changing the plugin.

Verify the composed tree without booting:

```bash
dsh --profile <profile> --dump-config
```

The output must contain the `ui-obsidian` row.

The host package and Obsidian companion are separate artifacts. Install the companion from a checkout or unpacked host tarball:

```bash
node scripts/install-companion.mjs --vault "C:\\path\\to\\vault"
```

A standalone `dsh-obsidian-bridge-0.4.0.zip` is attached to the GitHub Release. Extract only `main.js` and `manifest.json` into `<vault>/.obsidian/plugins/dsh-obsidian-bridge/`, enable the plugin, and reload Obsidian. Verify hashes against `SHA256SUMS` before installation.

The companion stores its random token in local plugin `data.json`. The host reads it automatically only when `vaultPath` resolves to the same canonical vault. Host and companion major/minor versions must match; IPC protocol remains version 1.

## Configuration

The `obsidian` settings namespace applies live when the optional DSH settings provider is mounted:

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

Alpha.2 settings integration uses `ctx.inject(['settings'])` and `settings.installSection(...)`; without a provider the plugin keeps using its profile entry configuration. Secret fields stay write-only on redacted settings surfaces.

## Development

Requirements: Node.js `^22.19.0 || >=24.0.0` (Node 23 is unsupported), npm `>=11`, TypeScript 5.7, DSH `0.1.2-alpha.2`, Cordis `4.0.2`, and Obsidian desktop.

```bash
npm install --ignore-scripts --registry=https://registry.npmjs.org/
npm run typecheck
npm run check:companion
npm test
npm run build
npm run verify:release
npm run smoke:dsh-profile
npm run install:companion -- --vault "C:\\path\\to\\vault"
npm run smoke:companion -- --vault "C:\\path\\to\\vault"
```

The suite contains 43 tests across activation, alpha.2 attachment contracts, IPC, editor context, Vault security, revisions, size limits, cancellation, and path normalization. CI runs the static/build/package gates on Node 22.19 and 24; release assets are built only after both jobs pass.

## Architecture and alpha.2 changes

- `src/index.ts`: optional alpha.2 settings service wiring, runtime lifecycle, skill facade, and per-agent activation.
- `src/activation.ts`: trigger matching, 25-tool scoped injection, approval policy, and reversible disposers.
- `src/vault/`: canonical path boundary and persistent `VaultFs`.
- `src/bridge/`: authenticated JSON Lines IPC, version-line enforcement, and vault identity verification.
- `companion/`: desktop-only Obsidian plugin using a Windows named pipe or Unix socket.
- `src/tools/`: Vault, knowledge, attachment, link, editor, and command definitions.

Alpha.2 retains `execute(args, exec)`, `exec.signal`, scoped `agent.ctx`, `tools/pre-execute`, `skills.register`, and `systemPrompt.section`. It moves settings installation onto `ctx.settings`, moves `JsonValue` to `@deepseek-ai/dsh-util-values`, renames tool presentation `code` mode to `ptc`, and removes API Proxy. This plugin uses neither presentation-mode names nor API Proxy, so those changes require no compatibility shim.

See [ARCHITECTURE.md](ARCHITECTURE.md), [MIGRATION.md](MIGRATION.md), [SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md).

## Compatibility

| dsh-obsidian | DSH host | Companion | Obsidian | Status |
|---|---|---|---|---|
| `0.4.x` / `dsh-obsidian-v0.4.0` | `0.1.2-alpha.2` | `0.4.x` | Desktop `>=1.4.0` | Supported |
| `0.3.x` / `dsh-obsidian-v0.3.1` | `0.1.0-rc.8` | `0.3.x` | Desktop `>=1.4.0` | `legacy/dsh-rc8` |
| `0.2.x` / `dsh-obsidian-v0.2.0` | `0.1.0-rc.7` | `0.2.x` | Desktop `>=1.4.0` | `legacy/dsh-rc7` |
| `0.1.x` / `v0.1.0` | rc.6 line | `0.1.x` | Desktop `>=1.4.0` | `legacy/dsh-rc6` |
| any other cross-line combination | unsupported | unsupported | any | Unsupported |

## DSH alpha.2 operational warnings

- Optional SQLite session persistence uses schema **20**. It rejects every other schema and ships no migration. Back up DSH home/session data and use a fresh database or explicit persistence-API export/import. This does not affect Obsidian vault files.
- The official DeepSeek adapter enables `dsh_plugin_packages` by default, sending the active Loader-backed package names and versions outside model messages to the configured official DeepSeek endpoint. Disable the `plugin-package-inventory-deepseek` profile row if deployment policy forbids that inventory. The pi-ai adapter does not use this extension.
- `dsh_session_log` is a separate extension and is not enabled by this plugin.
- API Proxy removal is implemented in alpha.2. `dsh-obsidian` has never used API Proxy or `ctx.remote`.

## Publishing and ecosystem

Community discovery uses the GitHub topic [`dsh-plugin`](https://github.com/topics/dsh-plugin). This plugin uses annotated tags `dsh-obsidian-v<version>`; core tags such as `dsh-v0.1.2-alpha.2` belong to DeepSeek Harness.

Every release synchronizes package, lockfile, companion manifest, runtime, smoke expectation, documentation, and tag versions. `verify:release` checks the complete DSH lock closure, official registry origins, required tarball contents, and forbidden secret/log/config paths. The tag workflow publishes a host tarball, a two-file companion ZIP, and `SHA256SUMS`. npm publication is not automatic and requires authorized `@deepseek-ai` scope access.

## Security

The companion never requests a URL. It listens only on OS-local IPC, requires a random 32-byte token, uses constant-time comparison, caps messages at 1 MiB, and verifies canonical vault identity before operations. Vault tools fail closed on traversal, absolute paths, control characters, protected dot directories, symlink/junction escapes, stale revisions, oversized payloads, unauthorized commands, and cancellation.

## License

[MIT](LICENSE)
