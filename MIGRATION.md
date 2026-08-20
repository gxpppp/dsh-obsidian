# Migration to DSH rc.8

## Release lines

| dsh-obsidian | DSH | Branch / tag |
|---|---|---|
| `0.3.x` | `0.1.0-rc.8` | `main` / `dsh-obsidian-v0.3.1` |
| `0.2.x` | `0.1.0-rc.7` | `legacy/dsh-rc7` / `dsh-obsidian-v0.2.0` |
| `0.1.x` | rc.6 line | `legacy/dsh-rc6` / `v0.1.0` |

The release lines are intentionally separate. Do not install an rc.7 host plugin in an rc.8 profile, and do not mix host and companion versions across the `0.2.x` and `0.3.x` lines.

## Upgrade from rc.7 to rc.8

1. Stop the DSH profile that contains dsh-obsidian.
2. Back up `$DSH_HOME`, profile settings, session data, and the target Obsidian vault.
3. If the profile explicitly uses SQLite session persistence, preserve the old database separately. DSH rc.8 uses an incompatible SQLite storage format and provides no in-place migration for the prerelease provider.
4. Upgrade the DSH CLI/runtime explicitly to `0.1.0-rc.8` or npm dist-tag `next`. The default DSH npm `latest` dist-tag still points to rc.7 at the time of this release.
5. Install dsh-obsidian `0.3.1` into the profile. Remove the rc.7 package first when the package manager does not replace a Git/link dependency cleanly.
6. Reinstall the Obsidian companion `0.3.1` into each vault and reload Obsidian. The companion keeps IPC protocol version 1, but host and companion release versions must match.
7. Verify the profile composition before booting it against real data:

   ```bash
   dsh --profile <profile> --dump-config
   ```

   The output must contain the `ui-obsidian` row.
8. Start the profile, invoke `obsidian_status`, and confirm DSH rc.8, companion `0.3.1`, protocol 1, and a matching canonical vault identity.
9. Run the companion smoke test from a trusted checkout or package installation:

   ```bash
   npm run smoke:companion -- --vault "C:\\path\\to\\vault"
   ```

The rc.8 API Proxy-to-Remote Agent Note is marked `proposed`. This plugin uses neither API Proxy, `ctx.connection`, nor `ctx.remote`, so no Remote API migration is required for this release.

## Rollback

A rollback must restore matching host and companion lines:

- rc.7: `legacy/dsh-rc7` or `dsh-obsidian-v0.2.0`, companion `0.2.0`
- rc.6: `legacy/dsh-rc6` or `v0.1.0`, companion `0.1.0`

If DSH rc.8 opened or created an SQLite session database, restore the pre-upgrade database and the matching rc.7 runtime rather than reusing the rc.8 database.

## Historical rc.6 to rc.7 migration

Version `0.2.0` replaced the HTTP/Local REST companion path with authenticated local IPC, removed browser UI dependencies, adopted per-agent scoped tool injection, and added the 25-tool surface. The removed settings were `restUrl`, `restToken`, `companionPort`, `pollMs`, and `protectDotObsidian`. That historical implementation is preserved unchanged on `legacy/dsh-rc7`.

## Release invariants

For every release:

- `package.json.version`, the lockfile root version, `companion/manifest.json.version`, companion `PLUGIN_VERSION`, and the smoke-test expectation are identical.
- Every direct DSH peer/dev dependency points to the declared DSH release line.
- The annotated Git tag uses `dsh-obsidian-v<version>` and points to the release commit.
- The npm/GitHub release artifact contains `lib/index.js`, declaration files, `companion/dist/main.js`, the companion manifest, scripts, bundle patch, and documentation.
- Host typecheck, companion typecheck, tests, build, package inspection, isolated DSH profile composition, and real Obsidian smoke all pass.
