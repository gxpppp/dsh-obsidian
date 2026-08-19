# dsh-obsidian

`dsh-obsidian` is a host-only Obsidian integration for DeepSeek Harness (DSH). The main branch targets DSH `0.1.0-rc.7` exactly. The previous rc.6 implementation is preserved on the remote branch `legacy/dsh-rc6` and at tag `v0.1.0`.

The plugin exposes 25 `obsidian_*` tools. Tools and guidance are injected only into the agent whose message matches the configured trigger vocabulary; unrelated sessions do not receive the schemas.

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

Install the DSH host package into a profile using the normal DSH bundle workflow:

```bash
dsh plugin --profile web add <package-or-link>
```

The package remains host-only. It does not export a browser client and does not install React, REST API, or HTTP server dependencies.

Install the Obsidian companion into the vault:

```bash
node scripts/install-companion.mjs --vault "C:\\path\\to\\vault"
```

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

Requirements: Node.js `>=22.19.0`, TypeScript 5.7, DSH `0.1.0-rc.7`, and an Obsidian desktop API-compatible development environment.

```bash
npm install --ignore-scripts
npm run typecheck
npm test
npm run build
npm run install:companion -- --vault "C:\\path\\to\\vault"
npm run smoke:companion -- --vault "C:\\path\\to\\vault"  # requires Obsidian + companion
```

`npm test` compiles the host and tests with `tsconfig.tests.json`, then runs every compiled `*.spec.js` with Node's built-in test runner. The current suite covers 38 tests across activation, DSH IPC, editor context, vault security, revisions, binary limits, cancellation, and path normalization.

## Architecture

- `src/index.ts`: rc.7 settings, runtime lifecycle, skill facade, and per-agent activation.
- `src/activation.ts`: trigger matching, 25-tool scoped injection, approval policy, and reversible disposers.
- `src/vault/`: canonical path boundary and persistent `VaultFs`.
- `src/bridge/`: versioned JSON-lines IPC client and vault identity verification.
- `companion/`: desktop-only Obsidian plugin using a Windows named pipe or Unix socket.
- `src/tools/`: Vault, knowledge, attachment, link, editor, and command tool definitions.

See [ARCHITECTURE.md](ARCHITECTURE.md), [MIGRATION.md](MIGRATION.md), and [SECURITY.md](SECURITY.md) for design details.

## Security

The companion never requests a URL. It listens only on an OS-local IPC endpoint, requires a random 32-byte token, uses constant-time token comparison, caps messages at 1 MiB, and verifies the canonical vault identity on every session. Server-side request URLs elsewhere in the project are not used by the current main branch.

Vault tools fail closed on traversal, absolute paths, control characters, protected dot directories, symlink/junction escapes, stale revisions, oversized payloads, unauthorized commands, and cancellation.

## License

MIT
