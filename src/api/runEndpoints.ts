import { decodeClaims } from '@/auth/claims';
import { getToken } from '@/auth/tokenStore';

import { AGENT } from './endpoints';

/**
 * 一次浏览器运行该走哪一组端点。
 *
 * # 两套端点，两种执行主体
 *
 * - **管理员**走 `/v1/admin/agent/*`：运行以智能体 owner 的身份执行，用于调试
 *   别人的智能体。管理员自己没有 per-agent 授权规则，以本人身份反而会被运行
 *   授权门拒绝。
 * - **普通用户**走 `/v1/user/agent/*`：运行以**本人**身份执行，由授权门判断能否
 *   使用该智能体。让普通用户走管理面等于让他们借用 owner 的授权，是必须避免的
 *   越权。
 *
 * 选择只读令牌里的 `is_admin`，和界面隐藏管理员入口是同一个判据；真正的鉴权
 * 在服务端：管理面整组要求管理员角色，用户面只认本人铸造的 runID。
 *
 * 这只用于**命名智能体**的 ask。无宿主调试台没有 agent，也没有 owner 可借用的
 * 授权，因此固定走用户面（见 `askDebug`）。
 */
export function runEndpoints(): { ask: string; approve: string; stop: string } {
  const isAdmin = Boolean(decodeClaims(getToken())?.isAdmin);
  return isAdmin
    ? { ask: AGENT.debugAsk, approve: AGENT.debugApprove, stop: AGENT.debugStop }
    : { ask: AGENT.userAsk, approve: AGENT.userApprove, stop: AGENT.userStop };
}

/**
 * 一次**已存在**运行的 approve/stop 端点。
 *
 * runID 的前缀就是权威：`dbg-` 由管理面铸造，其余由用户面铸造。按当前角色选会
 * 把续流发错面——例如管理员在调试台发起的是无宿主 `usr-` 运行，而角色仍是
 * admin；反过来，角色变化也不该改变一条旧运行属于哪个面。
 */
export function runEndpointsForRun(runID: string | null | undefined): {
  approve: string;
  stop: string;
} {
  return runID?.startsWith('dbg-')
    ? { approve: AGENT.debugApprove, stop: AGENT.debugStop }
    : { approve: AGENT.userApprove, stop: AGENT.userStop };
}
