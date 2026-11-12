/**
 * onexai 两个服务的数据形状。
 *
 * 字段名**照抄线上**，不做 camelCase 归一：agent 服务的声明式资源是 camelCase，
 * chat 服务里值班组是 camelCase 而工单是 snake_case。统一成一种风格看起来更整齐，
 * 代价是每个字段都要记住「它在本服务里叫什么」，而排查问题时对着接口返回找字段
 * 恰恰是最常做的事。
 *
 * 只有两处做了「视图形态」的归一，都在 api 层完成：
 * - 值班组的 `agents` 线上是 JSON 字符串，这里永远是非空数组或 undefined；
 * - 值班组的 `isSplitByBizLine` / `generateWeeklyRpt` 线上是 `"true"/"false"` 字符串，
 *   这里永远是 boolean。
 */

import type { ClientConfigValue } from '@/components/ClientConfigForm/value';

// ─── agent 服务的声明式资源（/v1/agent/*、/v1/core/secrets）──────────────────

/** 资源状态。两个值的集合，不是布尔。 */
export type ResourceStatus = 'enabled' | 'disabled';

/** 时间字段是 unix 毫秒（服务端用 encoding/json，不是 protojson）。 */
export type Millis = number;

/** 智能体类型：平台定义行为，或外部 A2A 注册。 */
export type AgentKind = 'native' | 'external';
/** 执行后端：内置运行时，或 A2A 远端。 */
export type AgentExecutionMode = 'inproc' | 'a2a';

export type PlatformA2ASkill = {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
};

export type PlatformA2ACapabilities = {
  streaming?: boolean;
  pushNotifications?: boolean;
  extendedAgentCard?: boolean;
  stateTransitionHistory?: boolean;
};

export type PlatformA2AExecution = {
  runtimeRef?: string;
  endpoint?: string;
  source?: 'card-url' | 'json' | 'manual' | 'runtime';
  cardUrl?: string;
  /** 导入的 AgentCard JSON（写路径）。 */
  card?: string;
  protocolVersion?: string;
  auth?: {
    type?: string;
    apiKeyHeader?: string;
    headerNames?: string[];
    tokenUrl?: string;
    clientId?: string;
    scopes?: string[];
    audience?: string;
    clientAuth?: string;
    insecureSkipVerify?: boolean;
    hasCredentials?: boolean;
    /** 写-only：apiKey / bearer token / headers JSON。 */
    credential?: string;
    /** 写-only。 */
    clientSecret?: string;
    clearCredentials?: boolean;
  };
  timeoutSeconds?: number;
  maxConcurrentInvocations?: number;
  metadataJson?: string;
};

export type PlatformAgentExecution = {
  mode?: AgentExecutionMode;
  a2a?: PlatformA2AExecution;
};

export type PlatformAgentA2AStatus = {
  phase?: string;
  protocolVersion?: string;
  transport?: string;
  resolvedEndpoint?: string;
  cardVersion?: string;
  cardDigest?: string;
  cardFetchedAt?: Millis;
  lastSyncError?: string;
  authReady?: boolean;
  provider?: string;
  capabilities?: PlatformA2ACapabilities;
  inputModes?: string[];
  outputModes?: string[];
  skills?: PlatformA2ASkill[];
  securitySchemes?: string;
  extensions?: { uri: string; description?: string; required?: boolean }[];
  /** 最近一次有效卡片原文。 */
  card?: string;
  cardHistory?: {
    version?: string;
    digest?: string;
    fetchedAt?: Millis;
    skillCount?: number;
    interfaceCount?: number;
  }[];
};

/** 平台智能体。 */
export type PlatformAgent = {
  name: string;
  displayName?: string;
  status?: ResourceStatus;
  description?: string;
  owner?: string;
  /** native | external；空按 native 处理。 */
  kind?: AgentKind;
  execution?: PlatformAgentExecution;
  contract?: {
    allowedSkills?: string[];
    inputModes?: string[];
    outputModes?: string[];
  };
  sharing?: { allowedNamespaces?: string[] };
  /** 本智能体可委派的子智能体（后端 spec.delegates）。 */
  delegates?: ObjectReference[];
  /** 运行前后调用的 Webhook 名字（后端 spec.webhooks）；无命名空间。 */
  webhooks?: string[];
  /** A2A 观测状态，execution.mode=a2a 时出现。 */
  a2a?: PlatformAgentA2AStatus;
  phase?: string;
  source?: string;
  protocolVersion?: string;
  transport?: string;
  endpoint?: string;
  cardVersion?: string;
  cardDigest?: string;
  cardFetchedAt?: Millis;
  capabilities?: string[];
  skillNames?: string[];
  skillCount?: number;
  /** 引用的 AgentTemplate，顺序即单值字段的回退优先级。 */
  templateRefs?: ObjectReference[];
  prompts?: ObjectReference[];
  skills?: ObjectReference[];
  mcps?: ObjectReference[];
  knowledgeBases?: ObjectReference[];
  /** 工具名模式：精确名、`delete_*` 通配、或 `*`。 */
  requireApprovals?: string[];
  /** JSON 数组串，如 `["opa"]`。 */
  authzBackends?: string;
  /** 认证 Webhook 名字（type=authentication）；非空时该 Agent 的 Bearer 认证只由它们决定。 */
  authnWebhooks?: string[];
  /** 鉴权 Webhook 名字（type=authorization）；非空时该 Agent 的授权只由它们决定。 */
  authzWebhooks?: string[];
  /** 固定使用的模型；空表示由请求/部署默认决定。 */
  model?: ObjectReference;
  /** 长期记忆库；空表示不启用。 */
  memoryRef?: ObjectReference;
  /** 控制器实际解析出的模型名（spec / 模板 / Binding）。 */
  resolvedModel?: string;
  /** 这个智能体暴露的自定义命令。 */
  customCommands?: ObjectReference[];
  /**
   * 前端派生字段：labels 里的 `onexai.io/scenario=true`。
   *
   * 后端没有这个字段；`resourceDefs` 的 decode/encode 负责在 wire 形状与
   * 表单开关之间转换，写回前一定会被剥离。
   */
  scenario?: boolean;
  namespace?: string;
  labels?: Record<string, string>;
  createdAt?: Millis;
  updatedAt?: Millis;
};

