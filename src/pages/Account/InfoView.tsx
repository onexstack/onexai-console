import type { ReactNode } from 'react';
import { Avatar, Tag } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import clsx from 'clsx';

import type { AccountUser, MeResponse } from '@/api/types';
import { formatDate } from '@/lib/date';

import { SecurityCard } from './SecurityCard';
import styles from './styles.module.scss';

/**
 * 基本信息。
 *
 * 后端没有自助修改资料的接口，所以这里全部只读 —— 不摆一排点了没反应的铅笔按钮。
 */
export default function InfoView({ me }: { me: MeResponse }) {
  const { user } = me;
  const name = user.display_name || user.username;

  return (
    <SecurityCard title="基本信息">
      <div className={styles.profileHero}>
        <Avatar
          className={styles.avatar}
          size={80}
          src={me.feishu?.avatar_url || undefined}
          icon={<UserOutlined />}
        />
        <div className={styles.heroText}>
          <div className={styles.heroName}>{name}</div>
          <div className={styles.heroTags}>
            <Tag color={user.role === 'admin' ? 'blue' : undefined}>{roleLabel(user.role)}</Tag>
            <Tag color={user.status === 'active' ? 'green' : 'default'}>
              {statusLabel(user.status)}
            </Tag>
            {me.feishu && <Tag color="geekblue">飞书已绑定</Tag>}
          </div>
        </div>
      </div>

      <div className={styles.fieldGrid}>
        <Field label="用户名" value={user.username} />
        <Field label="显示名" value={user.display_name} />
        <Field label="邮箱" value={user.email} />
        <Field label="角色" value={roleLabel(user.role)} />
        <Field label="状态" value={statusLabel(user.status)} />
        <Field label="登录方式" value={user.provider === 'lark' ? '飞书' : '账号密码'} />
        <Field label="注册时间" value={formatOptionalDate(user.created_at)} />
        <Field label="上次登录" value={formatOptionalDate(user.last_login_at)} />
      </div>
    </SecurityCard>
  );
}

function Field({ label, value }: { label: string; value?: ReactNode }) {
  const empty = value == null || value === '';
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={clsx(styles.fieldValue, empty && styles.emptyValue)}>
        {empty ? '-' : value}
      </span>
    </div>
  );
}

function roleLabel(role: AccountUser['role']): string {
  if (role === 'admin') return '管理员';
  if (role === 'sre') return 'SRE';
  return '普通用户';
}

function statusLabel(status: AccountUser['status']): string {
  return status === 'active' ? '正常' : '已禁用';
}

function formatOptionalDate(value: string | undefined): string | undefined {
  return value ? formatDate(value) : undefined;
}
