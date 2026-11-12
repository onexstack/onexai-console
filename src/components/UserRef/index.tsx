import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { listUsers } from '@/api/auth';
import type { AccountUser, FeishuBinding } from '@/api/types';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';

/** 服务端把 page_size 钳到 100，这里取上限。 */
const PAGE_SIZE = 100;
/** 目录的硬上限，避免异常数据量把应用卡住（约 2000 个账号）。 */
const MAX_PAGES = 20;

export type UserRow = AccountUser & { feishu?: FeishuBinding };

async function listAllUsers(): Promise<UserRow[]> {
  const first = await listUsers({ page: 1, pageSize: PAGE_SIZE });
  const users: UserRow[] = [...first.users];
  const pages = Math.min(Math.ceil(first.total / PAGE_SIZE), MAX_PAGES);
  for (let page = 2; page <= pages; page += 1) {
    try {
      const next = await listUsers({ page, pageSize: PAGE_SIZE });
      users.push(...next.users);
    } catch {
      // 已经拿到的部分仍然可用；剩下的 ID 回落到原始值。
      break;
    }
  }
  return users;
}

/** 目录里的一个账号，已经算好了「排在排班里该写什么」。 */
export interface DirectoryUser {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  feishuName?: string;
  /** 展示名：绑定飞书用飞书名，否则平台显示名。 */
  label: string;
  /** 写入排班的值：唯一 email，否则 username。 */
  value: string;
  /** 下拉搜索用的小写索引。 */
  searchText: string;
  status: AccountUser['status'];
  /** 是否存在飞书绑定记录：与 `/account?tab=feishu` 的「已绑定」同一口径。 */
  feishuBound: boolean;
  /** 绑定里有 Lark user_id 才算「能收到通知」；只有 open_id 的绑定发不出消息。 */
  larkReady: boolean;
  /** 飞书 user_id；用户组要把它写成成员别名，IM/Agent 运行才命中。 */
  larkUserID?: string;
  /** 飞书 open_id；没有 user_id 的租户用它兜底。 */
  openID?: string;
}

interface UserDirectoryValue {
  users: DirectoryUser[];
  byId: ReadonlyMap<string, string>;
  byKey: ReadonlyMap<string, DirectoryUser>;
  resolveName: (raw?: string | null) => string;
  ready: boolean;
  /** 目录是否仍在加载；编辑态要等它一次再映射主体，但不能无限等。 */
  loading: boolean;
}

const UserDirectoryContext = createContext<UserDirectoryValue>({
  users: [],
  byId: new Map(),
  byKey: new Map(),
  resolveName: raw => raw ?? '',
  ready: false,
  loading: false,
});

/**
 * 把账号列表整理成目录。
 *
 * 排班里的 `user_name` 是普通字符串，所以每个账号要有一个稳定的写入值：
 * email 只有在**全局唯一**时才能用（`chat.user.email` 没有唯一约束，两个账号
 * 共用一个邮箱时若都写 email，选择器会互相覆盖）；否则退回到唯一的 username。
 *
 * 展示名优先用飞书名，这也是页面「绑了飞书就展示飞书用户」的含义。
 */
function buildDirectory(rows: UserRow[]): DirectoryUser[] {
  const emailCount = new Map<string, number>();
  for (const row of rows) {
    const email = row.email?.trim().toLowerCase();
    if (email) emailCount.set(email, (emailCount.get(email) ?? 0) + 1);
  }

  return rows.flatMap(row => {
    const username = row.username?.trim();
    if (!username) return [];
    const displayName = row.display_name?.trim() || username;
    const email = row.email?.trim().toLowerCase() || undefined;
    const feishuName = row.feishu?.name?.trim() || undefined;
    const uniqueEmail = email && emailCount.get(email) === 1 ? email : undefined;
    const label = feishuName || displayName;
    return [
      {
        id: row.id,
        username,
        displayName,
        email,
        feishuName,
        label,
        value: uniqueEmail || username,
        searchText: [feishuName, displayName, username, email]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
        status: row.status,
        feishuBound: Boolean(row.feishu),
        larkReady: Boolean(row.feishu?.lark_user_id),
        larkUserID: row.feishu?.lark_user_id || undefined,
        openID: row.feishu?.open_id || undefined,
      },
    ];
  });
}

