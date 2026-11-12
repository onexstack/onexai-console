# onexai-console

OneX智能平台控制台（独立应用）。

对接 onexai 的两个后端：

| 服务                  | 默认本机端口 | 职责                                                               |
| :-------------------- | :----------- | :----------------------------------------------------------------- |
| `oai-chat-apiserver`  | 9180         | 登录、群会话（含 WebSocket）、工单、命令、值班组/排班              |
| `oai-agent-apiserver` | 9181         | 声明式资源（智能体/能力/自动化/运行环境/平台治理）、管理面流式调试 |

两者共用同一枚 Bearer 令牌，前提是它们的 `jwt.key` 配置成同一个值。开发期
任一后端未启动，代理会返回 504，页面会提示对应服务名和端口。

## 页面组织

侧栏是唯一的导航来源，按「日常工作 / 智能中心 / 运维中心 / 身份与授权 / 工单中心 / 观测中心 / 评测中心」分组；
资源按领域收进 6 个**可展开的父项**（智能体 / 能力中心 / 自动化 / 运行环境 / 扩展中心 / 权限控制），
子项都是真实路由，页面上不再另铺一排页签：

| 导航                                                                        | 路由                                                                                                                 | 内容                                                                          |
| :-------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------- |
| 工作台                                                                      | `/workbench`                                                                                                         | 待处理工单、值班组、智能体、命令覆盖、快捷入口                                |
| 智能对话                                                                    | `/chat`                                                                                                              | 智能体直聊（流式）                                                            |
| 工单中心 → 工单管理 / 值班管理 / 值班周报                                   | `/tickets`、`/oncall-groups`、`/oncall-weekly`                                                                       | 工单队列（仅管理员）、值班组 CRUD（读登录可见）、周报占位（所有登录用户可见） |
| 智能体 → 智能体 / 模版管理 / 能力编排                                       | `/agents`、`/agent-templates`、`/agent-bindings`                                                                     | 智能体、模版、能力编排                                                        |
| 能力中心 → 模型 / 知识库 / 记忆库 / Skill / MCP / 提示词 / 自定义命令       | `/models`、`/knowledge-bases`、`/memories`、`/skills`、`/mcps`、`/prompts`、`/custom-commands`                       | AI 能力资源与长期记忆治理                                                     |
| 自动化 → 定时任务 / 异步任务                                                | `/scheduled-runs`、`/async-tasks`                                                                                    | 调度任务、异步任务（仅管理员）                                                |
| 命名空间                                                                    | `/namespaces`                                                                                                        | 业务空间隔离                                                                  |
| 运行环境 → Runtime Profile / Runtime Hosting / 沙箱模板                     | `/runtime-profiles`、`/runtime-hostings`、`/sandbox-templates`                                                       | 运行时接入与沙箱                                                              |
| 扩展中心 → Agent Webhook / Auth Webhook                                     | `/webhooks`、`/auth-webhooks`                                                                                        | 运行钩子（onStart 准入 / onEnd 上报）；Auth Webhook 占位                      |
| 身份与授权 → 权限控制（用户 / 用户组 / 授权策略） / 引用授权 / 平台能力编排 | `/users`、`/user-groups`、`/policies`、`/reference-grants`、`/cluster-agent-bindings`                                | 用户与授权（前三项仅管理员）、跨空间引用、平台级能力编排                      |
| 观测中心 → 观测总览 / 运行分析 / Token 用量 / 智能体健康 / 异常与失败       | `/observability`、`/observability/runs`、`/observability/tokens`、`/observability/agents`、`/observability/failures` | 运行聚合（仅管理员）                                                          |
| 评测中心 → 数据集 / 评测任务 / 评测报告                                     | `/evaluations/datasets`、`/evaluations/tasks`、`/evaluations/reports`                                                | 占位（所有登录用户可见）                                                      |

个人访问密钥已并入「账号设置 → 凭据管理」(`/account?tab=credentials`)；旧地址
`/credentials` 会重定向到该页。

