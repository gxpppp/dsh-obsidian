# Changelog

## 0.4.0

- Upgrade the host compatibility line to DSH `0.1.2-alpha.2`, Cordis `4.0.2`, and Schemastery `3.18.2`.
- Migrate optional settings to `ctx.settings.installSection` and canonical tool JSON values to `@deepseek-ai/dsh-util-values`.
- Preserve the 25-tool host-only surface and companion IPC protocol 1 while enforcing matching host/companion major-minor versions.
- Add alpha.2 attachment contract coverage and preserve caller cancellation reasons through binary Vault reads.
- Refresh the cached Vault filesystem when live settings change size limits or protected paths, not only when the vault path changes.
- Place Obsidian tool guidance at prompt order 3000, after built-in tool guidance and before the alpha.2 PTC SDK section.
- Verify the complete DSH dependency closure, actual package contents, exact alpha.2 profile composition, and both supported Node lines before release.
- Archive the final rc.8 implementation on `legacy/dsh-rc8` and document alpha.2 PTC, API Proxy removal, profile reload, SQLite schema 20, and plugin-inventory behavior.

## 0.3.1

- Keep the DSH `0.1.0-rc.8` compatibility line and companion IPC protocol version 1.
- Make the compiled `node:test` runner compatible with the declared Node.js `22.19+` floor by removing the Node 24-only `--test-isolation` option.
- Validate releases on both Node.js 22.19 and 24 before publishing assets.

## 0.3.0

- Upgrade the host compatibility line to DSH `0.1.0-rc.8`.
- Preserve the 25-tool surface, Vault safety model, and companion IPC protocol version 1.
- Add reproducible package preparation, companion typecheck, public package metadata, release validation, and an isolated rc.8 profile gate.
- Archive the final rc.7 state on `legacy/dsh-rc7`.
- Document the rc.8 prerelease/`next` status and incompatible optional SQLite session-persistence format.

## 0.2.0

- Upgrade the host compatibility line to DSH `0.1.0-rc.7`.
- Replace the HTTP/Local REST bridge with authenticated local IPC.
- Add the full 25-tool Vault, knowledge, attachment, link, editor, command, and notice surface.
- Add revision conflicts, approval policy, protected paths, atomic writes, real companion smoke testing, and release documentation.

## 0.1.0

- Initial DSH rc.6 integration with 14 tools, runtime skill facade, and HTTP companion bridge.
