import { useMemo, type ReactNode } from 'react';
import { Alert, Button, Select, Space, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

import type { AgentComposition } from '@/api/types';
import NamespaceSelect from '@/components/NamespaceSelect';
import {
  refOptionsFromRows,
  useDefaultNamespace,
  useResourceRows,
  type SelectOption,
} from '@/components/ResourceForm/options';
import { useNamespace } from '@/runtime';
import { FieldHint } from '@/ui/components/FieldHint';

import { emptyComposition } from './debugComposition';
import { PromptOrderList } from './PromptOrderList';
import styles from './debug.module.scss';

type Row = Record<string, unknown>;

/** 「部署默认」在 Select 里的哨兵值；请求里映射回空串。 */
const DEPLOYMENT_DEFAULT = '__default__';

/** 调试台组合的引用方标识：非 Agent，可跨空间且按 grant 过滤。 */
const COMPOSITION_REFERRER = 'debug-compositions';

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** 停用资源不参与组合。 */
const enabled = (row: Row): boolean => row.status !== 'disabled';

/**
 * 调试台的能力组合。
 *
 * 无宿主：执行身份、配额与审批下限来自当前登录用户与部署配置；这里的六类
 * 选择就是这一轮运行的全部配置。选择器在运行中禁用，先停止再改，因为一轮
 * 运行只能描述一个组合。
 *
 * 引用方是页头的业务空间：裸名按它解析，跨空间项只有目标空间的
 * ReferenceGrant 放行时才出现。同一套规则由 `refOptionsFromRows` 实现，与
 * Agent / AgentBinding 表单共用，避免“界面可选、后端拒绝”。
 */
export function DebugConfig({
  userId,
  userName,
  composition,
  onChange,
  disabled,
}: {
  /** 真实用户 ID：用于模型 owner 过滤，不用于展示。 */
  userId?: string;
  /** 展示用的用户名/显示名；缺失时回退到 userId。 */
  userName?: string;
  composition: AgentComposition;
  onChange: (next: AgentComposition) => void;
  disabled: boolean;
}) {
  const selectedNamespace = useNamespace();
  const defaultNamespace = useDefaultNamespace();
  // 页头是「全部空间」时，引用方回落到部署默认空间；这也是后端在
  // composition.namespace 为空时的取值。
  const referrer = composition.namespace || selectedNamespace || defaultNamespace;

  const prompts = useResourceRows('prompts');
  const skills = useResourceRows('skills');
  const mcps = useResourceRows('mcps');
  const knowledgeBases = useResourceRows('knowledge-bases');
  const customCommands = useResourceRows('custom-commands');
  const models = useResourceRows('models');
  const grants = useResourceRows('reference-grants');

  const build = (
    resourceKey: string,
    rows: Row[],
    refFilter?: (row: Row) => boolean
  ): SelectOption[] =>
    refOptionsFromRows({
      rows,
      refFilter,
      scopeNamespace: referrer,
      referrerKey: COMPOSITION_REFERRER,
      resourceKey,
      grants: (grants.data ?? []) as Row[],
    });

  const promptOptions = useMemo(
    () =>
      build(
        'prompts',
        (prompts.data ?? []) as Row[],
        row => enabled(row) && str(row.content).trim() !== '' && !str(row.name).startsWith('aggregated-')
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prompts.data, grants.data, referrer]
  );
  const skillOptions = useMemo(
    () => build('skills', (skills.data ?? []) as Row[], enabled),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [skills.data, grants.data, referrer]
  );
  const mcpOptions = useMemo(
    () => build('mcps', (mcps.data ?? []) as Row[], enabled),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mcps.data, grants.data, referrer]
  );
  const kbOptions = useMemo(
    () => build('knowledge-bases', (knowledgeBases.data ?? []) as Row[], enabled),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [knowledgeBases.data, grants.data, referrer]
  );
  const commandOptions = useMemo(
    () => build('custom-commands', (customCommands.data ?? []) as Row[], enabled),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customCommands.data, grants.data, referrer]
  );
  // 无宿主运行的 subject 就是当前用户：只列平台模型和本人模型，否则选完会在
  // 运行前被后端以 403 拒绝。模型与能力同类，跨空间同样需要 grant。
  const modelOptions = useMemo(
    () =>
      build('models', (models.data ?? []) as Row[], row => {
        if (!enabled(row) || row.hasAPIKey === false) return false;
        const owner = str(row.owner);
        return !owner || owner === userId;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [models.data, grants.data, referrer, userId]
  );

  const patch = (part: Partial<AgentComposition>) => onChange({ ...composition, ...part });
  const identityName = userName || userId;
  const queries = [prompts, skills, mcps, knowledgeBases, customCommands, models];
  const loading = queries.some(query => query.isLoading);
  const refreshing = queries.some(query => query.isFetching);
  const refreshAll = () => {
    void Promise.all(queries.map(query => query.refetch()));
  };

  // 已保存的组合可能引用了后来被删除、被停用或撤销授权的资源。把它们标出来，
  // 并允许一键清理；发送前 `useDebugSession` 也会再拦一次。
  const invalid = useMemo(() => {
    const kinds: Array<[keyof AgentComposition, SelectOption[]]> = [
      ['prompts', promptOptions],
      ['skills', skillOptions],
      ['mcps', mcpOptions],
      ['knowledgeBases', kbOptions],
      ['customCommands', commandOptions],
    ];
    const out: Array<{ kind: keyof AgentComposition; value: string }> = [];
    for (const [kind, options] of kinds) {
      const valid = new Set(options.map(option => option.value));
      for (const value of (composition[kind] as string[] | undefined) ?? []) {
        if (!valid.has(value)) out.push({ kind, value });
      }
    }
    if (composition.model && !modelOptions.some(option => option.value === composition.model)) {
      out.push({ kind: 'model', value: composition.model });
    }
    return out;
  }, [composition, promptOptions, skillOptions, mcpOptions, kbOptions, commandOptions, modelOptions]);

  const dropInvalid = () => {
    const next: AgentComposition = { ...composition };
    for (const item of invalid) {
      if (item.kind === 'model') {
        next.model = '';
        continue;
      }
      const key = item.kind as
        | 'prompts'
        | 'skills'
        | 'mcps'
        | 'knowledgeBases'
        | 'customCommands';
      next[key] = (composition[key] ?? []).filter(value => value !== item.value);
    }
    onChange(next);
  };

  return (
    <div className={styles.config}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          业务空间
          <FieldHint>
            裸名按这个空间解析；引用其他空间的能力需要目标空间创建 ReferenceGrant。
          </FieldHint>
        </span>
        <NamespaceSelect
          allowAll={false}
          value={referrer}
          onChange={next => patch({ namespace: next })}
        />
        <Typography.Text type="secondary" className={styles.catalogHint}>
          当前引用方：{referrer}
        </Typography.Text>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          模型
          <FieldHint>
            不指定时使用部署默认模型（agent.chat-model 或
            llm.model）。候选中只包含平台模型和你自己的模型。
          </FieldHint>
        </span>
        <Select
          value={composition.model || DEPLOYMENT_DEFAULT}
          disabled={disabled}
          aria-label="模型"
          className={styles.select}
          onChange={next => patch({ model: next === DEPLOYMENT_DEFAULT ? '' : next })}
          options={[
            {
              value: DEPLOYMENT_DEFAULT,
              label: '部署默认（不指定模型）',
            },
            ...modelOptions,
          ]}
        />
      </label>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>
          提示词
          {composition.prompts.length > 0 ? (
            <em className={styles.count}>{composition.prompts.length}</em>
          ) : null}
        </span>
        <PromptOrderList
          options={promptOptions}
          value={composition.prompts}
          onChange={next => patch({ prompts: next })}
          disabled={disabled || prompts.isLoading}
        />
      </div>

      <div className={styles.configGrid}>
        <MultiSelect
          label="MCP"
          value={composition.mcps}
          options={mcpOptions}
          loading={mcps.isLoading}
          disabled={disabled}
          placeholder="选择 MCP 服务"
          hint="只显示启用中的 MCP，以及被目标空间 ReferenceGrant 放行的跨空间 MCP；跨空间项显示为「空间/名称」。"
          onChange={next => patch({ mcps: next })}
        />
        <MultiSelect
          label="命令"
          value={composition.customCommands}
          options={commandOptions}
          loading={customCommands.isLoading}
          disabled={disabled}
          placeholder="选择自定义命令"
          hint="自定义命令以调用方权限执行，只能在引用方空间内使用。"
          onChange={next => patch({ customCommands: next })}
        />
        <MultiSelect
          label="Skill"
          value={composition.skills}
          options={skillOptions}
          loading={skills.isLoading}
          disabled={disabled}
          placeholder="选择 Skill"
          onChange={next => patch({ skills: next })}
        />
        <MultiSelect
          label="知识库"
          value={composition.knowledgeBases}
          options={kbOptions}
          loading={knowledgeBases.isLoading}
          disabled={disabled}
          placeholder="选择知识库"
          onChange={next => patch({ knowledgeBases: next })}
        />
      </div>

      {invalid.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          title="组合中有失效或未授权的资源"
          description={
            <div>
              <div>
                {invalid
                  .map(item => `${String(item.kind)}: ${item.value}`)
                  .join('；')}
              </div>
              <Button size="small" type="link" onClick={dropInvalid} disabled={disabled}>
                清理失效项
              </Button>
            </div>
          }
        />
      ) : null}

      <Typography.Text type="secondary" className={styles.catalogHint}>
        自定义命令主要用于远端运行时的命令授权；无宿主调试使用进程内运行时，它只作为能力声明，不改变模型回合。
      </Typography.Text>

      <div className={styles.configFoot}>
        <div className={styles.identityNote}>
          <Tag bordered={false}>执行身份</Tag>
          <Typography.Text type="secondary" className={styles.identityNoteText}>
            当前登录用户{identityName ? `（${identityName}）` : ''}；配额与审批下限由部署配置提供
          </Typography.Text>
        </div>
        <Space size={2}>
          <Button
            size="small"
            type="link"
            icon={<ReloadOutlined />}
            loading={refreshing}
            disabled={disabled}
            onClick={refreshAll}
          >
            刷新资源
          </Button>
          <Button
            size="small"
            type="link"
            disabled={disabled}
            onClick={() => onChange(emptyComposition(referrer))}
          >
            重置组合
          </Button>
        </Space>
      </div>

      {loading ? (
        <Typography.Text type="secondary" className={styles.catalogHint}>
          正在读取资源目录…
        </Typography.Text>
      ) : null}
    </div>
  );
}

function MultiSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  loading,
  placeholder,
  hint,
}: {
  label: string;
  value: string[];
  options: SelectOption[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  loading?: boolean;
  placeholder: string;
  hint?: ReactNode;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>
        {label}
        <FieldHint>{hint}</FieldHint>
        {value.length > 0 ? <em className={styles.count}>{value.length}</em> : null}
      </span>
      <Select
        mode="multiple"
        value={value}
        options={options}
        loading={loading}
        disabled={disabled}
        allowClear
        showSearch
        optionFilterProp="label"
        maxTagCount="responsive"
        placeholder={placeholder}
        aria-label={label}
        className={styles.select}
        optionRender={option => {
          const data = option.data as SelectOption;
          return (
            <div>
              <div>{option.label}</div>
              {data.description ? (
                <div className={styles.optionDesc}>{data.description}</div>
              ) : null}
            </div>
          );
        }}
        onChange={onChange}
      />
    </label>
  );
}
