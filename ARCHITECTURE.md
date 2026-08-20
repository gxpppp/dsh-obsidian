# Architecture

## Runtime boundary

The package has one DSH host entry, `apply(ctx, config)`, and one optional Obsidian desktop companion. There is no browser client and no profile-global MCP connection.

The host registers one lightweight `obsidian` skill in the global skill registry. A trigger event (`agent/inbox/inserted` or the DSH `session/event` with `event.data.content`) activates the current agent. Tool registrations, prompt guidance, and the approval listener are all owned by that agent context and return disposers.

## Data paths

```text
DSH agent
  -> scoped obsidian_* tool
     -> VaultFs --------------------> canonical vault filesystem
     -> ObsidianBridge -- JSON Lines -> named pipe / Unix socket
                                      -> Obsidian APIs
```

`auto` mode only falls back from companion to filesystem for operations whose semantics are safe offline. Authentication failures, protocol mismatches, vault identity mismatches, and unsupported operations are terminal errors.

## IPC protocol

Protocol version 1 uses one request per local socket connection. A request contains `protocolVersion`, `requestId`, `token`, `method`, and `params`. The response contains the same protocol version and request id, plus either `data` or `{ code, message, details }`.

The endpoint is deterministic from the canonical vault path. Windows uses a named pipe; macOS and Linux use a Unix-domain socket. Requests and responses are capped at 1 MiB. The companion sends a `hello` response containing its protocol/plugin/Obsidian versions, capabilities, and canonical vault identity. The host compares this identity before any editor or semantic operation.

## Vault boundary

`VaultFs` normalizes every agent path and rejects empty segments, dot segments, absolute paths, drive prefixes, backslashes, control characters, protected dot directories, and symlink/junction escapes. Existing ancestors are realpathed before creation flows proceed.

Text and binary writes use a same-directory temporary file, `fsync`, and rename. Per-path queues serialize updates. SHA-256 revisions support optimistic concurrency through `if_match`. Deletion moves to an internal protected trash unless `permanent` is explicit.

## Tool ownership

- `vaultTools.ts`: status plus 10 filesystem tools.
- `knowledgeTools.ts` and `knowledgeOperations.ts`: bounded search and metadata/semantic calls.
- `attachmentTools.ts`: DSH durable image references and bounded binary vault files.
- `linkInsertTool.ts`: validated companion link insertion.
- `editor.ts`: active editor, inline edit, open, command list/execute, notice.

All tools use the DSH rc.8 `execute(args, exec)` contract and propagate `exec.signal`. The activation policy uses `tools/pre-execute` to apply command and write approval rules.
