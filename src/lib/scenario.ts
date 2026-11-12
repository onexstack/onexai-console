/**
 * 「智能场景」与「智能体」的唯一关联约定。
 *
 * 场景不是后端的一等资源：它就是一个带 `onexai.io/scenario=true` 标签的
 * 智能体。这样场景天然继承 Agent 的六类能力、模型、记忆库、运行环境、
 * owner/命名空间、权限、删除保护、会话历史、审批和 IM 入口，不需要再维护
 * 一套并行的资源与运行链路。
 *
 * 所有读写场景的地方都必须走这里，不要在各页面手写标签字符串：一旦有两份
 * 常量，取消场景（删标签）或列表过滤就会出现「一处认为它是场景、另一处
 * 不认为」的分裂。
 */

/** 场景标记标签的 key。value 固定为字符串 `"true"`。 */
export const SCENARIO_LABEL_KEY = 'onexai.io/scenario';

/** 这个对象是否被标记为场景。只接受字符串 `"true"`，避免把 `"false"` 当成真。 */
export function isScenarioAgent(agent: { labels?: Record<string, string> }): boolean {
  return agent.labels?.[SCENARIO_LABEL_KEY] === 'true';
}
