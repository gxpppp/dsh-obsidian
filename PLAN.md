# dsh-obsidian 移植计划与进度（存档）

> 目标：调研 Claudian（github.com/yishenTu/claudian，Obsidian 插件）全部代码架构与 Obsidian 交互模式，将其交互能力移植为 DSH 插件。本文件是计划 + 实施进度的权威存档。最后更新：2026-08-14（含按需注入改造 v2）。

## 1. 目标与验收标准

在 `E:\AAAhuancun\zaxang\dsh-obsidian` 实现可安装的 DSH 插件包（插件行 id `ui-obsidian`，包名 `@deepseek-ai/dsh-client-ui-obsidian`），让 DSH agent 与 Web GUI 获得与 Claudian 对等的 Obsidian 交互能力；交付 `RESEARCH.md`（Claudian 架构 + 全部交互模式 + 外部通道调研）与 `ARCHITECTURE.md`（逐模块移植映射）。

验收：
1. `dsh plugin --profile web add link:<repo>`（或等价手工安装）后重启 `dsh web`，http://127.0.0.1:3080 插件生效：设置页配置卡 + 侧边栏入口。
2. Agent 对真实 vault（`<VAULT_ROOT>`，settings 配置项 vaultPath）可执行：列目录、读/写/改/追加/删除/移动、全文搜索、frontmatter/元数据（fs 通道，Obsidian 无需运行）。
3. 安装 companion 后：活动笔记 + 选区/光标读取、内联编辑写回编辑器选区、打开到行、触发命令、Notice。
4. GUI：侧边栏入口（状态徽标）、浮层面板（状态卡/活动笔记/搜索/文件树/新建/重命名/删除/捕获到会话）。
5. vitest/node:test 单测全绿（vaultPaths/vaultFs/editorContext/bridge）。
6. 真实环境 E2E 逐项跑通。

## 2. 调研结论摘要（详见 RESEARCH.md）

- **Claudian**：480 TS 文件 / ~9.8 万行，Obsidian 桌面插件，嵌入 Claude Code/Codex/Grok/Opencode/Pi CLI，vault 即 agent 工作目录。运行在 Obsidian 进程内，靠 Obsidian 插件 API + 未文档化 `editor.cm`（CM6）+ 250ms 轮询 + vault 目录双向同步。
- **交互模式全目录（13 类）**：插件生命周期/视图/命令/设置页、VaultFileAdapter 文件层（路径规范化+写队列）、编辑器上下文（`<editor_selection>`/`<editor_cursor>` XML+CDATA）、选区捕获（CM6+DOM 回退）、内联编辑（`<replacement>`/`<insertion>` 解析+词级 diff 预览）、@mention/chips、vault 文件树 UI、右键菜单、会话持久化（`.claudian/`）、命令执行、CLI 环境写入、MCP 管理、渲染器组。
- **外部通道调研**：Local REST API 插件（/vault CRUD、/active、/search/simple、/commands、/open、内置 /mcp/ streamable-http 端点）；Obsidian 1.12+ 官方 CLI（需 Obsidian 运行）；Obsidian 插件可用 `require('node:http')` 起本地服务。
- **DSH 插件框架**：双半区包（host `.` 导出 cordis 插件 + browser `./client` 经 `window.__ModuleLoader__.load` 注入）；`dsh.bundle.patch` + `dsh.client.inject` 声明；host 能力：`ctx.tools.register(defineTool(...))`、`ctx.systemPrompt.section`、`installSettingsSection`、`ctx.connection.rpc.handle('/obsidian', ...)`；browser 能力：`ctx.slots.inject/register`、`ctx.settingsScope.bind`、`ctx.locale.register`、`ctx.sessions.binding(id).session.prompt`、`ctx.get('connection').rpc.call`；侧边栏无空闲 slot → DOM 注入（MutationObserver 自愈）。

## 3. 移植架构（已实现）

