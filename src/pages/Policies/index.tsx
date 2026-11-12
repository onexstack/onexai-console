import { useMemo, useState } from 'react';
import { Alert, App, Button, Card, Input, Result, Select, Space, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';

import {
  deletePolicy,
  listPolicies,
  updatePolicy,
  type AuthorizationPolicy,
  type PolicyInput,
} from '@/api/policies';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';
import PolicyDetailPane from './PolicyDetailPane';
import PolicyRail from './PolicyRail';
import { RESOURCE_KIND_OPTIONS } from './options';
import styles from './styles.module.scss';

/**
 * 授权策略（管理员）。
 *
 * 版式对齐 Polaris：左侧搜索 + 自定义策略列表，右侧选中策略详情。选中态落在
 * `/policies/:name`，刷新、复制链接、前进后退都能还原。列表筛选与行内状态开关
 * 是 onexai 原有能力，继续保留。
 */
export default function PoliciesPage() {
  const token = useSessionToken();
  const claims = useMemo(() => decodeClaims(token), [token]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { name: activeName } = useParams<{ name: string }>();
  const { message, modal } = App.useApp();

  const [subjectId, setSubjectId] = useState('');
  const [resourceKind, setResourceKind] = useState<string | undefined>();
  const [effect, setEffect] = useState<string | undefined>();
  const [enabled, setEnabled] = useState<string | undefined>();
  const [keyword, setKeyword] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [savingName, setSavingName] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['policies', { subjectId, resourceKind, effect, enabled }],
    queryFn: () =>
      listPolicies({
        offset: 0,
        limit: 0,
        ...(subjectId.trim() ? { subjectId: subjectId.trim() } : {}),
        ...(resourceKind ? { resourceKind } : {}),
        ...(effect ? { effect } : {}),
        ...(enabled ? { enabled } : {}),
      }),
    enabled: Boolean(claims?.isAdmin),
  });

  const rows = useMemo(() => {
    const search = keyword.trim().toLowerCase();
    const items = query.data?.items ?? [];
    if (!search) return items;
    return items.filter(policy => {
      const text = [policy.name, policy.description, ...(policy.subjects ?? []).map(s => s.name)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return text.includes(search);
    });
  }, [query.data?.items, keyword]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['policies'] });
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

  const toggle = async (policy: AuthorizationPolicy, next: boolean) => {
    setSavingName(policy.name);
    try {
      await updatePolicy(toInput(policy, next ? 'enabled' : 'disabled'));
      message.success(next ? '已启用' : '已停用');
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingName(null);
    }
  };

  const remove = async (policy: AuthorizationPolicy) => {
    try {
      await deletePolicy(policy.name);
      message.success(`已删除策略 ${policy.name}`);
      if (policy.name === activeName) navigate('/policies', { replace: true });
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const confirmDelete = (policy: AuthorizationPolicy) => {
    modal.confirm({
      title: `删除策略 ${policy.name}？`,
      content: '删除后该策略立即失效；引用它的主体不会受到影响。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => void remove(policy),
    });
  };

  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        授权策略
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
        用策略把用户、用户组或服务账号授权到命名空间和各类资源。判定 deny 优先、
        无匹配即拒绝；写操作不蕴含读操作。大批量人员请使用用户组，不要把上千个用户
        直接写进一条策略。
      </Typography.Paragraph>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="搜索策略名、描述或主体"
            prefix={<SearchOutlined />}
            style={{ width: 260 }}
            onSearch={value => setKeyword(value.trim())}
          />
          <Input.Search
            allowClear
            placeholder="主体 ID（账号/组/服务账号）"
            style={{ width: 240 }}
            onSearch={value => setSubjectId(value.trim())}
          />
          <Select
            allowClear
            placeholder="资源类型"
            style={{ width: 160 }}
            value={resourceKind}
            onChange={setResourceKind}
            options={RESOURCE_KIND_OPTIONS.map(option => ({
              value: option.value,
              label: option.label,
            }))}
          />
          <Select
            allowClear
            placeholder="效果"
            style={{ width: 130 }}
            value={effect}
            onChange={setEffect}
            options={[
              { value: 'allow', label: '允许' },
              { value: 'deny', label: '拒绝' },
            ]}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 130 }}
            value={enabled}
            onChange={setEnabled}
            options={[
              { value: 'true', label: '启用' },
              { value: 'false', label: '停用' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/policies/new')}>
            新建策略
          </Button>
          <Typography.Text type="secondary">共 {query.data?.total ?? 0} 条策略</Typography.Text>
        </Space>
      </Card>

      {query.isError ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          title="读取策略失败"
          description={query.error instanceof Error ? query.error.message : undefined}
        />
      ) : null}

      <div className={styles.layout}>
        <Card size="small">
          <PolicyRail
            policies={rows}
            activeName={activeName}
            keyword={keyword}
            onKeywordChange={setKeyword}
            loading={query.isLoading}
            collapsed={collapsed}
            onToggleCollapsed={() => setCollapsed(value => !value)}
            onSelect={policy => navigate(`/policies/${encodeURIComponent(policy.name)}`)}
            onEdit={policy => navigate(`/policies/${encodeURIComponent(policy.name)}/edit`)}
            onDelete={confirmDelete}
            onToggleStatus={(policy, next) => toggle(policy, next)}
          />
        </Card>

        <PolicyDetailPane
          name={activeName}
          onEdit={policy => navigate(`/policies/${encodeURIComponent(policy.name)}/edit`)}
          onDelete={confirmDelete}
          onToggleStatus={async (policy, next) => {
            if (savingName === policy.name) return;
            await toggle(policy, next);
          }}
        />
      </div>
    </div>
  );
}

/** 行内开关把整条策略写回，只改 status。 */
function toInput(policy: AuthorizationPolicy, status: 'enabled' | 'disabled'): PolicyInput {
  return {
    name: policy.name,
    subjects: policy.subjects ?? [],
    resources: policy.resources ?? [],
    verbs: policy.verbs?.length ? policy.verbs : ['read'],
    effect: policy.effect ?? 'allow',
    status,
    description: policy.description ?? '',
    agentNames: policy.agentNames ?? [],
    resourceAttributes: policy.resourceAttributes ?? '',
    subjectNamespace: policy.subjectNamespace,
  };
}
