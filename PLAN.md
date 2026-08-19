# dsh-obsidian 主线状态

最后更新：2026-08-19。

## 当前目标

主线 `0.2.0` 仅支持 DSH `0.1.0-rc.7`，保持 host-only，并提供完整的 Obsidian 工具集成。rc.6 / HTTP / Local REST / browser UI 历史实现保存在 `legacy/dsh-rc6` 与 `v0.1.0`，不在主线维护兼容层。

## 已实现

- DSH rc.7 精确依赖、官方 schemastery、Node `22.19+`。
- 25 个按 agent 动态注入的 `obsidian_*` 工具。
- Agent 工具、prompt、审批 listener 和 skill 的可撤销生命周期。
- rc.7 `event.data.content` 激活通道和 `exec.signal` 传播。
- 安全 Vault 核心：路径规范化、dot-directory 保护、symlink/junction containment、原子文本/二进制写入、同路径串行、SHA-256 revision、`if_match`、trash、分页搜索和大小限制。
- Companion v1：Windows named pipe / Unix socket、JSON Lines、1 MiB 限制、随机 Token、恒定时间比较、vault identity、超时与取消。
- Obsidian editor、metadata cache、frontmatter、links、attachments、commands 和 Notice 路由。
- rc.7 approval policy：危险操作、写操作、全操作和命令策略。
- Host/companion 类型检查、Node 单元与 IPC contract 测试、host/companion 构建。
- `README.md`、`ARCHITECTURE.md`、`MIGRATION.md`、`SECURITY.md`。

## 工具清单

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

## 最终验收

- `npm run typecheck`
- Companion `tsc --noEmit -p tsconfig.companion.json`
- `npm test`
- `npm run build`
- Bundle 扫描确认无 React、browser RPC、HTTP server、Local REST 或内嵌 DSH SDK。
- 在可用的真实 DSH rc.7 profile 中验证按需激活、热禁用和审批。
- 在可用的真实 Obsidian 测试 vault 中验证选区、冲突、metadata、frontmatter、links、attachments 和 command。

真实 DSH/Obsidian 环境不可用时，必须明确记录未验证项，不能以旧日志或 mock contract 冒充 E2E。
