import { useLocation, useNavigate } from 'react-router';
import { Alert, App, Button, Popconfirm, Result, Space, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DetailShell,
  InfoSection,
  SecretValue,
  StatusSwitch,
  isSwitchOn,
  type InfoItem,
} from '@/ui';
import { useGoBack } from '@/runtime';
import { decodeClaims, type SessionClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';

import {
  RESOURCE_BY_KEY,
  conditionMatches,
  copyableValueOf,
  renderFieldValue,
  switchMappingOf,
  valueAt,
  type FieldSpec,
  type ResourceSpec,
} from '@/api/resources';
import { extraActions, extraTabs } from '@/api/catalog/extras';
import { findForeignAgentRef } from '@/lib/agent-refs';
import { commandGroupTagLabel, commandGroupsOf } from '@/lib/command-groups';
import { InlineFieldEditControl } from '@/components/InlineFieldEdit';
import {
  inlineEditText,
  inlineEditWireValue,
  isValidJson,
} from '@/components/InlineFieldEdit/value';

/**
 * 通用详情页。
 *
 * 页签 = 描述符里的纯展示分组 + `extras` 注册表里的请求型页签（生效能力、
 * 执行记录、审计、预览等）。页面不写 `if (key === …)`，新增资源只改注册表。
 */
export default function ResourceDetailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const segments = location.pathname.split('/').filter(Boolean);
  const key = segments[0] ?? '';
  const id = decodeURIComponent(segments[1] ?? '');
  const spec = RESOURCE_BY_KEY[key];

  const listPath = `/${key}`;
  const goBackToSource = useGoBack(listPath);
  const token = useSessionToken();
  const claims = decodeClaims(token);
  const writable = Boolean(spec?.binding.writable && (!spec.adminOnlyWrite || claims?.isAdmin));

  const query = useQuery({
    queryKey: ['res', key, 'item', id],
    queryFn: async () => {
      if (!spec) throw new Error(`未知资源：${key}`);
      return spec.binding.api.get(id);
    },
    enabled: Boolean(spec && id),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const removeFn = spec?.binding.api.remove;
      if (!removeFn) return;
      await removeFn(id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['res', key] });
      navigate(listPath);
    },
  });

  if (!spec) {
    return <Result status="404" title="未知资源" subTitle={`这个应用里没有「${key}」这一页。`} />;
  }

  const record = (query.data ?? null) as Record<string, unknown> | null;

  /**
   * 详情页里的开关：写回整行，由写通路修补缓存并做后台对账。
   *
   * 不在写后立即重取：后端读接口走 informer 缓存，写后马上 GET 可能还是旧值，
   * 会把开关打回原状态。`save` 成功即视为已提交，服务端追平由后台完成。
   *
   * 只处理顶层字段（嵌套字段的浅合并会覆盖父对象），只读资源没有这个入口。
   */
  const toggleSwitch = async (field: FieldSpec, next: boolean) => {
    const value = next ? (field.switchOn ?? true) : (field.switchOff ?? false);
    try {
      await spec.binding.save(id, { [field.key]: value });
      message.success('修改成功');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '修改失败');
    }
  };

  /**
   * 详情页的单字段内联编辑。
   *
   * 与开关相同：保存成功即视为已提交，由写通路先修补缓存、后台再对账。失败时
   * 抛出错误让 `ValueWithActions` 保持编辑态——用户可以改完再试一次。
   */
  const saveInlineField = async (field: FieldSpec, text: string) => {
    try {
      const wire = inlineEditWireValue(field, text);
      // 历史 Agent 可能带着 kubectl 写入的跨空间引用；行内保存不一定经过表单的
      // submitValidate，这里补同一道闸门，避免把后端 400 原样抛给用户。
      if (key === 'agents') {
        const issue = findForeignAgentRef({ [field.key]: wire });
        if (issue) throw new Error(issue.message);
      }
      await spec.binding.save(id, { [field.key]: wire });
      message.success('修改成功');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '修改失败');
      throw err;
    }
  };

  const readCondition = (path: string) => valueAt(record ?? {}, path);
  const tabs = [
    ...spec.tabs
      .filter(tab => conditionMatches(tab.when, readCondition))
      .map(tab => ({
        key: tab.key,
        label: tab.label,
        children: (
          <div>
            {tab.note && (
              <Alert type="info" showIcon style={{ marginBottom: 16 }} title={tab.note} />
            )}
            <InfoSection
              title={tab.label}
              items={itemsOf(
                spec,
                tab.fields,
                record,
                claims,
                writable ? toggleSwitch : undefined,
                writable ? saveInlineField : undefined
              )}
            />
          </div>
        ),
      })),
    ...(record ? extraTabs(key, { id, record, refresh: () => void query.refetch() }) : []),
  ];

  const actions = (
    <Space wrap>
      {record && extraActions(key, { id, record, refresh: () => void query.refetch() })}
      {writable && (
        <Button type="primary" onClick={() => navigate(`/${key}/${encodeURIComponent(id)}/edit`)}>
          编辑
        </Button>
      )}
      {writable && spec.binding.api.remove && (
        <Popconfirm
          title={`确定删除该${spec.name}吗？`}
          description="删除后无法恢复。"
          okText="确定"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => remove.mutate()}
        >
          <Button danger loading={remove.isPending}>
            删除
          </Button>
        </Popconfirm>
      )}
    </Space>
  );

  return (
    <>
      <DetailShell
        id={id}
        showId
        loading={query.isLoading}
        onBack={goBackToSource}
        tabs={record ? tabs : undefined}
        actions={actions}
      >
        {query.isError ? (
          <Result
            status="error"
            title="读取失败"
            subTitle={
              (query.error as Error | null)?.message ?? '这个资源不存在，或者你没有权限查看它。'
            }
            extra={<Button onClick={() => void query.refetch()}>重试</Button>}
          />
        ) : (
          <Spin />
        )}
      </DetailShell>
    </>
  );
}