三条通道：
- **fs**：host 直读 vault 目录（Obsidian 无需运行）→ 9 个文件工具。
- **companion**：随包交付迷你 Obsidian 插件（companion/，node:http 于 127.0.0.1:34567 + Bearer token）→ 编辑器保真能力（活动笔记/选区/内联编辑/打开到行/命令/搜索/Notice）。
- **rest**（可选）：Local REST API 插件直连（open/command/search 回退）。

**工具清单（14 个）**：obsidian_list / obsidian_read / obsidian_write / obsidian_edit / obsidian_append / obsidian_delete / obsidian_move / obsidian_search / obsidian_metadata / obsidian_active / obsidian_inline_edit / obsidian_open / obsidian_command / obsidian_commands_list。

## 4. 目录结构

```
dsh-obsidian/
├── package.json / cordis.patch.yml / tsconfig(.build/.tests/.companion).json
├── scripts/build.mjs            # esbuild CLI host 半区 + tsc 类型（沙箱下不用 JS API）
├── scripts/install-companion.mjs# 构建并装入 vault + community-plugins.json 启用
├── src/
│   ├── index.ts                 # host apply：skill/activation/settings/rpc/bridge 装配
│   ├── activation.ts            # 按需激活：触发词匹配 + per-agent 工具/规则注入（v2）
│   ├── skill.ts                 # obsidian skill 门面（目录一行 + 指南按需加载，v2）
│   ├── vault/ vaultPaths.ts vaultFs.ts editorContext.ts detect.ts
│   ├── bridge/ bridge.ts        # companion/rest HTTP 客户端 + 快照
│   ├── tools/ context.ts files.ts editor.ts
│   ├── prompt/ section.ts       # 激活时注入的 guidance（300 顺序位）
│   └── settings/ schema.ts      # Config：vaultPath/mode/restUrl/restToken/companionPort/companionToken/pollMs/triggerKeywords/...
├── companion/ manifest.json src/main.ts build.mjs   # Obsidian 桥插件
└── tests/ vaultPaths.spec.ts vaultFs.spec.ts editorContext.spec.ts bridge.spec.ts activation.spec.ts  # node:test（30 用例）
```

## 5. 实施步骤与进度

| # | 步骤 | 状态 |
|---|---|---|
| 1 | 脚手架 + npm install（SDK ^0.1.0-rc.6，--ignore-scripts + 本地 cache） | ✅ |
| 2 | vaultPaths/vaultFs/editorContext + 单测 | ✅ 21/21 通过 |
| 3 | fs 通道 9 工具 + render + 系统提示词 + 设置 schema | ✅ tsc 全绿 |
| 4 | companion 插件（server/设置卡/构建/安装脚本） | ✅ 已装入 vault 并启用 |
| 5 | bridge.ts + 5 编辑器工具 + host RPC 通道（/obsidian） | ✅ |
| 6 | browser 半区：侧边栏入口/面板/树/设置卡/locales | ✅ 构建产物 28KB |
| 7 | 构建 + 安装到 web profile + 重启 dsh web 验证 | ✅ 已装（symlink+bundles 登记），新进程已服务 client bundle，根页面引用插件 |
| 8 | 真实 vault E2E + RESEARCH.md/ARCHITECTURE.md/README | ⏳ 进行中 |

**沙箱/环境经验**（重要）：
- 沙箱禁止子进程 pipe 捕获 → esbuild 必须用 CLI 二进制 + `stdio: inherit`；vitest/vite/tsx 不可用 → 测试用 node:test（`node --test --test-isolation=none`）+ tsc 预编译（tsconfig.tests.json → .test-build/）。
- npm 走 `--cache .npm-cache --ignore-scripts`（lifecycle spawn 被拦）；npx.ps1/npm.ps1 包装器在沙箱下坏 → 用 `cmd /c` 或 node 直调 npm-cli.js。
- `dsh plugin` 是 pnpm 转发器 → 已全局装 pnpm@9（`<NPM_GLOBAL_DIR>`）；profile 的 pnpm workspace 状态旧（virtual store 冲突）→ 采用手工安装：symlink + package.json dependencies + `dsh.profile.bundles` 登记（与既有 dsh-search-mcp 同模式）。
- 模板字面量写源码时注意：`\n` 会成为真实换行（修测试转义时踩过）；`\'` 不会保留反斜杠（字符串内撇号直接写 Unicode/换措辞）；.mjs 脚本严禁 TS 类型标注。

