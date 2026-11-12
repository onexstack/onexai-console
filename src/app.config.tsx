import { defineConfig } from '@/runtime';
import {
  ApiOutlined,
  AppstoreOutlined,
  BugOutlined,
  CloudServerOutlined,
  ClusterOutlined,
  CommentOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  FundViewOutlined,
  LinkOutlined,
  LockOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  ScheduleOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UsergroupAddOutlined,
} from '@ant-design/icons';
import logoUrl from './assets/logo.svg';
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

/**
 * 观测中心的 5 个视图共用同一份懒加载组件；模块级引用也保证 AppShell 的
 * lazy 缓存只创建一次。
 */
const ObservabilityPage = () => import('@/pages/Observability');

/**
 * 评测中心的 3 个占位视图共用同一份懒加载组件；模块级引用也保证 AppShell 的
 * lazy 缓存只创建一次。
 */
const EvaluationsPage = () => import('@/pages/Evaluations');

/**
 * OneX 智能平台（onexai 控制台）的声明式配置。
 *
 * # 组织方式
 *
 * 侧栏是唯一的导航来源，按「日常工作 / 智能中心 / 运维中心 / 身份与授权 /
 * 工单中心 / 观测中心 / 评测中心」分组。
 * 资源按领域收进 6 个可展开的父项（智能体 / 能力中心 / 自动化 / 运行环境 / 扩展中心 / 权限控制）：
 * 父项是 SubMenu，子项才是真实路由，因此深链、刷新、后退都成立，页面上不再另铺一排页签。
 *
 * # 身份
 *
 * 本应用不参与 OneX 的登录。`SessionGate` 在 AppShell 里包住整个路由树：
 * 没有 onexai 令牌就渲染登录页，有则放行。真正的权限闸在服务端。
 */
