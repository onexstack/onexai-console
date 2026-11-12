import type { DirectoryUser } from '@/components/UserRef';
import type { UserGroupMember } from '@/api/userGroups';

/**
 * 一个平台账号转成用户组成员。
 *
 * 账号能拿到的身份都写进去：浏览器/JWT 用账号 UUID，chat 角色判定用登录名，
 * IM/Agent 运行用飞书 user_id，缺 user_id 的租户用 open_id 兜底。少写一种，
 * 那条路径上的请求就不会命中这个组。
 */
export function memberOfUser(user: DirectoryUser): UserGroupMember {
  return {
    userID: user.id,
    username: user.username,
    larkUserID: user.larkUserID,
    openID: user.openID,
    displayName: user.feishuName || user.displayName,
    email: user.email,
  };
}

/** 成员条目标所有身份别名。 */
export function identitiesOf(member: UserGroupMember): string[] {
  return [member.userID, member.username, member.larkUserID, member.openID].filter(
    (value): value is string => Boolean(value && value.trim())
  );
}

/** 成员条目是否命中任一身份。 */
export function memberHasAny(member: UserGroupMember, identities: string[]): boolean {
  const keys = identitiesOf(member);
  return identities.some(identity => identity && keys.includes(identity));
}

/** 展示名：优先飞书名/平台显示名，退回到第一个身份标识。 */
export function memberLabel(member: UserGroupMember): string {
  return (
    member.displayName?.trim() ||
    member.username?.trim() ||
    member.userID?.trim() ||
    member.larkUserID?.trim() ||
    member.openID?.trim() ||
    '未命名成员'
  );
}

/**
 * 覆盖度提示。
 *
 * `browser` 表示浏览器/JWT 路径（账号 UUID）能命中；`lark` 表示 IM/Agent
 * 运行路径（飞书 user_id 或 open_id）能命中。只有一侧时给出提示，而不是假装
 * 成员已经完整覆盖。
 */
export function coverageOf(member: UserGroupMember): { browser: boolean; lark: boolean } {
  return {
    browser: Boolean(member.userID?.trim()),
    lark: Boolean(member.larkUserID?.trim() || member.openID?.trim()),
  };
}

/** 同一个人在一个组里只应出现一次：按任一别名判重。 */
export function sameMember(a: UserGroupMember, b: UserGroupMember): boolean {
  const left = new Set(identitiesOf(a));
  return identitiesOf(b).some(identity => left.has(identity));
}
