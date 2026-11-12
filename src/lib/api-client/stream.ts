/**
 * SSE（Server-Sent Events）请求助手。
 *
 * # 为什么它不在生成的 SDK 里
 *
 * 后端的流式端点无法写进契约：onexmesh 的 HTTP 生成器拒绝为 streaming RPC 产出
 * 路由，而 `onex-idlgen` 要求 OpenAPI 与 proto 的 RPC 严格一一对应。两边合起来使
 * SSE 端点既进不了 proto 也进不了 OpenAPI（见 onex-rfcs/18 与 mapping/09-agent.md
 * 的「流式面」小节）。生成 CLI 因此还会**主动剔除**含 `text/event-stream` 的响应
 * （`cli.ts` 的 `stripSseEndpoints`）——axios 客户端没有 `client.sse`，留着只会生成
 * 一个调用就炸的函数。
 *
 * 所以流式必须手写。写成 fetch 而不是 EventSource：**EventSource 不能带
 * Authorization 头**，而这里的每条流都在身份闸后面，且身份就是 Bearer 令牌。
 *
 * # 与 axios 客户端共用同一套令牌语义
 *
 * 令牌的读取、401 后的刷新重试、刷新失败后的登出，都不在这里重新发明一遍——
 * 它接的是同一个 {@link ApiConfig} 的同一组回调。两套各写一份的后果，是刷新逻辑
 * 修在一边、另一边继续踩着 `interceptors.test.ts` 开头记的那个自锁。
 *
 * # 调用方负责解析 URL
 *
 * `url` 应当是**最终地址**：开发代理下的 `/api/...` 前缀、网关模式下的
 * `/onex/<服务>` 前缀都由调用方按既有规则补齐（见 `apps/main/src/api/client.ts`
 * 的 `resolveUrl`）。这里不复制那套改写规则——两份判断一旦漂移，症状是「本地好、
 * 线上错服务」，而那正是 `gateway-services.ts` 当初把两份声明合成一份要避免的事。
 */
import type { ApiConfig } from './index';
import { isRateLimited, rateLimitCode, rateLimitMessage } from './rate-limit';

/** 一个 SSE 事件块。字段名对齐 SSE 规范里的行名。 */
export interface SseEvent {
  /** `event:` 行的值。缺省时为空串，按规范等同于 `message`。 */
  event: string;
  /** `data:` 行拼接的结果（多行按换行连接，符合规范）。 */
  data: string;
  /**
   * `id:` 行的值。
   *
   * **解析但不消费**。本平台不发 `id:`（见 `parseSse` 的说明：poke 语义下断线续传
   * 没有意义），这里保留它是为了让分帧器对规范完整——一个按规范写的服务端接上来时，
   * 解析器不会因为多一行而丢事件。
   */
  id?: string;
  /**
   * `retry:` 行的值（毫秒）。
   *
   * **解析但不消费**，理由同上：退避策略在 {@link subscribeSse} 里，不交给服务端单方面
   * 指定（它看不到客户端的连接预算与可见性）。
   */
  retry?: number;
}

/** {@link streamRequest} 的入参。 */
export interface StreamRequestOptions {
  /** 最终请求地址，已含代理/网关前缀。 */
  url: string;
  /** HTTP 方法，默认 POST（本平台的流式端点都是 POST）。 */
  method?: string;
  /** 请求体，会被 JSON 序列化。 */
  body?: unknown;
  /** 附加请求头。 */
  headers?: Record<string, string>;
  /** 中止信号。调用方用它取消一条流。 */
  signal?: AbortSignal;
  /** 令牌与刷新语义的来源，与 axios 客户端同一个对象。 */
  auth: Pick<ApiConfig, 'getToken' | 'refreshToken' | 'onUnauthorized'>;
  /** 每个事件回调一次。抛错会中止流并向上传播。 */
  onEvent: (event: SseEvent) => void;
  /** 响应头到达、状态码已判定为成功之后回调一次。 */
  onOpen?: (response: Response) => void;
  /** 覆盖 fetch 实现（测试用）。 */
  fetch?: typeof fetch;
}

/** parseJsonObject 把正文解析成对象，失败返回 undefined。 */
function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** asMessage 从响应体对象里取 message 字段。 */
function asMessage(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return undefined;
}

