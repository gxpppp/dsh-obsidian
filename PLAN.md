# dsh-obsidian mainline status

Last updated: 2026-08-20.

## Current target

Mainline `0.3.0` supports DSH `0.1.0-rc.8` exactly and remains host-only. Previous DSH lines are immutable maintenance snapshots:

- rc.7: `legacy/dsh-rc7`, tag `dsh-obsidian-v0.2.0`
- rc.6: `legacy/dsh-rc6`, tag `v0.1.0`

No compatibility shim is maintained between these DSH prerelease lines.

## Implemented surface

- 25 per-agent, on-demand `obsidian_*` tools.
- Reversible agent-scoped tools, prompt guidance, approval policy, and runtime skill lifecycle.
- rc.8-compatible `execute(args, exec)`, `exec.signal`, agent events, settings validation, skill registration, and attachment store use.
- Secure Vault filesystem: normalized paths, protected dot directories, symlink/junction containment, atomic text/binary writes, per-path serialization, SHA-256 revisions, optimistic conflicts, trash, bounded search, and size limits.
- Companion IPC v1: Windows named pipe / Unix socket, JSON Lines, 1 MiB protocol limit, random token, constant-time comparison, canonical vault identity, timeout and cancellation.
- Obsidian editor, metadata cache, frontmatter, links, attachments, commands, and Notice routes.
- DSH approval policy for commands, dangerous operations, writes, or all operations.
- Reproducible host/companion builds, package preparation, unit/contract tests, isolated DSH profile composition, and real Obsidian smoke testing.

## Tool catalog

1. `obsidian_status`
2. `obsidian_list`
3. `obsidian_stat`
4. `obsidian_read`
5. `obsidian_write`
6. `obsidian_edit`
7. `obsidian_append`
8. `obsidian_mkdir`
9. `obsidian_copy`
10. `obsidian_move`
11. `obsidian_delete`
12. `obsidian_search`
13. `obsidian_metadata`
14. `obsidian_frontmatter_update`
15. `obsidian_attachment_add`
16. `obsidian_attachment_read`
17. `obsidian_link_resolve`
18. `obsidian_links`
19. `obsidian_link_insert`
20. `obsidian_active`
21. `obsidian_inline_edit`
22. `obsidian_open`
23. `obsidian_commands_list`
24. `obsidian_command`
25. `obsidian_notice`

## rc.8-specific decisions

- All seven direct DSH peer/dev dependencies are pinned to `0.1.0-rc.8`; Cordis remains `4.0.1`.
- Companion protocol remains version 1 because companion behavior is independent of the DSH host package version.
- The rc.8 API Proxy-to-Remote note is proposed and not used by this plugin; no API Proxy or Remote migration is implemented here.
- DSH rc.8 declares its optional SQLite persistence format incompatible. All profile E2E uses an isolated `DSH_HOME`; production session data is never opened during release validation.
- DSH rc.8 is currently a prerelease/`next` line. Documentation must not imply npm `latest` resolves to rc.8.

## Release gates

1. `npm ci --ignore-scripts`
2. `npm run typecheck`
3. `npm run check:companion`
4. `npm test`
5. `npm run build`
6. `npm pack --dry-run` plus required-file inspection
7. scan bundles for removed React/browser/HTTP/REST runtime and accidentally bundled DSH SDK
8. install the final package or link into an isolated DSH rc.8 profile and confirm the `ui-obsidian` row with `--dump-config`
9. install companion `0.3.0` into a disposable or backed-up desktop vault and run `npm run smoke:companion`
10. confirm smoke directories, debug ports, logs, tokens, and generated release files are cleaned or excluded
11. verify `main`, `legacy/dsh-rc7`, `legacy/dsh-rc6`, historical tags, and the new annotated release tag on origin

A real DSH/Obsidian step that cannot run must be reported as unverified; mock or historical logs do not substitute for it.
