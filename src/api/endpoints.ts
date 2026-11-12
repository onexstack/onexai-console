/**
 * 两个服务的路径常量。
 *
 * 路径逐条写全，不做复数推导：上游不是「资源名的复数」——MCP 是
 * `/v1/agent/mcpservers`、知识库是 `/v1/agent/knowledgebases`（没有连字符）、
 * 密钥在 `/v1/core/secrets`、授权规则是 `/v1/agent/authorizationrules`。
 * 按复数拼会得到一串 404，而 404 在列表页上看起来和「还没有数据」很像。
 */

/** Webhook 是命名空间资源；测试端点用查询参数定位记录。 */
function namespaceQuery(namespace?: string): string {
  return namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
}

export const AGENT = {
  agents: '/v1/agent/agents',
  /** 抓取/解析 AgentCard，不落库。 */
  agentPreview: '/v1/agent/agents/preview',
  agentCard: (name: string) => `/v1/agent/agents/${encodeURIComponent(name)}/card`,
  agentRefreshCard: (name: string) => `/v1/agent/agents/${encodeURIComponent(name)}/refresh-card`,
  agentInvoke: (name: string) => `/v1/agent/agents/${encodeURIComponent(name)}/invoke`,
  agentInvokeStream: (name: string) => `/v1/agent/agents/${encodeURIComponent(name)}/invoke/stream`,
  agentInvocations: (name: string) => `/v1/agent/agents/${encodeURIComponent(name)}/invocations`,
  agentTask: (name: string, taskId: string) =>
    `/v1/agent/agents/${encodeURIComponent(name)}/tasks/${encodeURIComponent(taskId)}`,
  agentTaskCancel: (name: string, taskId: string) =>
    `/v1/agent/agents/${encodeURIComponent(name)}/tasks/${encodeURIComponent(taskId)}/cancel`,
  /** 命名空间候选（控制面的 Kubernetes Namespace）。 */
  namespaces: '/v1/agent/namespaces',
  /** Agent.authzBackends 可引用的已启用授权后端。 */
  authzBackends: '/v1/authz/backends',
  /** Kubernetes TokenReview（认证）评审端点。 */
  tokenReviews: '/v1/authn/tokenreviews',
  /** 评审端点与调用方凭据的配置状态。 */
  authWebhookInfo: '/v1/authn/webhook-info',
  /** Kubernetes SubjectAccessReview（授权）评审端点。 */
  subjectAccessReviews: '/v1/authz/subjectaccessreviews',
  /**
   * 控制面扩展对象（准入 Webhook 配置、CEL 准入策略、APIService）。
   *
   * 只挂在管理员组下：这些对象改变的是「什么请求能进控制面」，不是某个业务资源。
   */
  extensions: '/v1/admin/extensions',
  extensionObjects: (resource: string) => `/v1/admin/extensions/${encodeURIComponent(resource)}`,
  extensionObject: (resource: string, name: string) =>
    `/v1/admin/extensions/${encodeURIComponent(resource)}/${encodeURIComponent(name)}`,
  agentTemplates: '/v1/agent/templates',
  agentBindings: '/v1/agent/agentbindings',
  agentBindingPreview: '/v1/agent/agentbindings/preview',
  /** 集群级能力编排：一条策略作用于多个命名空间的一批智能体。 */
  clusterAgentBindings: '/v1/agent/clusteragentbindings',
  runtimeProfiles: '/v1/agent/runtimeprofiles',
  runtimeHostings: '/v1/agent/runtimehostings',
  sandboxTemplates: '/v1/agent/sandboxtemplates',
  customCommands: '/v1/agent/customcommands',
  customCommandAudits: '/v1/agent/customcommands/audits',
  webhooks: '/v1/agent/webhooks',
  /** 管理员对单个 Webhook 发一次 TokenReview（认证后端在线测试）。 */
  webhookTokenReviewTest: (name: string, namespace?: string) =>
    `/v1/agent/webhooks/${encodeURIComponent(name)}/test/tokenreviews${namespaceQuery(namespace)}`,
  /** 管理员对单个 Webhook 发一次 SubjectAccessReview（鉴权后端在线测试）。 */
  webhookSubjectAccessReviewTest: (name: string, namespace?: string) =>
    `/v1/agent/webhooks/${encodeURIComponent(name)}/test/subjectaccessreviews${namespaceQuery(namespace)}`,
  scheduledRuns: '/v1/agent/scheduledruns',
  /**
   * 异步任务管理面。
   *
   * 不加 `/agent` 前缀：`AGENT_BASE_URL` 已经指向 agent 服务，路径必须从
   * `/v1` 写全；这里与调试面 `/v1/admin/agent/*` 同属管理员 bearer 组。
   */
  adminRuns: '/v1/admin/agent/runs',
  /** 运行监控聚合；`all=true` 时是全平台视图，用于监控抽屉与观测中心。 */
  adminRunMonitor: '/v1/admin/agent/runs/monitor',
  /** 长时间没有进展的运行（排队超时、租约过期、运行超时）。 */
  adminRunStuck: '/v1/admin/agent/runs/stuck',
  adminRun: (id: string) => `/v1/admin/agent/runs/${encodeURIComponent(id)}`,
  adminRunEvents: (id: string) => `/v1/admin/agent/runs/${encodeURIComponent(id)}/events`,
  adminRunCancel: (id: string) => `/v1/admin/agent/runs/${encodeURIComponent(id)}/cancel`,
  adminRunRetry: (id: string) => `/v1/admin/agent/runs/${encodeURIComponent(id)}/retry`,
  skills: '/v1/agent/skills',
  referenceGrants: '/v1/agent/referencegrants',
  mcps: '/v1/agent/mcpservers',
  mcpTest: '/v1/agent/mcpservers/test',
  knowledgeBases: '/v1/agent/knowledgebases',
  /** 对单条知识库跑一次带参数的召回测试，不落库。 */
  knowledgeBaseRetrievalTest: (name: string) =>
    `/v1/agent/knowledgebases/${encodeURIComponent(name)}/retrieval-test`,
  memories: '/v1/agent/memories',
  memory: (name: string) => `/v1/agent/memories/${encodeURIComponent(name)}`,
  memoryUserEntries: (memory: string) => `/v1/user/memories/${encodeURIComponent(memory)}/entries`,
  memoryUserEntry: (memory: string, id: string) =>
    `/v1/user/memories/${encodeURIComponent(memory)}/entries/${encodeURIComponent(id)}`,
  memoryUserSearch: (memory: string) =>
    `/v1/user/memories/${encodeURIComponent(memory)}/entries/search`,
  memoryUserBatchDelete: (memory: string) =>
    `/v1/user/memories/${encodeURIComponent(memory)}/entries/batch-delete`,
  memoryUserStats: (memory: string) => `/v1/user/memories/${encodeURIComponent(memory)}/stats`,
  memoryAdminEntries: (memory: string) =>
    `/v1/admin/agent/memories/${encodeURIComponent(memory)}/entries`,
  memoryAdminEntry: (memory: string, id: string) =>
    `/v1/admin/agent/memories/${encodeURIComponent(memory)}/entries/${encodeURIComponent(id)}`,
  memoryAdminSearch: (memory: string) =>
    `/v1/admin/agent/memories/${encodeURIComponent(memory)}/entries/search`,
  memoryAdminBatchDelete: (memory: string) =>
    `/v1/admin/agent/memories/${encodeURIComponent(memory)}/entries/batch-delete`,
  memoryAdminStats: (memory: string) =>
    `/v1/admin/agent/memories/${encodeURIComponent(memory)}/stats`,
  memoryAdminSubjects: (memory: string) =>
    `/v1/admin/agent/memories/${encodeURIComponent(memory)}/subjects`,
  memoryAdminAudit: (memory: string) =>
    `/v1/admin/agent/memories/${encodeURIComponent(memory)}/audit`,
  memoryAdminReembed: (memory: string) =>
    `/v1/admin/agent/memories/${encodeURIComponent(memory)}/reembed`,
  memoryAdminEval: (memory: string) =>
    `/v1/admin/agent/memories/${encodeURIComponent(memory)}/eval`,
  memoryAdminPurge: (memory: string, subject: string) =>
    `/v1/admin/agent/memories/${encodeURIComponent(memory)}/subjects/${encodeURIComponent(subject)}`,
  prompts: '/v1/agent/prompts',
  models: '/v1/agent/models',
  modelTest: '/v1/agent/models/test',
  /** 按需取回模型端点的 API Key 明文（仅归属人或管理员）。 */
  modelApiKey: (name: string) => `/v1/agent/models/${encodeURIComponent(name)}/api-key`,
  secrets: '/v1/core/secrets',
  /** 按需取回凭据的 Secret Key 明文（仅管理员）。 */
  secretReveal: (secretId: string) => `/v1/core/secrets/${encodeURIComponent(secretId)}/key`,
  /**
   * 当前账号自己的访问密钥（AK/SK）。
   *
   * 挂在 agent 服务上：凭据行存在 agent schema，接口由 oai-agent-apiserver
   * 提供；它和浏览器面共用同一枚令牌，但不需要管理员角色。
   */
  aksk: '/v1/aksk',
  akskKey: (id: string) => `/v1/aksk/${encodeURIComponent(id)}`,
  authzRules: '/v1/agent/authorizationrules',
  /** 用户组：成员关系存放在 agent schema，由本服务提供管理面。 */
  userGroups: '/v1/agent/usergroups',
  userGroup: (name: string) => `/v1/agent/usergroups/${encodeURIComponent(name)}`,
  debugAsk: '/v1/admin/agent/ask',
  debugApprove: '/v1/admin/agent/approve',
  debugStop: '/v1/admin/agent/stop',
  /**
   * 普通用户的运行面：以**本人**身份运行，由服务端的运行授权门决定能否使用该
   * 智能体。管理面的调试运行则以智能体 owner 的身份执行，两者不能互换。
   */
  userAsk: '/v1/user/agent/ask',
  userApprove: '/v1/user/agent/approve',
  userStop: '/v1/user/agent/stop',
} as const;

