import { agentClient, agentUrl, request, streamAuth } from './client';
import { AGENT } from './endpoints';
import { streamRequest, type SseEvent } from '@/lib/api-client/stream';

/** 一条归一化的 A2A 流事件；与后端 `a2aclient.StreamEvent` 同形。 */
export type A2AStreamEvent = {
  type: string;
  invocationId?: string;
  state?: string;
  taskId?: string;
  contextId?: string;
  text?: string;
  message?: string;
  final?: boolean;
  raw?: string;
  artifact?: {
    artifactId: string;
    name?: string;
    description?: string;
    parts?: { kind?: string; text?: string; data?: string; fileUrl?: string; fileName?: string; mimeType?: string }[];
  };
  code?: number;
};

export type A2AInvokeRequest = {
  message: string;
  contextId?: string;
  taskId?: string;
  skill?: string;
  metadataJson?: string;
  timeoutSeconds?: number;
  requestId?: string;
};

export type A2AInvokeResult = {
  invocationId?: string;
  taskId?: string;
  contextId?: string;
  state?: string;
  text?: string;
  artifacts?: A2AStreamEvent['artifact'][];
  interrupt?: { kind?: string; requestId?: string; message?: string; schemes?: string[] };
  latencyMs?: number;
  retryable?: boolean;
  error?: string;
  rawTask?: string;
};

export type A2AInvocation = {
  invocationId: string;
  agent?: string;
  namespace?: string;
  source?: string;
  callerKind?: string;
  callerId?: string;
  callerName?: string;
  callerAgent?: string;
  taskId?: string;
  contextId?: string;
  state?: string;
  input?: string;
  output?: string;
  error?: string;
  latencyMs?: number;
  artifactCount?: number;
  artifacts?: string;
  createdAt?: number;
  completedAt?: number;
};

export async function invokeA2A(name: string, body: A2AInvokeRequest): Promise<A2AInvokeResult> {
  return request<A2AInvokeResult>(agentClient, {
    url: AGENT.agentInvoke(name),
    method: 'POST',
    data: body,
  });
}

/** 流式调用；`onEvent` 每收到一条归一化事件回调一次。 */
export async function streamA2A(
  name: string,
  body: A2AInvokeRequest,
  options: { signal?: AbortSignal; onEvent: (event: A2AStreamEvent) => void }
): Promise<void> {
  await streamRequest({
    url: agentUrl(AGENT.agentInvokeStream(name)),
    method: 'POST',
    body,
    signal: options.signal,
    auth: streamAuth,
    onEvent: (event: SseEvent) => {
      const parsed = parseEvent(event);
      if (parsed) options.onEvent(parsed);
    },
  });
}

export async function cancelA2ATask(name: string, taskId: string): Promise<void> {
  await request<void>(agentClient, {
    url: AGENT.agentTaskCancel(name, taskId),
    method: 'POST',
  });
}

export async function listA2AInvocations(
  name: string,
  params: { offset?: number; limit?: number } = {}
): Promise<{ invocations: A2AInvocation[]; count: number }> {
  return request<{ invocations: A2AInvocation[]; count: number }>(agentClient, {
    url: AGENT.agentInvocations(name),
    method: 'GET',
    params: { offset: params.offset ?? 0, limit: params.limit ?? 20 },
  });
}

export async function getA2AInvocation(name: string, invocationId: string): Promise<A2AInvocation> {
  const data = await request<{ invocation: A2AInvocation }>(agentClient, {
    url: `${AGENT.agentInvocations(name)}/${encodeURIComponent(invocationId)}`,
    method: 'GET',
  });
  return data.invocation;
}

function parseEvent(event: SseEvent): A2AStreamEvent | null {
  if (!event.data) return null;
  try {
    return JSON.parse(event.data) as A2AStreamEvent;
  } catch {
    return null;
  }
}