## 5b. 按需注入改造（v2，2026-08-14）

**需求**：agent 上下文里平时不注入 obsidian 工具与规则——需要时才注入（"像工具"），不需要时安静存在（"像未连接的 MCP"）。

**依据**（openasf.io《DeepSeek Harness 源码分析》+ 官方包 .d.ts 查证）：
- DSH 官方接入优先级：能力接入先走 MCP/配置，最后才写原生插件；但"per-agent 按需"需要原生能力：`agent.ctx`（scoped context）注册工具只对该 agent 可见；`agent/inbox/inserted` 事件在用户消息进入 inbox 时触发（早于下一轮 prompt assembly）；`tools/change` 通知 harness 重新组装。
- skill 机制（`ctx.skills.register` + `dsh-tool-skill` 目录）＝ 一行目录描述 + 按需加载完整正文，天然是"MCP 配置可见"门面。

**改造内容（已实现）**：
1. **零常驻**：移除全局工具注册与全局 systemPrompt section。唯一常驻 = `obsidian` skill 目录一行（`src/skill.ts`，announceToAgent 控制）。
2. **按需激活**（`src/activation.ts`）：监听 `agent/inbox/inserted`，用户消息命中触发词（obsidian/vault/笔记/日记/知识库/当前笔记/选中文本…，可配置 `triggerKeywords`）→ `activateAgent()` 在**该 agent 的 `agent.ctx`** 注册 14 工具 + 动态 guidance section（text 为 provider，每次 assembly 求值）。幂等（WeakSet），随 agent 销毁自动注销；其他会话永不可见。
3. **配置新增**：`autoActivate`（默认 true）、`triggerKeywords`（默认词表，设置页 schema 自动渲染）。
4. **测试**：`tests/activation.spec.ts`（触发词匹配/幂等/独立激活/skill 内容），30/30 全绿；tsc 全绿；build 产物确认无全局注册。

**与 MCP 路线的取舍**：DSH 的 mcp-client 是 profile 级全局连接（连上所有会话可见），做不到 per-agent 按需；原生 `agent.ctx` 注册才是"会话级按需"。工具名保持 `obsidian_*` 而非 `mcp__*`，规则全文走 skill 按需加载。

## 5c. 清除 browser 半区（v2.1，2026-08-14）

**判定**：已装插件（web profile 登记 `@deepseek-ai/dsh-client-ui-obsidian`）的 UI 与 v2 计划（agent 侧按需注入，非 GUI 操作面板）不符 → 整体清除 client 半区。

**已执行**：
- 删除 `src/client/`（7 文件 ~750 行：sidebar-entry.tsx 侧边栏入口、panel.tsx 浮层面板、settings-card.tsx 设置卡、rpc.ts、locales.ts、augment.ts、index.ts）。
- `package.json`：移除 `dsh.client.inject/platform` 声明与 `exports['./client']`；description 更新为 host-only。
- `scripts/build.mjs`：移除 client 构建段（__ModuleLoader__ 包装），产物仅 `lib/index.js` + types。
- 验证：tsc 0 错误；30/30 测试；构建产物确认无 client.js。
- 配置界面不受影响：host 的 `installSettingsSection` 仍在 Web 设置页渲染完整 Config 表单（vaultPath/token/mode/triggerKeywords…）。

## 5d. 激活链路修复 + 全工具实测（v2.2，2026-08-14）

**E2E 实测结论**：按需激活全链路打通（skill ✅ → 触发词 ✅ → per-agent 工具注入 ✅ → 14 工具可用 ✅）。`activation.log` 文件日志成为激活链路的标准观测手段。

