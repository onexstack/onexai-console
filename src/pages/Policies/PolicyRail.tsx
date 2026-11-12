import { DownOutlined, RightOutlined } from '@ant-design/icons';
import { Button, Empty, Input, Space, Spin, Tag, Typography } from 'antd';

import type { AuthorizationPolicy } from '@/api/policies';
import { MoreActions, StatusSwitch } from '@/ui';
import { kindLabel } from './options';
import styles from './styles.module.scss';

interface Props {
  policies: AuthorizationPolicy[];
  activeName?: string;
  keyword: string;
  onKeywordChange: (value: string) => void;
  loading?: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (policy: AuthorizationPolicy) => void;
  onEdit: (policy: AuthorizationPolicy) => void;
  onDelete: (policy: AuthorizationPolicy) => void;
  onToggleStatus: (policy: AuthorizationPolicy, next: boolean) => Promise<void> | void;
}

/**
 * 策略页左栏：搜索 + 可折叠的「自定义策略」列表。
 *
 * onexai 没有 Polaris 的默认策略概念，所以这里只有一组；行内开关与更多菜单
 * 保留列表页原有的快捷操作。
 */
export default function PolicyRail({
  policies,
  activeName,
  keyword,
  onKeywordChange,
  loading,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onEdit,
  onDelete,
  onToggleStatus,
}: Props) {
  return (
    <div className={styles.rail}>
      <Input.Search
        allowClear
        placeholder="搜索策略名、描述或主体"
        value={keyword}
        onChange={event => onKeywordChange(event.target.value)}
      />

      <Button type="text" block onClick={onToggleCollapsed} className={styles.railGroup}>
        <Space size={6}>
          {collapsed ? <RightOutlined /> : <DownOutlined />}
          <span>自定义策略（{policies.length}）</span>
        </Space>
      </Button>

      {loading ? (
        <div className={styles.railLoading}>
          <Spin />
        </div>
      ) : null}

      {!loading && policies.length === 0 ? (
        <Empty description={keyword ? '没有匹配的策略' : '还没有策略'} />
      ) : null}

      {!collapsed ? (
        <div className={styles.railList}>
          {policies.map(policy => {
            const resources = policy.resources ?? [];
            const subjects = policy.subjects ?? [];
            return (
              <div
                key={policy.name}
                className={`${styles.railItem} ${
                  policy.name === activeName ? styles.railItemActive : ''
                }`}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(policy)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') onSelect(policy);
                }}
              >
                <div className={styles.railItemMain}>
                  <Typography.Text strong ellipsis={{ tooltip: policy.name }}>
                    {policy.name}
                  </Typography.Text>
                  <Space size={4} wrap className={styles.railTags}>
                    <Tag color={policy.effect === 'deny' ? 'red' : 'green'}>
                      {policy.effect === 'deny' ? '拒绝' : '允许'}
                    </Tag>
                    {policy.status === 'disabled' ? <Tag>停用</Tag> : null}
                    <Tag>{subjects.length} 主体</Tag>
                    <Tag>
                      {resources.length > 0
                        ? resources.map(resource => kindLabel(resource.kind)).join('、')
                        : '无资源'}
                    </Tag>
                  </Space>
                </div>
                <Space
                  size={2}
                  className={styles.railItemActions}
                  onClick={event => event.stopPropagation()}
                >
                  <StatusSwitch
                    checked={policy.status !== 'disabled'}
                    onChange={next => onToggleStatus(policy, next)}
                  />
                  <MoreActions
                    items={[
                      { key: 'edit', label: '编辑' },
                      { key: 'delete', label: '删除', danger: true },
                    ]}
                    onClick={({ key }) => {
                      if (key === 'edit') onEdit(policy);
                      if (key === 'delete') onDelete(policy);
                    }}
                  />
                </Space>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
