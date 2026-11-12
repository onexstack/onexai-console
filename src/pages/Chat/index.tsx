import { useSearchParams } from 'react-router';

import AgentChat from './AgentChat';

/**
 * 对话。
 *
 * 只保留智能体直聊：管理面流式接口，能力由智能体绑定决定，历史只在本机。
 */
export default function ChatPage() {
  const [params] = useSearchParams();
  const agent = params.get('agent') ?? undefined;
  const draft = params.get('draft') ?? undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AgentChat initialAgent={agent} draft={draft} key={`agent-${agent ?? ''}`} />
    </div>
  );
}