/** 流式请求失败时抛出的错误。 */
export class StreamRequestError extends Error {
  constructor(
    message: string,
    /** HTTP 状态码；传输层失败（fetch 抛错）时为 0。 */
    readonly status: number,
    /** 服务端返回的正文片段，便于定位。 */
    readonly body?: string
  ) {
    super(message);
    this.name = 'StreamRequestError';
  }
}

/**
 * 发起一条 SSE 请求，按事件回调，直到流结束。
 *
 * 正常结束（服务端关闭流）时 resolve；传输失败、非 2xx、或 `onEvent` 抛错时 reject。
 * 调用方取消（`signal` 中止）会以 `AbortError` reject——**由调用方决定是否忽略**：
 * 用户点了"停止生成"就走这条路径，把它当异常上报会污染监控。
 */
export async function streamRequest(options: StreamRequestOptions): Promise<void> {
  const doFetch = options.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new StreamRequestError('no fetch implementation available', 0);
  }

  let response = await send(doFetch, options, await readToken(options));
  if (response.status === 401 && options.auth.refreshToken) {
    // 401 只重试**一次**：刷新本身失败时会返回 null，再试一次只是把同一个失败
    // 打两遍。这与 axios 拦截器的重试语义一致。
    const refreshed = await options.auth.refreshToken();
    if (refreshed) {
      await discard(response);
      response = await send(doFetch, options, refreshed);
    }
  }

  if (response.status === 401) {
    await discard(response);
    options.auth.onUnauthorized?.();
    throw new StreamRequestError('unauthorized', 401);
  }
  if (!response.ok) {
    const text = await readBodyText(response);
    // 限流（429/413）的响应体是 {"code","message"}（见 onex-rfcs/api/generic.md）。
    // SSE 调用点最可能撞上的就是它——agent 对话是最贵的端点。不翻译的话，调用方
    // 只会看到「stream request failed with HTTP 429」，既不知道原因也不知道能不能
    // 重试。翻译成和 axios 侧同一句文案，两条路径说法一致。
    if (isRateLimited(response.status)) {
      const payload = parseJsonObject(text ?? '');
      throw new StreamRequestError(
        rateLimitMessage(rateLimitCode(payload), asMessage(payload)),
        response.status,
        text
      );
    }
    throw new StreamRequestError(
      `stream request failed with HTTP ${response.status}`,
      response.status,
      text
    );
  }
  if (!response.body) {
    // 有响应头但没有正文：这类环境（或这类代理）无法承载流式，静默返回会让调用方
    // 以为"流正常结束、只是没有事件"。明说比空转好。
    throw new StreamRequestError('response has no body; streaming is unavailable', response.status);
  }

  options.onOpen?.(response);
  await consume(parseSse(response.body), options.onEvent);
}

async function readToken(options: StreamRequestOptions): Promise<string | null> {
  if (!options.auth.getToken) return null;
  return await options.auth.getToken();
}

async function send(
  doFetch: typeof fetch,
  options: StreamRequestOptions,
  token: string | null
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    ...options.headers,
  };
  if (options.body !== undefined) {
    headers['Content-Type'] ??= 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return await doFetch(options.url, {
    method: options.method ?? 'POST',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    // 流式响应不能走 HTTP 缓存；显式声明让它对任何中间层都成立。
    cache: 'no-store',
    credentials: 'same-origin',
  });
}

/** 丢弃一个不再需要的响应体，避免连接悬挂。 */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 已经关闭或已被消费——无需处理。
  }
}

async function readBodyText(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}

async function consume(
  events: AsyncGenerator<SseEvent>,
  onEvent: (event: SseEvent) => void
): Promise<void> {
  for await (const event of events) {
    onEvent(event);
  }
}

/**
 * 把字节流切成 SSE 事件。
 *
 * 按规范：事件块由**空行**分隔；块内 `field: value` 逐行；以 `:` 开头的是注释；
 * `data` 多行用换行连接。这里刻意不实现 `Last-Event-ID` 重连——本平台的流是
 * 单次请求-响应，断掉由调用方重新发起（带着自己的会话状态），自动重连会把一个
 * 已结束的 run 重新挂上去。
 */
export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let index: number;
      // 空行分隔事件块。\r\n 与 \n 都要认：规范允许前者，而转发链上两种都出现过。
      while ((index = findBlockEnd(buffer)) !== -1) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index).replace(/^(\r?\n){2}/, '');
        const event = parseBlock(block);
        if (event) yield event;
      }
    }

    buffer += decoder.decode();
    const last = parseBlock(buffer);
    if (last) yield last;
  } finally {
    // 提前退出（onEvent 抛错、signal 中止）时释放 reader，否则连接会一直挂到
    // 服务端超时。
    await reader.cancel().catch(() => undefined);
  }
}