**激活链路三处根因（src/activation.ts）**：
1. `UserMessage.content` 是 `ContentBlock[]` 数组而非 string → 新增 `extractText()` 提取 text 块（元凶，曾导致触发词永不命中）。
2. 激活失败静默 → `fileActivationLog()` 写 `activation.log` 全链路可观测。
3. 事件通道 → 双通道监听（`agent/inbox/inserted` + `session/event` 兜底），scope 源码确认 root 监听器收所有事件（`tag === void 0 → true`）。

**全工具实测（14/14）**：fs 通道 9 工具全通过（含中文路径/搜索、frontmatter 解析）；编辑器 5 工具在 Obsidian 未运行时错误处理正确。**实测发现并修复**：
- `obsidian_active` 不可达分支返回 `content: undefined` → lossless JSON 崩溃 → 改 `''`（src/tools/editor.ts）。
- `vaultFs.ensureParentFolder` 吞掉全部 mkdir 错误 → move 报误导性 ENOENT → 只吞 `EEXIST`，其余真实抛出（src/vault/vaultFs.ts）。

**Obsidian 运行态实测（companion 桥真实链路）**：
- 配置：token 从 `.obsidian/plugins/dsh-obsidian-bridge/data.json` 复制到 settings.yaml 的 `obsidian.companionToken`（dsh-settings 文件 watcher 热生效，无需重启）。
- `obsidian_active/open/inline_edit/command` 全通过（真实编辑器中插入/命令触发，从 /api/state 验证内容与光标）。
- **companion 侧两处 bug（已修+部署，Obsidian 重载生效）**：
  1. `listCommands` 500：Obsidian 命令注册表是 Record 不是 Map，`.values()` 抛 TypeError → 改 `Object.keys` 遍历（companion/src/main.ts）。
  2. `applyEdit` 光标不跟随：CM6 dispatch 只改内容 → 补 `selection: { anchor: from+len, head: from+len }`。
- **host 侧一处修复（需重启 dsh web 生效）**：`activeState` companion 可达但无活动笔记（path=''）时误报"不可达" → companion 可达即返回；`obsidian_active` 对空 path 返回明确错误（src/bridge/bridge.ts + src/tools/editor.ts）。

验证：tsc 0 错误；33/33 测试；构建产物确认修复在 lib。

## 6. 待办（下一步）

1. **E2E（真实环境）**：
   - 刷新 http://127.0.0.1:3080，确认设置页 Obsidian 配置表单出现（vaultPath/token/mode/triggerKeywords），侧边栏无 Obsidian 入口（client 已清除）；`dsh plugin --profile web list` 复核登记。
   - 启动 Obsidian（用户 vault 已装 companion），复制 token 到插件设置，验证 health/state/edit/open/command。
   - 新开会话验证按需激活：先发无关消息确认 obsidian_* 工具不可见、系统提示无 obsidian 规则；再发含触发词消息（如"帮我在笔记里记一下"），确认下一轮工具出现 + guidance section 注入；再开第二个会话确认互不影响。
   - 显式路径：模型主动 skill 加载 obsidian 指南（目录一行可见）。
   - 验证 Obsidian 未运行时 fs 通道仍可用。
2. **文档**：RESEARCH.md（Claudian 架构+交互模式+通道调研）、ARCHITECTURE.md（模块映射）、README.md（安装/配置/使用/安全）。
3. 清理：删 `*.log`、`.test-build`、`debug-*.mjs`、`tsconfig.tests.json` 视情况保留；`git init` + 首次提交（可选）。

## 7. 边界与假设

- v1 不做：输入框 @mention 下拉、会话持久化到 vault、Obsidian 右键菜单（记入 ARCHITECTURE.md 后续路线）。
- rest 通道依赖用户安装 Local REST API 插件；cli 通道（Obsidian 1.12+ 官方 CLI）本机未探测到，留文档。
- 写工具无额外审批门（与 Claudian 一致），工具描述明示副作用。
- companion token 自动生成于 Obsidian 侧，需人工复制到 DSH 设置（安装脚本输出指引）。
