import { useCallback, useState } from 'react';
import { Button, Tooltip } from 'antd';
import {
  BellOutlined,
  HistoryOutlined,
  LockOutlined,
  MailOutlined,
  MobileOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';

import type { MeResponse } from '@/api/types';

import PasswordModal from './PasswordModal';
import {
  SecurityCard,
  SecurityItem,
  StatusChip,
  UnwiredButton,
  UnwiredSwitch,
} from './SecurityCard';
import styles from './styles.module.scss';

/**
 * 安全设置。
 *
 * 布局对齐 onex-console：两列卡片、无阴影、每行「图标块 + 标题/状态/描述 + 操作」。
 * 后端目前只提供改密码；手机、邮箱、两步验证、登录记录先以「暂未接入」占位，
 * 不做成看起来能用、点了却没反应的按钮。
 *
 * 飞书绑定与解绑已迁至「飞书绑定」板块（`/account?tab=feishu`），这里不再保留
 * 重复入口。
 */
export default function SecurityView({ me }: { me: MeResponse }) {
  const [passwordOpen, setPasswordOpen] = useState(false);

  const closePassword = useCallback(() => setPasswordOpen(false), []);

  return (
    <>
      <div className={styles.securityGrid}>
        <SecurityCard title="身份验证">
          <SecurityItem
            icon={<MobileOutlined />}
            title="安全手机"
            status={<StatusChip tone="muted">暂未接入</StatusChip>}
            description="手机可用于身份验证、密码找回、通知接收。"
            action={<UnwiredButton>绑定</UnwiredButton>}
          />
          <SecurityItem
            icon={<MailOutlined />}
            title="安全邮箱"
            status={<StatusChip tone="muted">暂未接入</StatusChip>}
            description="邮箱可用于身份验证、密码找回、通知接收。"
            action={<UnwiredButton>绑定</UnwiredButton>}
          />
        </SecurityCard>

        <SecurityCard title="密码设置">
          <SecurityItem
            icon={<LockOutlined />}
            title="账户密码"
            description="用于账号密码登录。飞书登录创建的账号如果还没有设置过密码，当前密码可以留空。"
            action={
              me.can_change_password ? (
                <Button onClick={() => setPasswordOpen(true)}>修改</Button>
              ) : (
                <Tooltip title="当前账号不支持修改密码">
                  <span className={styles.tooltipAnchor}>
                    <Button disabled>修改</Button>
                  </span>
                </Tooltip>
              )
            }
          />
        </SecurityCard>

        <SecurityCard title="账户安全">
          <SecurityItem
            icon={<SafetyCertificateOutlined />}
            title="两步验证"
            status={<StatusChip tone="muted">暂未接入</StatusChip>}
            description="开启后登录时需要进行二次验证，提升账号安全性。"
            action={<UnwiredSwitch label="两步验证" />}
          />
          <SecurityItem
            icon={<BellOutlined />}
            title="登录提醒"
            status={<StatusChip tone="muted">暂未接入</StatusChip>}
            description="当账号在新设备上登录时发送邮件通知。"
            action={<UnwiredSwitch label="登录提醒" />}
          />
        </SecurityCard>

        <SecurityCard title="登录记录" className={styles.fullWidth}>
          <SecurityItem
            icon={<HistoryOutlined />}
            title="登录历史"
            status={<StatusChip tone="muted">暂未接入</StatusChip>}
            description="记录账号的登录设备、时间与来源 IP，便于发现异常登录。"
            action={<UnwiredButton>查看</UnwiredButton>}
          />
        </SecurityCard>
      </div>

      <PasswordModal open={passwordOpen} onClose={closePassword} provider={me.user.provider} />
    </>
  );
}
