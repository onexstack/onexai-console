import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { Alert, App, Button, Form, Modal, Result, type FormInstance } from 'antd';
import { CheckOutlined, RightOutlined } from '@ant-design/icons';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';

import { useGoBack, useNamespace } from '@/runtime';
import { ApiError } from '@/api/client';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';
import { SecretValue, useIsMobile } from '@/ui';
import {
  MODEL_PROVIDER_DEFAULT_BASE_URLS,
  ONE_TIME_SECRET_FIELD,
  RESOURCE_BY_KEY,
  conditionFieldsOf,
  conditionMatches,
  valueAt,
  type FieldOption,
  type ResourceSpec,
} from '@/api/resources';
import NamespaceSelect from '@/components/NamespaceSelect';
import PageLayout from '@/components/PageLayout';
import ResourceFormFields from '@/components/ResourceForm';
import A2APreviewPanel from '@/pages/Agents/A2APreviewPanel';
import {
  deepMerge,
  displayNameFieldsOf,
  editableFields,
  initialValues,
  normalizeSubmit,
  setPath,
} from '@/components/ResourceForm/form-model';
import { displayNamePatch } from '@/lib/display-name';
import { scrollToTopOf } from '@/lib/scroll';
import { matchesToolPattern } from '@/lib/tool-pattern';

import ReviewStep from './ReviewStep';
import WebhookTemplateHelp from './WebhookTemplateHelp';
import CreateModeSwitch, { type CreateMode } from './CreateModeSwitch';
import SmartCreatePanel from './smartCreate/SmartCreatePanel';
import type { SmartDraft } from './smartCreate/types';
import { MCPConnectionTestPanel, useMcpConnectionTest } from './MCPConnectionTest';
import styles from './styles.module.scss';

/** 内置提供方的默认地址集合：用来判断当前 baseUrl 是不是表单自动带出的。 */
const MODEL_PROVIDER_DEFAULT_ADDRESSES = new Set(Object.values(MODEL_PROVIDER_DEFAULT_BASE_URLS));

/** 汇总步骤是合成的，不属于任何详情页签。 */
const REVIEW_STEP_KEY = '__review__';
const REVIEW_STEP_LABEL = '信息确认';

/** 「工具与审批」里依赖连通性测试结果的两个字段。 */
const MCP_TOOL_FIELDS = ['allowedTools', 'requireApprovals'] as const;

/** 新建智能体但页头还没选具体业务空间时的提示。 */
const AGENT_NAMESPACE_REQUIRED = '请先在页头选择业务空间，再配置智能体的能力';

/** antd 的 NamePath：字段键 `spec.enabled` 对应 `['spec', 'enabled']`。 */
type FieldName = (string | number)[];

/**
 * 草案 → 手动表单。
 *
 * 「微调」从 location.state 预填和智能创建直接确认走的是同一份映射；写成
 * 一份，新增草案字段时才不会只改到其中一处。
 */
function applyDraftToForm(form: FormInstance<Record<string, unknown>>, draft: SmartDraft): void {
  form.setFieldsValue({
    name: draft.name,
    displayName: draft.displayName,
    description: draft.description,
    status: draft.status,
    model: draft.model || undefined,
    knowledgeBases: draft.knowledgeBases.map(item => item.name),
    mcps: draft.mcps.map(item => item.name),
    skills: draft.skills.map(item => item.name),
    prompts: (draft.prompts ?? []).map(item => item.name),
    customCommands: draft.customCommands.map(item => item.name),
    templateRefs: draft.templateRefs ?? [],
  });
}

/**
 * 资源的新建/编辑页。
 *
 * 两条路由共用：`/<资源>/new` 与 `/<资源>/:id/edit`。列表页与详情页只负责跳转，
 * 表单本身由资源描述符驱动 —— 加一类资源不需要再加一个页面。
 *
 * # 分步与版式
 *
 * 步骤来自详情页签（`spec.tabs`）里可编辑的那部分，最后追加一个只读的
 * 「信息确认」。步骤条对齐腾讯云（`~/22.png`）：已完成是主色圆 + 对勾，当前是
 * 主色圆 + 数字，未到是灰圆 + 灰数字；字段区沿用火山引擎表单的版式 —— 标签在左、
 * 必填红星在标签前、说明文字在控件下方。
 *
 * # 为什么所有分区都挂载
 *
 * 非当前分区只是 `hidden`，`Form.Item` 仍然注册在表单里。这样最后一步或提交时
 * 的 `validateFields()` 能覆盖全部字段；条件渲染会让未来分区的必填规则直接消失，
 * 校验假通过。
 */
