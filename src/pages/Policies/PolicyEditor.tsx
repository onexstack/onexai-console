import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Input,
  Radio,
  Result,
  Select,
  Space,
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router';

import {
  createPolicy,
  getPolicy,
  normalizeSubjectKind,
  resourcesOf,
  subjectsOf,
  updatePolicy,
  type PolicyInput,
  type PolicyResource,
  type PolicySubject,
} from '@/api/policies';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';
import { useUserDirectory } from '@/components/UserRef';
import UserPicker from '@/components/UserPicker';
import { memberOfUser } from '@/components/usergroup/members';
import { useUserGroups } from '@/components/usergroup/useUserGroups';
import PageLayout from '@/components/PageLayout';
import { useGoBack } from '@/runtime/hooks';
import { RESOURCE_KIND_OPTIONS, VERB_OPTIONS, kindLabel, verbLabel } from './options';

interface WizardState {
  name: string;
  description: string;
  enabled: boolean;
  wildcard: boolean;
  pickedUsers: string[];
  pickedGroups: string[];
  serviceAccounts: string[];
  extraSubjects: PolicySubject[];
  resources: PolicyResource[];
  verbs: string[];
  effect: 'allow' | 'deny';
  agentNames: string[];
  attributes: string;
}

const EMPTY: WizardState = {
  name: '',
  description: '',
  enabled: true,
  wildcard: false,
  pickedUsers: [],
  pickedGroups: [],
  serviceAccounts: [],
  extraSubjects: [],
  resources: [{ kind: 'namespace', names: ['*'] }],
  verbs: ['read'],
  effect: 'allow',
  agentNames: [],
  attributes: '',
};

const STEPS = ['选择用户', '授权', '预览'];

/**
 * 整页三步策略编辑器：选择用户 → 授权 → 预览。
 *
 * 版式对齐 Polaris 的独立创建页；字段保留 onexai 策略模型的完整能力（服务账号、
 * 所有主体、读/写、允许/拒绝、智能体限定、资源属性）。账号主体保存时展开全部
 * 身份别名，否则浏览器 / IM / Agent 任一路径都可能不命中。
 */
