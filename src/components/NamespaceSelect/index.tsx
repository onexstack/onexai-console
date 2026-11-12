import { useMemo } from 'react';
import { Select } from 'antd';
import { ClusterOutlined } from '@ant-design/icons';

import { useNamespaceOptions } from '@/components/ResourceForm/options';
import { ALL_NAMESPACES, setNamespace, useNamespace, useTranslation } from '@/runtime';

import styles from './styles.module.scss';

export interface NamespaceSelectProps {
  /**
   * 是否提供「全部空间」。
   *
   * 列表/浏览场景保持可选；创建页必须把资源落到一个具体业务空间时传 false，
   * 否则新建的智能体会在“页头显示全部空间”的情况下静默落到后端默认空间。
   */
  allowAll?: boolean;
  /**
   * 是否把系统空间 `default` 纳入候选。
   *
   * 业务空间列表默认过滤系统空间，但 OneX 的内置智能体与历史数据可能住在
   * `default`。只在需要选中它的场景（智能体创建页、引用授权）打开。
   */
  includeSystem?: boolean;
  /**
   * 受控值。提供时只影响本选择器，不写全局 store；调试台的引用方需要它：
   * 页头可能是「全部空间」，而调试台必须有一个具体的引用方。
   */
  value?: string;
  /** 受控变更回调；缺省时写全局 store。 */
  onChange?: (namespace: string) => void;
}

/**
 * 业务空间选择器。
 *
 * 命名空间（Kubernetes Namespace）在本应用里既是资源的一个字段，也是列表的浏览
 * 维度：运营通常只关心自己那个命名空间下的资源。选择结果放在全局 store 里（见
 * `runtime/store.ts`），所以切换页面、刷新之后仍然是同一个空间。
 *
 * 「全部空间」用空字符串表示 —— 选中它时调用方不传过滤条件，列表行为与没有这个
 * 选择器时逐字节一致。
 *
 * 不单独画「业务空间」标签：选择器与页面标题同行、靠右摆放，框内已写明当前值
 * （「全部空间」或具体空间名）。标签会让标题行看起来像两段标题；无障碍名称仍由
 * `aria-label` 提供。
 */
export default function NamespaceSelect({
  allowAll = true,
  includeSystem = false,
  value,
  onChange,
}: NamespaceSelectProps) {
  const { t } = useTranslation();
  const globalNamespace = useNamespace();
  const namespace = value ?? globalNamespace;
  const apply = onChange ?? setNamespace;
  const { options, loading } = useNamespaceOptions({ includeSystem });

  const selectOptions = useMemo(() => {
    const namespaces = options
      .filter(option => option.value !== ALL_NAMESPACES)
      .map(option => ({ value: option.value, label: option.label }));

    // 已保存的空间可能已从候选里消失（被删除 / 权限变化 / 候选接口失败）。
    // 保留成一条合成选项，而不是静默回落到「全部空间」：后者会悄悄扩大数据范围，
    // 让用户以为筛选还在生效。
    if (namespace && !namespaces.some(option => option.value === namespace)) {
      namespaces.push({ value: namespace, label: namespace });
    }

    return allowAll
      ? [{ value: ALL_NAMESPACES, label: t('全部空间') }, ...namespaces]
      : namespaces;
  }, [allowAll, namespace, options, t]);

  return (
    <div className={styles.root}>
      <Select
        className={styles.select}
        // 允许「全部空间」时值可能是空串；禁止时用 undefined 让占位符出现。
        value={allowAll ? namespace : namespace || undefined}
        options={selectOptions}
        loading={loading}
        showSearch
        optionFilterProp="label"
        prefix={<ClusterOutlined />}
        popupMatchSelectWidth={false}
        placeholder={allowAll ? undefined : t('请选择业务空间')}
        aria-label={t('业务空间')}
        onChange={apply}
      />
    </div>
  );
}