/** A2A 卡片预览（不落库）。 */
export type A2APreviewResult = {
  ok?: boolean;
  message?: string;
  latencyMs?: number;
  effectiveCardUrl?: string;
  summary?: PlatformAgentA2AStatus;
  rawCard?: string;
  warnings?: string[];
};

/** Skill：一个可以从外部源拉取的技能定义。 */
export type PlatformSkill = {
  name: string;
  displayName?: string;
  status?: ResourceStatus;
  description?: string;
  /** github | gitlab | lark_doc */
  provider?: string;
  /** 提供方参数，JSON 对象串（各 provider 形状不同）。 */
  params?: string;
  cacheTtlSeconds?: number;
  /** "Yes" 时暴露为聊天命令。 */
  asCmd?: string;
  /** hosted | tool | guide 等；由 skill 子系统解释。 */
  mode?: string;
  /** 委派契约：给本地模型判断何时调用（guide 模式必填）。 */
  contract?: string;
  /** tool 模式执行的入口程序（tool 模式必填）。 */
  entrypoint?: string;
  namespace?: string;
  labels?: Record<string, string>;
  createdAt?: Millis;
  updatedAt?: Millis;
};

/** MCP：一个 MCP server。 */
export type PlatformMCP = {
  name: string;
  displayName?: string;
  description?: string;
  status?: ResourceStatus;
  mode?: string;
  /** SSE | HTTP */
  protocol?: string;
  url?: string;
  /** 请求头，JSON 对象串。 */
  headers?: string;
  /** 工具白名单；空表示不限制。 */
  allowedTools?: string[];
  requireApprovals?: string[];
  /** 工具与资源的映射，JSON 数组串。 */
  resourceMappings?: string;
  namespace?: string;
  labels?: Record<string, string>;
  createdAt?: Millis;
  updatedAt?: Millis;
};

/** 知识库：一个 RAGFlow / Dify 数据集的登记。 */
export type PlatformKnowledgeBase = {
  name: string;
  displayName?: string;
  description?: string;
  status?: ResourceStatus;
  /** dify | ragflow；空表示由服务端推断。 */
  platform?: string;
  datasetId?: string;
  scoreThreshold?: number;
  topK?: number;
  namespace?: string;
  labels?: Record<string, string>;
  createdAt?: Millis;
  updatedAt?: Millis;
};

/** 召回测试命中的一条切片，字段与后端 `KnowledgeBaseRetrievalHit` 对齐。 */
export type KnowledgeRetrievalHit = {
  chunkId?: string;
  /** 文档名；平台没有名字时回退为文档 ID。 */
  documentName?: string;
  content?: string;
  /** 平台混合相似度，排序依据。 */
  score?: number;
  /** 仅向量相似度，平台未报告时为 0。 */
  vectorScore?: number;
};

/** 一次召回测试的请求参数；未填写的可选项由后端回退到记录/部署默认值。 */
export type KnowledgeRetrievalTestInput = {
  query: string;
  topK?: number;
  scoreThreshold?: number;
  vectorSimilarityWeight?: number;
  rerank?: boolean;
  keyword?: boolean;
};

/**
 * 一次召回测试的结果。
 *
 * `ok=false`（或字段缺失）是有效业务结果，不是 HTTP 失败：后端用 `omitempty`
 * 序列化，false 会被省略，所以判断成功必须写 `ok === true`。
 */
export type KnowledgeRetrievalTestResult = {
  ok?: boolean;
  message?: string;
  hits?: KnowledgeRetrievalHit[];
  tookMs?: number;
  /** 实际生效的参数，后端回显。 */
  topK?: number;
  scoreThreshold?: number;
  vectorSimilarityWeight?: number;
  rerank?: boolean;
  keyword?: boolean;
  platform?: string;
  rerankModel?: string;
};

/** 记忆库：长期记忆的策略与作用域。 */
export type PlatformMemory = {
  name: string;
  displayName?: string;
  description?: string;
  status?: ResourceStatus;
  enabled?: boolean;
  namespace?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  embeddingVersion?: string;
  extractionEnabled?: boolean;
  extractionModel?: string;
  maxFactsPerRun?: number;
  ttlDays?: number;
  maxEntriesPerSubject?: number;
  retrievalMode?: string;
  topK?: number;
  minScore?: number;
  maxTokens?: number;
  piiRedactionEnabled?: boolean;
  piiStrategy?: string;
  blockInstructionLike?: boolean;
  allowAdminContentRead?: boolean;
  subjectMode?: string;
  owner?: string;
  labels?: Record<string, string>;
  phase?: string;
  entryCount?: number;
  subjectCount?: number;
  createdAt?: Millis;
  updatedAt?: Millis;
};

