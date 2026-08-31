# dsh-obsidian mainline status

Last updated: 2026-08-30.

## Current target

Mainline `0.4.0` supports DSH `0.1.2-alpha.2` exactly and remains host-only. Earlier DSH lines are immutable snapshots:

- rc.8: `legacy/dsh-rc8`, tag `dsh-obsidian-v0.3.1`
- rc.7: `legacy/dsh-rc7`, tag `dsh-obsidian-v0.2.0`
- rc.6: `legacy/dsh-rc6`, tag `v0.1.0`

No compatibility shim is maintained between prerelease lines.

## Implemented surface

- 25 per-agent, on-demand `obsidian_*` tools.
- Reversible agent-scoped tools, prompt guidance, approval policy, and runtime skill lifecycle.
- Alpha.2-compatible optional settings injection, `execute(args, exec)`, `exec.signal`, agent events, skill registration, common `JsonValue`, and attachment store use.
- Secure Vault filesystem: normalized paths, protected dot directories, symlink/junction containment, atomic text/binary writes, per-path serialization, SHA-256 revisions, optimistic conflicts, trash, bounded search, size limits, and preserved cancellation reasons.
- Companion IPC v1: Windows named pipe / Unix socket, JSON Lines, 1 MiB limit, random token, constant-time comparison, canonical vault identity, timeout/cancellation, and host/companion release-line enforcement.
- Obsidian editor, metadata cache, frontmatter, links, attachments, commands, and Notice routes.
- Reproducible host/companion builds, package content verification, complete DSH dependency-line checks, isolated alpha.2 profile composition, and real Obsidian smoke testing.

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

## Alpha.2 decisions

- Eight direct DSH peer/dev packages, including `dsh-util-values`, are pinned to `0.1.2-alpha.2`; Cordis is `4.0.2`, Schemastery is `3.18.2`.
- npm `alpha` points to alpha.2; `latest` and `next` remain rc.2. Release and smoke gates use exact versions.
- Optional settings use `ctx.inject(['settings'])`; absence of the provider falls back to the composition entry.
- Tool presentation PTC naming and API Proxy removal require no shim because this package never configures presentation mode or uses API Proxy/Remote.
- Companion protocol remains 1 because DSH package changes do not alter the wire contract.
- SQLite schema 20 is incompatible with prior files and has no built-in migration. Profile E2E always uses a temporary `DSH_HOME`.
- The official DeepSeek adapter enables Loader package inventory by default. Deployment owners may disable its profile row; this plugin does not send that field itself.

## Release gates

1. official-registry `npm ci --ignore-scripts`
2. Node 22.19 and 24 host typecheck
3. Node 22.19 and 24 companion typecheck
4. 43 tests, including alpha.2 attachment and version-line contracts
5. reproducible host/companion build
6. complete lock closure and actual tarball content verification
7. scan bundles and package paths for removed browser/HTTP runtime and local secrets/logs/config
8. install the final tarball into an isolated exact alpha.2 profile and confirm `ui-obsidian` with `--dump-config`
9. install companion `0.4.0` into an authorized desktop vault and run real smoke
10. verify temporary paths are removed and no token or vault content enters a release artifact
11. confirm `main`, all three legacy branches, historical tags, and the new annotated tag on origin

A real DSH or Obsidian step that cannot run is reported as unverified; mocks and historical logs do not substitute for it.
