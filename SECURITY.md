# Security model

## URL and network policy

The main branch does not make server-side URL requests. The companion uses OS-local IPC only: a Windows named pipe or a Unix-domain socket. No HTTP listener, Local REST fallback, or remote URL is part of the active implementation.

## Authentication and identity

The companion creates a 32-byte random token with `crypto.randomBytes` and compares it with `timingSafeEqual`. Every request carries the token and protocol version. The host performs `hello` and compares canonical vault identity before using the companion. Token values are never included in status, errors, prompts, tool output, or logs.

## Message limits

A single JSON-lines request or response is capped at 1 MiB. Attachment and text payloads have independent configurable limits. Timeouts and caller cancellation are propagated to IPC and filesystem work.

## Vault containment

Agent paths are vault-relative. The path boundary rejects absolute paths, drive prefixes, backslashes, control characters, empty/dot segments, and configured protected top-level dot directories. Existing path components are resolved through realpath, including the nearest existing ancestor for create flows. Writes, copies, moves, reads, and deletes all pass through this boundary.

## Change safety

Text and binary writes are atomic. Per-path queues serialize updates. Read results include a SHA-256 revision, and update tools accept `if_match`; stale updates return `CONFLICT`. Inline editor edits additionally verify the active path, document revision, selection offsets, and expected selected text.

## Destructive operations

Deletion moves to protected internal trash by default. Permanent deletion, writes when configured, dangerous commands, and all commands under `approvalMode` are handled by the rc.7 `tools/pre-execute` approval pipeline. Unknown commands and commands returning false fail closed.

## Sensitive data

The old activation log that stored message prefixes was removed. Structured logger messages contain only event type and agent id. Companion settings persist the token locally in Obsidian plugin data; the host settings schema marks an explicitly configured token as secret.