/** 记忆条目。 */
export type PlatformMemoryEntry = {
  id: string;
  namespace?: string;
  memory?: string;
  agent?: string;
  /** 写入该条目的智能体所在空间；共享记忆库下用于区分同名智能体。 */
  agentNamespace?: string;
  subject?: string;
  sessionId?: string;
  runId?: string;
  type?: string;
  status?: string;
  content?: string;
  embeddingModel?: string;
  embeddingVersion?: string;
  embeddingStatus?: string;
  source?: string;
  actor?: string;
  importance?: number;
  confidence?: number;
  accessCount?: number;
  lastAccessedAt?: number;
  expiresAt?: number;
  tags?: string[];
  metadata?: string;
  version?: number;
  createdAt?: number;
  updatedAt?: number;
};

export type MemoryScoreBreakdown = {
  final?: number;
  rrf?: number;
  vectorSimilarity?: number;
  vectorRank?: number;
  keywordRank?: number;
  recency?: number;
  importance?: number;
  confidence?: number;
};

export type MemorySearchHit = {
  entry: PlatformMemoryEntry;
  score?: number;
  breakdown?: MemoryScoreBreakdown;
  tokenCount?: number;
};

export type MemoryStats = {
  total?: number;
  byType?: Record<string, number>;
  byStatus?: Record<string, number>;
  pendingEmbeddings?: number;
  failedEmbeddings?: number;
  subjects?: number;
};

export type MemorySubject = {
  subject: string;
  entries?: number;
  lastCreatedAt?: number;
};

/** 记忆审计事件。 */
export type PlatformMemoryAudit = {
  id: string;
  memory?: string;
  subject?: string;
  entryId?: string;
  actor?: string;
  action?: string;
  source?: string;
  reason?: string;
  createdAt?: number;
};

/** 提示词。 */
export type PlatformPrompt = {
  name: string;
  displayName?: string;
  status?: ResourceStatus;
  description?: string;
  content?: string;
  namespace?: string;
  labels?: Record<string, string>;
  createdAt?: Millis;
  updatedAt?: Millis;
};

/** 模型：一个 OpenAI 兼容的接入点。 */
export type PlatformModel = {
  name: string;
  displayName?: string;
  status?: ResourceStatus;
  description?: string;
  provider?: string;
  baseUrl?: string;
  /**
   * 仅在创建响应里返回一次；Get / List 恒为空。
   *
   * 详情页通过 `GET /v1/agent/models/:name/api-key` 按需取回明文（归属人或
   * 管理员），不要把密钥放进列表/详情响应里。
   */
  apiKey?: string;
  model?: string;
  capabilities?: string[];
  owner?: string;
  /** 是否已配置 API Key（读取时只给这个布尔，不给明文）。 */
  hasAPIKey?: boolean;
  labels?: Record<string, string>;
  createdAt?: Millis;
  updatedAt?: Millis;
};

/** 密钥：AK/SK 一类凭据。 */
export type PlatformSecret = {
  secretId: string;
  /**
   * 仅在创建响应里返回一次；Get / List 恒为空。
   *
   * 详情页通过 `GET /v1/core/secrets/:secretId/key` 按需取回明文（管理员）。
   */
  secretKey?: string;
  description?: string;
  createdAt?: Millis;
  updatedAt?: Millis;
};

/** 授权规则：上游 OPA 判定所依据的那张表的行。 */
export type PlatformAuthzRule = {
  name: string;
  /** user | group | serviceaccount | namespace | * */
  subjectType?: string;
  subjectIds?: string[];
  /** agent | mcp | tool | skill | knowledgebase | namespace | k8s-namespace | service | cluster | * */
  resourceKind?: string;
  resourceNames?: string[];
  /** 仅对这些 agent 生效；空表示不限。 */
  agentNames?: string[];
  /** 资源属性过滤，JSON 对象串。 */
  resourceAttributes?: string;
  /** read | write（write 不含 read）。 */
  verbs?: string[];
  /** allow | deny（deny 优先）。 */
  effect?: string;
  status?: ResourceStatus;
  description?: string;
  owner?: string;
  createdAt?: Millis;
  updatedAt?: Millis;
};

/** 智能体模版。`spec` 是 JSON 字符串。 */
export type PlatformAgentTemplate = {
  name: string;
  displayName?: string;
  status?: ResourceStatus;
  description?: string;
  namespace?: string;
  /** 线上是 JSON 字符串；列表/详情经 `decode` 后是解析好的对象。 */
  spec?: string | Record<string, unknown>;
  createdAt?: Millis;
  updatedAt?: Millis;
};

/** 智能体绑定的引用项。 */
/**
 * 指向本组资源的引用。namespace 为空表示引用方所在命名空间；Agent spec 只允许
 * 这种本地形式，跨空间引用必须放在 AgentBinding / ClusterAgentBinding 里。
 */
export type ObjectReference = { namespace?: string; name: string };

export type AgentBindingReference = ObjectReference;

