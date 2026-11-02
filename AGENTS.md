# pi-glance-tps 项目记忆

给新会话的 AI 助手：先读本文件，再改代码。这里是 fork 的来龙去脉、关键决策和当前状态，避免重复排查。

## 这是什么

`pi-glance-tps` 是 [pi-glance](https://github.com/LinYS77/pi-glance) 0.7.7 的 fork，为 pi 提供圆角输入框与状态栏，并在其中内置**实时输出速度**（tokens/s），设置面板**全中文**。

- 本地仓库：`E:\pi-tach`（目录名没改，包名是 `pi-glance-tps`）
- 远程：`git@github.com:jixule/pi-glance-tps.git`（public，MIT，默认分支 main）
- 安装方式（未发布 npm）：`pi install git:github.com/jixule/pi-glance-tps`
- 设置命令：`/glance-tps`；配置目录：`~/.pi/agent/pi-glance-tps/config.json`（schema version 15）
- 本机已安装为本地路径 `E:\pi-tach`，改动后 `/reload` 即生效

## 已完成的改动（按提交）

1. `3bd0d01 feat(statusline): fork pi-glance 并内置实时速度`
   - 新增 `src/runtime/live-speed.ts`：`LiveSpeedTracker` 用流式内容估算 tokens（≈4 字符/token），≥250ms 采样窗口 + EMA α=0.3，`finish` 输出本条消息生成窗口平均值
   - `state.liveSpeed` 保存实时读数；`refresh-session` 接入 `message_start/message_update/message_end/agent_start`
   - `runtime.ts` 管 80ms spinner 计时器（仅流式且有实时段时运行，`unref`，各退出路径清理）
   - `segments/throughput.ts` 优先渲染 `⠇ 168.8 t/s` / `✓ 168.8 t/s`，tone 分档 ≥100 正常、≥30 警告、<30 错误；无实时数据时回退请求级平均
2. `b991a14 fix`：设置面板打开期间停止 spinner 计时并跳过状态栏刷新，避免与全宽 overlay 抢重绘
3. `106b7d1` / `6b9941c fix`：关闭总开关（Appearance → GlanceTps → Off）不再卸载编辑器，而是**就地降级**——编辑器保留、`config.enabled === false` 时 `render()` 走 `super.render()` 输出 Pi 原生输入框，仅退役 footer/渲染回调/Git 轮询。原因：Pi 1.2 的 `getEditorComponent()` 返回包装后的工厂，旧逻辑跳过恢复且编辑器已被卸载，输入框会彻底消失
4. `1437abc feat(settings)`：设置面板、段名、通知、配置诊断全部中文化（分区：外观/状态栏/活动状态/输入）
5. `904ce28` / `3a38a5f`：同步 README、安装命令改 git 源、配置诊断与 README 断言中文化
6. `0b42e16 chore(ci)`：`ci.yml` 改为仅 `workflow_dispatch`，不再每次 push 自动跑

## 设计约定（改代码前必读）

- **不要**在关闭插件时卸载自定义编辑器：Pi 1.2 会报告包装工厂，恢复会失败。用就地降级。
- 其他扩展已接管的 footer/编辑器不要覆盖（保留上游约定，测试有覆盖）。
- 速度段的计时器只在「正在流式 + 段已启用 + 面板未打开」时运行，不要无条件启动。
- 「无实时数据」时必须回退到请求级平均，这是上游 throughput 的语义，不要删除。
- UI 文案已中文化，改文案要同步 `tests/**` 中大量断言（包括正则与 `visibleWidth` 相关断言）。

## 测试与 CI

- 本地：`npm run test:dev`（先 `npm install`，编译到 `.tmp-test`）
- 现状：359 项，**344 通过**，13 项失败全部是上游在 Windows 的既有问题（架构测试用 POSIX 路径、`spawn npm ENOENT`、git CRLF/rename、config-io 权限抖动）。改动前用 git worktree 基线确认过，不要试图修它们。
- 新增用例：`tests/runtime/test-live-speed.ts`、`tests/surface/test-live-speed-status-line.ts`
- GitHub Actions 已不随 push 触发；需要时在 Actions 页手动 *Run workflow*。CI 在 Linux 上是否有其他断言差异尚未验证。

## 待办 / 未完成

- 仓库尚无 tag；README 写了 `@v0.1.0`，需打 `v0.1.0` tag 并推送后才可用（会触发 `release.yml` 校验并创建 Release）
- 未发布 npm；`pi-glance-tps` 在 npm registry 上仍为空闲
- 如需 CI 绿：手动跑一次，按 Runner 日志逐条修 Linux 侧断言（我看不到日志，需要提供）

## 已知环境

- Windows 10，pi 1.2.0，Node 22.22.3，npm（该仓库用 npm，不是 pnpm）
- `~/.pi/agent/settings.json` 里已移除 `npm:pi-glance`、`npm:pi-tps-was-taken`，只保留本地包 `E:\pi-tach`
- 旧的 `~/.pi/agent/pi-glance/config.json` 已迁移到 `pi-glance-tps`（沿用 everforest-light 主题，throughput 段开启）
