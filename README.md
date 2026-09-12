# pi-claude-code-ui

Claude Code 风格的 Pi TUI 主题扩展：clawd header、`⏺`/`⎿` 工具行、微光动词 working 指示器。

## 文件

| 文件 | 职责 |
|---|---|
| `index.ts` | 事件接线（session/agent 生命周期）、chrome 应用、主题应用 |
| `tick.ts` | 全局 90ms ticker（working + tool spinner 共用） |
| `tool-render.ts` | 工具调用行 + 结果块渲染、spinner 订阅 ticker、运行中 live preview（尾部 5 行） |
| `wrap-tools.ts` | `ToolExecutionComponent` 原型补丁（仅显示层，不碰执行） |
| `format.ts` | 工具标题/参数/结果摘要纯函数 |
| `working.ts` | `Thinking…/Cooking…` 微光动词 + elapsed 计时 |
| `editor.ts` | 圆角 prompt 输入框 + 右下时钟 |
| `footer.ts` | model · thinking · context% · CH% · 目录 · 分支 |
| `header.ts` | 启动 banner（以 session entry 持久化） |
| `user-message.ts` | 用户消息 `> ` 引用风原型补丁 |
| `live-thinking.ts` | 流式 thinking 展开，结束后收成 `Thought for Xs` |
| `tool-group.ts` | 连续同名工具折叠成 `⏺ Read 3 files` 一行（全部完成且未 Ctrl+O 时） |
| `live-thinking-logic.ts` | live thinking 纯函数（完成判定/时长/摘要） |

## 设计决策

- **不用 `registerTool` 重写内置工具**：`createXTool(cwd, options)` 会把加载期 cwd/operations 烘焙进去，且要逐个转发 `promptSnippet`/`constrainedSampling`/`prepareArguments`。原型补丁对执行 100% 透明，sandbox/SSH/permission 类扩展不受影响。
- **spinner pending 只看 `isPartial`**：历史重建的组件 Pi 永远不调 `markExecutionStarted()`，`executionStarted` 恒 false（曾导致 reload 后星号常闪，见 tool-render.ts 注释）。
- **主题/ thinking label 每个 load 只应用一次**：`session_start` 每次都强制切主题会跟用户 `/theme` 打架。
- **单全局 90ms ticker**：`working` 和 tool spinner 共用 `tick.ts`，`/reload` 用 `Symbol.for` 覆盖同一 key。多工具并发时一次 `requestRender`，掉线/导出路径的僵尸 entry 靠 2s staleness 自愈。
- **第三方工具按自带 renderer 保留**：不再白名单 `Agent`/`Agents` 名字。
- **live thinking**：仅在 `hideThinkingBlock=true` 时生效；Ctrl+T 展开全部时不干预。

## 已知的 Pi 版本耦合点（升级 Pi 后重点看）

1. `wrap-tools.ts` 依赖 `ToolExecutionComponent` 原型方法名（`getCallRenderer` 等）。
2. `user-message.ts` 假设 `UserMessageComponent.render()` 返回 Box padding 行（内容行 1 格前导空格、无边框）+ OSC133 顺序 `END, FINAL, START`。对不上时会自动降级（原样返回）。
3. `tool-render.ts` 假设 `ToolExecutionComponent` 对完成工具调 `updateResult(result, false)`（`isPartial=false` 即完成）。
4. `header.ts` banner 依赖 `custom` entry + `registerEntryRenderer`。
5. `tool-group.ts` 全局补 `Container.prototype.addChild`，依赖 `setToolsExpanded` 的 duck-typed `setExpanded` 和 `ToolExecutionComponent` 的 `isPartial/expanded/result` 字段。
6. `live-thinking.ts` 依赖 `AssistantMessageComponent.updateContent` + thinking `Text`/`MouseRegion` 占位，以及 `message_update` 的 `thinking_start/end`。
7. 当前针对 Pi `0.85.x` 验证。
