import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Checkbox, Empty, Input, Space, Spin, Tag, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { getPolicy, listPolicies, updatePolicy, type PolicySubject } from '@/api/policies';
import { resourceSummary, verbLabel } from '@/pages/Policies/options';
import { ResizableDrawer } from '@/ui';
import { matchPolicies, policyToInput, removeSubjectNames, type SubjectScope } from './authz';

export interface SubjectAuthorizeTarget {
  kind: 'user' | 'group';
  /** 抽屉标题与提示里显示的主体名。 */
  label: string;
  /** 用户目标：账号的全部身份别名。 */
  identities?: string[];
  /** 用户组目标：组名。 */
  groupName?: string;
}

interface Props {
  open: boolean;
  target: SubjectAuthorizeTarget | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Polaris 式「授权」：把主体勾选到已有策略上。
 *
 * 与用户组页编辑成员是同一类做法——只处理发生变化的策略，保存前重新读取
 * 每条策略，避免把抽屉打开期间别人做的修改覆盖掉。接口没有 ETag，最终仍是
 * 最后一次写入获胜。
 */
export default function SubjectAuthorizeDrawer({ open, target, onClose, onSaved }: Props) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [saving, setSaving] = useState(false);

  const query = useQuery({
    queryKey: ['policies', 'all'],
    queryFn: () => listPolicies({ offset: 0, limit: 0 }),
    enabled: open,
    staleTime: 15_000,
  });

  const scope = useMemo<SubjectScope>(() => {
    if (!target) return {};
    if (target.kind === 'group') return { groupName: target.groupName };
    return { aliases: target.identities ?? [] };
  }, [target]);

  const policies = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const attached = useMemo(() => {
    if (!target) return new Set<string>();
    return new Set(
      matchPolicies(policies, scope)
        .filter(match =>
          target.kind === 'group' ? match.source === 'group' : match.source === 'direct'
        )
        .map(match => match.policy.name)
    );
  }, [policies, scope, target]);

  useEffect(() => {
    if (!open || !query.data || !target) return;
    setSelected([...attached]);
    setKeyword('');
  }, [open, query.data, target]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = keyword.trim()
    ? policies.filter(policy => {
        const text = `${policy.name} ${policy.description ?? ''}`
          .concat((policy.subjects ?? []).map(subject => subject.name).join(' '))
          .toLowerCase();
        return text.includes(keyword.trim().toLowerCase());
      })
    : policies;

  const save = async () => {
    if (!target) return;
    const changed = policies.filter(policy => {
      const should = selected.includes(policy.name);
      const has = attached.has(policy.name);
      return should !== has;
    });
    if (changed.length === 0) {
      onClose();
      return;
    }

    const kind = target.kind === 'group' ? 'Group' : 'User';
    const names =
      target.kind === 'group'
        ? [target.groupName ?? ''].filter(Boolean)
        : (target.identities ?? []);

    setSaving(true);
    try {
      const results = await Promise.allSettled(
        changed.map(async policy => {
          const fresh = await getPolicy(policy.name);
          const add = selected.includes(policy.name);
          let subjects: PolicySubject[] = fresh.subjects ?? [];
          if (add) {
            const seen = new Set(subjects.map(subject => `${subject.kind}/${subject.name}`));
            for (const name of names) {
              const key = `${kind}/${name}`;
              if (seen.has(key)) continue;
              seen.add(key);
              subjects = [...subjects, { kind, name }];
            }
          } else {
            subjects = removeSubjectNames(subjects, kind, names);
          }
          await updatePolicy(policyToInput(fresh, { subjects }));
        })
      );
      const failed = results.filter(result => result.status === 'rejected').length;
      if (failed > 0) {
        const first = results.find(result => result.status === 'rejected') as
          PromiseRejectedResult | undefined;
        message.error(
          `${changed.length - failed} 条策略保存成功，${failed} 条失败：${
            first?.reason instanceof Error ? first.reason.message : '未知错误'
          }`
        );
      } else {
        message.success(`已更新 ${changed.length} 条策略`);
      }
      await queryClient.invalidateQueries({ queryKey: ['policies'] });
      onSaved();
      if (failed === 0) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResizableDrawer
      open={open}
      title={`授权${target ? `：${target.label}` : ''}`}
      onClose={() => {
        if (!saving) onClose();
      }}
      defaultWidth={640}
      minWidth={480}
      storageKey="subject-authorize"
      destroyOnHidden
      maskClosable={!saving}
      keyboard={!saving}
      closable={!saving}
      extra={
        <Space>
          <Button
            disabled={saving}
            onClick={() => {
              if (!saving) onClose();
            }}
          >
            取消
          </Button>
          <Button type="primary" loading={saving} onClick={() => void save()}>
            授权
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          title={
            target?.kind === 'group'
              ? `勾选后，策略会把用户组 ${target.label} 作为授权主体。`
              : `勾选后，策略会写入该账号的全部身份别名（账号 ID、登录名、飞书身份）。`
          }
        />
        <Input.Search
          allowClear
          placeholder="搜索策略名、描述或主体"
          value={keyword}
          onChange={event => setKeyword(event.target.value)}
        />
        {query.isLoading ? <Spin /> : null}
        {query.isError ? (
          <Alert
            type="error"
            showIcon
            title="读取策略失败"
            description={query.error instanceof Error ? query.error.message : undefined}
          />
        ) : null}
        {!query.isLoading && !query.isError && visible.length === 0 ? (
          <Empty description={keyword ? '没有匹配的策略' : '还没有策略'} />
        ) : null}
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {visible.map(policy => {
            const checked = selected.includes(policy.name);
            return (
              <Checkbox
                key={policy.name}
                checked={checked}
                disabled={saving}
                onChange={event => {
                  setSelected(prev =>
                    event.target.checked
                      ? [...prev, policy.name]
                      : prev.filter(name => name !== policy.name)
                  );
                }}
              >
                <Space direction="vertical" size={2}>
                  <Space size={6} wrap>
                    <Typography.Text>{policy.name}</Typography.Text>
                    <Tag color={policy.effect === 'deny' ? 'red' : 'green'}>
                      {policy.effect === 'deny' ? '拒绝' : '允许'}
                    </Tag>
                    {policy.status === 'disabled' ? <Tag>停用</Tag> : null}
                    {(policy.verbs ?? []).map(verb => (
                      <Tag key={verb} color={verb === 'write' ? 'volcano' : 'green'}>
                        {verbLabel(verb)}
                      </Tag>
                    ))}
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {policy.description || '无描述'}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {(policy.resources ?? []).map(resourceSummary).join('，') || '无资源'}
                  </Typography.Text>
                </Space>
              </Checkbox>
            );
          })}
        </Space>
      </Space>
    </ResizableDrawer>
  );
}
