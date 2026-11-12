import { useMemo } from 'react';
import { Alert, Button, Input, Radio, Switch, Tag } from 'antd';

import { rankCatalog, suggestName } from './matcher';
import {
  SELECTION_KINDS,
  SMART_KINDS,
  type SmartCatalog,
  type SmartDraft,
  type SmartSelectionKind,
} from './types';
import CapabilityGroup from './CapabilityGroup';
import styles from './styles.module.scss';

const NAME_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

export interface SmartReviewProps {
  goal: string;
  draft: SmartDraft;
  catalog: SmartCatalog;
  existingAgentNames: Set<string>;
  preferredNamespace: string;
  saving: boolean;
  submitError: string | null;
  onChange: (draft: SmartDraft) => void;
  onConfirm: () => void;
  onBack: () => void;
  onRegenerate: () => void;
  onSwitchManual: () => void;
}

/** 第三步：确认与微调。所有编辑都回写到同一个 draft，摘要即时更新。 */
export default function SmartReview({
  goal,
  draft,
  catalog,
  existingAgentNames,
  preferredNamespace,
  saving,
  submitError,
  onChange,
  onConfirm,
  onBack,
  onRegenerate,
  onSwitchManual,
}: SmartReviewProps) {
  const ranked = useMemo(
    () => rankCatalog(goal, catalog, preferredNamespace),
    [goal, catalog, preferredNamespace]
  );

  const nameError = useMemo(() => {
    const name = draft.name.trim();
    if (!name) return '请输入名称';
    if (name.length > 63) return '名称不能超过 63 个字符';
    if (!NAME_PATTERN.test(name)) return '只能使用小写字母、数字、- 和 .，且以字母或数字开头/结尾';
    if (existingAgentNames.has(name)) return '这个名称已被占用';
    return null;
  }, [draft.name, existingAgentNames]);

  const displayNameError = draft.displayName.trim() ? null : '请输入显示名';
  const invalid = Boolean(nameError || displayNameError);

  const update = (patch: Partial<SmartDraft>) => onChange({ ...draft, ...patch });

  const toggle = (kind: SmartSelectionKind, name: string, checked: boolean) => {
    const list = draft[kind];
    if (checked) {
      if (list.some(item => item.name === name)) return;
      const candidate = ranked[kind].find(item => item.name === name);
      const reason = candidate?.reasons?.join('；') || '手动选择';
      update({ [kind]: [...list, { name, reason }] } as Partial<SmartDraft>);
      return;
    }
    update({ [kind]: list.filter(item => item.name !== name) } as Partial<SmartDraft>);
  };

  const modelLabel = draft.model
    ? (ranked.models.find(item => item.name === draft.model)?.displayName ?? draft.model)
    : '部署默认';

  const totalSelected = SELECTION_KINDS.reduce((sum, kind) => sum + draft[kind].length, 0);
  const suggested = nameError === '这个名称已被占用' ? suggestName(goal, existingAgentNames) : null;

  return (
    <div className={styles.review}>
      <div className={styles.reviewMain}>
        <div className={styles.reviewBanner}>
          <div>
            <h2 className={styles.reviewTitle}>智能体草案</h2>
            <p className={styles.reviewSub}>
              已生成名称、描述与能力组合。确认前可以自由增删；创建仍走标准的智能体接口。
            </p>
          </div>
          <Tag color={draft.engine === 'ai' ? 'purple' : 'default'}>
            {draft.engine === 'template'
              ? '来自模版'
              : draft.engine === 'debug'
                ? '调试台组合'
                : draft.engine === 'ai'
                  ? 'AI 智能匹配'
                  : '本地关键词匹配'}
          </Tag>
        </div>

        {draft.notice && (
          <Alert
            type="warning"
            showIcon
            className={styles.alert}
            title="匹配结果有调整"
            description={draft.notice}
          />
        )}
        {submitError && (
          <Alert
            type="error"
            showIcon
            className={styles.alert}
            title="创建失败"
            description={submitError}
          />
        )}

        <section className={styles.card}>
          <h3 className={styles.cardTitle}>基本信息</h3>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="smart-display-name">
              显示名
            </label>
            <Input
              id="smart-display-name"
              value={draft.displayName}
              maxLength={100}
              status={displayNameError ? 'error' : undefined}
              onChange={event => update({ displayName: event.target.value })}
            />
            {displayNameError && <span className={styles.fieldError}>{displayNameError}</span>}
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="smart-name">
              名称
            </label>
            <Input
              id="smart-name"
              addonBefore="/agents/"
              value={draft.name}
              maxLength={63}
              status={nameError ? 'error' : undefined}
              onChange={event => update({ name: event.target.value.toLowerCase() })}
            />
            {nameError ? (
              <span className={styles.fieldError}>
                {nameError}
                {suggested && (
                  <Button type="link" size="small" onClick={() => update({ name: suggested })}>
                    使用 {suggested}
                  </Button>
                )}
              </span>
            ) : (
              <span className={styles.fieldHint}>创建后不可修改；用于 URL 与运行时寻址。</span>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="smart-description">
              描述
            </label>
            <Input.TextArea
              id="smart-description"
              value={draft.description}
              autoSize={{ minRows: 2, maxRows: 5 }}
              maxLength={500}
              showCount
              onChange={event => update({ description: event.target.value })}
            />
          </div>

          <div className={styles.fieldInline}>
            <label className={styles.fieldLabel} htmlFor="smart-status">
              创建后启用
            </label>
            <Switch
              id="smart-status"
              checked={draft.status === 'enabled'}
              onChange={checked => update({ status: checked ? 'enabled' : 'disabled' })}
            />
            <span className={styles.fieldHint}>
              将创建在：{preferredNamespace || '部署默认空间'}
            </span>
          </div>
        </section>

        <section className={styles.group}>
          <header className={styles.groupHead}>
            <h3 className={styles.groupTitle}>
              模型
              <span className={styles.groupCount}>单选；留空使用部署默认</span>
            </h3>
          </header>
          {ranked.models.length === 0 ? (
            <div className={styles.groupEmpty}>
              <span>没有可用的模型端点。</span>
              <a href="/models/new" target="_blank" rel="noreferrer">
                去创建
              </a>
            </div>
          ) : (
            <div className={styles.capGrid}>
              <label className={styles.capCard}>
                <Radio checked={draft.model === ''} onChange={() => update({ model: '' })} />
                <span className={styles.capBody}>
                  <span className={styles.capTitleRow}>
                    <span className={styles.capTitle}>部署默认</span>
                  </span>
                  <span className={styles.capDesc} title="不显式绑定模型，运行时按部署配置选择。">
                    不显式绑定模型，运行时按部署配置选择。
                  </span>
                </span>
              </label>
              {ranked.models.map(model => (
                <label key={model.name} className={styles.capCard}>
                  <Radio
                    checked={draft.model === model.name}
                    onChange={() => update({ model: model.name })}
                  />
                  <span className={styles.capBody}>
                    <span className={styles.capTitleRow}>
                      <span className={styles.capTitle} title={model.displayName}>
                        {model.displayName}
                      </span>
                      {model.displayName !== model.name && (
                        <code className={styles.capName} title={model.name}>
                          {model.name}
                        </code>
                      )}
                    </span>
                    {model.detail && (
                      <span className={styles.capDetail} title={model.detail}>
                        {model.detail}
                      </span>
                    )}
                    {model.description && (
                      <span className={styles.capDesc} title={model.description}>
                        {model.description}
                      </span>
                    )}
                    {(model.reasons ?? []).length > 0 && (
                      <span className={styles.capReasons}>
                        {(model.reasons ?? []).slice(0, 2).map(reason => (
                          <Tag
                            key={reason}
                            color="processing"
                            className={styles.reasonTag}
                            title={reason}
                          >
                            {reason}
                          </Tag>
                        ))}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
        </section>

        {SELECTION_KINDS.map(kind => {
          const meta = SMART_KINDS.find(item => item.kind === kind);
          if (!meta) return null;
          return (
            <CapabilityGroup
              key={kind}
              kind={kind}
              label={meta.label}
              candidates={ranked[kind]}
              selected={draft[kind]}
              newHref={meta.newHref}
              preferredNamespace={preferredNamespace}
              onToggle={(name, checked) => toggle(kind, name, checked)}
            />
          );
        })}
      </div>

      <aside className={styles.summary}>
        <h3 className={styles.summaryTitle}>创建预览</h3>
        <div className={styles.summaryName}>{draft.displayName || '未命名智能体'}</div>
        <div className={styles.summaryId}>{draft.name || '—'}</div>

        <dl className={styles.summaryList}>
          <div>
            <dt>模型</dt>
            <dd>{modelLabel}</dd>
          </div>
          {SELECTION_KINDS.map(kind => {
            const meta = SMART_KINDS.find(item => item.kind === kind);
            return (
              <div key={kind}>
                <dt>{meta?.label ?? kind}</dt>
                <dd>{draft[kind].length}</dd>
              </div>
            );
          })}
          <div>
            <dt>能力合计</dt>
            <dd>{totalSelected}</dd>
          </div>
        </dl>

        <p className={styles.summaryNote}>
          运行时会按授权再次校验所选能力；这里展示的是平台目录中已启用的资源。
        </p>
      </aside>

      <div className={styles.actions}>
        <Button onClick={onBack}>返回</Button>
        <Button onClick={onSwitchManual} disabled={saving || invalid}>
          微调
        </Button>
        <Button onClick={onRegenerate} disabled={saving}>
          重新匹配
        </Button>
        <Button type="primary" loading={saving} disabled={invalid} onClick={onConfirm}>
          创建
        </Button>
      </div>
    </div>
  );
}
