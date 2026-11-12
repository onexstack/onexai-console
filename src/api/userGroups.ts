import { agentClient, request } from './client';
import { AGENT } from './endpoints';

/**
 * 用户组管理。
 *
 * 组名（`name`）是策略里的 group subject_id，创建后不可修改；成员是对人的
 * 身份别名集合。同一个人可能有多个身份：账号 UUID（浏览器/JWT）、登录名
 * （chat 角色判定）、飞书 user_id（IM/Agent 运行）、open_id（兜底）。保存
 * 时把能拿到的别名都写上，判定时任一命中即视为组员。
 */
export interface UserGroupMember {
  /** 平台账号 ID（chat.user.id / JWT user_id）。 */
  userID?: string;
  /** 登录名。 */
  username?: string;
  /** 飞书 user_id。 */
  larkUserID?: string;
  /** 飞书 open_id。 */
  openID?: string;
  /** 仅展示。 */
  displayName?: string;
  email?: string;
}

export interface UserGroup {
  name: string;
  displayName: string;
  description: string;
  enabled: boolean;
  owner: string;
  members: UserGroupMember[];
  createdAt: string;
  updatedAt: string;
}

export interface UserGroupListParams {
  offset?: number;
  limit?: number;
  /** 任一身份别名精确匹配。 */
  member?: string;
  /** 名称/显示名/描述模糊匹配。 */
  keyword?: string;
}

export interface UserGroupInput {
  name: string;
  displayName?: string;
  description?: string;
  enabled?: boolean;
  members: UserGroupMember[];
}

export interface UserGroupListResult {
  total: number;
  items: UserGroup[];
}

export async function listUserGroups(
  params: UserGroupListParams = {}
): Promise<UserGroupListResult> {
  const data = await request<{ userGroups?: UserGroup[]; count?: number }>(agentClient, {
    url: AGENT.userGroups,
    method: 'GET',
    params,
  });
  return { total: Number(data.count ?? 0), items: data.userGroups ?? [] };
}

export async function getUserGroup(name: string): Promise<UserGroup> {
  const data = await request<{ userGroup?: UserGroup }>(agentClient, {
    url: AGENT.userGroup(name),
    method: 'GET',
  });
  if (!data.userGroup) throw new Error(`用户组 ${name} 的响应里没有资源体`);
  return data.userGroup;
}

export async function createUserGroup(input: UserGroupInput): Promise<UserGroup> {
  const data = await request<{ userGroup?: UserGroup }>(agentClient, {
    url: AGENT.userGroups,
    method: 'POST',
    data: { userGroup: input },
  });
  if (!data.userGroup) throw new Error('创建用户组的响应里没有资源体');
  return data.userGroup;
}

export async function updateUserGroup(
  name: string,
  input: Omit<UserGroupInput, 'name'>
): Promise<UserGroup> {
  const data = await request<{ userGroup?: UserGroup }>(agentClient, {
    url: AGENT.userGroup(name),
    method: 'PUT',
    data: { userGroup: input },
  });
  if (!data.userGroup) throw new Error('更新用户组的响应里没有资源体');
  return data.userGroup;
}

export async function deleteUserGroup(name: string): Promise<void> {
  await request<{ ok?: boolean }>(agentClient, {
    url: AGENT.userGroup(name),
    method: 'DELETE',
  });
}

/** 一个人是否出现在某个成员条目里（任一别名精确命中）。 */
export function memberMatches(member: UserGroupMember, identities: string[]): boolean {
  const keys = memberIdentities(member);
  return identities.some(identity => identity && keys.includes(identity));
}

/** 成员条目携带的全部身份别名。 */
export function memberIdentities(member: UserGroupMember): string[] {
  return [member.userID, member.username, member.larkUserID, member.openID].filter(
    (value): value is string => Boolean(value && value.trim())
  );
}