const appConfig = defineConfig({
  name: 'OneX 智能平台',

  base: (process.env.PUBLIC_BASE_PATH || '').replace(/\/+$/, ''),

  routes: [
    { path: '/', redirect: '/workbench', index: true },

    // 所有资源共用一条整页表单：`/<资源>/new` 与 `/<资源>/:id/edit`。
    // 静态段 `new` 在 React Router 里的优先级高于 `:id`，所以不会和
    // `/agents/:id` 这类详情路由抢；资源键由页面从第一段路径取。
    {
      path: ':resourceKey/new',
      component: () => import('@/pages/ResourceForm'),
      meta: { title: '新建', hidden: true },
    },
    {
      path: ':resourceKey/:id/edit',
      component: () => import('@/pages/ResourceForm'),
      meta: { title: '编辑', hidden: true },
    },

    {
      path: 'workbench',
      component: () => import('@/pages/Workbench'),
      meta: { title: '工作台', icon: <DashboardOutlined /> },
    },
    {
      // 个人账号页：从右上角头像菜单进入，不进侧边栏。
      path: 'account',
      component: () => import('@/pages/Account'),
      meta: { title: '账号设置', hidden: true, icon: <TeamOutlined /> },
    },
    // 修改密码已收进账号页的弹窗、飞书绑定已收进「飞书绑定」板块；
    // 旧地址保留为重定向，兼容书签与深链。
    {
      path: 'account/password',
      redirect: '/account?tab=security',
      meta: { title: '账号设置', hidden: true },
    },
    {
      path: 'account/feishu',
      redirect: '/account?tab=feishu',
      meta: { title: '账号设置', hidden: true },
    },
    {
      path: 'users',
      component: () => import('@/pages/Users'),
      meta: { title: '用户', icon: <TeamOutlined /> },
    },
    {
      path: 'users/:id/password',
      component: () => import('@/pages/Users/Password'),
      meta: { title: '重置密码', hidden: true },
    },
    {
      // 用户没有独立的新建页：新建走列表页弹窗。这条重定向挡住通用
      // `:resourceKey/new`，避免它把 /users/new 当成一个未知资源表单。
      path: 'users/new',
      redirect: '/users',
      meta: { title: '用户', hidden: true },
    },
    {
      path: 'users/:id',
      component: () => import('@/pages/Users/Detail'),
      meta: { title: '用户详情', hidden: true },
    },
    {
      path: 'user-groups',
      component: () => import('@/pages/UserGroups'),
      meta: { title: '用户组', icon: <UsergroupAddOutlined /> },
    },
    {
      path: 'user-groups/new',
      redirect: '/user-groups',
      meta: { title: '用户组', hidden: true },
    },
    {
      path: 'user-groups/:name',
      component: () => import('@/pages/UserGroups/Detail'),
      meta: { title: '用户组详情', hidden: true },
    },
    {
      path: 'namespaces',
      component: () => import('@/pages/ResourceList'),
      meta: { title: '命名空间', icon: <ClusterOutlined />, resourceKey: 'namespaces' },
    },
    {
      path: 'namespaces/:id',
      component: () => import('@/pages/ResourceDetail'),
      meta: { title: '命名空间详情', hidden: true, resourceKey: 'namespaces' },
    },
    {
      path: 'chat',
      component: () => import('@/pages/Chat'),
      meta: { title: '智能对话', icon: <CommentOutlined /> },
    },
    {
      path: 'tickets',
      component: () => import('@/pages/Tickets'),
      meta: { title: '工单管理', icon: <BugOutlined />, resourceKey: 'tickets' },
    },
    {
      path: 'tickets/:id',
      component: () => import('@/pages/Tickets/Detail'),
      meta: { title: '工单详情', hidden: true, resourceKey: 'tickets' },
    },
    {
      path: 'oncall-groups',
      component: () => import('@/pages/Oncall/GroupList'),
      meta: { title: '值班管理', icon: <ScheduleOutlined />, resourceKey: 'oncall-groups' },
    },
    {
      path: 'oncall-groups/:id',
      component: () => import('@/pages/Oncall/GroupDetail'),
      meta: { title: '值班组详情', hidden: true, resourceKey: 'oncall-groups' },
    },
    {
      // 值班周报：工单 × 值班的周期复盘占位页。后端聚合接口尚未接入，页面只渲染
      // 静态骨架、不发请求。路径刻意不以 `/tickets` 开头：access.ts 按首段把
      // `/tickets` 整组视为管理员专属，而本页对所有登录用户可见。
      path: 'oncall-weekly',
      component: () => import('@/pages/Oncall/WeeklyReport'),
      meta: { title: '值班周报', icon: <FileTextOutlined /> },
    },

    // ── 智能体 ───────────────────────────────────────────────────────────────
    {
      // 外部 A2A 注册已并入统一的智能体新建页；旧地址保留为重定向。
      path: 'a2a-agents/new',
      redirect: '/agents/new?type=external',
      meta: { title: '注册 A2A 智能体', hidden: true },
    },
    {
      // 兼容旧入口：A2A 现在是统一智能体目录的一个页签。
      path: 'a2a-agents',
      redirect: '/agents?tab=external',
      meta: { title: 'A2A 智能体', hidden: true },
    },
    {
      path: 'agents',
      component: () => import('@/pages/Agents'),
      meta: { title: '智能体', resourceKey: 'agents' },
    },
    {
      path: 'agents/:id',
      component: () => import('@/pages/ResourceDetail'),
      meta: { title: '智能体详情', hidden: true, resourceKey: 'agents' },
    },
    // 场景智能体的前端支持暂时隐藏；旧地址保留重定向到智能体列表，书签不 404。
    {
      path: 'scenarios',
      redirect: '/agents',
      meta: { title: '智能体', hidden: true },
    },
    {
      path: 'agent-templates',
      component: () => import('@/pages/ResourceList'),
      meta: { title: '模版管理', resourceKey: 'agent-templates' },
    },
    {
      path: 'agent-templates/:id',
      component: () => import('@/pages/ResourceDetail'),
      meta: { title: '模版详情', hidden: true, resourceKey: 'agent-templates' },
    },
    {
      path: 'agent-bindings',
      component: () => import('@/pages/ResourceList'),
      meta: { title: '能力编排', resourceKey: 'agent-bindings' },
    },
    {
      path: 'agent-bindings/:id',
      component: () => import('@/pages/ResourceDetail'),
      meta: { title: '能力编排详情', hidden: true, resourceKey: 'agent-bindings' },
    },
    {
      path: 'cluster-agent-bindings',
      component: () => import('@/pages/ResourceList'),
      meta: { title: '平台能力编排', resourceKey: 'cluster-agent-bindings' },
    },
    {
      path: 'cluster-agent-bindings/:id',
      component: () => import('@/pages/ResourceDetail'),
      meta: { title: '平台能力编排详情', hidden: true, resourceKey: 'cluster-agent-bindings' },
    },

    // ── 能力 ─────────────────────────────────────────────────────────────────
    {
      path: 'models',
      component: () => import('@/pages/ResourceList'),
      meta: { title: '模型管理', resourceKey: 'models' },
    },
    {
      path: 'models/:id',
      component: () => import('@/pages/ResourceDetail'),
      meta: { title: '模型详情', hidden: true, resourceKey: 'models' },
    },
    {
      path: 'knowledge-bases',
      component: () => import('@/pages/ResourceList'),
      meta: { title: '知识库管理', resourceKey: 'knowledge-bases' },
    },
    {
      path: 'knowledge-bases/:id',
      component: () => import('@/pages/ResourceDetail'),
      meta: { title: '知识库详情', hidden: true, resourceKey: 'knowledge-bases' },
    },
    {
      path: 'memories',
      component: () => import('@/pages/ResourceList'),
      meta: { title: '记忆库管理', resourceKey: 'memories' },
    },
    {
      path: 'memories/:id',
      component: () => import('@/pages/ResourceDetail'),
      meta: { title: '记忆库详情', hidden: true, resourceKey: 'memories' },
    },
    {
      path: 'skills',
      component: () => import('@/pages/ResourceList'),
      meta: { title: 'Skill 管理', resourceKey: 'skills' },
    },
    {
      path: 'skills/:id',
      component: () => import('@/pages/ResourceDetail'),
      meta: { title: 'Skill 详情', hidden: true, resourceKey: 'skills' },
    },
    {
      path: 'reference-grants',
      component: () => import('@/pages/ResourceList'),
      meta: { title: '引用授权', resourceKey: 'reference-grants' },
    },
    {
      path: 'reference-grants/:id',
      component: () => import('@/pages/ResourceDetail'),
      meta: { title: '引用授权详情', hidden: true, resourceKey: 'reference-grants' },
    },
    {
      path: 'mcps',
      component: () => import('@/pages/ResourceList'),
      meta: { title: 'MCP 管理', resourceKey: 'mcps' },
    },
    {
      path: 'mcps/:id',
      component: () => import('@/pages/ResourceDetail'),
      meta: { title: 'MCP 详情', hidden: true, resourceKey: 'mcps' },
    },
    {
      path: 'prompts',
      component: () => import('@/pages/ResourceList'),
      meta: { title: '提示词管理', resourceKey: 'prompts' },
    },
    {
      path: 'prompts/:id',
      component: () => import('@/pages/ResourceDetail'),
      meta: { title: '提示词详情', hidden: true, resourceKey: 'prompts' },
    },
    {
      path: 'custom-commands',
      component: () => import('@/pages/ResourceList'),
      meta: { title: '自定义命令', resourceKey: 'custom-commands' },
    },
    {
      path: 'custom-commands/:id',
      component: () => import('@/pages/ResourceDetail'),
      meta: { title: '自定义命令详情', hidden: true, resourceKey: 'custom-commands' },
    },

    // ── 自动化 ───────────────────────────────────────────────────────────────
    {
      path: 'scheduled-runs',
      component: () => import('@/pages/ResourceList'),
      meta: { title: '定时任务', resourceKey: 'scheduled-runs' },
    },
    {
      path: 'scheduled-runs/:id',
      component: () => import('@/pages/ResourceDetail'),
      meta: { title: '定时任务详情', hidden: true, resourceKey: 'scheduled-runs' },
    },
    {
      path: 'async-tasks',
      component: () => import('@/pages/AsyncTasks'),
      meta: { title: '异步任务' },
    },
    {
      path: 'async-tasks/:id',
      component: () => import('@/pages/AsyncTasks/Detail'),
      meta: { title: '异步任务详情', hidden: true },
    },
    {
      // 命令覆盖暂不对外暴露：只保留路由与页面本身（直接访问 URL 仍可用），
      // 不再占侧栏入口，也不会出现在从路由生成的菜单里。
      path: 'command-coverage',
      component: () => import('@/pages/CommandCoverage'),
      meta: { title: '命令覆盖', hidden: true },
    },
    {
      // 命令台暂不对外暴露：只保留路由与页面本身（直接访问 URL 仍可用），
      // 不再占侧栏、快捷跳转与工作台的入口。
      path: 'command-console',
      component: () => import('@/pages/CommandConsole'),
      meta: { title: '命令台', hidden: true },
    },

    // ── 运行环境 ─────────────────────────────────────────────────────────────
    {
      path: 'runtime-profiles',
      component: () => import('@/pages/ResourceList'),
      meta: { title: 'Runtime Profile', resourceKey: 'runtime-profiles' },
    },
    {
      path: 'runtime-profiles/:id',
      component: () => import('@/pages/ResourceDetail'),
      meta: { title: 'Runtime Profile 详情', hidden: true, resourceKey: 'runtime-profiles' },
    },
    {
      path: 'runtime-hostings',
      component: () => import('@/pages/ResourceList'),
      meta: { title: 'Runtime Hosting', resourceKey: 'runtime-hostings' },
    },
    {
      path: 'runtime-hostings/:id',
      component: () => import('@/pages/ResourceDetail'),
      meta: { title: 'Runtime Hosting 详情', hidden: true, resourceKey: 'runtime-hostings' },
    },
    {
      path: 'sandbox-templates',
      component: () => import('@/pages/ResourceList'),
      meta: { title: '沙箱模板', resourceKey: 'sandbox-templates' },
    },
    {
      path: 'sandbox-templates/:id',
      component: () => import('@/pages/ResourceDetail'),
      meta: { title: '沙箱模板详情', hidden: true, resourceKey: 'sandbox-templates' },
    },

    // ── 身份、权限与集成 ─────────────────────────────────────────────────────
    {
      // 个人访问密钥（AK/SK）：每个账号管理自己的一对凭据，与登录密码是两套
      // 东西。现已并入 `/account?tab=credentials`；旧地址保留为重定向，书签
      // 与深链继续可用（与 `/feishu-bindings` 同一处理方式）。
      path: 'credentials',
      redirect: '/account?tab=credentials',
      meta: { title: '账号设置', hidden: true },
    },
    {
      // 服务间调用的凭据（agent Secret）。仍保留路由，因为运行时托管等资源的
      // 表单会把这里当成引用候选；只是不再占一个侧栏入口。
      path: 'secrets',
      component: () => import('@/pages/ResourceList'),
      meta: { title: '服务凭据', resourceKey: 'secrets' },
    },
    {
      path: 'secrets/:id',
      component: () => import('@/pages/ResourceDetail'),
      meta: { title: '服务凭据详情', hidden: true, resourceKey: 'secrets' },
    },
    {
      path: 'policies',
      component: () => import('@/pages/Policies'),
      meta: { title: '授权策略', icon: <SafetyCertificateOutlined /> },
    },
    {
      // 静态段优先于通用 `:resourceKey/new` / `:resourceKey/:id/edit`，
      // 但显式排在前面更易读。
      path: 'policies/new',
      component: () => import('@/pages/Policies/PolicyEditor'),
      meta: { title: '新建策略', hidden: true },
    },
    {
      path: 'policies/:name/edit',
      component: () => import('@/pages/Policies/PolicyEditor'),
      meta: { title: '编辑策略', hidden: true },
    },
    {
      // 左列表 + 右详情的选中态深链；刷新后仍能直接落到某条策略。
      path: 'policies/:name',
      component: () => import('@/pages/Policies'),
      meta: { title: '授权策略', hidden: true },
    },
    // 旧地址保留重定向，兼容书签与深链。
    {
      path: 'authz-rules',
      redirect: '/policies',
      meta: { title: '授权策略', hidden: true },
    },
    {
      // 旧链接带策略名时定位到具体策略，而不是丢回列表。
      path: 'authz-rules/:id',
      component: () => import('@/pages/Policies/LegacyPolicyRedirect'),
      meta: { title: '授权策略', hidden: true },
    },
    {
      // 挂在「运维中心 → 扩展中心」下：称谓与 Auth Webhook 成对，路由仍是
      // `/webhooks`（后端资源键不变）。
      path: 'webhooks',
      component: () => import('@/pages/ResourceList'),
      meta: { title: 'Webhook', resourceKey: 'webhooks' },
    },
    {
      path: 'webhooks/:id',
      component: () => import('@/pages/ResourceDetail'),
      meta: { title: 'Webhook 详情', hidden: true, resourceKey: 'webhooks' },
    },
    {
      // 访问评审：TokenReview（认证）+ SubjectAccessReview（授权）。
      // 入口暂时隐藏：路由保留，侧栏与全局搜索都不再展示。
      path: 'auth-webhooks',
      component: () => import('@/pages/AuthWebhooks'),
      meta: { title: '认证 / 授权 Webhook', hidden: true },
    },
    {
      // 控制面扩展对象：准入 Webhook 配置、CEL 准入策略与绑定、聚合 API 注册。
      // 与 Agent Webhook 不同——那些是平台自己的业务回调，这些是 API Server
      // 自己的准入与聚合配置，直接由 oai-declserver 服务。
      // 入口暂时隐藏：路由保留，侧栏与全局搜索都不再展示。
      path: 'extensions',
      component: () => import('@/pages/Extensions'),
      meta: { title: '扩展对象', hidden: true },
    },
    {
      // 飞书绑定已迁移到 `/account?tab=feishu`；旧地址保留为重定向，书签与
      // 深链（含 `?open=`）继续可用。
      path: 'feishu-bindings',
      component: () => import('@/pages/FeishuBindings/Redirect'),
      meta: { title: '账号设置', hidden: true },
    },

    // ── 观测中心 ─────────────────────────────────────────────────────────────
    // 5 个视图是 5 条真实路由（侧栏叶子 + 页内 TAB 同步）；全部由
    // `ObservabilityPage` 按 pathname 渲染，数据来自 /v1/admin 运行聚合。
    {
      path: 'observability',
      component: ObservabilityPage,
      meta: { title: '观测总览', icon: <DashboardOutlined /> },
    },
    {
      path: 'observability/runs',
      component: ObservabilityPage,
      meta: { title: '运行分析' },
    },
    {
      path: 'observability/tokens',
      component: ObservabilityPage,
      meta: { title: 'Token 用量' },
    },
    {
      path: 'observability/agents',
      component: ObservabilityPage,
      meta: { title: '智能体健康' },
    },
    {
      path: 'observability/failures',
      component: ObservabilityPage,
      meta: { title: '异常与失败' },
    },

    // ── 评测中心（占位）──────────────────────────────────────────────────────
    // 后端评测能力尚未接入，先保留导航入口、真实路由与占位页，避免侧栏出现
    // 「配了却打不开」的死链；3 个视图共用 `EvaluationsPage` 按 pathname 渲染。
    {
      path: 'evaluations',
      redirect: '/evaluations/datasets',
      meta: { title: '评测中心', hidden: true },
    },
    {
      path: 'evaluations/datasets',
      component: EvaluationsPage,
      meta: { title: '数据集' },
    },
    {
      path: 'evaluations/tasks',
      component: EvaluationsPage,
      meta: { title: '评测任务' },
    },
    {
      path: 'evaluations/reports',
      component: EvaluationsPage,
      meta: { title: '评测报告' },
    },
  ],

  /**
   * 侧栏菜单，也是唯一导航源。
   *
   * 七个分组各自回答一个问题：日常工作（今天要做什么）、智能中心（要造什么）、
   * 运维中心（平台怎么跑）、身份与授权（谁能用什么）、工单中心（工单与值班怎么处理）、
   * 观测中心（平台跑得怎么样）、评测中心（智能体好不好用）。
   * 叶子项的 key 是真实路由；父项用 `hub:<领域>` 这种合成 key（不能复用第一个
   * 子项的路径，antd 要求 key 唯一），点父项只展开、不导航。DefaultLayout 用
   * 路径段匹配反查 `selectedKeys`，所以 `/models/<id>` 这类详情页仍能高亮
   * `/models`，`/observability/runs` 也能精确高亮到子页。
   */
  menu: [
    {
      type: 'group',
      label: '日常工作',
      children: [
        { key: '/workbench', icon: <DashboardOutlined />, label: '工作台' },
        { key: '/chat', icon: <CommentOutlined />, label: '智能对话' },
      ],
    },
    {
      type: 'group',
      label: '智能中心',
      children: [
        {
          key: 'hub:agents',
          icon: <RobotOutlined />,
          label: '智能体',
          children: [
            { key: '/agents', label: '智能体' },
            { key: '/agent-templates', label: '模版管理' },
            { key: '/agent-bindings', label: '能力编排' },
          ],
        },
        {
          key: 'hub:capabilities',
          icon: <CloudServerOutlined />,
          label: '能力中心',
          children: [
            { key: '/models', label: '模型' },
            { key: '/knowledge-bases', label: '知识库' },
            { key: '/memories', label: '记忆库' },
            { key: '/skills', label: 'Skill' },
            { key: '/mcps', label: 'MCP' },
            { key: '/prompts', label: '提示词' },
            { key: '/custom-commands', label: '自定义命令' },
          ],
        },
        {
          key: 'hub:automation',
          icon: <ThunderboltOutlined />,
          label: '自动化',
          children: [
            { key: '/scheduled-runs', label: '定时任务' },
            { key: '/async-tasks', label: '异步任务' },
          ],
        },
      ],
    },
    {
      type: 'group',
      label: '运维中心',
      children: [
        { key: '/namespaces', icon: <ClusterOutlined />, label: '命名空间' },
        {
          key: 'hub:runtime',
          icon: <DeploymentUnitOutlined />,
          label: '运行环境',
          children: [
            { key: '/runtime-profiles', label: 'Runtime Profile' },
            { key: '/runtime-hostings', label: 'Runtime Hosting' },
            { key: '/sandbox-templates', label: '沙箱模板' },
          ],
        },
        {
          // 扩展中心：把「平台向外/向内接的钩子」收在一处。Agent Webhook 是
          // 运行边界的准入与上报。认证 / 授权 Webhook 与扩展对象的入口暂时
          // 隐藏（路由仍保留），恢复时把对应叶子加回来即可。
          key: 'hub:extensions',
          icon: <AppstoreOutlined />,
          label: '扩展中心',
          children: [{ key: '/webhooks', label: 'Webhook' }],
        },
      ],
    },
    {
      type: 'group',
      label: '身份与授权',
      children: [
        {
          key: 'hub:access-control',
          icon: <LockOutlined />,
          label: '权限控制',
          children: [
            { key: '/users', label: '用户' },
            { key: '/user-groups', label: '用户组' },
            { key: '/policies', label: '授权策略' },
          ],
        },
        { key: '/reference-grants', icon: <LinkOutlined />, label: '引用授权' },
        { key: '/cluster-agent-bindings', icon: <ApiOutlined />, label: '平台能力编排' },
      ],
    },
    {
      // 工单中心：工单与值班的日常处理入口。值班周报当前是静态占位页，
      // 后端聚合尚未接入；该页对所有登录用户可见（见 runtime/access.ts）。
      type: 'group',
      label: '工单中心',
      children: [
        { key: '/tickets', icon: <BugOutlined />, label: '工单管理' },
        { key: '/oncall-groups', icon: <ScheduleOutlined />, label: '值班管理' },
        { key: '/oncall-weekly', icon: <FileTextOutlined />, label: '值班周报' },
      ],
    },
    {
      // 观测中心：全部数据来自 /v1/admin 运行聚合，仅管理员可见（access.ts）。
      type: 'group',
      label: '观测中心',
      children: [
        { key: '/observability', icon: <DashboardOutlined />, label: '观测总览' },
        {
          // 应用级观测：运行分析、Token、智能体健康与异常收进同一个子菜单。
          key: 'hub:app-observability',
          icon: <FundViewOutlined />,
          label: '应用观测',
          children: [
            { key: '/observability/runs', label: '运行分析' },
            { key: '/observability/tokens', label: 'Token 用量' },
            { key: '/observability/agents', label: '智能体健康' },
            { key: '/observability/failures', label: '异常与失败' },
          ],
        },
      ],
    },
    {
      // 评测中心：占位分组，后端评测能力尚未接入；所有登录用户可见。
      type: 'group',
      label: '评测中心',
      children: [
        { key: '/evaluations/datasets', icon: <DatabaseOutlined />, label: '数据集' },
        { key: '/evaluations/tasks', icon: <ExperimentOutlined />, label: '评测任务' },
        { key: '/evaluations/reports', icon: <FileTextOutlined />, label: '评测报告' },
      ],
    },
  ],

  theme: {
    // 主色对齐 onex-console：可点击文字、Primary 按钮背景、选中态都取这个值。
    primaryColor: '#1677FF',
    borderRadius: 6,
    // 按钮圆角单独可配；火山引擎风格与全局圆角一致，取 6px。
    buttonBorderRadius: 6,
    // 品牌标识只在顶栏出现一次；侧栏不再重复书名/副标题。
    logo: logoUrl,
  },

  layout: {
    siderCollapsedWidth: 44,
  },

  i18n: {
    defaultLocale: 'zh-CN',
    resources: {
      'zh-CN': { translation: zhCN },
      'en-US': { translation: enUS },
    },
  },

  homePath: '/workbench',
});

export default appConfig;
