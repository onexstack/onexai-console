import { getAdapter } from 'axios';
import type { AxiosAdapter, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

/**
 * HTTP 层的读缓存 + 在途合并。
 *
 * # 它解决的是什么问题
 *
 * 本机实测（2026-10-16，`scripts/local-verify-perf-requests.mjs`）：一个已登录页面
 * 首屏要发 20~30 个请求，其中**成对的重复**至少两对 ——
 * `/v1/notifications/unreadcount` 与 `/v1/conversations` 会在「会话引导」与
 * 「通知流连上时的补拉」两个入口各发一次，两次相隔几十毫秒。它们抢的是同一批
 * 连接（HTTP/1.1 下浏览器每源只给 6 条），于是每条请求的**观测**时长被放大 2~5 倍
 * ——接口自身其实只要 60~120ms。
 *
 * 所以这一层要做两件事，缺一不可：
 *
 * 1. **在途合并**：同一个 key 上已经有请求在飞时，后来的调用者复用同一个 promise，
 *    而不是再发一条。这与 `api/catalog.ts` 的 `memoizeProducts` 是同一个手法。
 * 2. **短 TTL 缓存**：页面内相邻的重复读（翻回上一页、同一份数据被两个组件各读
 *    一次）不必再打网络。默认 3 秒 —— 观测到的重复都在同一个约 700ms 的帧里发出，
 *    3 秒足够合并；而用户在 3 秒之后主动触发的刷新本来就该打网络，不会被吃掉。
 *
 * # 为什么是「换 adapter」而不是请求拦截器
 *
 * 请求拦截器**不能短路请求**：它只能改 config，改完请求照样出去。axios 的形状里，
 * 唯一能在「不产生网络往返」的前提下交出响应的地方是 `config.adapter`。所以这里
 * 装的是一个请求拦截器，它只做一件事：给可缓存的请求换上 `cachedAdapter`。
 *
 * 这也解释了为什么 key 必须在 **adapter 内部**算：到那时所有请求拦截器都已经跑过，
 * `config.url` 已经是最终形态（网关前缀已经补上），`getUri` 拼出来的就是真正要发的
 * 地址。在拦截器里算会算到补前缀之前的 URL —— 那样两条不同的请求会撞进同一个 key。
 *
 * # 只缓存 GET，且只缓存 2xx
 *
 * 非 GET 一律不缓存也不合并（写请求重复发是语义变化，不是性能优化）。
 * 失败**必须**把表项删掉 —— 这一条与 `api/catalog.ts`、`api/siteProfile.ts` 的
 * 「失败清空缓存」是同一条规则：留着一条 rejected 的 promise，这一页在该 key 上
 * 就再也读不出东西了（而且报错会伪装成业务错误）。
 *
 * # 写请求成功后清空整张表
 *
 * 3 秒的 TTL 里最省事、也最不会错的失效策略是「有人写过就全清」，而不是去猜
 * 哪几个资源段受这次写影响（猜错的症状是「改完没生效」，而那是这一层最不该制造的
 * 故障）。读缓存的价值在首屏那一帧，写之后本来就应该重新读。
 *
 * # 与既有模块级 memo 的关系：并存，不取代
 *
 * `api/catalog.ts` / `api/siteProfile.ts` / `api/user.ts` / `useMentionCandidates.ts`
 * 缓存的是**已经 map 成领域对象的整会话结果**，没有 TTL，各有各的失效点
 * （`invalidateSiteProfile` 等）。这一层不碰它们：既不去 invalidate，也不替它们
 * 做决定。它管的是**没有被那些 memo 覆盖的那批读**（未读数、会话列表、订单、积分、
 * 评论、列表页……），以及 memo **首次取数期间**的在途合并。
 *
 * # 与 zustand `loaded` 闸门的关系：不冲突
 *
 * 两者回答的是不同问题 —— `loaded` 答「这个账号的数据见没见过」，这一层答
 * 「这条 GET 在 3 秒内答过吗」。`load()` 命中热缓存照样 `set({loaded:true})`、
 * 照样渲染同一个值，只是不走网络。
 *
 * 唯一会打架的是「调用方明确要重发」的那条路（`useSessionBootstrap.ts` 的注释
 * 点了名：store 不知道调用方是首次加载还是用户点了刷新）。收口方式是一个显式
 * 请求头 {@link DEFAULT_FRESH_HEADER}：带上它的请求既不读缓存也不写缓存。
 * 主力是 `store/notification.ts` 的 `refresh()` —— 它是推送驱动的，全部意义就是新鲜。
 */

/** 默认 TTL。见文件头：足够吃掉首屏那一帧的重复，又不至于吃掉用户的主动刷新。 */
export const DEFAULT_CACHE_TTL_MS = 3000;

/** 带上这个请求头 = 「必须打网络」：既不读缓存也不写缓存。 */
export const DEFAULT_FRESH_HEADER = 'x-onex-fresh';

export interface HttpCacheOptions {
  /** 缓存存活时间，毫秒。0 表示只做在途合并、不缓存结果。 */
  ttlMs?: number;
  /** 哪些请求可缓存。默认：`GET` 且没有 `responseType: 'stream'`。 */
  cacheable?: (config: InternalAxiosRequestConfig) => boolean;
  /** 换 key 的函数，默认 `method + url + 身份指纹`。 */
  keyOf?: (config: InternalAxiosRequestConfig, uri: string) => string;
  /** 「必须打网络」的请求头名。 */
  freshHeader?: string;
}

export interface HttpCache {
  /** 按 key 子串或正则失效。 */
  invalidate: (match: string | RegExp) => void;
  /** 清空。会话边界（换号/登出）与写请求成功后都调它。 */
  clear: () => void;
  /** 当前表项数，测试与观测用。 */
  size: () => number;
}

/**
 * 默认是否可缓存。
 *
 * `responseType: 'stream'` 排除掉：那条路上响应体是一次性的，交回给第二个调用者
 * 就等于给它一个已经读空的流。（当前 SSE 走的是 `stream.ts` 的 `fetch`，压根不经
 * axios；这里排除的是将来有人用 axios 发流。）
 */
function defaultCacheable(config: InternalAxiosRequestConfig): boolean {
  if (config.method?.toLowerCase() !== 'get') return false;
  return config.responseType !== 'stream';
}

/**
 * 身份指纹。
 *
 * 表是按标签页内存活的，理论上换号时 `clear()` 会清掉；但「换号一定经过
 * `store/session.ts` 的边界」是个假设，而假设错了的后果是**把上一个账号的数据交给
 * 下一个账号**。把 Authorization 揉进 key 让这条路径不成立 —— 代价只是同一份数据
 * 在两个账号下各缓存一次。
 *
 * 只取哈希而不是原文：这张表会进堆快照，没必要把凭据躺在里面。
 */
function identityFingerprint(config: InternalAxiosRequestConfig): string {
  const raw =
    (config.headers?.get?.('Authorization') as string | undefined) ??
    (config.headers as Record<string, unknown> | undefined)?.['Authorization'];
  if (!raw || typeof raw !== 'string') return 'anonymous';
  // djb2：只为分组，不求抗碰撞 —— 撞了就是两个账号共用一条缓存，
  // 而那需要两条不同的 token 恰好同哈希，比换号不清理的概率低得多。
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function installHttpCache(instance: AxiosInstance, opts: HttpCacheOptions = {}): HttpCache {
  const {
    ttlMs = DEFAULT_CACHE_TTL_MS,
    cacheable = defaultCacheable,
    freshHeader = DEFAULT_FRESH_HEADER,
  } = opts;

  const store = new Map<string, { promise: Promise<AxiosResponse>; at: number }>();

  /**
   * 底层 adapter 必须**按请求惰性解析**，不能在装拦截器时抓一把。
   *
   * axios 1.x 的 `defaults.adapter` 默认不是一个函数，而是 `['xhr','http','fetch']`
   * 这样的**候选数组**，真正挑哪个由 `dispatchRequest` 在发请求时经 `getAdapter()`
   * 决定。装拦截器时读 `instance.defaults.adapter` 拿到的是那个数组（甚至
   * `undefined`），直接当函数调用的症状是每个请求都抛
   * `TypeError: baseAdapter is not a function` —— 2026-10-16 第一次接上去就是这个，
   * 而页面上只表现为「所有数据加载失败」，看不出是这一层干的。
   */
  function resolveBaseAdapter(config: InternalAxiosRequestConfig): AxiosAdapter {
    return getAdapter(config.adapter ?? instance.defaults.adapter);
  }

  /** 已经换过 adapter 的 config 再打一次标记，避免 401 重试时把包装层当成底层。 */
  const WRAPPED = Symbol('onex-http-cache-wrapped');

  const keyOf =
    opts.keyOf ??
    ((config: InternalAxiosRequestConfig, uri: string) =>
      `${config.method?.toLowerCase()} ${uri} ${identityFingerprint(config)}`);

  function cachedAdapter(
    config: InternalAxiosRequestConfig,
    baseAdapter: AxiosAdapter
  ): Promise<AxiosResponse> {
    const uri = instance.getUri(config);
    const key = keyOf(config, uri);
    const hit = store.get(key);
    const now = Date.now();

    // 在途合并与 TTL 命中是同一条路：表里那条 promise 只要还没过期就交回去。
    // （在途的那一条 `at` 是刚写进去的，所以必然未过期。）
    if (hit && now - hit.at < ttlMs) return hit.promise;

    const promise = Promise.resolve(baseAdapter(config)).then(
      (response: AxiosResponse) => response,
      (err: unknown) => {
        // 失败必须删表项，否则这一页在这个 key 上再也读不出东西。
        store.delete(key);
        throw err;
      }
    );

    if (ttlMs > 0) store.set(key, { promise, at: now });
    else {
      // 「只做在途合并」的档：交出去的 promise 落定后立刻移除，下一次调用重新发。
      store.set(key, { promise, at: now });
      promise.finally(() => store.delete(key)).catch(() => {});
    }
    return promise;
  }

  /**
   * 装上这个拦截器时**必须在请求把 config 交给 adapter 之前**改掉它。
   * axios 的请求拦截器按注册顺序**倒序**执行（LIFO），所以后注册的先跑；
   * 这里不依赖顺序 —— 无论先后，只要在 adapter 被调用前把 `adapter` 换掉即可，
   * 而拦截器链一定跑在 adapter 之前。
   *
   * 底层 adapter 在**这里**取（而不是在 `cachedAdapter` 里）：那时
   * `config.adapter` 还是原来那个，取得到真东西；换完之后再取，取到的是包装层自己，
   * 于是每次请求都会自我递归。
   */
  instance.interceptors.request.use(config => {
    if (freshHeader && config.headers?.get?.(freshHeader)) return config;
    if (!cacheable(config)) return config;
    // 401 刷新重试会带着同一个 config 再走一遍拦截器链。已经换过就不再换第二次，
    // 否则第二层包装的「底层」会是第一层包装（递归）。
    const marked = config as InternalAxiosRequestConfig & { [WRAPPED]?: true };
    if (marked[WRAPPED]) return config;

    const base = resolveBaseAdapter(config);
    marked[WRAPPED] = true;
    config.adapter = cfg => cachedAdapter(cfg, base);
    return config;
  });

  // 写请求成功后清空整张表（理由见文件头）。只认成功：失败时服务端状态没变，
  // 缓存仍然有效。
  instance.interceptors.response.use(response => {
    const method = response.config.method?.toLowerCase();
    if (method && method !== 'get') store.clear();
    return response;
  });

  return {
    clear: () => store.clear(),
    size: () => store.size,
    invalidate: match => {
      const test =
        typeof match === 'string' ? (k: string) => k.includes(match) : (k: string) => match.test(k);
      for (const key of [...store.keys()]) if (test(key)) store.delete(key);
    },
  };
}
