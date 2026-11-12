import type { ReactNode } from 'react';
import { Button, Divider, Result, Space, Tabs } from 'antd';
import type { TabsProps } from 'antd';

import { DetailShell } from '@/ui';

interface Props {
  title: ReactNode;
  onBack: () => void;
  actions?: ReactNode;
  loading?: boolean;
  /** 有值时用错误结果替换正文；`onRetry` 供重试。 */
  error?: ReactNode;
  onRetry?: () => void;
  /** 标题卡下方的信息区（`InfoSection` / Token 占位等）。 */
  info: ReactNode;
  tabs: TabsProps['items'];
}

/**
 * 用户 / 用户组详情页的共用骨架：页头 + 操作条 + 信息卡 + 页签。
 *
 * Polaris 的详情页就是「信息卡在上、关系页签在下」；两个详情页只差字段与
 * 页签内容，骨架留在这里避免两份复制随后漂移。
 */
export default function SubjectDetailLayout({
  title,
  onBack,
  actions,
  loading,
  error,
  onRetry,
  info,
  tabs,
}: Props) {
  return (
    <DetailShell id={title} onBack={onBack} actions={actions} loading={loading}>
      {error ? (
        <Result
          status="error"
          title="读取详情失败"
          subTitle={error}
          extra={
            <Space>
              <Button onClick={onBack}>返回列表</Button>
              {onRetry ? (
                <Button type="primary" onClick={onRetry}>
                  重试
                </Button>
              ) : null}
            </Space>
          }
        />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {info}
          <Divider style={{ margin: 0 }} />
          <Tabs items={tabs} />
        </Space>
      )}
    </DetailShell>
  );
}
