# Migration to DSH 0.1.2-alpha.2

## Release lines

| dsh-obsidian | DSH | Branch / tag |
|---|---|---|
| `0.4.x` | `0.1.2-alpha.2` | `main` / `dsh-obsidian-v0.4.0` |
| `0.3.x` | `0.1.0-rc.8` | `legacy/dsh-rc8` / `dsh-obsidian-v0.3.1` |
| `0.2.x` | `0.1.0-rc.7` | `legacy/dsh-rc7` / `dsh-obsidian-v0.2.0` |
| `0.1.x` | rc.6 line | `legacy/dsh-rc6` / `v0.1.0` |

The lines are intentionally separate. Do not mix a host package, companion, or DSH runtime from different rows.

## Upgrade from rc.8 to alpha.2

1. Stop every DSH profile that contains dsh-obsidian.
2. Back up `$DSH_HOME`, profile manifests and patches, session data, and the target Obsidian vault.
3. If the profile uses optional SQLite persistence, keep its existing database with the old runtime. Alpha.2 creates schema 20, rejects every other schema, and provides no built-in migration. Use a fresh database or export/import logical sessions through the persistence API.
4. Install the exact alpha.2 runtime and its required profile package manager:

   ```bash
   npm install --global @deepseek-ai/dsh@0.1.2-alpha.2 pnpm@11.7.0
   ```

   `@alpha` currently resolves to alpha.2, while npm `latest` and `next` resolve to `0.1.1-rc.2`. Exact versions are the release invariant.
5. Install dsh-obsidian `0.4.0` into the profile. Remove the rc.8 package first if the package manager does not replace a Git/link dependency cleanly.
6. Reinstall the Obsidian companion `0.4.0` into each vault and reload Obsidian. IPC remains protocol 1, but host and companion major/minor versions must match.
7. Inspect the composed profile before booting it:

   ```bash
   dsh --profile <profile> --dump-config
   ```

   The output must contain `ui-obsidian`. Also inspect `dsh.profile.patchReload`: `web` reloads patch files live; shipped headless/ACP/SDK profiles apply them only at startup.
8. Start the profile, invoke `obsidian_status`, and confirm companion `0.4.x`, protocol 1, and a matching canonical vault identity.
9. Run the companion smoke from a trusted package installation:

   ```bash
   npm run smoke:companion -- --vault "C:\\path\\to\\vault"
   ```

Alpha.2 moves optional settings installation to `ctx.inject(['settings'])` plus `settings.installSection`, moves `JsonValue` to `dsh-util-values`, renames tool presentation `code` to `ptc`, and removes API Proxy. The plugin has been migrated to the new settings/value surfaces and uses neither the presentation-mode setting nor API Proxy.

## Privacy review

The shipped official DeepSeek profile enables `dsh_plugin_packages` by default. It sends active Loader-backed plugin package names and versions, including this package, outside model messages to the configured official DeepSeek endpoint. Disable the `plugin-package-inventory-deepseek` row if deployment policy forbids package inventory disclosure. This behavior is owned by DSH, not by the Obsidian companion, and does not include the companion token or vault content.

## Rollback

Restore a complete matching line:

- rc.8: `legacy/dsh-rc8` or `dsh-obsidian-v0.3.1`, companion `0.3.x`
- rc.7: `legacy/dsh-rc7` or `dsh-obsidian-v0.2.0`, companion `0.2.x`
- rc.6: `legacy/dsh-rc6` or `v0.1.0`, companion `0.1.x`

Do not open an alpha.2 schema-20 SQLite database with an older runtime. Restore the older database backup with its matching runtime. Obsidian vault files are independent of the DSH session database.

## Release invariants

For every release:

- Package, lock root, companion manifest, shared runtime version, smoke expectation, and annotated tag are identical.
- Every direct and transitive `@deepseek-ai/dsh-*` package uses the declared prerelease line and resolves from the official npm registry.
- The tarball contains host JS/types, companion JS/manifest, scripts, bundle patch, and documentation; it excludes local `data.json`, logs, settings secrets, test vaults, and generated release directories.
- Node 22.19 and 24 both pass host/companion typechecks, all tests, build, and release verification before assets can publish.
- A final tarball installs into an isolated exact-version DSH profile and `--dump-config` contains `ui-obsidian`.
- A real Obsidian smoke uses a unique temporary vault folder and cleans it in `finally`.
