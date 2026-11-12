import { EXECUTION_MODE_ENUM } from '@/api/resources';
import type { AgentExecutionMode, PlatformAgent } from '@/api/types';

/**
 * 列表与监控抽屉共用的智能体派生展示逻辑。
 *
 * 抽屉标题上的状态 Tag 必须和列表行里的完全一致，否则同一条数据在两个位置
 * 显示两种说法。状态文案只在这里定义一次。
 */

/**
 * 列表/详情展示用的智能体类型。
 *
 * 场景智能体的前端支持暂时隐藏：带 `onexai.io/scenario=true` 标签的历史对象
 * 仍按平台智能体展示与筛选，不会从「平台智能体」页签消失。
 */
export type AgentKind = 'native' | 'external';

export function agentKind(agent: PlatformAgent): AgentKind {
  return agent.kind === 'external' ? 'external' : 'native';
}

/** 类型列/导出的文案与颜色：与 `agentKind` 一一对应，只在这里定义一次。 */
export const AGENT_KIND_META: Record<AgentKind, { text: string; color: string }> = {
  native: { text: '平台', color: 'blue' },
  external: { text: 'A2A', color: 'purple' },
};

export function isA2A(agent: PlatformAgent): boolean {
  return agent.kind === 'external' || agent.execution?.mode === 'a2a';
}

/**
 * 执行方式的中文标签。
 *
 * 复用 `isA2A()` 而不是重读 `execution.mode`：外部 A2A 智能体即使历史上把 mode
 * 写成 inproc，真实执行路径也只会是 A2A，列表、抽屉与详情必须给出同一个答案。
 */
export function executionModeOf(agent: PlatformAgent): {
  mode: AgentExecutionMode;
  text: string;
  color: string;
  tooltip: string;
} {
  const mode: AgentExecutionMode = isA2A(agent) ? 'a2a' : 'inproc';
  const meta = EXECUTION_MODE_ENUM[mode];
  return {
    mode,
    text: meta.text,
    color: meta.color,
    tooltip:
      mode === 'a2a'
        ? 'A2A 远端执行（a2a）：任务交给远端 A2A Runtime'
        : '内置运行时（inproc）：任务在本平台执行',
  };
}

export function stateOf(agent: PlatformAgent): { text: string; color: string } {
  if (agent.status === 'disabled') return { text: '已停用', color: 'default' };
  if (!isA2A(agent)) return { text: '启用', color: 'green' };
  switch (agent.a2a?.phase ?? agent.phase) {
    case 'Ready':
      return { text: '正常', color: 'green' };
    case 'Degraded':
      return { text: '降级', color: 'orange' };
    case 'Error':
      return { text: '异常', color: 'red' };
    case 'Pending':
      return { text: '同步中', color: 'blue' };
    case 'Disabled':
      return { text: '已停用', color: 'default' };
    default:
      return { text: '未知', color: 'default' };
  }
}

export function versionOrModel(agent: PlatformAgent): string {
  if (isA2A(agent)) {
    const version = agent.a2a?.cardVersion ?? agent.cardVersion;
    return version ? `v${version}` : '-';
  }
  return agent.model?.name || agent.resolvedModel || '-';
}