export const CHAT = {
  login: '/v1/auth/login',
  register: '/v1/auth/register',
  providers: '/v1/auth/providers',
  me: '/v1/auth/me',
  password: '/v1/auth/password',
  larkAuthorizeURL: '/v1/auth/lark/authorize-url',
  larkLogin: '/v1/auth/lark/login',
  feishuBindStart: '/v1/auth/feishu/bind/start',
  feishuBindStatus: '/v1/auth/feishu/bind/status',
  feishuBindConfirm: '/v1/auth/feishu/bind/confirm',
  feishuBind: '/v1/auth/feishu/bind',
  feishuBindings: '/v1/auth/feishu/bindings',
  /**
   * 飞书身份 → 可用智能体（@peer）的长期映射。
   *
   * 与上面的握手端点分开：握手是一次性的 `peer_bind_claim`，这里读写的是
   * `PeerBinding`。普通用户只看得到自己，管理员看得到全部，由服务端按令牌
   * 里的角色收窄，所以只有一条路径。
   */
  feishuPeerBindings: '/v1/feishu-bindings',
  feishuPeerBinding: (peerID: string) => `/v1/feishu-bindings/${encodeURIComponent(peerID)}`,
  feishuPeerBindingAgents: (peerID: string) =>
    `/v1/feishu-bindings/${encodeURIComponent(peerID)}/agents`,
  users: '/v1/users',
  user: (id: string) => `/v1/users/${encodeURIComponent(id)}`,
  userPassword: (id: string) => `/v1/users/${encodeURIComponent(id)}/password`,
  conversations: '/v1/conversations',
  history: (convId: string) => `/v1/history/${encodeURIComponent(convId)}`,
  members: (convId: string) => `/v1/members/${encodeURIComponent(convId)}`,
  search: '/v1/search',
  image: (msgId: string) => `/v1/images/${encodeURIComponent(msgId)}`,
  assetContent: (assetId: string) => `/v1/assets/${encodeURIComponent(assetId)}/content`,
  assets: '/v1/assets',
  ws: '/v1/ws',
  tickets: '/v1/tickets',
  ticket: (id: string) => `/v1/tickets/${encodeURIComponent(id)}`,
  ticketNotes: (id: string) => `/v1/tickets/${encodeURIComponent(id)}/notes`,
  oncallGroups: '/v1/oncall-groups',
  oncallGroup: (name: string) => `/v1/oncall-groups/${encodeURIComponent(name)}`,
  oncallCurrent: '/v1/oncall-current',
  oncallSchedule: (name: string) => `/v1/oncall-groups/${encodeURIComponent(name)}/schedule`,
  oncallSchedulePreview: (name: string) =>
    `/v1/oncall-groups/${encodeURIComponent(name)}/schedule/preview`,
  oncallScheduleCurrent: (name: string) =>
    `/v1/oncall-groups/${encodeURIComponent(name)}/schedule/oncall`,
  oncallScheduleTimeline: (name: string) =>
    `/v1/oncall-groups/${encodeURIComponent(name)}/schedule/timeline`,
  oncallScheduleLayerTimelines: (name: string) =>
    `/v1/oncall-groups/${encodeURIComponent(name)}/schedule/layer-timelines`,
  oncallOverrides: (name: string) =>
    `/v1/oncall-groups/${encodeURIComponent(name)}/schedule/overrides`,
  oncallOverride: (name: string, id: string) =>
    `/v1/oncall-groups/${encodeURIComponent(name)}/schedule/overrides/${encodeURIComponent(id)}`,
  oncallUnavailabilities: (name: string) =>
    `/v1/oncall-groups/${encodeURIComponent(name)}/schedule/unavailabilities`,
  oncallUnavailability: (name: string, id: string) =>
    `/v1/oncall-groups/${encodeURIComponent(name)}/schedule/unavailabilities/${encodeURIComponent(id)}`,
  oncallHolidays: (name: string) =>
    `/v1/oncall-groups/${encodeURIComponent(name)}/schedule/holidays`,
  oncallHoliday: (name: string, id: string) =>
    `/v1/oncall-groups/${encodeURIComponent(name)}/schedule/holidays/${encodeURIComponent(id)}`,
  oncallEscalation: (name: string) => `/v1/oncall-groups/${encodeURIComponent(name)}/escalation`,
  oncallEscalate: (name: string) => `/v1/oncall-groups/${encodeURIComponent(name)}/escalate`,
  commandsExec: '/v1/commands/exec',
  commandsTree: '/v1/commands/tree',
  cli: (name: string) => `/v1/cli/${encodeURIComponent(name)}`,
  chatCommands: '/v1/chat/commands',
  chatCommand: (name: string) => `/v1/chat/commands/${encodeURIComponent(name)}`,
  agentCommandCoverage: '/v1/agent-command-coverage',
} as const;

/** agent 资源的子资源。 */
export const agentSub = {
  effective: (name: string) => `${AGENT.agents}/${encodeURIComponent(name)}/effective`,
  contextSkills: (name: string) => `${AGENT.agents}/${encodeURIComponent(name)}/context-skills`,
  contextCommands: (name: string) => `${AGENT.agents}/${encodeURIComponent(name)}/context-commands`,
  executions: (name: string) => `${AGENT.scheduledRuns}/${encodeURIComponent(name)}/executions`,
  trigger: (name: string) => `${AGENT.scheduledRuns}/${encodeURIComponent(name)}/trigger`,
  cancelExecution: (name: string, id: string) =>
    `${AGENT.scheduledRuns}/${encodeURIComponent(name)}/executions/${encodeURIComponent(id)}/cancel`,
  invokeCommand: (name: string) => `${AGENT.customCommands}/${encodeURIComponent(name)}/invoke`,
  approveCommand: (name: string) => `${AGENT.customCommands}/${encodeURIComponent(name)}/approve`,
} as const;