/** 智能体绑定的 spec。 */
export type AgentBindingSpec = {
  enabled?: boolean;
  displayName?: string;
  description?: string;
  owner?: { kind?: string; name?: string; apiGroup?: string };
  selector?: {
    matchExpressions?: { key: string; operator: string; values?: string[] }[];
  };
  agents?: string[];
  modelRef?: ObjectReference;
  prompts?: AgentBindingReference[];
  skills?: AgentBindingReference[];
  knowledgeBases?: AgentBindingReference[];
  /** 注意线上键名是 `mcpservers`，不是 `mcps`。 */
  mcpservers?: AgentBindingReference[];
  customCommands?: AgentBindingReference[];
  /**
   * 按命令目录的标签批量授予命令，与 `commands` 取并集。
   *
   * 每个 Command 都带 `agent.onexstack.io/group`，所以
   * `group in (duty)` 能授出整组、并跟随以后新增的命令。
   */
  commandSelector?: {
    matchLabels?: Record<string, string>;
    matchExpressions?: { key: string; operator: string; values?: string[] }[];
  };
  commands?: string[];
};

/** 智能体绑定的 status。 */
export type AgentBindingStatus = {
  observedGeneration?: number;
  matchedAgents?: number;
  missing?: string[];
  resolved?: {
    prompts?: string[];
    skills?: string[];
    mcps?: string[];
    knowledgeBases?: string[];
    customCommands?: string[];
    commands?: string[];
  };
};

/** 跨命名空间共享授权：引用方。 */
export type ReferenceGrantFrom = { group: string; kind: string; namespace: string };

/** 跨命名空间共享授权：目标方。name 为空表示该 kind 的全部对象。 */
export type ReferenceGrantTo = { group: string; kind: string; name?: string };

/** 跨命名空间共享授权。授权对象住在目标命名空间。 */
export type PlatformReferenceGrant = {
  name: string;
  namespace?: string;
  from?: ReferenceGrantFrom[];
  to?: ReferenceGrantTo[];
  labels?: Record<string, string>;
  createdAt?: number;
  updatedAt?: number;
};

/** 智能体绑定。 */
export type PlatformAgentBinding = {
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  spec?: AgentBindingSpec;
  status?: AgentBindingStatus;
  createdAt?: Millis;
  updatedAt?: Millis;
};

/** 运行配置。 */
export type PlatformRuntimeProfile = {
  name: string;
  namespace?: string;
  displayName?: string;
  status?: ResourceStatus;
  description?: string;
  owner?: string;
  kind?: string;
  endpoint?: string;
  hostingRef?: string;
  modelAccess?: string;
  authBearerSecret?: string;
  authBearerKey?: string;
  authCASecret?: string;
  authCAKey?: string;
  authInsecureVerify?: boolean;
  runTimeoutNanos?: number;
  maxConcurrentRun?: number;
  maxToolCalls?: number;
  resolvedEndpoint?: string;
  capabilities?: string;
  createdAt?: Millis;
  updatedAt?: Millis;
};

/** 运行时托管。 */
export type PlatformRuntimeHosting = {
  name: string;
  namespace?: string;
  displayName?: string;
  status?: ResourceStatus;
  description?: string;
  owner?: string;
  profileRef?: string;
  mode?: string;
  image?: string;
  command?: string[];
  env?: string;
  maxInstances?: number;
  idleTTLNanos?: number;
  resources?: string;
  instances?: string;
  createdAt?: Millis;
  updatedAt?: Millis;
};

/** 沙箱模板。 */
export type PlatformSandboxTemplate = {
  name: string;
  namespace?: string;
  displayName?: string;
  description?: string;
  status?: ResourceStatus;
  image?: string;
  command?: string[];
  env?: string[];
  ttlSeconds?: number;
  createdAt?: Millis;
  updatedAt?: Millis;
};

/** Webhook。 */
export type PlatformWebhook = {
  name: string;
  status?: ResourceStatus;
  /** run（默认）| authentication（TokenReview）| authorization（SubjectAccessReview）。 */
  type?: string;
  url?: string;
  clientConfig?: ClientConfigValue;
  secretRef?: string;
  events?: string[];
  /** 认证 Webhook 的 TokenReview.spec.audiences。 */
  audiences?: string[];
  timeoutSeconds?: number;
  /** ignore | fail */
  failureMode?: string;
  template?: string;
  owner?: string;
  createdAt?: Millis;
  updatedAt?: Millis;
};

/** 定时任务。 */
export type PlatformScheduledRun = {
  name: string;
  namespace?: string;
  displayName?: string;
  description?: string;
  status?: ResourceStatus;
  owner?: string;
  createdBy?: string;
  agent?: string;
  /** cron 表达式。 */
  schedule?: string;
  timeZone?: string;
  prompt?: string;
  paused?: boolean;
  executionTimeoutNanos?: number;
  lastExecutionId?: string;
  lastScheduledAt?: Millis;
  /** 下一次触发时间（Unix 毫秒）；暂停或表达式非法时为 0。 */
  nextScheduledAt?: Millis;
  createdAt?: Millis;
  updatedAt?: Millis;
};

/** 一条定时任务执行记录（biz 形状，snake_case）。 */
export type ScheduledExecution = {
  id: string;
  namespace?: string;
  schedule?: string;
  trigger?: 'scheduled' | 'manual' | string;
  prompt?: string;
  session_id?: string;
  run_id?: string;
  /** pending | running | completed | failed | canceled */
  state?: string;
  failure_reason?: string;
  started_at?: Millis;
  finished_at?: Millis;
  created_at?: Millis;
};

