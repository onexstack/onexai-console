/**
 * 兼容层：早期页面从这个文件导入。
 *
 * 真正的实现已经按服务拆到 `agent.ts` / `chat.ts` / `resourceDefs.ts`；这里只做
 * re-export，避免一次性改动所有调用点。新代码不要再从这里导入。
 */

export { login, listConversations, listHistory, listMembers, searchMessages } from './chat';
export { listTicketNotes, ticketBinding, ticketApi, oncallGroupBinding } from './chat';
export { DEBUG_APPROVE_URL, DEBUG_ASK_URL, stopDebugRun } from './agent';
export type { ResourceBinding } from './agent';
export { platformBindings, platformResourceBindings } from './agent';

/** 只在创建响应里出现一次的密钥字段（见 `resources.tsx` 的同名常量）。 */
export const ONE_TIME_SECRET_FIELD: Record<string, string> = {
  secrets: 'secretKey',
  models: 'apiKey',
};
