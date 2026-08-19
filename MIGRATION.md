# Migration to DSH rc.7

## Branches

The rc.6 implementation is preserved at `legacy/dsh-rc6` and tag `v0.1.0`. The main branch is the rc.7 line and does not carry an rc.6 compatibility layer.

## Host dependency changes

The package now pins these DSH packages to `0.1.0-rc.7`:

- `dsh-agent`
- `dsh-attachment`
- `dsh-llm`
- `dsh-settings`
- `dsh-skill`
- `dsh-system-prompt`
- `dsh-tools`

`@deepseek-ai/cordis` remains `4.0.1`. The schema package is `@deepseek-ai/schemastery@3.18.1`. Browser runtime, locale, UI-slot, React, host connection RPC, and Local REST dependencies were removed from the main line.

The rc.7 tool contract requires `execute(args, exec)`. Every long-running implementation observes `exec.signal`. Scoped tool registration, prompt sections, guards, settings watchers, and event listeners are owned by their effect/disposer.

## Configuration changes

The old fields `restUrl`, `restToken`, `companionPort`, `pollMs`, and `protectDotObsidian` are removed. Use:

- `mode: auto | fs | companion`
- `companionEndpoint` for an optional local IPC override
- `protectedPaths`, `maxTextBytes`, `attachmentFolder`, `maxAttachmentBytes`
- `approvalMode`, `commandPolicy`, and `commandAllowlist`

The companion token is normally read from the matching vault's plugin `data.json`; an explicit `companionToken` remains supported for deployment-managed secrets.

## Companion migration

Install the `0.2.0` companion again. The old HTTP endpoint on `127.0.0.1` is not used by the main branch. After reload, the companion creates a named pipe on Windows or a Unix socket on macOS/Linux. It stores a fresh random token and reports protocol version 1 through `hello`.

Existing HTTP/REST settings must be removed or replaced with the new fields. A companion serving a different vault is rejected rather than reused.

## Verification

```bash
npm install --ignore-scripts
npm run typecheck
npm test
npm run build
npm run install:companion -- --vault <vault>
```