/** 自定义命令的参数。 */
export type CommandParameter = {
  name: string;
  in?: string;
  type?: string;
  description?: string;
  required?: boolean;
  defaultValue?: string;
  enums?: string[];
  format?: string;
  short?: string;
  schemaJson?: string;
};

/** 自定义命令的 prompt 定义。 */
export type PromptCommand = { template?: string };
/** 自定义命令的 http 定义。 */
export type HTTPCommand = {
  method?: string;
  url?: string;
  /** 与 url 二选一：集群内 Service。 */
  service?: { namespace?: string; name?: string; port?: number; path?: string };
  caBundle?: string;
  insecureSkipTLSVerify?: boolean;
  headers?: { name: string; value: string }[];
  /** 渲染后追加到 URL 的 query 参数。 */
  query?: Record<string, string>;
  body?: string;
  contentType?: string;
  /** Secret 名称；值作为 Bearer token 发送。 */
  secretRef?: { name?: string; namespace?: string };
  sideEffects?: string;
};
/** 自定义命令的 tool 定义。 */
export type ToolCommand = {
  /** 必须同时绑定到智能体的 MCP Server。 */
  mcpServer?: { name?: string; namespace?: string };
  tool?: string;
  argumentsTemplate?: string;
};
/** 自定义命令的输出定义。 */
export type CommandOutput = { format?: string; template?: string; schemaJson?: string };

/** 自定义命令。 */
export type PlatformCustomCommand = {
  name: string;
  displayName?: string;
  status?: ResourceStatus;
  description?: string;
  enabled?: boolean;
  /** prompt | http | tool */
  type?: string;
  aliases?: string[];
  usage?: string;
  parameters?: CommandParameter[];
  prompt?: PromptCommand;
  http?: HTTPCommand;
  tool?: ToolCommand;
  output?: CommandOutput;
  timeoutSeconds?: number;
  labels?: Record<string, string>;
  namespace?: string;
  createdAt?: Millis;
  updatedAt?: Millis;
};

/** 一次自定义命令调用的判定/结果。 */
export type InvocationStatus = {
  phase?: string;
  reason?: string;
  message?: string;
  evaluationError?: string;
  warnings?: string[];
  auditAnnotations?: Record<string, string>;
  params?: Record<string, unknown>;
  usage?: string;
  approval?: {
    approvalId?: string;
    command?: string;
    agent?: string;
    tool?: string;
    mcpServer?: string;
    argumentsJson?: string;
    expiresAt?: Millis;
    phase?: string;
  };
};

/** 自定义命令调用响应。 */
export type InvokeCustomCommandResponse = {
  uid?: string;
  kind?: string;
  name?: string;
  status?: InvocationStatus;
};

/** 自定义命令审计。 */
export type CustomCommandAudit = {
  uid?: string;
  command?: string;
  agent?: string;
  kind?: string;
  phase?: string;
  reason?: string;
  userId?: string;
  conversationId?: string;
  surface?: string;
  durationMs?: number;
  evaluationError?: string;
  createdAt?: Millis;
};

/** 智能体的生效能力视图。 */
export type EffectiveAgent = {
  agent: string;
  observed?: boolean;
  resolvedHash?: string;
  /** 控制器未能解析的引用，括号内是原因。 */
  unresolved?: string[];
  capabilities?: {
    model?: string;
    skills?: string[];
    mcps?: string[];
    knowledgeBases?: string[];
    customCommands?: string[];
    commands?: string[];
    requireApproval?: string[];
    webhooks?: string[];
    templates?: string[];
    delegates?: string[];
    sessionTools?: boolean;
  };
  bindings?: {
    total?: number;
    truncated?: boolean;
    items?: {
      name: string;
      generation?: number;
      hash?: string;
      prompt_count?: number;
      skill_count?: number;
      mcp_count?: number;
      knowledge_base_count?: number;
      command_count?: number;
    }[];
  };
};

/**
 * 测试模式选择的能力子集。
 *
 * 只包含真正参与一次运行的类别：审批策略是安全下限，聊天命令不参与运行，
 * 两者都不在这里。缺省（整个对象不发送）表示按生效能力全集运行。
 */
export type CapabilitySelection = {
  skills: string[];
  mcps: string[];
  knowledgeBases: string[];
  customCommands: string[];
};

/** 测试模式里可勾选的能力类别。 */
export type SelectableCapability = keyof CapabilitySelection;

/**
 * 调试台的一次能力组合。
 *
 * 与 `CapabilitySelection` 的语义不同：后者只能缩小智能体已有的绑定，这里
 * 就是这一轮运行的全部配置。调试台无宿主，执行主体是当前登录用户；`model`
 * 留空表示部署默认，其余空数组表示「这一类一个都不用」。
 */
export type AgentComposition = {
  model?: string;
  prompts: string[];
  skills: string[];
  mcps: string[];
  knowledgeBases: string[];
  customCommands: string[];
  /**
   * 引用方业务空间：裸名按它解析，跨空间引用按它判定 ReferenceGrant。
   * 无宿主调试台取控制台当前空间；空表示部署默认空间。
   */
  namespace?: string;
};

/** 智能体上下文技能：技能仓库中 asCmd=Yes 且加载成功的技能（候选集，不代表已被绑定授予）。 */
export type ContextSkill = {
  name: string;
  description?: string;
  repo?: string;
  provider?: string;
};

