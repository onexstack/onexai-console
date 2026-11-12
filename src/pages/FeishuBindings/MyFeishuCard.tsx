import { useState } from 'react';
import { Alert, App, Avatar, Button, Card, Skeleton, Space, Tag, Tooltip } from 'antd';
import { TeamOutlined } from '@ant-design/icons';
import clsx from 'clsx';

import { unbindFeishu } from '@/api/auth';
import type { FeishuPeerBinding, MeResponse } from '@/api/types';
import { formatDate } from '@/lib/date';
import { CopyButton } from '@/ui/components/CopyButton';

import { reasonText } from './meta';
import styles from './styles.module.scss';

/**
 * 「我的飞书」账号级绑定卡。
 *
 * 这里只负责绑定 / 解绑自己的身份：账号级接口 `DELETE /v1/auth/feishu/bind`
 * 只认令牌里的用户，不接受他人 ID。`@peer` 可用智能体的配置统一在下方
 * 「飞书身份」列表里完成——同一个动作只留一个入口，避免本卡与列表行重复。
 *
 * `ownRow` 只是当前列表里能匹配到自己的那一行，用来在 onex-iam 等外部来源
 * 下禁用解绑；找不到也不影响账号级解绑（后端会做最终校验）。
 */
export default function MyFeishuCard({
  me,
  loading,
  error,
  onRetry,
  ownRow,
  onBind,
  onUnbound,
}: {
  me?: MeResponse;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  ownRow?: FeishuPeerBinding;
  onBind: () => void;
  onUnbound: (openID: string) => Promise<void>;
}) {
  const { message, modal } = App.useApp();
  const [unbinding, setUnbinding] = useState(false);

  const feishu = me?.feishu;
  const bound = Boolean(feishu);

  // `can_unbind` 是 peer 级判定：mismatch 时非管理员也会是 false，但账号级
  // `DELETE /v1/auth/feishu/bind` 仍允许解绑账号侧（后端只校验密码）。
  //
  // 机器人侧残留一条指向「已不存在账号」的 peer 行时（迁移或删号遗留），
  // 按 external/unknown 拦住账号级解绑会把用户堵死：那一行他自己删不掉，
  // 账号侧的绑定不清空又无法重新绑定。这种残留行不代表任何现存的外部授权，
  // 重新绑定时后端会接管并修正它，所以只对「仍指向现存账号」的外部来源保留禁用。
  // `!account` 覆盖两种坏数据：canonical 指向已删除的账号，或根本没有 canonical。
  const stalePeerRow = Boolean(ownRow && !ownRow.account);
  const blockingReason =
    ownRow &&
    !ownRow.can_unbind &&
    !stalePeerRow &&
    (ownRow.readonly_reason === 'external' || ownRow.readonly_reason === 'unknown_source')
      ? ownRow.readonly_reason
      : undefined;

  const confirmUnbind = () => {
    if (!feishu) return;
    modal.confirm({
      title: '解绑飞书',
      content: (
        <div className={styles.confirmText}>
          <p>
            解绑后，飞书里向 OneX 机器人提问将不再按你的账号识别，<code>@peer</code> 也不再可用。
          </p>
          <p>该操作不可撤销，需要重新走一次绑定流程。</p>
          <p>
            解绑要求账号已设置登录密码，否则解绑后将无法登录；如未设置，请先到「安全设置 →
            密码设置」设置，或联系管理员。
          </p>
        </div>
      ),
      okText: '解绑',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setUnbinding(true);
        try {
          await unbindFeishu();
          message.success('已解绑飞书');
          await onUnbound(feishu.open_id);
        } catch (err) {
          message.error(err instanceof Error ? err.message : '解绑失败');
          throw err;
        } finally {
          setUnbinding(false);
        }
      },
    });
  };

  return (
    <Card className={clsx(styles.card, styles.myCard)} title="我的飞书">
      {loading && !me ? (
        <Skeleton active avatar paragraph={{ rows: 2 }} />
      ) : error && !me ? (
        <Alert
          type="error"
          showIcon
          title="读取账号信息失败"
          description={error instanceof Error ? error.message : undefined}
          action={
            <Button size="small" onClick={onRetry}>
              重试
            </Button>
          }
        />
      ) : (
        <>
          <div className={styles.myFeishu}>
            <Avatar
              size={48}
              src={feishu?.avatar_url}
              icon={<TeamOutlined />}
              className={styles.avatar}
            />
            <div className={styles.myIdentity}>
              <div className={styles.myName}>
                <span>{bound ? feishu?.name || '未命名飞书账号' : '未绑定飞书'}</span>
                {bound ? <Tag color="success">已绑定</Tag> : <Tag color="warning">未绑定</Tag>}
              </div>
              {bound ? (
                <>
                  <div className={styles.identityId}>
                    <span className={styles.mono}>{feishu?.open_id}</span>
                    <CopyButton value={feishu?.open_id ?? ''} ariaLabel="复制飞书 open_id" />
                  </div>
                  {feishu?.bound_at && (
                    <div className={styles.myMeta}>绑定于 {formatDate(feishu.bound_at)}</div>
                  )}
                  <div className={styles.myDesc}>
                    飞书里向机器人提问会按这个账号识别；<code>@peer</code>{' '}
                    使用在下方为这个身份配置的智能体。
                  </div>
                </>
              ) : (
                <div className={styles.myDesc}>
                  绑定后，你在飞书里向 OneX 机器人提问时会按你的账号回答，并使用你的专属助手；
                  绑定完成后可在下方列表中配置 <code>@peer</code> 可用的智能体。
                </div>
              )}
            </div>
            <Space size={8} wrap className={styles.myActions}>
              {bound ? (
                blockingReason ? (
                  <Tooltip title={reasonText(blockingReason)}>
                    <span className={styles.inlineBlock}>
                      <Button danger disabled>
                        解绑
                      </Button>
                    </span>
                  </Tooltip>
                ) : (
                  <Button danger loading={unbinding} onClick={confirmUnbind}>
                    解绑
                  </Button>
                )
              ) : (
                <Button type="primary" onClick={onBind}>
                  绑定飞书
                </Button>
              )}
            </Space>
          </div>
          {bound && stalePeerRow && (
            <Alert
              type="warning"
              showIcon
              className={styles.myAlert}
              title="机器人侧的绑定没有关联到有效账号"
              description="列表里的这条记录可能是历史迁移或删号遗留。直接解绑后重新绑定飞书，会接管并修正这条残留绑定。"
            />
          )}
          {error && (
            <Alert
              type="warning"
              showIcon
              className={styles.myAlert}
              title="账号信息刷新失败，当前显示的是上次读取结果"
              description={error instanceof Error ? error.message : undefined}
              action={
                <Button size="small" onClick={onRetry}>
                  重试
                </Button>
              }
            />
          )}
        </>
      )}
    </Card>
  );
}