/** 一个键都没有歧义时，才能用来反查展示名。 */
function buildKeyIndex(users: DirectoryUser[]): Map<string, DirectoryUser> {
  const byKey = new Map<string, DirectoryUser>();
  const ambiguous = new Set<string>();
  for (const user of users) {
    for (const raw of [
      user.id,
      user.username,
      user.email,
      user.value,
      user.larkUserID,
      user.openID,
    ]) {
      if (!raw) continue;
      const key = raw.trim().toLowerCase();
      if (!key || ambiguous.has(key)) continue;
      const prev = byKey.get(key);
      if (prev && prev.id !== user.id) {
        ambiguous.add(key);
        byKey.delete(key);
        continue;
      }
      byKey.set(key, user);
    }
  }
  return byKey;
}

/**
 * 平台用户目录。
 *
 * `/v1/users` 只对管理员开放，所以非管理员不发请求：目录里只有 JWT 自带的
 * 当前用户，其余归属显示原始值。这正是「解析得到就显示用户名，否则回落原始值」。
 * 目录是全局的，列表每一格只查一次 context，不会按行发请求。
 */
export function UserDirectoryProvider({ children }: { children: ReactNode }) {
  const token = useSessionToken();
  const claims = useMemo(() => decodeClaims(token), [token]);

  const { data, isSuccess, isPending } = useQuery({
    queryKey: ['users', 'directory', claims?.userId ?? ''],
    queryFn: listAllUsers,
    enabled: Boolean(claims?.isAdmin),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
    // 非管理员的 403、或目录接口临时不可用，都不该弹全局错误：页面本身能降级。
    meta: { silent: true },
  });

  const users = useMemo(() => buildDirectory(data ?? []), [data]);

  const byId = useMemo(() => {
    const map = new Map<string, string>();
    if (claims?.userId && claims.name) map.set(claims.userId, claims.name);
    for (const user of users) map.set(user.id, user.username);
    return map;
  }, [claims?.userId, claims?.name, users]);

  const byKey = useMemo(() => {
    const map = buildKeyIndex(users);
    if (claims?.userId && claims.name && !map.has(claims.userId)) {
      map.set(claims.userId, {
        id: claims.userId,
        username: claims.name,
        displayName: claims.name,
        label: claims.name,
        value: claims.name,
        searchText: claims.name.toLowerCase(),
        status: 'active',
        feishuBound: false,
        larkReady: false,
      });
    }
    return map;
  }, [claims?.userId, claims?.name, users]);

  const resolveName = useMemo(
    () => (raw?: string | null) => {
      const value = raw?.trim();
      if (!value) return '';
      return byKey.get(value.toLowerCase())?.label ?? value;
    },
    [byKey]
  );

  const value = useMemo(
    () => ({
      users,
      byId,
      byKey,
      resolveName,
      ready: isSuccess && users.length > 0,
      loading: isPending,
    }),
    [users, byId, byKey, resolveName, isSuccess, isPending]
  );
  return <UserDirectoryContext.Provider value={value}>{children}</UserDirectoryContext.Provider>;
}

/** 目录的读取入口，供选择器和展示组件复用。 */
export function useUserDirectory(): UserDirectoryValue {
  return useContext(UserDirectoryContext);
}

/** 一个用户 ID：能解析就显示用户名，解析不到原样显示 ID。 */
export function UserRef({ id }: { id: string }) {
  const { byId } = useUserDirectory();
  return <span title={id}>{byId.get(id) ?? id}</span>;
}

/**
 * 策略主体里的一种身份别名（可能是账号 ID、登录名、飞书 user_id、open_id）。
 *
 * 能折叠到某个平台账号时显示账号名并链接用户详情；否则原样显示，不猜测、
 * 不误链——一个解析不到的 alias 不代表它就是账号 ID。
 */
export function UserAliasRef({ value, link = true }: { value: string; link?: boolean }) {
  const { byKey } = useUserDirectory();
  const user = byKey.get(value.trim().toLowerCase());
  if (!user) return <span title={value}>{value}</span>;
  const label = `${user.label}（${user.username}）`;
  if (!link) return <span title={value}>{label}</span>;
  return (
    <Link to={`/users/${encodeURIComponent(user.id)}`} title={value}>
      {label}
    </Link>
  );
}

/**
 * 排班里的一个名字（邮箱 / 登录名）：能解析就显示飞书名或平台名，否则原值。
 * 原始值放在 title 里，管理员仍能看出实际写入的内容。
 */
export function ScheduleUserName({ value }: { value?: string | null }) {
  const { resolveName } = useUserDirectory();
  if (!value?.trim()) return <span>-</span>;
  const label = resolveName(value);
  return <span title={label === value ? undefined : value}>{label}</span>;
}