/** 智能体上下文命令：当前启用、同命名空间的自定义命令（不含内置命令与 skill: 命令）。 */
export type ContextCustomCommand = {
  name: string;
  aliases?: string[];
  parameters?: CommandParameter[];
  usage?: string;
  groups?: string[];
};

/** 绑定预览响应。 */
export type AgentBindingPreview = {
  matchedAgents?: string[];
  resolved?: {
    prompts?: string[];
    skills?: string[];
    mcps?: string[];
    knowledgeBases?: string[];
    customCommands?: string[];
    commands?: string[];
  };
  missing?: string[];
};

/** 模型连通性测试响应。`ok=false` 是有效响应，不是接口失败。 */
export type ModelTestResult = {
  /** 成功返回 true；失败时后端因 omitempty 会省略该字段。 */
  ok?: boolean;
  latencyMs?: number;
  message?: string;
};

/** MCP 连通性测试响应。`ok=false` 是有效响应，不是接口失败。 */
export type McpTestResult = {
  /** 成功返回 true；失败时后端因 omitempty 会省略该字段，必须按 === true 判断。 */
  ok?: boolean;
  latencyMs?: number;
  message?: string;
  /** 探测到的全部工具（探测时已忽略 allowedTools 白名单）。 */
  tools?: { name: string; description?: string }[];
};

// ─── chat 服务的资源（/v1/*）─────────────────────────────────────────────────

/** 登录响应。 */
export interface LoginResponse {
  token: string;
  user_id: string;
  name?: string;
  expires_at: number;
  /** 仅飞书登录返回：登录后要回到的站内路径。 */
  redirect?: string;
}

/** 登录方式；由 `/v1/auth/providers` 在未登录时给出。 */
export interface AuthProviders {
  local: boolean;
  registration: boolean;
  lark: boolean;
}

/** 平台账号。 */
export interface AccountUser {
  id: string;
  username: string;
  display_name: string;
  email?: string;
  role?: '' | 'admin' | 'sre';
  status: 'active' | 'disabled';
  provider: 'local' | 'lark';
  created_at: string;
  last_login_at?: string;
}

/** 账号上的飞书身份。 */
export interface FeishuBinding {
  open_id: string;
  union_id?: string;
  lark_user_id?: string;
  name?: string;
  avatar_url?: string;
  bound_via?: 'code' | 'oauth';
  bound_at: string;
}

/** `GET /v1/auth/me`。 */
export interface MeResponse {
  user: AccountUser;
  feishu?: FeishuBinding;
  providers: AuthProviders;
  can_change_password: boolean;
}

/** 飞书绑定握手：控制台铸出的码。 */
export interface FeishuBindStart {
  code: string;
  command: string;
  expires_at: string;
}

/** 飞书绑定握手的一步。 */
export interface FeishuBindStatus {
  bound: boolean;
  expired: boolean;
  awaiting_confirm: boolean;
}

/**
 * 飞书身份 ↔ 平台账号的两侧数据是否一致。
 *
 * `account_only` 是「账号已绑定，机器人侧还没写入」；`peer_only` 是外部身份
 * 系统推送的投影；`mismatch` 是两侧指向了不同的账号。它们都真实存在，不能
 * 折叠成一个「异常」。
 */
export type FeishuPeerBindingState = 'bound' | 'account_only' | 'peer_only' | 'mismatch';

/** 绑定指向的平台账号。 */
export interface FeishuPeerBindingAccount {
  id: string;
  username: string;
  display_name: string;
  status: 'active' | 'disabled';
}

/**
 * 飞书账号的 agent 能力编排。
 *
 * `agents` 永远是数组：空数组表示「已绑定但没有可用智能体」，与「没有这条
 * 绑定」是两种状态。控制台的写入路径最多包含 1 个名字（历史数据可能多于 1
 * 个，读取照常，保存时收敛）。
 */
export interface FeishuPeerBinding {
  backend: string;
  scope: string;
  peer_id: string;
  canonical?: string;
  agents: string[];
  source?: string;
  updated_at?: string;
  account?: FeishuPeerBindingAccount;
  feishu?: FeishuBinding;
  state: FeishuPeerBindingState;
  writable: boolean;
  can_unbind: boolean;
  readonly_reason?: string;
}

/** `GET /v1/feishu-bindings`。 */
export interface FeishuPeerBindingListResponse {
  total: number;
  page: number;
  page_size: number;
  bindings: FeishuPeerBinding[];
}

/** `GET /v1/users`。 */
export interface UserListResponse {
  total: number;
  users: (AccountUser & { feishu?: FeishuBinding })[];
}

/** 新建账号时的请求体（管理员）。创建后即可用用户名 + 密码登录。 */
export interface CreateUserInput {
  username: string;
  password: string;
  display_name?: string;
  role?: '' | 'admin' | 'sre';
  status?: 'active' | 'disabled';
}

/**
 * 一对个人访问密钥（AK/SK）。
 *
 * `secret_key` 只在创建响应里出现一次；列表永远不带它，查看明文走
 * `GET /v1/aksk/:id`。
 */
export interface AccessKey {
  id: string;
  name: string;
  access_key: string;
  enabled: boolean;
  last_used_at?: string;
  created_at: string;
}

/** `GET /v1/aksk`。 */
export interface AccessKeyListResponse {
  keys: AccessKey[];
  total: number;
  /** 当前账号最多能持有的对数。 */
  limit: number;
}

