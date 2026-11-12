import { useMemo, useState } from 'react';
import { Button, Checkbox, Tag } from 'antd';
import clsx from 'clsx';

import type { SmartCandidate, SmartSelection, SmartSelectionKind } from './types';
import styles from './styles.module.scss';

export interface CapabilityGroupProps {
  kind: SmartSelectionKind;
  label: string;
  candidates: SmartCandidate[];
  selected: SmartSelection[];
  newHref: string;
  preferredNamespace: string;
  onToggle: (name: string, checked: boolean) => void;
}

/**
 * 一类能力的复选卡片。
 *
 * 默认只展示「已选 + 有命中」的项；「显示全部」才铺开完整候选。这样模型/本地
 * 匹配的结果是页面主角，用户仍能在这里纠正它。
 */
export default function CapabilityGroup({
  kind,
  label,
  candidates,
  selected,
  newHref,
  preferredNamespace,
  onToggle,
}: CapabilityGroupProps) {
  const [showAll, setShowAll] = useState(false);

  const selectedReasons = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of selected) map.set(item.name, item.reason);
    return map;
  }, [selected]);

  const ordered = useMemo(() => {
    return [...candidates].sort((a, b) => {
      const selectedA = selectedReasons.has(a.name) ? 1 : 0;
      const selectedB = selectedReasons.has(b.name) ? 1 : 0;
      if (selectedA !== selectedB) return selectedB - selectedA;
      return (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name);
    });
  }, [candidates, selectedReasons]);

  const matched = ordered.filter(
    candidate => selectedReasons.has(candidate.name) || (candidate.score ?? 0) > 0
  );
  const visible = showAll ? ordered : matched.length > 0 ? matched : ordered.slice(0, 3);
  const canExpand = ordered.length > visible.length || showAll;

  return (
    <section className={styles.group} aria-labelledby={`smart-group-${kind}`}>
      <header className={styles.groupHead}>
        <h3 id={`smart-group-${kind}`} className={styles.groupTitle}>
          {label}
          <span className={styles.groupCount}>
            已选 {selected.length} / 共 {ordered.length}
          </span>
        </h3>
        {canExpand && (
          <Button type="link" size="small" onClick={() => setShowAll(value => !value)}>
            {showAll ? '收起' : `显示全部 ${ordered.length} 项`}
          </Button>
        )}
      </header>

      {ordered.length === 0 ? (
        <div className={styles.groupEmpty}>
          <span>没有可用的{label}。</span>
          <a href={newHref} target="_blank" rel="noreferrer">
            去创建
          </a>
        </div>
      ) : (
        <div className={styles.capGrid}>
          {visible.map(candidate => {
            const checked = selectedReasons.has(candidate.name);
            const reasons = checked
              ? [selectedReasons.get(candidate.name) ?? '已选择']
              : (candidate.reasons ?? []);
            const sameNamespace =
              preferredNamespace !== '' && candidate.namespace === preferredNamespace;

            return (
              <label
                key={candidate.name}
                className={clsx(styles.capCard, checked && styles.capCardSelected)}
              >
                <Checkbox
                  checked={checked}
                  onChange={event => onToggle(candidate.name, event.target.checked)}
                />
                <span className={styles.capBody}>
                  <span className={styles.capTitleRow}>
                    <span className={styles.capTitle} title={candidate.displayName}>
                      {candidate.displayName}
                    </span>
                    {candidate.displayName !== candidate.name && (
                      <code className={styles.capName} title={candidate.name}>
                        {candidate.name}
                      </code>
                    )}
                    {candidate.namespace && (
                      <Tag className={styles.capTag} title={candidate.namespace}>
                        {candidate.namespace}
                      </Tag>
                    )}
                    {sameNamespace && (
                      <Tag color="blue" className={styles.capTag}>
                        同空间
                      </Tag>
                    )}
                  </span>
                  {candidate.detail && (
                    <span className={styles.capDetail} title={candidate.detail}>
                      {candidate.detail}
                    </span>
                  )}
                  {candidate.description && (
                    <span className={styles.capDesc} title={candidate.description}>
                      {candidate.description}
                    </span>
                  )}
                  {reasons.length > 0 && (
                    <span className={styles.capReasons}>
                      {reasons.slice(0, 3).map(reason => (
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
            );
          })}
        </div>
      )}
    </section>
  );
}