`/command-console`（命令台）与 `/command-coverage`（命令覆盖）当前不对导航暴露：
路由与页面保留，直接访问 URL 仍可用，但侧栏、`⌘K` 与工作台都不再提供入口。

跨页交互：`⌘K` 快速跳转；工单抽屉里的「在对话中分析」会把工单号预填进对话。
「智能体」的「新建」旁有「智能创建」，直达 `/agents/new?mode=smart`；也可以
从新建页顶部的「创建方式」切换。

## 能力边界（重要）

浏览器只接**服务端用 Bearer 令牌放行**的接口。以下接口只对 AK/SK 签名调用开放，
控制台**不提供入口**，也不把密钥带进浏览器：

`/v1/agent/runs*`、`/v1/agent/approvals`、`/v1/agent/sessions/{id}/runs|fork|shares`、
`/v1/agent/revisions*`、`/v1/sandboxes*`、`/v1/chat/completions`、
`/v1/agent/ask|approve|stop`（签名面）、`/v1/authz/decisions`、`/v1/observability/*`、
`/v1/share/*`。

记忆库的配置走声明式资源面（`/v1/agent/memories`），条目走
`/v1/user/memories/{memory}/...`（普通用户，服务端强制 subject）与
`/v1/admin/agent/memories/{memory}/...`（管理员，可跨 subject）；运行时通过
AK/SK 的 `/v1/agent/memories/{memory}/...` 读写。

因此：

- **智能体直聊**按角色选择运行面：管理员走 `POST /v1/admin/agent/ask|approve|stop`
  （以智能体 owner 身份执行，便于调试别人的智能体）；普通用户走
  `POST /v1/user/agent/ask|approve|stop`（以本人身份执行，受运行授权门约束）。
  两条面都只接受 `agent + question + reasoning`，不能逐轮切换模型/Skill/知识库/MCP；
  能力由智能体的绑定决定。
- **智能创建**复用同一条运行面：`POST /v1/user/agent/ask` 以 `agent: "default"`
  运行内置助手（无工具 / 无知识库），前端把用户目标与候选目录放进 `question`，
  模型返回结构化草案；用户确认后仍走标准的 `POST /v1/agent/agents`。服务端为这个
  builtin 分支使用**每次请求独立**的会话（不累积历史），并限制输入大小；签名面
  `/v1/agent/ask` 仍然不向浏览器开放。
- 服务端**没有**调试运行的会话列表/历史查询。左侧线程是**本机记录**
  （`onexai-console_transcripts_v1`），服务端记忆按「智能体 × 当前用户」保留一份。
- 工单只读：生命周期由 `/open`、`/hand`、`/close`、`/mark` 与飞书卡片驱动。
- 值班组接口在当前后端**没有角色校验**，控制台只做界面收口，不构成安全边界。

需要运行记录/审批队列/修订/记忆时，应加一层持有 AK/SK 的 BFF，而不是让 SPA 签名。

## 开发

```bash
pnpm install
pnpm dev          # http://localhost:3010
pnpm build        # 产物在 dist/
pnpm typecheck
pnpm lint
```

开发期 API 代理由 `rsbuild.config.ts` 提供（`/api/onexai/chat`、`/api/onexai/agent`），
目标可用 `DEV_ONEXAI_*_TARGET` 覆盖；chat 代理保留 WebSocket 转发（`ws: true`）。
部署时用 `PUBLIC_ONEXAI_CHAT_BASE_URL` / `PUBLIC_ONEXAI_AGENT_BASE_URL` 指向网关。

### 账号与飞书

登录页支持账号密码注册 / 登录，以及飞书 OAuth 登录。后端在
`chat.login.allow-local` 打开时校验 `chat.user` 里的 bcrypt 口令；
`chat.login.allow-registration` 控制开放注册。飞书登录需要在后端配置
`lark.oauth-redirect-uri`（本机为 `http://localhost:3010/auth/lark/callback`），
并在飞书开放平台的「安全设置 → 重定向 URL」里登记同一个地址。