/** 把一组字段名变成详情页的行。未在描述符里声明的字段名会被忽略。 */
function itemsOf(
  spec: ResourceSpec,
  fieldKeys: string[] | undefined,
  record: Record<string, unknown> | null,
  claims: SessionClaims | null,
  onToggleSwitch?: (field: FieldSpec, next: boolean) => Promise<void>,
  onInlineSave?: (field: FieldSpec, value: string) => Promise<void>
): InfoItem[] {
  const declared: FieldSpec[] = fieldKeys
    ? fieldKeys
        .map(k => spec.fields.find(f => f.key === k))
        .filter((f): f is FieldSpec => Boolean(f))
    : spec.fields;
  const readCondition = (path: string) => valueAt(record ?? {}, path);
  const fields = declared.filter(field => conditionMatches(field.when, readCondition));

  return fields.map(field => {
    // 密钥类字段：读取接口永远不带明文，值改由按需取回的组件渲染。
    // 必须在 `renderFieldValue` 之前分流，否则空值会先被画成「-」。
    if (field.reveal) {
      const reveal = field.reveal;
      const recordId = record ? String(valueAt(record, spec.idKey) ?? '') : '';
      return {
        label: field.label,
        value: record ? (
          <SecretValue
            key={`${spec.key}:${recordId}`}
            label={field.label}
            load={() => reveal.load(record)}
            present={reveal.present ? reveal.present(record) : true}
            permitted={reveal.allowed ? reveal.allowed(record, claims) : true}
            unavailableHint={reveal.unavailableHint}
            restrictedHint={reveal.restrictedHint}
          />
        ) : (
          <span>-</span>
        ),
        hint: field.note,
        // 复制由 SecretValue 在揭示后提供，外层不再挂一个复制空串的按钮。
        copyable: false,
      };
    }

    const rawValue = record ? fieldValueOf(field, record) : undefined;
    // 空值与默认值语义等价的枚举（kind/mode/auth.type）：详情页按默认值展示，
    // 与表单的 `defaultWhenEmpty` 保持一致。
    const raw =
      field.defaultWhenEmpty && (rawValue === undefined || rawValue === null || rawValue === '')
        ? field.defaultValue
        : rawValue;
    // 可写的开关字段在详情页可以直接切；嵌套字段（`spec.enabled`）由写通路
    // 按点路径只改这一个字段，不会覆盖父对象。
    const interactive = Boolean(onToggleSwitch) && field.kind === 'switch' && !field.readOnly;
    // 内联编辑仍只支持顶层字段：它的写回与开关共用同一条 patch 通路，但这里
    // 没有放开嵌套编辑的产品需求，保持原来的限制。
    const inlineEditable =
      Boolean(onInlineSave) &&
      field.inlineEdit === true &&
      !field.readOnly &&
      !field.key.includes('.');
    // `json` / `jsonValue` 的编辑串必须是合法 JSON（空串表示清空）。
    const jsonField = field.kind === 'json' || field.kind === 'jsonValue';
    const checked = isSwitchOn(switchMappingOf(field), raw);
    return {
      label: field.label,
      value: interactive ? (
        <StatusSwitch
          checked={checked}
          onLabel={field.switchOnLabel ?? '是'}
          offLabel={field.switchOffLabel ?? '否'}
          onChange={next => onToggleSwitch?.(field, next) ?? undefined}
          confirm={
            field.switchConfirm
              ? {
                  title: checked ? `确定停用此${spec.name}吗？` : `确定启用此${spec.name}吗？`,
                  okText: checked ? '停用' : '启用',
                  cancelText: '取消',
                }
              : undefined
          }
        />
      ) : (
        renderFieldValue(field, raw)
      ),
      editable: inlineEditable
        ? {
            // 值在 `EditConfig` 里统一按字符串流转，复杂类型的序列化/解析在
            // `InlineFieldEdit` 里成对实现。
            type: 'custom',
            currentValue: inlineEditText(field, raw),
            wide:
              field.kind === 'textarea' ||
              field.kind === 'tags' ||
              field.kind === 'refs' ||
              field.kind === 'labels' ||
              field.kind === 'jsonList' ||
              jsonField,
            validate:
              field.required || jsonField
                ? value => {
                    if (field.required && value.trim() === '') {
                      return `${field.label}不能为空`;
                    }
                    if (jsonField && value.trim() !== '' && !isValidJson(value)) {
                      return `${field.label} 不是合法 JSON`;
                    }
                    return undefined;
                  }
                : undefined,
            renderEdit: (value: string, onChange: (next: string) => void) => (
              <InlineFieldEditControl
                field={field}
                value={value}
                onChange={onChange}
                resourceKey={spec.key}
                scopeNamespace={
                  typeof record?.namespace === 'string' ? record.namespace : undefined
                }
              />
            ),
            onSave: (value: string) => onInlineSave?.(field, value) ?? Promise.resolve(),
          }
        : undefined,
      hint: field.note,
      // 长 ID（数据集、项目、事件）是拿去别处对账用的，复制的价值远大于读它。
      copyable: copyableValueOf(field, raw) !== undefined,
      // 复制必须是原始字符串：`value` 是 React 节点，兜底序列化会得到 [object Object]。
      rawValue: typeof raw === 'string' ? raw : undefined,
    };
  });
}

/**
 * 详情页一行的值。
 *
 * `kind: 'commands'` 在线上是三个字段：`spec.commandSelector` 的分组条件、
 * `spec.customCommands` 的 `[{name}]` 与 `spec.commands` 的字符串数组。详情页
 * 合并成一行「命令」展示；分组渲染成一个「值班组」标签，而不是把组内命令展开
 * ——展开既会和显式命令重复，也会被数组的「前 2 项 + N」截断。数组渲染会把
 * `{name}` 解析成名称，见 `renderFieldValue`。
 */
function fieldValueOf(field: FieldSpec, record: Record<string, unknown>): unknown {
  const primary = valueAt(record, field.key);
  if (field.kind !== 'commands') return primary;

  const groups = field.commandSelectorField
    ? commandGroupsOf(valueAt(record, field.commandSelectorField)).map(commandGroupTagLabel)
    : [];
  const extra = field.commandsField ? valueAt(record, field.commandsField) : undefined;
  return [
    ...groups,
    ...(Array.isArray(primary) ? primary : []),
    ...(Array.isArray(extra) ? extra : []),
  ];
}