/** `POST /v1/aksk` 的响应：唯一一次带明文 SecretKey。 */
export interface AccessKeyCreated {
  key: AccessKey;
  secret_key: string;
}

/**
 * 值班组。JSON 是 camelCase（与工单相反），沿用线上字段名。
 *
 * 这张表在 chat 服务里没有角色检查——任何持令牌的调用者都能改。控制台的读写
 * 入口因此按管理员收口（见 handler/ticket.go 的注释）。
 *
 * `agents` 与两个布尔字段是**视图形态**：线上 `agents` 是 JSON 字符串，
 * `isSplitByBizLine` / `generateWeeklyRpt` 是 `"true"/"false"` 字符串；
 * 翻译只在 `api/chat.ts` 的 codec 里做一次。
 */
export type OncallGroup = {
  id?: number;
  name: string;
  displayName?: string;
  status?: string;
  shortDesc?: string;
  longDesc?: string;
  /**
   * 这个值班组给工单群加载的智能体：视图里是单个 agent 名（线上仍是 JSON
   * 数组，翻译在 `api/resourceDefs.ts` 的 codec 里做一次）。
   *
   * 业务上每组只加载一个；历史多选值在渲染/保存时收敛为第一个。
   */
  agents?: string;
  scheduleId?: string;
  allocationStrategy?: string;
  owner?: string;
  isSplitByBizLine?: boolean;
  generateWeeklyRpt?: boolean;
  source?: string;
  welcomeMessage?: string;
  namespace?: string;
  order?: number;
  createdAt?: number;

  updatedAt?: number;
};

// ─── 原生值班排班 ───────────────────────────────────────────────────────────

/** 排班来源：native 原生、regen 旧外部排班、none 未配置。 */
export type ScheduleSource = 'native' | 'regen' | 'none';

/** 轮转类型。shiftDurationSeconds 是权威值，类型只决定默认时长。 */
export type RotationType = 'daily' | 'weekly' | 'custom';

export interface ScheduleParticipant {
  userName: string;
  orderIndex: number;
}

export interface ScheduleLayer {
  name: string;
  orderIndex: number;
  rotationType: RotationType;
  /** RFC3339 绝对时刻。 */
  rotationStart: string;
  shiftDurationSeconds: number;
  participants: ScheduleParticipant[];
}

export interface ScheduleOverride {
  id: string;
  overrideUser: string;
  startTime: string;
  endTime: string;
  createdBy?: string;
  createdAt?: string;
}

export interface ScheduleUnavailability {
  id: string;
  userName: string;
  startDate: string;
  endDate: string;
  reason?: string;
  createdBy?: string;
}

export interface ScheduleHoliday {
  id: string;
  date: string;
  name: string;
  countryCode?: string;
}

export interface ScheduleDefinition {
  timezone: string;
  description?: string;
  notificationChannel?: string;
  layers: ScheduleLayer[];
}

export interface DutySchedule extends ScheduleDefinition {
  overrides: ScheduleOverride[];
  unavailabilities: ScheduleUnavailability[];
  holidays: ScheduleHoliday[];
}

export interface OncallScheduleResponse {
  group: string;
  configured: boolean;
  source: ScheduleSource;
  legacyScheduleId?: string;
  schedule?: DutySchedule;
}

export interface OncallCurrentMember {
  userName: string;
  isOverride: boolean;
  layerName?: string;
  since?: string;
  until?: string;
}

export interface OncallCurrentResponse {
  group: string;
  at: string;
  source: ScheduleSource;
  timezone?: string;
  current?: OncallCurrentMember;
  backups?: OncallCurrentMember[];
}

export interface OncallCurrentListResponse {
  items: OncallCurrentResponse[];
}

export interface TimelineSegment {
  start: string;
  end: string;
  userName: string;
  isOverride: boolean;
  layerName?: string;
}

export interface OncallTimelineResponse {
  group: string;
  from: string;
  to: string;
  timezone: string;
  segments: TimelineSegment[];
}

export interface OncallLayerTimelinesResponse {
  group: string;
  from: string;
  to: string;
  timezone: string;
  layers: Record<string, TimelineSegment[]>;
  effective: TimelineSegment[];
}

export type EscalationTargetType = 'schedule' | 'users' | 'both';

export interface EscalationTier {
  index: number;
  timeoutSeconds: number;
  targetType: EscalationTargetType;
  groupName?: string;
  userNames?: string[];
}

export interface EscalationPolicy {
  enabled: boolean;
  autoEscalate: boolean;
  autoEscalateFromLevel: number;
  tiers: EscalationTier[];
}

export interface OncallEscalationResponse {
  group: string;
  configured: boolean;
  policy?: EscalationPolicy;
}

export interface EscalationTarget {
  userName: string;
  userId?: string;
  source: string;
}

export interface EscalateResponse {
  ticketId: string;
  group: string;
  tierIndex: number;
  status: string;
  targets: EscalationTarget[];
}

/** 工单状态。 */
export type TicketStatus = 'open' | 'processing' | 'saved' | 'resolved' | 'closed';

/**
 * 工单。JSON 是 snake_case——与值班组相反。
 *
 * 只读：生命周期属于值班命令与飞书卡片（`/open` 建、`/hand` 转、`/close` 结）。
 */