/** 找到第一个空行（事件块结束）的起始下标。 */
function findBlockEnd(buffer: string): number {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

/** 解析一个事件块；没有 `data:` 行的块按规范不派发。 */
function parseBlock(block: string): SseEvent | null {
  if (block === '') return null;

  let event = '';
  let id: string | undefined;
  let retry: number | undefined;
  const data: string[] = [];

  for (const rawLine of block.split(/\r?\n/)) {
    if (rawLine === '' || rawLine.startsWith(':')) continue;
    const colon = rawLine.indexOf(':');
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    // 规范：冒号后紧跟的一个空格要去掉，其余空格保留。
    let value = colon === -1 ? '' : rawLine.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'event':
        event = value;
        break;
      case 'data':
        data.push(value);
        break;
      case 'id':
        id = value;
        break;
      case 'retry': {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isNaN(parsed)) retry = parsed;
        break;
      }
      default:
        // 未知字段按规范忽略。
        break;
    }
  }

  if (data.length === 0) return null;
  return { event, data: data.join('\n'), id, retry };
}

/** {@link subscribeSse} 的入参。 */
export interface SubscribeSseOptions {
  /** 最终请求地址，已含代理/网关前缀，与 {@link StreamRequestOptions.url} 同义。 */
  url: string;
  /** 令牌与刷新语义的来源，与 axios 客户端同一个对象。 */
  auth: Pick<ApiConfig, 'getToken' | 'refreshToken' | 'onUnauthorized'>;
  /** 中止信号。调用方用它结束订阅。 */
  signal: AbortSignal;
  /**
   * 需要重新读取资源时回调。
   *
   * **连接建立时也会回调一次**，不只是收到事件时。这是这个封装最重要的一条语义：
   * 断线期间发生的变化没有任何事件能补发，重连后立刻读一次快照才是补齐它的方式。
   */
  onChange: () => void;
  /** 一次连接失败时回调。重连仍会继续；调用方通常只用来打日志。 */
  onError?: (error: unknown) => void;
  /** 覆盖 fetch 实现（测试用）。 */
  fetch?: typeof fetch;
  /** 断线重连的首次退避，默认 1000ms。 */
  retryDelayMs?: number;
  /** 退避上限，默认 15000ms。 */
  maxRetryDelayMs?: number;
}

/** 一次连接的退避起点。 */
const DEFAULT_RETRY_DELAY_MS = 1000;
/** 退避上限。 */
const DEFAULT_MAX_RETRY_DELAY_MS = 15000;

/**
 * 一次连接「活够久了」的门槛。
 *
 * 服务端每条流都有最大时长（`ssebus.DefaultMaxDuration`，5 分钟），到点主动关闭，
 * 这是**预期的轮换**——只有活过这个门槛之后的正常结束才算轮换。短于它的「正常结束」
 * 不是轮换，是中间层把流吞成了空响应；见 {@link subscribeSse}。
 */
const HEALTHY_CONNECTION_MS = 5_000;

/** 连续失败到这个次数时告警一次（只报一次，恢复时补一条）。 */
const WARN_AFTER_CONSECUTIVE_FAILURES = 3;

