/**
 * ClientConfig 的值形状与纯函数。
 *
 * 与组件分开：`resources.tsx` 的列表/详情渲染只用到类型，`form-model` 只用得到
 * 形状本身，把它们拖进一个 React 组件文件会让这些模块也依赖 antd。
 */

/**
 * 字段级配置：同一个控件被 Webhook / MCP / A2A / RuntimeProfile 共用。
 *
 * 不传时保持原来的完整形态（URL/Service 二选一 + 超时 + 凭据），只有明确
 * 声明了选项的资源才收起某一块。
 */
export interface ClientConfigFormOptions {
  /** 允许的连接方式；缺省两种都允许。 */
  modes?: Array<'url' | 'service'>;
  /** 是否渲染 ClientConfig 自己的超时；缺省 true。 */
  showTimeout?: boolean;
  /** 是否渲染凭据 Secret / Secret 键 / 请求头 Secret；缺省 true。 */
  showCredentials?: boolean;
  /** 把 CA / TLS / 请求头收进「高级连接设置」折叠区；缺省 false。 */
  advancedCollapse?: boolean;
  /** 隐藏内层 URL 标签（外层 Form.Item 已经有标签时用）；缺省 false。 */
  hideUrlLabel?: boolean;
  /** 表单必填校验：要求配置 url；缺省 false。 */
  requireUrl?: boolean;
}

/** `normalize` 的裁剪选项：隐藏的字段要写成显式 undefined，编辑时才能清掉旧值。 */
export interface NormalizeOptions {
  keepService?: boolean;
  keepTimeout?: boolean;
  keepCredentials?: boolean;
}

/** 与后端 `ClientConfig` 一一对应的字段。 */
export interface ClientConfigValue {
  url?: string;
  service?: {
    namespace?: string;
    name?: string;
    port?: number;
    path?: string;
  };
  caBundle?: string;
  timeoutSeconds?: number;
  insecureSkipTLSVerify?: boolean;
  headers?: Record<string, string>;
  secretRef?: { name?: string; key?: string };
  headersRef?: { name?: string };
}

/**
 * normalize drops empty fields and returns undefined when nothing is set.
 *
 * The backend treats an absent `clientConfig` as "use the legacy endpoint field",
 * so an object of empty strings is not the same thing as no object: it would take
 * precedence and fail to resolve.
 */
export function normalize(
  value: ClientConfigValue,
  options: NormalizeOptions = {}
): ClientConfigValue | undefined {
  const keepService = options.keepService ?? true;
  const keepTimeout = options.keepTimeout ?? true;
  const keepCredentials = options.keepCredentials ?? true;
  const out: ClientConfigValue = {};
  // 是否有任何一个「可见且已配置」的字段。被隐藏的字段即使有旧值也不能算数，
  // 否则只剩 service 的存量记录会以 `{ service: undefined }` 的空壳写回。
  let hasValue = false;

  if (value.url) {
    out.url = value.url;
    hasValue = true;
  }

  if (!keepService) {
    // 显式 undefined：编辑路径最后是 deepMerge(record, values)，缺键会留下
    // 记录里的旧 service。
    out.service = undefined;
  } else if (value.service) {
    const service: NonNullable<ClientConfigValue['service']> = {};
    if (value.service.namespace) service.namespace = value.service.namespace;
    if (value.service.name) service.name = value.service.name;
    if (typeof value.service.port === 'number') service.port = value.service.port;
    if (value.service.path) service.path = value.service.path;
    if (Object.keys(service).length) {
      out.service = service;
      hasValue = true;
    }
  }

  if (value.caBundle) {
    out.caBundle = value.caBundle;
    hasValue = true;
  }
  if (!keepTimeout) {
    out.timeoutSeconds = undefined;
  } else if (typeof value.timeoutSeconds === 'number') {
    out.timeoutSeconds = value.timeoutSeconds;
    hasValue = true;
  }
  if (value.insecureSkipTLSVerify) {
    out.insecureSkipTLSVerify = true;
    hasValue = true;
  }
  if (value.headers && Object.keys(value.headers).length) {
    out.headers = value.headers;
    hasValue = true;
  }

  if (!keepCredentials) {
    out.secretRef = undefined;
    out.headersRef = undefined;
  } else {
    if (value.secretRef) {
      const secretRef: NonNullable<ClientConfigValue['secretRef']> = {};
      if (value.secretRef.name) secretRef.name = value.secretRef.name;
      if (value.secretRef.key) secretRef.key = value.secretRef.key;
      if (Object.keys(secretRef).length) {
        out.secretRef = secretRef;
        hasValue = true;
      }
    }
    if (value.headersRef?.name) {
      out.headersRef = { name: value.headersRef.name };
      hasValue = true;
    }
  }

  return hasValue ? out : undefined;
}

/**
 * decodeCA renders the stored value as PEM for editing.
 *
 * The field carries base64 (Kubernetes' representation), but a record written by
 * hand may already hold PEM. Both are shown as PEM, and a value that is neither
 * is shown as-is rather than being mangled by a failed decode.
 */
export function decodeCA(bundle: string | undefined): string {
  if (!bundle) return '';
  if (bundle.includes('-----BEGIN')) return bundle;
  try {
    const decoded = atob(bundle);
    return decoded.includes('-----BEGIN') ? decoded : bundle;
  } catch {
    return bundle;
  }
}

/** encodeCA stores PEM as base64, which is what the field carries. */
export function encodeCA(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  // 没有 PEM 头说明它已经是 base64（或用户填了别的东西），原样保留，避免二次编码。
  if (!trimmed.includes('-----BEGIN')) return trimmed;
  return btoa(trimmed);
}