export type Ticket = {
  id?: number;
  /** 本系统的业务主键。会话就是按它关联工单的。 */
  ticket_id: string;
  title?: string;
  description?: string;
  status?: TicketStatus;
  /** 级别：1 最紧急，4 最低。 */
  level?: number;
  /** 值班组 ID（就是值班组名的小写形式）。 */
  group_id?: string;
  /** 报障人。 */
  reporter_id?: string;
  reporter_name?: string;
  reporter_open_id?: string;
  /** 当前处理人。 */
  assignee_id?: string;
  assignee_name?: string;
  /** 事件平台（Regen）上的事件 ID。 */
  incident_id?: string;
  source?: string;
  /** 结案总结。 */
  summary?: string;
  resolved_at?: string;
  closed_at?: string;
  created_at?: string;
  updated_at?: string;
};

/** 一条工单处理记录（`/mark` 写下的）。 */
export type TicketNote = {
  id?: number;
  ticket_id: string;
  author_id?: string;
  author_name?: string;
  /** 这条记录写的内容。 */
  note: string;
  /** 这条记录同时标记了「需要复盘」。 */
  review?: boolean;
  /** 这条记录同时标记了「转为需求」。 */
  demand?: boolean;
  created_at?: string;
};

/** 会话（飞书群）。没有归属隔离：这是机器人所在的所有群。 */
export type Conversation = {
  id: string;
  type?: string;
  name?: string;
  avatar_url?: string;
  members?: string[];
  unread_count?: number;
  backend?: string;
  raw_id?: string;
  last_message?: {
    id?: string;
    conv_id?: string;
    sender_id?: string;
    sender_name?: string;
    content?: string;
    content_type?: string;
    create_time?: number;
    is_bot?: boolean;
  };
};

/** 图片/文件引用（媒体引用）。 */
export type ImageRef = {
  asset_id?: string;
  object_key?: string;
  url?: string;
  mime_type?: string;
  size?: number;
  width?: number;
  height?: number;
  name?: string;
  source?: string;
};

/** 一条消息。`create_time` 是 unix **秒**（chat handler 的 time.Unix()）。 */
export type ChatMessageRecord = {
  id: string;
  conv_id: string;
  sender_id?: string;
  sender_name?: string;
  content?: string;
  content_type?: string;
  images?: ImageRef[];
  create_time?: number;
  is_bot?: boolean;
  client_msg_id?: string;
};

/** 会话成员。 */
export type ConversationMember = {
  user_id: string;
  name?: string;
};

/** 命令树节点。 */
export type CommandNode = {
  name: string;
  short?: string;
  group?: string;
  dangerous?: boolean;
  flags?: { name: string; shorthand?: string; usage?: string }[];
  subcommands?: CommandNode[];
};

/** 命令目录项。 */
export type ChatCommand = {
  name: string;
  namespace?: string;
  displayName?: string;
  description?: string;
  enabled?: boolean;
  group?: string;
  aliases?: string[];
  usage?: string;
  source?: string;
  accountLevel?: boolean;
  labels?: Record<string, string>;
  createdAt?: Millis;
  updatedAt?: Millis;
};

/** 命令执行响应。 */
export type ExecCommandResponse = {
  raw?: string;
  text?: string;
  markdown?: { title?: string; content?: string; color?: string };
  error?: string;
};

/** 命令覆盖报告：一个 agent 的覆盖情况。 */
export type AgentCoverage = {
  agent: string;
  rules?: string[];
  commands?: string[];
  skills?: string[];
};

/** 命令覆盖报告。 */
export type Coverage = {
  agents?: AgentCoverage[];
  withNothing?: number;
};

/** 上传后的资产。 */
export type Asset = {
  asset_id: string;
  kind?: string;
  url?: string;
  mime_type?: string;
  size?: number;
  width?: number;
  height?: number;
  name?: string;
  source?: string;
  created_at?: Millis;
  expires_at?: Millis;
};

/** 工单查询条件。字段名与 chat 服务一致（snake_case）。 */
export interface TicketQuery {
  status?: string;
  group_id?: string;
  assignee_id?: string;
  page?: number;
  page_size?: number;
}

/** 自定义命令审计查询。 */
export interface AuditQuery {
  command?: string;
  agent?: string;
  userId?: string;
  phase?: string;
  offset?: number;
  limit?: number;
}

// ─── WebSocket 帧（pkg/wshub/message.go）───────────────────────────────────────

export type WsFrameType =
  | 'ping'
  | 'pong'
  | 'subscribe'
  | 'send'
  | 'ack'
  | 'message'
  | 'event'
  | 'error'
  | 'command_output'
  | 'command_done'
  | 'conversation_changed';

export interface WsClientFrame {
  type: WsFrameType;
  request_id?: string;
  conv_id?: string;
  payload?: unknown;
}

export interface WsServerFrame {
  type: WsFrameType;
  request_id?: string;
  payload?: unknown;
}

export interface WsSendPayload {
  content: string;
  images?: ImageRef[];
  client_msg_id?: string;
}

export interface WsAckPayload {
  client_msg_id: string;
  server_id: string;
  error?: string;
}

export interface WsMessagePayload {
  id: string;
  conv_id: string;
  sender_id?: string;
  sender_name?: string;
  content?: string;
  content_type?: string;
  images?: ImageRef[];
  create_time?: number;
  is_bot?: boolean;
  client_msg_id?: string;
}

export interface WsCommandOutputPayload {
  chunk: string;
  agent_name?: string;
  /** answer | reasoning | progress */
  kind?: string;
}

export interface WsErrorPayload {
  code?: string;
  message?: string;
}