/**
 * 订阅一条变更流，断线自动重连，直到 `signal` 中止。
 *
 * # 它只做「连上去、被戳、重读」，不做任何状态解析
 *
 * 事件正文是 `{"v":1,"kind":"..."}`，这个封装**不看它**——收到任何事件就调
 * `onChange`，由调用方重新拉一次权威接口。服务端 REST 因此始终是唯一权威，而丢了
 * 一个事件只是等下一次重连或兜底轮询，永远不会让界面显示出服务端没有的状态。
 *
 * # 正常结束与出错走不同的路
 *
 * 服务端每条流都有最大时长（`ssebus.DefaultMaxDuration`，5 分钟），到点主动关闭，
 * 这是**预期**行为，所以立刻重连、不退避。只有连接失败才退避，指数增长到上限——
 * 否则一个拒绝连接的服务端会被 5 分钟一次的轮询打，而不是被退避挡住。
 *
 * 判据不是「有没有抛错」，而是**这条连接活了多久**（{@link HEALTHY_CONNECTION_MS}）。
 * 一个把流吞成空响应的中间层（代理缓冲、LB 的 200、路由配错）返回的是 **200 之后
 * 立刻 EOF**——在 HTTP 层面是「成功」，{@link streamRequest} 会正常 resolve。旧实现
 * 把它当轮换处理：不涨退避、循环头立刻重连，于是一个恒返回空 200 的网关就能让整个
 * 平台的浏览器无延迟地一直重连。现在它和连接失败走同一条路：告警、抖动退避、指数增长。
 *
 * # 退避带抖动
 *
 * 固定退避会让服务端重启后的所有客户端在同一时刻重连（惊群）。等量抖动（保留一半、
 * 另一半随机）既打散了它们，又不像完整随机那样可能退到接近 0——对一个恒失败的服务端，
 * 那等于没有退避。
 *
 * # 调用方仍须保留兜底轮询
 *
 * 这条流不是可靠通道：Redis 挂了、网关悄悄掐了连接、事件在重连窗口里丢掉，都不会
 * 有任何报错。兜底轮询是「推送丢包不导致状态永远不更新」的最终保证，不是没改干净
 * 的残留。
 */
export async function subscribeSse(options: SubscribeSseOptions): Promise<void> {
  const retryDelay = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const maxRetryDelay = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;

  let backoff = retryDelay;
  let consecutiveFailures = 0;

  while (!options.signal.aborted) {
    const openedAt = Date.now();
    let failure: unknown;

    try {
      await streamRequest({
        url: options.url,
        method: 'GET',
        auth: options.auth,
        signal: options.signal,
        fetch: options.fetch,
        // 连接建立即读一次快照：断线期间的变化没有事件能补发，这是补齐它的方式。
        onOpen: () => options.onChange(),
        onEvent: () => options.onChange(),
      });
    } catch (error) {
      if (options.signal.aborted) return;
      failure = error;
    }

    if (options.signal.aborted) return;

    if (failure === undefined && Date.now() - openedAt >= HEALTHY_CONNECTION_MS) {
      // 服务端按时长关闭了这条流，而且它活够了——这是预期的轮换，立刻重连，并把
      // 退避重置：它说明连接是健康的，不该因为一次正常轮换而背上指数退避。
      consecutiveFailures = 0;
      backoff = retryDelay;
      continue;
    }

    // 走到这里只有两种情形，且都在下面带延迟重连：
    //
    // 1. 连接失败（DNS、被拒、非 2xx、传输中断）；
    // 2. **200 之后立刻结束**——不是轮换，是中间层把流吞掉了（见文件头）。
    //
    // 两者都必须退避。把 (2) 当轮换处理正是那个「恒返回空 200 的网关让浏览器无延迟
    // 一直重连」的缺陷。
    consecutiveFailures += 1;
    reportRepeatedFailure(options.url, consecutiveFailures, failure);
    options.onError?.(
      failure ?? new StreamRequestError('stream closed immediately after opening', 0)
    );

    await sleep(jittered(backoff), options.signal);
    backoff = Math.min(backoff * 2, maxRetryDelay);
  }
}

/**
 * 等量抖动：保留一半退避，另一半随机。
 *
 * 见 {@link subscribeSse} 的「退避带抖动」。
 */
function jittered(backoff: number): number {
  return backoff / 2 + Math.random() * (backoff / 2);
}

/**
 * 连续失败达到阈值时告警**一次**。
 *
 * 重连失败此前是完全无声的：`onError` 是可选参数，而四个调用点一个都没传，于是一场
 * 重连风暴在浏览器里既没有日志也没有指标。按「第 N 次」而不是「每次」打，是为了让它
 * 在 DevTools 里可读——每次都打会把控制台刷满，等于没打。
 */
function reportRepeatedFailure(url: string, consecutiveFailures: number, failure: unknown): void {
  if (consecutiveFailures !== WARN_AFTER_CONSECUTIVE_FAILURES) return;
  const reason = failure instanceof Error ? failure.message : String(failure ?? 'unknown');
  console.warn(
    `[sse] ${url}: 连续 ${consecutiveFailures} 次未能建立变更流，仍在退避重连（最近一次：${reason}）`
  );
}

/** 等待一段可被中止的时间。中止时立即返回，由调用方在循环头判断。 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