export default function PolicyEditorPage() {
  const { name: routeName } = useParams<{ name: string }>();
  const isEdit = Boolean(routeName);
  const location = useLocation();
  const navigate = useNavigate();
  const goBack = useGoBack('/policies');
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const token = useSessionToken();
  const claims = useMemo(() => decodeClaims(token), [token]);
  const directory = useUserDirectory();
  const groupsQuery = useUserGroups(Boolean(claims?.isAdmin));

  const [state, setState] = useState<WizardState>(EMPTY);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const initialized = useRef('');

  const policyQuery = useQuery({
    queryKey: ['policies', 'item', routeName],
    queryFn: () => getPolicy(routeName as string),
    enabled: isEdit && Boolean(routeName),
  });
  const policy = policyQuery.data;

  const presetResources = useMemo<PolicyResource[] | undefined>(() => {
    if (isEdit) return undefined;
    const params = new URLSearchParams(location.search);
    const kind = params.get('kind');
    const names = params.getAll('name').filter(Boolean);
    if (!kind || names.length === 0) return undefined;
    return [{ kind, names }];
  }, [isEdit, location.search]);

  useEffect(() => {
    if (isEdit && !policy) return;
    const key = isEdit ? `edit:${routeName}` : `create:${JSON.stringify(presetResources ?? null)}`;
    if (initialized.current === key) return;
    // 编辑态要把 User 主体映射回平台账号，等目录一次；目录失败时用原始主体
    // 初始化，不能一直转圈。
    if (isEdit && directory.loading) return;
    initialized.current = key;

    if (!policy) {
      setState({ ...EMPTY, resources: presetResources ?? EMPTY.resources });
      setStep(0);
      return;
    }

    const users = new Set(directory.users.map(user => user.id));
    const byName = new Map(directory.users.map(user => [user.username, user.id]));
    let wildcard = false;
    const pickedUsers: string[] = [];
    const pickedGroups: string[] = [];
    const serviceAccounts: string[] = [];
    const extraSubjects: PolicySubject[] = [];

    for (const subject of subjectsOf(policy)) {
      const kind = normalizeSubjectKind(subject.kind);
      if (subject.name === '*') {
        wildcard = true;
      } else if (kind === 'Group') {
        pickedGroups.push(subject.name);
      } else if (kind === 'User') {
        const byNameID = byName.get(subject.name);
        if (users.has(subject.name)) pickedUsers.push(subject.name);
        else if (byNameID) pickedUsers.push(byNameID);
        else extraSubjects.push(subject);
      } else if (kind === 'ServiceAccount') {
        serviceAccounts.push(subject.name);
      } else {
        extraSubjects.push(subject);
      }
    }

    setState({
      name: policy.name,
      description: policy.description ?? '',
      enabled: policy.status !== 'disabled',
      wildcard,
      pickedUsers: [...new Set(pickedUsers)],
      pickedGroups: [...new Set(pickedGroups)],
      serviceAccounts: [...new Set(serviceAccounts)],
      extraSubjects,
      resources: resourcesOf(policy),
      verbs: policy.verbs?.length ? policy.verbs : ['read'],
      effect: policy.effect ?? 'allow',
      agentNames: policy.agentNames ?? [],
      attributes: policy.resourceAttributes ?? '',
    });
    setStep(0);
  }, [isEdit, policy, presetResources, directory.users, directory.loading, routeName]);

  const set = <K extends keyof WizardState>(key: K, value: WizardState[K]) =>
    setState(prev => ({ ...prev, [key]: value }));

  const subjects = useMemo<PolicySubject[]>(() => {
    const out: PolicySubject[] = [];
    if (state.wildcard) {
      out.push(
        { kind: 'User', name: '*' },
        { kind: 'Group', name: '*' },
        { kind: 'ServiceAccount', name: '*', namespace: '*' }
      );
    }
    for (const id of state.pickedUsers) {
      const user = directory.users.find(item => item.id === id);
      if (!user) {
        out.push({ kind: 'User', name: id });
        continue;
      }
      const member = memberOfUser(user);
      for (const alias of [member.userID, member.username, member.larkUserID, member.openID]) {
        if (alias) out.push({ kind: 'User', name: alias });
      }
    }
    for (const name of state.pickedGroups) out.push({ kind: 'Group', name });
    for (const name of state.serviceAccounts) out.push({ kind: 'ServiceAccount', name });
    out.push(...state.extraSubjects);

    const seen = new Set<string>();
    return out.filter(subject => {
      const key = `${normalizeSubjectKind(subject.kind)}/${subject.name}`;
      if (!subject.name.trim() || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [state, directory.users]);

  const validateStep = (index: number): string | null => {
    if (index === 0) {
      if (!state.name.trim()) return '请填写策略名称';
      if (!isEdit && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(state.name.trim())) {
        return '名称需以字母或数字开头，只允许字母、数字、下划线、点和连字符，最长 128 位';
      }
      if (subjects.length === 0) return '请至少选择一个生效对象';
    }
    if (index === 1) {
      if (state.resources.length === 0) return '请至少添加一种资源类型';
      for (const resource of state.resources) {
        if (resource.names.length === 0)
          return `请为「${kindLabel(resource.kind)}」填写资源名，或选择全部`;
      }
      if (state.verbs.length === 0) return '请至少选择一个动作';
    }
    return null;
  };

  const next = () => {
    const problem = validateStep(step);
    if (problem) {
      message.warning(problem);
      return;
    }
    setStep(current => Math.min(current + 1, STEPS.length - 1));
  };

  const submit = async () => {
    for (let index = 0; index < STEPS.length; index += 1) {
      const problem = validateStep(index);
      if (problem) {
        setStep(index);
        message.warning(problem);
        return;
      }
    }
    const input: PolicyInput = {
      name: state.name.trim(),
      subjects,
      resources: state.resources.map(resource => ({
        kind: resource.kind,
        names: resource.names.map(name => name.trim()).filter(Boolean),
      })),
      verbs: state.verbs,
      effect: state.effect,
      status: state.enabled ? 'enabled' : 'disabled',
      description: state.description.trim(),
      agentNames: state.agentNames,
      resourceAttributes: state.attributes,
    };
    setSaving(true);
    try {
      if (isEdit) {
        await updatePolicy(input);
        message.success('策略已保存');
      } else {
        await createPolicy(input);
        message.success(`策略 ${input.name} 已创建`);
      }
      await queryClient.invalidateQueries({ queryKey: ['policies'] });
      navigate(`/policies/${encodeURIComponent(input.name)}`, { replace: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存策略失败');
    } finally {
      setSaving(false);
    }
  };

  if (!claims?.isAdmin) {
    return (
      <div style={{ padding: 24 }}>
        <Result
          status="403"
          title="需要管理员权限"
          subTitle="授权策略只对管理员开放。请联系管理员为你的账号授予管理员角色。"
        />
      </div>
    );
  }

  if (isEdit && policyQuery.isError) {
    return (
      <div style={{ padding: 24 }}>
        <Result
          status="error"
          title="读取策略失败"
          subTitle={policyQuery.error instanceof Error ? policyQuery.error.message : undefined}
          extra={
            <Space>
              <Button onClick={() => navigate('/policies')}>返回列表</Button>
              <Button type="primary" onClick={() => void policyQuery.refetch()}>
                重试
              </Button>
            </Space>
          }
        />
      </div>
    );
  }

  const resourceColumns: ColumnsType<PolicyResource> = [
    {
      title: '资源类型',
      key: 'kind',
      render: (_, resource) => <Tag color="blue">{kindLabel(resource.kind)}</Tag>,
    },
    {
      title: '范围',
      key: 'names',
      render: (_, resource) =>
        resource.names.includes('*') ? (
          <Tag color="green">全部（含后续新增）</Tag>
        ) : (
          <Space size={4} wrap>
            {resource.names.map(name => (
              <Tag key={name}>{name}</Tag>
            ))}
          </Space>
        ),
    },
  ];

  const footer = (
    <Space>
      <Button
        disabled={saving}
        onClick={() => (step === 0 ? goBack() : setStep(current => current - 1))}
      >
        {step === 0 ? '取消' : '上一步'}
      </Button>
      {step < STEPS.length - 1 ? (
        <Button type="primary" disabled={saving} onClick={next}>
          下一步
        </Button>
      ) : (
        <Button type="primary" loading={saving} onClick={() => void submit()}>
          完成
        </Button>
      )}
    </Space>
  );

  return (
    <PageLayout
      title={isEdit ? `编辑策略 ${routeName}` : '新建策略'}
      onBack={goBack}
      footer={footer}
      footerAlign="end"
      loading={isEdit && policyQuery.isLoading}
    >
      <Steps
        size="small"
        current={step}
        items={STEPS.map(title => ({ title }))}
        style={{ marginBottom: 24 }}
      />

      {step === 0 ? (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Field
            label="策略名称"
            required
            extra={isEdit ? '名称创建后不可修改。' : '名称创建后不可修改；规则按它审计。'}
          >
            <Input
              value={state.name}
              disabled={isEdit}
              onChange={event => set('name', event.target.value)}
              placeholder="例如 dept-ai-read"
              maxLength={128}
            />
          </Field>
          <Field label="备注">
            <Input.TextArea
              rows={3}
              value={state.description}
              onChange={event => set('description', event.target.value)}
              placeholder="这条策略解决什么问题、由谁维护"
              maxLength={512}
            />
          </Field>
          <Field label="角色" extra="选择平台账号后，会把该账号的全部身份别名写入策略。">
            <Tabs
              items={[
                {
                  key: 'users',
                  label: '用户',
                  children: (
                    <UserPicker
                      multiple
                      allowCustom={false}
                      valueKey="id"
                      value={state.pickedUsers}
                      onChange={value =>
                        set('pickedUsers', Array.isArray(value) ? value : value ? [value] : [])
                      }
                      disabled={state.wildcard}
                    />
                  ),
                },
                {
                  key: 'groups',
                  label: '用户组',
                  children: (
                    <Select
                      mode="multiple"
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      style={{ width: '100%' }}
                      value={state.pickedGroups}
                      disabled={state.wildcard}
                      loading={groupsQuery.isLoading}
                      placeholder="选择用户组"
                      options={groupsQuery.groups.map(group => ({
                        value: group.name,
                        label: `${group.displayName || group.name}（${group.members.length} 人${
                          group.enabled ? '' : '，已停用'
                        }）`,
                      }))}
                      onChange={value => set('pickedGroups', value)}
                    />
                  ),
                },
              ]}
            />
          </Field>
          <Field label="服务账号" extra="内部服务调用者（例如 AK/SK 的 key id）。">
            <Select
              mode="tags"
              style={{ width: '100%' }}
              value={state.serviceAccounts}
              disabled={state.wildcard}
              placeholder="输入后回车添加"
              onChange={value => set('serviceAccounts', value)}
            />
          </Field>
          <Field
            label="所有主体"
            extra="匹配任何用户、组或服务账号。通常只用于基线策略，再配合拒绝规则收紧。"
          >
            <Switch
              checked={state.wildcard}
              onChange={value => set('wildcard', value)}
              checkedChildren="全部主体"
              unCheckedChildren="指定主体"
            />
          </Field>
          {state.extraSubjects.length > 0 ? (
            <Field
              label="其他主体"
              extra="来自历史规则、无法归并到平台账号的身份；保存时原样保留。"
            >
              <Space size={4} wrap>
                {state.extraSubjects.map((subject, index) => (
                  <Tag
                    key={`${subject.kind}/${subject.name}/${index}`}
                    closable
                    onClose={() =>
                      set(
                        'extraSubjects',
                        state.extraSubjects.filter((_, i) => i !== index)
                      )
                    }
                  >
                    {normalizeSubjectKind(subject.kind)}/{subject.name}
                  </Tag>
                ))}
              </Space>
            </Field>
          ) : null}
          <Alert
            type="info"
            showIcon
            title={`当前将写入 ${subjects.length} 条主体记录`}
            description="一个账号会展开成多条身份别名；飞书未绑定的账号只能覆盖浏览器路径。"
          />
        </Space>
      ) : null}

      {step === 1 ? (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            一个策略可以同时覆盖命名空间和多种资源；每种资源类型可以选“全部（含后续新增）”或指定名称。
            名称写 <Typography.Text code>researcher</Typography.Text> 表示任意命名空间下的同名资源，
            写 <Typography.Text code>helper-public/researcher</Typography.Text>{' '}
            则精确限定到那个命名空间。
          </Typography.Text>
          <Field label="资源" required>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {state.resources.map((resource, index) => (
                <ResourceRow
                  key={`${resource.kind}-${index}`}
                  resource={resource}
                  onChange={next =>
                    set(
                      'resources',
                      state.resources.map((item, i) => (i === index ? next : item))
                    )
                  }
                  onRemove={() =>
                    set(
                      'resources',
                      state.resources.filter((_, i) => i !== index)
                    )
                  }
                />
              ))}
              <Button
                onClick={() =>
                  set('resources', [...state.resources, { kind: 'agent', names: ['*'] }])
                }
              >
                添加资源类型
              </Button>
            </Space>
          </Field>
          <Field label="操作" required extra="写不蕴含读：需要读写时两项都要勾选。">
            <Checkbox.Group
              value={state.verbs}
              options={VERB_OPTIONS}
              onChange={value => set('verbs', value as string[])}
            />
          </Field>
          <Field label="效果" extra="拒绝优先于允许；任何一条匹配的拒绝规则都会否决请求。">
            <Radio.Group value={state.effect} onChange={event => set('effect', event.target.value)}>
              <Radio value="allow">允许</Radio>
              <Radio value="deny">拒绝</Radio>
            </Radio.Group>
          </Field>
          <Field label="限定智能体（可选）" extra="只在这些智能体运行时生效；留空表示不限。">
            <Select
              mode="tags"
              style={{ width: '100%' }}
              value={state.agentNames}
              onChange={value => set('agentNames', value)}
              placeholder="输入智能体名称后回车"
            />
          </Field>
          <Field
            label="资源属性条件（可选）"
            extra='JSON 对象，例如 {"env":"prod"}；所有键都匹配才生效。'
          >
            <Input.TextArea
              rows={2}
              value={state.attributes}
              onChange={event => set('attributes', event.target.value)}
              placeholder='{"env":"prod"}'
            />
          </Field>
        </Space>
      ) : null}

      {step === 2 ? (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Field label="策略名称">
            <Typography.Text>{state.name || '-'}</Typography.Text>
          </Field>
          <Field label="备注">
            <Typography.Text>{state.description || '无备注'}</Typography.Text>
          </Field>
          <Field label="状态">
            <Tag color={state.enabled ? 'blue' : 'default'}>{state.enabled ? '启用' : '停用'}</Tag>
          </Field>
          <Field label="用户｜用户组">
            <Space direction="vertical" size={4}>
              <Typography.Text>
                用户：{state.wildcard ? '所有主体' : `${state.pickedUsers.length} 个账号`}
              </Typography.Text>
              <Typography.Text>
                用户组：{state.wildcard ? '-' : `${state.pickedGroups.length} 个组`}
              </Typography.Text>
              <Typography.Text>服务账号：{state.serviceAccounts.length} 个</Typography.Text>
              {state.extraSubjects.length > 0 ? (
                <Typography.Text type="secondary">
                  其他主体 {state.extraSubjects.length} 条（历史身份，原样保留）
                </Typography.Text>
              ) : null}
            </Space>
          </Field>
          <Field label="资源">
            <Table<PolicyResource>
              rowKey={resource => `${resource.kind}/${resource.names.join('|')}`}
              size="small"
              pagination={false}
              columns={resourceColumns}
              dataSource={state.resources}
              locale={{ emptyText: '还没有资源' }}
            />
          </Field>
          <Field label="动作与效果">
            <Space size={6} wrap>
              {state.verbs.map(verb => (
                <Tag key={verb} color={verb === 'write' ? 'volcano' : 'green'}>
                  {verbLabel(verb)}
                </Tag>
              ))}
              <Tag color={state.effect === 'deny' ? 'red' : 'green'}>
                {state.effect === 'deny' ? '拒绝（优先）' : '允许'}
              </Tag>
            </Space>
          </Field>
          <Alert
            type="info"
            showIcon
            title={`将写入 ${subjects.length} 条主体记录`}
            description="最终是否允许由服务端在每次请求时按 deny 优先、无匹配拒绝的规则计算。"
          />
          {state.effect === 'deny' ? (
            <Alert
              type="warning"
              showIcon
              title="这是一条拒绝策略"
              description="拒绝优先于允许。确认它只覆盖你希望阻断的主体与资源，否则会覆盖其他人的授权。"
            />
          ) : null}
        </Space>
      ) : null}
    </PageLayout>
  );
}

function Field({
  label,
  required,
  extra,
  children,
}: {
  label: string;
  required?: boolean;
  extra?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Typography.Text strong>
        {label}
        {required ? <Typography.Text type="danger"> *</Typography.Text> : null}
      </Typography.Text>
      {extra ? (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '2px 0 8px' }}>
          {extra}
        </Typography.Paragraph>
      ) : (
        <div style={{ height: 8 }} />
      )}
      {children}
    </div>
  );
}

function ResourceRow({
  resource,
  onChange,
  onRemove,
}: {
  resource: PolicyResource;
  onChange: (resource: PolicyResource) => void;
  onRemove: () => void;
}) {
  const option = RESOURCE_KIND_OPTIONS.find(item => item.value === resource.kind);
  const all = resource.names.includes('*');
  const hasKind = RESOURCE_KIND_OPTIONS.some(item => item.value === resource.kind);

  return (
    <Space align="start" wrap>
      <Select
        value={resource.kind}
        options={
          hasKind
            ? RESOURCE_KIND_OPTIONS.map(item => ({ value: item.value, label: item.label }))
            : [
                ...RESOURCE_KIND_OPTIONS.map(item => ({ value: item.value, label: item.label })),
                { value: resource.kind, label: kindLabel(resource.kind) },
              ]
        }
        onChange={kind => onChange({ kind, names: ['*'] })}
        style={{ width: 180 }}
      />
      <Radio.Group
        value={all ? 'all' : 'specific'}
        onChange={event =>
          onChange({ ...resource, names: event.target.value === 'all' ? ['*'] : [] })
        }
      >
        <Radio value="all">全部</Radio>
        <Radio value="specific">指定</Radio>
      </Radio.Group>
      {all ? (
        <Typography.Text type="secondary" style={{ lineHeight: '32px' }}>
          包含后续新增
        </Typography.Text>
      ) : (
        <Select
          mode="tags"
          style={{ minWidth: 260, flex: 1 }}
          value={resource.names}
          options={option?.names}
          placeholder={option?.names ? '选择角色' : '输入资源名后回车'}
          onChange={names => onChange({ ...resource, names })}
        />
      )}
      <Button danger type="link" onClick={onRemove}>
        移除
      </Button>
    </Space>
  );
}