export default function ResourceFormPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile('lg');
  const { message, notification } = App.useApp();
  const [form] = Form.useForm<Record<string, unknown>>();

  const segments = location.pathname.split('/').filter(Boolean);
  const key = segments[0] ?? '';
  const isCreate = segments[1] === 'new';
  const id = decodeURIComponent(isCreate ? '' : (segments[1] ?? ''));
  const spec = RESOURCE_BY_KEY[key];
  const namespace = useNamespace();

  // 当前登录用户只用于「创建人字段」（见 handleSubmit），不做鉴权。
  const token = useSessionToken();
  const claims = useMemo(() => decodeClaims(token), [token]);

  const [searchParams, setSearchParams] = useSearchParams();
  /** 「微调」把草案放进 location.state，手动页只消费一次。 */
  const seedDraft = useMemo(
    () => (location.state as { draft?: SmartDraft } | null)?.draft,
    [location.state]
  );

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const [step, setStep] = useState(0);
  /** 校验失败后要滚到的字段；等切到目标分区渲染完成后再执行。 */
  const [scrollTarget, setScrollTarget] = useState<FieldName | null>(null);
  /** 步骤条：切步时把内容区滚回顶部。 */
  const stepsRef = useRef<HTMLElement>(null);
  /** 上一次真正生效的步骤：首帧不滚动，页面保持初始位置。 */
  const lastStepRef = useRef(step);

  const goBack = useGoBack(`/${key}`);

  /**
   * 保存/创建成功后的统一去向：回到该资源的列表页。
   *
   * 用 `replace` 顶掉表单页：提交成功后，后退回到一张还带着旧值、可以再次提交的
   * 表单没有意义。编辑、新建与一次性密钥弹窗都走这里，三条成功出口只有一份实现。
   */
  const leaveToList = () => navigate(`/${key}`, { replace: true });

  // MCP 的「工具与审批」步必须先通过连通性测试才能离开；其他资源这个 hook
  // 是空操作（enabled=false），不会发请求。
  const mcpTest = useMcpConnectionTest({
    enabled: key === 'mcps',
    spec,
    form,
    isCreate,
  });
  const resetMcpTest = mcpTest.reset;

  // 新建时「显示名」默认跟随「名称」，直到用户亲手改过显示名。
  const displayNameFields = useMemo(() => (spec ? displayNameFieldsOf(spec) : null), [spec]);
  const displayNameEdited = useRef(false);

  /**
   * 选择内置提供方时带出默认接入地址。
   *
   * 只覆盖空值或上一次自动带出的地址：用户手填的自定义网关不能被切换提供方
   * 冲掉。上游 Model 对象把 endpoint 声明为必填，地址为空会在写入控制面时
   * 被拒绝，最终只看到一句 “A database write operation failed.”。
   */
  const handleValuesChange = (changed: Record<string, unknown>) => {
    // 必须放在下面的提前 return 之前：显示名同步对所有资源生效。
    if (isCreate && displayNameFields) {
      const patch = displayNamePatch(changed, displayNameFields, displayNameEdited);
      if (patch) form.setFieldValue(patch.name, patch.value);
    }

    // 改变创建方式会整组替换页签（平台 ↔ 外部 A2A）；停在原来的第 N 步会
    // 落到一个语义完全不同的分区上，直接回到第一步。
    if (key === 'agents' && Object.prototype.hasOwnProperty.call(changed, 'kind')) {
      setStep(0);
    }

    // 连接参数变了，上一次测试结果立即作废（下一次「下一步」会重新测试）。
    if (
      key === 'mcps' &&
      ['protocol', 'url', 'headers'].some(field =>
        Object.prototype.hasOwnProperty.call(changed, field)
      )
    ) {
      resetMcpTest();
    }

    if (key !== 'models' || !Object.prototype.hasOwnProperty.call(changed, 'provider')) return;
    const provider = typeof changed.provider === 'string' ? changed.provider : '';
    const current = form.getFieldValue('baseUrl');
    if (
      typeof current === 'string' &&
      current !== '' &&
      !MODEL_PROVIDER_DEFAULT_ADDRESSES.has(current)
    ) {
      return;
    }
    form.setFieldValue('baseUrl', MODEL_PROVIDER_DEFAULT_BASE_URLS[provider] ?? '');
  };

  const query = useQuery({
    queryKey: ['res', key, 'item', id],
    queryFn: async () => {
      if (!spec) throw new Error(`未知资源：${key}`);
      return spec.binding.api.get(id);
    },
    enabled: Boolean(spec && !isCreate && id),
  });

  const record = (query.data ?? null) as Record<string, unknown> | null;

  /**
   * 「创建方式」只在新建智能体页出现，位置固定，不随智能体类型变化。
   *
   * 智能创建只面向平台智能体：从外部 A2A 点「智能创建」（或带
   * `?type=external&mode=smart` 直达）时，把类型带回平台并恢复内置执行方式，
   * 避免草案按外部注册字段提交。
   */
  const createType = searchParams.get('type') === 'external' ? 'external' : 'native';
  const watchedKind = Form.useWatch('kind', form) as string | undefined;
  const currentKind =
    watchedKind ?? (typeof record?.kind === 'string' ? record.kind : undefined) ?? createType;
  const isAgentCreate = isCreate && key === 'agents';
  /**
   * 新建必须落到一个具体业务空间。
   *
   * 页头的「全部空间」对列表是筛选语义，对创建没有意义：后端会把对象静默
   * 落到部署默认空间，而引用候选若按“全部空间”展开就会绕过 ReferenceGrant
   * 过滤。空间不定时不允许提交；智能体还额外不允许进入能力步骤。
   */
  const needsCreateNamespace = isCreate && Boolean(spec?.namespaceField) && !namespace;
  const needsAgentNamespace = isAgentCreate && !namespace;
  const smartMode = isAgentCreate && !needsAgentNamespace && searchParams.get('mode') === 'smart';

  // 选好业务空间后，把“请先选择业务空间”的提示清掉；其他错误保持不动。
  useEffect(() => {
    if (needsAgentNamespace) return;
    setError(prev => (prev === AGENT_NAMESPACE_REQUIRED ? null : prev));
  }, [needsAgentNamespace]);

  useEffect(() => {
    if (!smartMode || currentKind !== 'external') return;
    form.setFieldsValue({ kind: 'native', execution: { mode: 'inproc' } });
    setStep(0);
  }, [smartMode, currentKind, form]);

  /**
   * 条件字段只订阅自己依赖的路径。
   *
   * `Form.useWatch([], form)` 会让整张表单每次按键都重渲染；这里的 selector 返回
   * 一个“条件结果对象”，rc-field-form 内部按 JSON 比较，只有条件真的变化时才触发
   * 本页重渲染。
   */
  const conditionFields = useMemo(() => (spec ? conditionFieldsOf(spec) : []), [spec]);
  const selectConditions = useCallback(
    (values: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const field of conditionFields) out[field] = valueAt(values, field);
      return out;
    },
    [conditionFields]
  );
  const liveConditions = Form.useWatch(selectConditions, form);
  /** 表单值优先；未挂载/只读字段（编辑时的 kind、execution.mode）回退到记录。 */
  const readCondition = useCallback(
    (path: string) => liveConditions?.[path] ?? valueAt(record ?? {}, path),
    [liveConditions, record]
  );

  /**
   * 引用候选的作用域命名空间。
   *
   * 新建跟随页头选择，编辑以记录自身所在空间为准（编辑不能改空间，页头选择
   * 只是浏览维度）。只有声明了 `namespaceField` 的资源才收窄 —— 模型这类
   * 集群级资源的引用候选不能被页头选择误过滤。
   *
   * 新建智能体页头必须选具体空间（见 `needsAgentNamespace`）；候选 hook 对
   * Agent 的空 scope 失败关闭，不会把「全部空间」翻译成带 namespace 的引用。
   */
  const recordNamespace = typeof record?.namespace === 'string' ? record.namespace : '';
  const scopeNamespace = spec?.namespaceField
    ? isCreate
      ? namespace
      : recordNamespace || namespace
    : '';

  // 同一个页面组件可能被两条路由复用（`/x/new` ↔ `/x/1/edit`）：身份一变
  // 就清空上一次的表单和步骤，避免旧值/旧步骤串到另一条资源上。
  const identity = `${key}/${isCreate ? 'new' : id}`;
  useEffect(() => {
    displayNameEdited.current = false;
    setInitialized(false);
    setStep(0);
    // 身份切换后同样从卡片顶部开始，不要跳去步骤条。
    lastStepRef.current = 0;
    setScrollTarget(null);
    form.resetFields();
    resetMcpTest();
  }, [identity, form, resetMcpTest]);

  // 分区 = 详情页签里可编辑的那部分 + 兜底的「其他」。顺序跟着描述符走，
  // 所以同一资源的新建页与详情页看起来是同一套结构。
  const sections = useMemo(
    () => (spec ? sectionsOf(spec, isCreate, readCondition) : []),
    [spec, isCreate, readCondition]
  );

  // MCP 的「工具与审批」是最后一个可编辑分区，也是提交前的最后一道门：
  // 连通性没通过就不允许进入「信息确认」。
  const mcpToolsIndex =
    key === 'mcps' ? sections.findIndex(section => section.key === 'tools') : -1;

  /**
   * 连通性测试发现的工具，作为「允许的工具 / 需审批的工具」的候选。
   *
   * 测试没通过（或连接参数刚改过、结果已作废）时不给候选，两个字段也保持禁用：
   * 否则用户会面对一个空下拉，却不知道要先测连接。
   */
  const mcpTools = useMemo<FieldOption[]>(() => {
    if (key !== 'mcps' || mcpTest.state?.ok !== true) return [];
    return (mcpTest.state.tools ?? []).map(tool => ({
      value: tool.name,
      label: tool.name,
      description: tool.description?.trim() || undefined,
    }));
  }, [key, mcpTest.state]);

  const mcpToolsUnlocked = key !== 'mcps' || mcpTest.state?.ok === true;

  /** 当前「允许的工具」；空数组表示允许全部，此时审批候选也是全部工具。 */
  const watchedAllowedTools = Form.useWatch('allowedTools', form) as string[] | undefined;
  const allowedToolPatterns = useMemo(
    () => (watchedAllowedTools ?? []).map(String).filter(Boolean),
    [watchedAllowedTools]
  );

  // 「需审批的工具」只能从「允许的工具」范围内选：先按允许的模式过滤候选。
  const mcpApprovalTools = useMemo(() => {
    if (key !== 'mcps' || allowedToolPatterns.length === 0) return mcpTools;
    return mcpTools.filter(tool =>
      allowedToolPatterns.some(pattern => matchesToolPattern(String(tool.value), pattern))
    );
  }, [key, mcpTools, allowedToolPatterns]);

  const mcpToolFieldOptions = useMemo(
    () =>
      key === 'mcps' ? { allowedTools: mcpTools, requireApprovals: mcpApprovalTools } : undefined,
    [key, mcpTools, mcpApprovalTools]
  );
  const mcpToolFieldsDisabled = key === 'mcps' && !mcpToolsUnlocked ? MCP_TOOL_FIELDS : undefined;

  // 收窄「允许的工具」后，把已选但已经不被允许的审批工具清掉，避免提交一条
  // 自相矛盾的配置。允许列表为空（允许全部）时保持原值不动。
  //
  // 用签名只在「允许集合 / 探测结果」真正变化时裁一次：approvals 是自由输入的
  // tags，若每次输入都重跑，用户刚敲下的通配模式（如 delete_*）会在同一拍被删。
  const prunedSignature = useRef<string | null>(null);
  useEffect(() => {
    if (key !== 'mcps' || mcpTest.state?.ok !== true) return;
    if (allowedToolPatterns.length === 0) {
      prunedSignature.current = null;
      return;
    }
    const signature = JSON.stringify([allowedToolPatterns, mcpTools.map(tool => tool.value)]);
    if (prunedSignature.current === signature) return;
    prunedSignature.current = signature;

    const current = (form.getFieldValue('requireApprovals') as string[] | undefined) ?? [];
    // `*` 是「对全部允许工具的审批策略」，不因为当前探测不到同名工具而丢弃。
    const kept = current.filter(
      name =>
        String(name) === '*' ||
        allowedToolPatterns.some(pattern => matchesToolPattern(String(name), pattern))
    );
    if (kept.length === current.length) return;
    form.setFieldsValue({ requireApprovals: kept.length ? kept : undefined });
  }, [key, mcpTest.state?.ok, allowedToolPatterns, mcpTools, form]);

  // 最后一步是只读汇总。sections 为空时（没有可填字段的资源）不追加，
  // 避免出现一个空白的「信息确认」。
  const steps = useMemo(
    () => [
      ...sections.map(section => ({ key: section.key, label: section.label })),
      ...(sections.length > 0 ? [{ key: REVIEW_STEP_KEY, label: REVIEW_STEP_LABEL }] : []),
    ],
    [sections]
  );

  const reviewStepIndex = sections.length;
  const currentStep = sections.length > 0 ? Math.min(step, reviewStepIndex) : 0;
  const isReview = sections.length > 0 && currentStep === reviewStepIndex;
  const currentSection = isReview ? undefined : sections[currentStep];
  const submitOnly = sections.length === 0;

  useEffect(() => {
    if (!spec || initialized) return;
    if (isCreate) {
      const values = initialValues(spec, null, true);
      // 新建时沿用页头选中的业务空间；只有表单里仍渲染 namespace 字段的资源
      // 才走这里（其余资源由描述符的 namespaceField 在提交时补齐）。没有选中
      // 空间时不填，保持「留空使用部署默认」的既有语义。
      if (namespace && editableFields(spec, true).some(field => field.key === 'namespace')) {
        values.namespace = namespace;
      }
      // 列表页的「接入 A2A 智能体」直达 `?type=external`：类型在表单里可改，
      // 这里只负责把直达入口的初始值填好。带 `?mode=smart` 时按平台智能体
      // 初始化 —— 智能创建只产出平台智能体，不能沿用外部注册的执行方式。
      if (key === 'agents') {
        // 智能创建只产出平台智能体，不能沿用外部注册的执行方式。
        const initialKind = smartMode ? 'native' : createType;
        setPath(values, 'kind', initialKind);
        if (initialKind === 'external') {
          setPath(values, 'execution.mode', 'a2a');
          setPath(values, 'execution.a2a.source', 'card-url');
        }
      }
      form.setFieldsValue(values);
      setInitialized(true);
      return;
    }
    if (record) {
      form.setFieldsValue(initialValues(spec, record, false));
      setInitialized(true);
    }
  }, [spec, isCreate, record, form, initialized, namespace, createType, smartMode, key]);

  // 「微调」：把智能草案写进手动表单。放在初始化 effect 之后，确保覆盖
  // 初始值；写完立刻清掉 location.state，刷新/返回不会再次灌入旧草案。
  useEffect(() => {
    if (!seedDraft) return;
    applyDraftToForm(form, seedDraft);
    navigate(location.pathname, { replace: true, state: null });
  }, [seedDraft, form, navigate, location.pathname]);

  // 切步后滚回内容顶部，否则从长分区走到短分区时会停在上一段的滚动位置。
  // 用 `scrollTop = 0` 而不是 `scrollIntoView`：后者会把步骤条顶到滚动区顶边，
  // 连带把页头下方的灰底间距、卡片边框与内边距一起滚出视口，页面看起来像被上移了。
  // 首帧 / 同一身份的重置不滚。
  useEffect(() => {
    if (lastStepRef.current === step) return;
    lastStepRef.current = step;
    scrollToTopOf(stepsRef.current);
  }, [step]);

  // 校验失败的目标字段：等目标分区已经显示（有布局）后再滚，`scrollToField`
  // 对 `display: none` 的元素不会产生任何滚动。
  useEffect(() => {
    if (!scrollTarget) return;
    const raf = requestAnimationFrame(() => {
      form.scrollToField(scrollTarget, { behavior: 'smooth', block: 'center' });
      setScrollTarget(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollTarget, form]);

  if (!spec || !spec.binding.writable || (!isCreate && !id)) {
    return (
      <Result
        status="404"
        title="未知资源"
        subTitle={`这个应用里没有「${key}」这一页，或者它不支持新建/编辑。`}
      />
    );
  }

  if (!isCreate && query.isError) {
    return (
      <Result
        status="error"
        title="读取失败"
        subTitle={
          (query.error as Error | null)?.message ?? '这个资源不存在，或者你没有权限查看它。'
        }
        extra={<Button onClick={() => void query.refetch()}>重试</Button>}
      />
    );
  }

  const title = `${isCreate ? '新建' : '编辑'}${spec.name}`;
  const loadingRecord = !isCreate && query.isLoading;

  /**
   * 一次性密钥弹窗的文案。
   *
   * 模型与凭据的密钥现在都能在详情页按需查看，凭据仍是一次性的：判据就是字段
   * 描述符上有没有 `reveal`，不再维护第二张「哪些资源能再看」的映射表。
   */
  const secretFieldSpec = secret
    ? spec.fields.find(field => field.key === secret.label)
    : undefined;
  const revealableSecret = Boolean(secretFieldSpec?.reveal);
  const secretLabel = secretFieldSpec?.label ?? secret?.label ?? '密钥';

  /** 字段键 `spec.enabled` → antd 的 NamePath `['spec','enabled']`。 */
  const namePathsOf = (section: Section): FieldName[] =>
    section.fields.map(fieldKey => fieldKey.split('.'));

  const firstErrorName = (err: unknown): FieldName | undefined =>
    (err as { errorFields?: { name?: FieldName }[] }).errorFields?.[0]?.name;

  /**
   * 校验失败后切到出错字段所在分区，并安排滚动。
   *
   * 只记录目标、不立即滚：目标字段可能在被 `hidden` 隐藏的分区里，没有布局时
   * 滚动是空操作；真正的滚动由上面的 effect 在切步渲染后执行。
   */
  const revealField = (name: FieldName) => {
    const fieldKey = name.map(String).join('.');
    const index = sections.findIndex(section => section.fields.includes(fieldKey));
    if (index >= 0) setStep(index);
    setScrollTarget(name);
  };

  /** 校验指定字段（不传 = 全部）；失败时自动露出第一个错误字段。 */
  const validate = async (names?: FieldName[]): Promise<boolean> => {
    try {
      await form.validateFields(names);
      return true;
    } catch (err) {
      const name = firstErrorName(err);
      if (name) revealField(name);
      return false;
    }
  };

  const handleSubmit = async (): Promise<boolean> => {
    if (needsAgentNamespace) {
      setError(AGENT_NAMESPACE_REQUIRED);
      return false;
    }

    let values: Record<string, unknown>;
    try {
      values = await form.validateFields();
    } catch (err) {
      // 校验失败：切到第一个出错的字段所在分区再滚过去。在「信息确认」步时
      // 所有分区都是隐藏的，直接 scrollToField 不会动。
      const name = firstErrorName(err);
      if (name) revealField(name);
      return false;
    }

    const normalized = normalizeSubmit(spec, values, isCreate, record);
    if (normalized.error) {
      setError(normalized.error);
      return false;
    }

    // 领域派生/裁剪：例如外部 A2A 强制 mode=a2a、native 切回 inproc 时清掉
    // execution.a2a。必须放在 deepMerge 之前，且用 undefined 自有属性覆盖记录值。
    spec.submitTransform?.(normalized.values, { isCreate, record });

    // 描述符声明的「创建人字段」（模型的归属）由当前登录用户补齐：用户不该
    // 手输自己的平台用户 ID。拿不到身份就失败关闭，避免静默创建成平台级端点。
    if (isCreate && spec.creatorFields?.length) {
      const creator = claims?.userId ?? claims?.name;
      if (!creator) {
        setError('无法读取当前登录用户，请重新登录后再试');
        return false;
      }
      for (const field of spec.creatorFields) setPath(normalized.values, field, creator);
    }

    // 描述符声明的「页头业务空间」字段：表单不渲染。新建跟随页头选择；编辑
    // 保留记录自身的 namespace——页头只是浏览维度，用它覆盖记录会让 PUT 打到
    // 另一个命名空间（按「名字 + 空间」定位的资源会直接 404）。记录没有
    // namespace 时才回退到页头；页头为「全部空间」（空串）时都不传。
    if (spec.namespaceField && namespace && (isCreate || !recordNamespace)) {
      setPath(normalized.values, spec.namespaceField, namespace);
    }

    // 跨字段校验：服务端仍是权威，这里提前拦住确定性错误（如自定义命令的
    // parameters 结构、模板字段引用），并把用户带到出错的字段分区。
    const issue = spec.submitValidate?.(normalized.values, { isCreate, record });
    if (issue) {
      if (issue.field) revealField([issue.field]);
      setError(issue.message);
      return false;
    }

    setSaving(true);
    setError(null);
    try {
      const saved = isCreate
        ? await spec.binding.create(normalized.values)
        : await spec.binding.save(id, deepMerge(record ?? {}, normalized.values));

      if (!isCreate) {
        // 与新建保持一致：保存成功回列表，用户紧接着就能在表格里确认这一行。
        message.success('保存成功');
        leaveToList();
        return true;
      }

      const secretField = ONE_TIME_SECRET_FIELD[key];
      const secretValue = secretField ? saved?.[secretField] : undefined;
      if (secretField && typeof secretValue === 'string' && secretValue !== '') {
        // 一次性密钥只在创建响应里出现：先让人保存，再离开这一页。
        setSecret({ label: secretField, value: secretValue });
        return true;
      }

      // 创建完成回到列表：用户接下来通常是继续新建或查看刚创建的行，
      // 直接跳详情会让「新建」这条路无法连续使用。
      message.success('创建成功');
      leaveToList();
      return true;
    } catch (err) {
      // 409 通常是唯一键冲突。新建时的标识字段还能改，带用户回到它所在的分区；
      // 具体冲突（例如已占用该名称的命名空间）由后端 message 说明。
      if (isCreate && err instanceof ApiError && err.status === 409) {
        revealField(spec.idKey.split('.'));
      }
      setError(err instanceof Error ? err.message : '保存失败');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleModeChange = (mode: CreateMode) => {
    if (needsAgentNamespace) {
      setError(AGENT_NAMESPACE_REQUIRED);
      return;
    }
    const next = new URLSearchParams(searchParams);
    if (mode === 'smart') next.set('mode', 'smart');
    else next.delete('mode');
    setSearchParams(next, { replace: true });
  };

  /**
   * 智能创建的确认：先把草案写进手动表单，再复用同一条提交链路。
   *
   * 这样 owner/namespace 补齐、normalizeSubmit、错误展示、创建后跳转都只有一份；
   * 智能页不直接调用 `binding.create`，避免两条写入逻辑逐渐分叉。
   */
  const handleSmartConfirm = async (draft: SmartDraft): Promise<boolean> => {
    applyDraftToForm(form, draft);
    return handleSubmit();
  };

  /**
   * 一次性密钥弹窗关闭后的去向。
   *
   * 创建已经成功，剩下的只是「把密钥交到人手里」；确定或直接关闭都回列表，
   * 与不弹密钥的创建路径保持一致。
   */
  const leaveAfterCreate = () => {
    setSecret(null);
    message.success('创建成功');
    leaveToList();
  };

  /**
   * 下一步。
   *
   * 普通分区只校验当前段；从最后一个分区进入「信息确认」时校验全部字段 ——
   * 确认页必须建立在全量有效的数据上。
   */
  const goNext = async () => {
    if (needsAgentNamespace) {
      setError(AGENT_NAMESPACE_REQUIRED);
      return;
    }
    if (!currentSection) {
      await handleSubmit();
      return;
    }
    const names = currentStep === sections.length - 1 ? undefined : namePathsOf(currentSection);
    if (!(await validate(names))) return;

    // MCP 的最后一个可编辑分区：先测通，再进入信息确认。
    if (key === 'mcps' && currentSection.key === 'tools' && !(await mcpTest.ensureTested())) {
      notification.error({
        title: 'MCP 连通性测试未通过',
        description: '请检查协议、接入地址与请求头后重试。',
      });
      return;
    }

    setStep(currentStep + 1);
  };

  /**
   * 点击步骤条跳转。
   *
   * 回看已通过的分区是自由的；跳到「信息确认」要求全量有效，否则先被拉回
   * 第一个出错字段。向前跳普通分区不额外校验，最终提交会统一兜底。
   */
  const goToStep = async (index: number) => {
    if (index === currentStep) return;
    if (needsAgentNamespace) {
      setError(AGENT_NAMESPACE_REQUIRED);
      return;
    }
    if (index < sections.length) {
      setStep(index);
      return;
    }
    if (!(await validate())) return;

    // 从步骤条直接跳到「信息确认」也不能绕过 MCP 门禁；失败时把人带回
    // 「工具与审批」，让面板上的错误详情可见。
    if (key === 'mcps' && !(await mcpTest.ensureTested())) {
      if (mcpToolsIndex >= 0) setStep(mcpToolsIndex);
      notification.error({
        title: 'MCP 连通性测试未通过',
        description: '请检查协议、接入地址与请求头后重试。',
      });
      return;
    }

    setStep(reviewStepIndex);
  };

  const primaryLabel = isReview || submitOnly ? (isCreate ? '创建' : '保存') : '下一步';
  const handlePrimary = () => {
    if (isReview || submitOnly) void handleSubmit();
    else void goNext();
  };

  // 确认页读取表单快照：它没有可编辑控件，切到这一步时的重渲染就是最新值；
  // `true` 让所有已注册字段（含 hidden 分区）都出现在结果里。
  const reviewValues = isReview ? (form.getFieldsValue(true) as Record<string, unknown>) : {};
  const contentTitle = isReview ? REVIEW_STEP_LABEL : currentSection?.label;

  return (
    <>
      <PageLayout
        title={title}
        // 业务空间选择器与列表页保持一致：新建跟随页头，编辑以记录为准不再展示。
        // 新建智能体必须落到具体空间，因此去掉「全部空间」；同时放行 default，
        // 平台内置智能体与历史数据大多住在这里。
        titleExtra={
          isCreate && spec.namespaceField ? (
            <NamespaceSelect allowAll={false} includeSystem={isAgentCreate} />
          ) : undefined
        }
        onBack={goBack}
        loading={loadingRecord}
        footerAlign="end"
        footer={
          smartMode ? null : (
            <>
              <Button onClick={goBack}>取消</Button>
              {currentStep > 0 && (
                <Button disabled={saving} onClick={() => setStep(currentStep - 1)}>
                  上一步
                </Button>
              )}
              <Button
                type="primary"
                loading={saving || mcpTest.testing}
                disabled={loadingRecord || needsCreateNamespace}
                onClick={handlePrimary}
              >
                {primaryLabel}
              </Button>
            </>
          )
        }
      >
        {isAgentCreate && (
          <CreateModeSwitch
            value={smartMode ? 'smart' : 'manual'}
            onChange={handleModeChange}
            disabled={needsAgentNamespace}
          />
        )}

        {needsCreateNamespace && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            title="请先选择业务空间"
            description="资源按业务空间隔离，引用候选与 ReferenceGrant 判定也以它为准。要使用 default 空间的现有资源与授权，请在页头选择 default；其他空间同理。"
          />
        )}

        {isAgentCreate && (
          <div hidden={!smartMode}>
            <SmartCreatePanel
              active={smartMode}
              claims={claims}
              namespace={namespace}
              saving={saving}
              submitError={error}
              onConfirm={handleSmartConfirm}
              onSwitchManual={draft => navigate('/agents/new', { state: { draft } })}
              onCancel={goBack}
              onClearError={() => setError(null)}
            />
          </div>
        )}

        <div hidden={smartMode}>
          {steps.length > 0 && (
            <nav ref={stepsRef} className={styles.steps} aria-label="表单步骤">
              {steps.map((item, index) => {
                const stateClass =
                  index < currentStep
                    ? styles.stepDone
                    : index === currentStep
                      ? styles.stepCurrent
                      : styles.stepTodo;
                return (
                  <Fragment key={item.key}>
                    {index > 0 && <RightOutlined aria-hidden className={styles.stepArrow} />}
                    <button
                      type="button"
                      className={clsx(styles.step, stateClass)}
                      aria-current={index === currentStep ? 'step' : undefined}
                      onClick={() => void goToStep(index)}
                    >
                      <span className={styles.stepCircle}>
                        {index < currentStep ? (
                          <CheckOutlined className={styles.stepCheck} />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <span className={styles.stepLabel}>{item.label}</span>
                    </button>
                  </Fragment>
                );
              })}
            </nav>
          )}

          {contentTitle && <h2 className={styles.sectionTitle}>{contentTitle}</h2>}

          {error && <Alert type="error" showIcon title={error} className={styles.error} />}

          <Form
            form={form}
            className={clsx(styles.form, !isMobile && styles.horizontalForm)}
            layout={isMobile ? 'vertical' : 'horizontal'}
            labelCol={isMobile ? undefined : { flex: '150px' }}
            wrapperCol={isMobile ? undefined : { flex: '0 1 640px' }}
            labelAlign="start"
            colon={false}
            onValuesChange={handleValuesChange}
            onFinish={handlePrimary}
          >
            {sections.map((section, index) => (
              <section key={section.key} className={styles.section} hidden={index !== currentStep}>
                {section.note && (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    // MCP 的「工具与审批」说明配合压短后的单行文案，不再折行。
                    className={
                      key === 'mcps' && section.key === 'tools' ? styles.sectionNote : undefined
                    }
                    title={section.note}
                  />
                )}
                {/* 先测通、拿到工具列表，下面的两个多选才有候选。 */}
                {section.key === 'tools' && mcpToolsIndex >= 0 && (
                  <MCPConnectionTestPanel
                    state={mcpTest.state}
                    testing={mcpTest.testing}
                    onTest={() => void mcpTest.run()}
                  />
                )}
                {/* 模板说明放在字段之前：先看清变量与示例，再动笔写模板。 */}
                {section.formExtra === 'webhook-template-help' && <WebhookTemplateHelp />}
                <ResourceFormFields
                  spec={spec}
                  isCreate={isCreate}
                  scopeNamespace={scopeNamespace}
                  fields={section.fields}
                  currentId={isCreate ? undefined : id}
                  fieldOptions={mcpToolFieldOptions}
                  disabledFields={mcpToolFieldsDisabled}
                />
                {section.formExtra === 'a2a-preview' && (
                  <A2APreviewPanel form={form} namespace={namespace} />
                )}
              </section>
            ))}
          </Form>

          {isReview && (
            <ReviewStep spec={spec} sections={sections} values={reviewValues} isCreate={isCreate} />
          )}
        </div>
      </PageLayout>

      <Modal
        open={Boolean(secret)}
        title="请立即保存这个密钥"
        okText="我已保存"
        cancelButtonProps={{ style: { display: 'none' } }}
        onOk={() => leaveAfterCreate()}
        onCancel={() => leaveAfterCreate()}
      >
        <p className={styles.secretHint}>
          {revealableSecret
            ? `${secretLabel} 只在创建响应里返回完整明文；关闭后仍可在详情页点「查看」取回（需资源归属人或管理员）。`
            : `${secretLabel} 只在创建响应里返回一次；关闭这个对话框后无法再次查看，只能轮换。`}
        </p>
        <div className={styles.secretValueBox}>
          <SecretValue
            label={secretLabel}
            initialPlaintext={secret?.value}
            initialVisible={false}
            unavailableHint="服务端没有返回这把密钥的明文；请到详情页点「查看」取回。"
          />
        </div>
      </Modal>
    </>
  );
}

interface Section {
  key: string;
  label: string;
  fields: string[];
  note?: string;
  formExtra?: 'a2a-preview' | 'webhook-template-help';
}

/**
 * 把可编辑字段按详情页签分组；不在任何页签里的字段收进「其他」。
 *
 * 条件为假的页签整组跳过，并把它的字段全部标记为 `used`：否则这些字段会掉进
 * “其他”，用户会在一个本不该出现的分组里看到 A2A 的字段。页签内条件为假的
 * 字段同样标记 `used`，但只从本分区移除。
 */
function sectionsOf(
  spec: ResourceSpec,
  isCreate: boolean,
  readCondition: (path: string) => unknown
): Section[] {
  const editable = editableFields(spec, isCreate);
  const order = editable.map(field => field.key);
  const editableKeys = new Set(order);
  const used = new Set<string>();
  const sections: Section[] = [];
  const visibleTabs = spec.tabs.filter(tab => conditionMatches(tab.when, readCondition));

  // 先把可见页签的字段分完，再处理被隐藏的页签。
  //
  // 顺序不能反：`远端执行` 与 `A2A 接入` 共用 endpoint/runtimeRef/鉴权等字段，
  // 但两者互斥。若先遍历隐藏页签并把它的一组字段标成 used，轮到可见页签时这些
  // 共用字段已经被“吃掉”，用户会看到 A2A 页签只剩来源和契约。
  for (const tab of visibleTabs) {
    const candidates = tab.fields ?? order;
    const fields = candidates.filter(field => editableKeys.has(field) && !used.has(field));
    const shown = fields.filter(field => {
      const declared = editable.find(item => item.key === field);
      return !declared?.when || conditionMatches(declared.when, readCondition);
    });
    fields.forEach(field => used.add(field));
    if (shown.length === 0) continue;
    sections.push({
      key: tab.key,
      label: tab.label,
      fields: shown,
      note: tab.note,
      formExtra: tab.formExtra,
    });
  }

  // 隐藏页签的字段也要标记 used，否则会掉进“其他”，在一个本不该出现的分组里
  // 露出 A2A/能力字段。只标记没有被可见页签认领的剩余字段。
  for (const tab of spec.tabs) {
    if (visibleTabs.includes(tab)) continue;
    for (const field of tab.fields ?? []) {
      if (editableKeys.has(field)) used.add(field);
    }
  }

  const rest = order.filter(field => !used.has(field));
  if (rest.length > 0) {
    const shown = rest.filter(field => {
      const declared = editable.find(item => item.key === field);
      return !declared?.when || conditionMatches(declared.when, readCondition);
    });
    if (shown.length > 0) sections.push({ key: 'other', label: '其他', fields: shown });
  }
  return sections;
}