登录后从右上角头像进入「账号设置 → 飞书绑定」(`/account?tab=feishu`)，在顶部
「我的飞书」卡片里把飞书身份绑定到当前账号：控制台给出 `/bind-onex <码>`，在
飞书私聊机器人发送后，把机器人回复的 8 位确认码填回页面。绑定 / 解绑都在这张
卡片里完成。

绑定完成后，在同一页下方的「飞书身份」列表里配置这个飞书账号可用的智能体——
它就是飞书里 `@peer` 解析出的列表。普通用户只看得到并修改自己的绑定；管理员
看得到全部，也可以代改。由 onex-iam 写入的绑定在控制台只读。「用户」的
飞书列仍有直达入口。旧地址 `/feishu-bindings` 与 `/account/feishu` 都会重定向
到这里。

管理员在「用户」(`/users`) 里启用 / 禁用账号、调整角色、重置密码。

### 临时跳过登录页

只有需要临时以管理员身份跳过登录时才打开（例如还没建出第一个账号）：

```bash
DEV_BYPASS_LOGIN=true
```

`pnpm dev` 会用 `~/.onexai/oai-chat-apiserver.yaml` 的 `jwt.key` 签一枚 24 小时有效的
管理员令牌注入浏览器。**只对 dev server 生效**，构建产物不会包含令牌。

## 运行形态

- **独立运行**：自己的 dev server / 独立部署，`BrowserRouter`。
- **被 OneX 控制台嵌入**：Wujie 下走 `MemoryRouter`，前缀由宿主 `basePath` 决定；
  iframe 嵌入无需特殊配置。查询缓存与 WebSocket 在卸载时清理。

## 身份

本应用有自己的会话：`POST /v1/auth/login`（或 `/v1/auth/register`、
`/v1/auth/lark/login`）换一枚 onexai 令牌，存在 `onexai-console_onexai_token`
下。`SessionGate` 在 AppShell 层包住整个路由树，未登录时渲染登录 / 注册页。
Header 里的姓名与角色从 JWT 解出，**仅用于隐藏入口和选择运行面**；真正的闸在
服务端：

- 声明式资源面（`/v1/agent/*`、`/v1/core/*`）对**任意登录用户**开放读；写操作
  按 owner 隔离——创建时服务端把 owner 记为调用者，之后只有 owner 或管理员能
  改/删。skill、MCP、知识库、提示词这类没有 owner 列的资源是共享构件。
- 治理资源仍要求管理员：`/v1/core/secrets`、`/v1/agent/authorizationrules`；
  chat 服务的 `/v1/tickets`、`/v1/agent-command-coverage`、`/v1/users` 也一样。
- `/v1/admin/*` 整组要求管理员角色。

账号被禁用后，chat 服务会在下一次鉴权时拒绝其令牌；agent 服务目前只在令牌过期
后失效。

## 目录

```
src/
├── app.config.tsx      # 路由 / 侧栏菜单 / 主题 / i18n
├── api/                # client / endpoints / types / 资源接线 / 查询缓存 / SSE / WS
│   ├── resourceDefs.ts # 18 类资源的接线表（列表形状、编码、整行写回）
│   ├── catalog/        # 非字段扩展：附加页签、行操作
│   └── queryClient.ts  # TanStack Query 单例与全局错误桥
├── auth/               # 令牌存储、登录动作、JWT claims 展示
├── components/         # SessionGate / QuickJump / 表单 / 详情面板 / 运行面板
├── pages/              # Workbench / Chat / Tickets / ResourceList / ResourceDetail …
├── runtime/            # AppShell / 布局 / 菜单 / 主题 / i18n / Wujie
├── ui/                 # 从 onex-console 抽取的组件子集
└── lib/                # api-client / 日期 / 剪贴板 / 主题偏好
```

`src/ui` 与 `src/lib` 的部分实现与 onex-console 的共享包同源（2026-11-06 抽取），
两边的行为契约没有生成器兜底——改动其中一处时，记得同步另一处。
