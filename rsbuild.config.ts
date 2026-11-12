import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { defineConfig, loadEnv } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginSass } from '@rsbuild/plugin-sass';

/**
 * 首帧主题脚本。
 *
 * 在 React 挂载前把 `<html data-theme>` 写好，否则暗色系统用户会先看到一帧亮色。
 * 键名与 `src/lib/theme.ts` 的 `THEME_STORAGE_KEY` 必须一致；改一处要同时改另一处。
 */
const THEME_STORAGE_KEY = 'onex-theme-preference';
const THEME_BOOTSTRAP_SCRIPT = `(function(){var root=document.documentElement;var p=null;try{p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)})}catch(e){}if(p!=='light'&&p!=='dark'&&p!=='system'){p='system'}var dark=p==='dark'||(p==='system'&&!!window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);root.setAttribute('data-theme',dark?'dark':'light');root.setAttribute('data-theme-source',p==='system'?'system':'user');try{root.style.colorScheme=dark?'dark':'light'}catch(e){}})();`;

/**
 * 浏览器侧会读、但允许缺省的 `PUBLIC_*` 变量。
 *
 * 未设置时必须被替换为 `undefined`：否则 `process.env.PUBLIC_XXX` 会原样进入产物，
 * 运行时抛 `process is not defined`（整页白屏）。
 */
const OPTIONAL_PUBLIC_VARS = [
  'PUBLIC_ONEXAI_CHAT_BASE_URL',
  'PUBLIC_ONEXAI_AGENT_BASE_URL',
  'PUBLIC_BASE_PATH',
  'PUBLIC_ASSET_PREFIX',
  // 开发期登录旁路注入的令牌（见下方 `mintDevToken`）。未开启旁路时为 undefined。
  'PUBLIC_DEV_JWT',
];

/**
 * 开发期登录旁路：`DEV_BYPASS_LOGIN=true` 时签一枚管理员令牌交给浏览器。
 *
 * # 为什么需要
 *
 * oai-chat-apiserver 的三个登录 provider（local / lark / apikey）默认全部关闭
 * ——它们都不校验凭据，打开等于「知道一个名字就能换到令牌」，所以本机配置里
 * `chat.login.allow-local: false`。当前后端上控制台的登录表单无法成功，页内
 * `SessionGate` 会一直停在登录页。
 *
 * # 它做了什么
 *
 * 服务端对 token 只做两件事：用 HS256 验签（密钥是两份配置里相同的 `jwt.key`），
 * 以及读 claims 里的 `is_admin` / `is_sre`。所以开发期可以用同一把密钥直接签一枚
 * 管理员令牌，经 `PUBLIC_DEV_JWT` 注入浏览器，由 `auth/devSession.ts` 在启动时写进
 * 令牌存储——`SessionGate` 看到令牌就放行，两个后端的接口也认。
 *
 * # 边界
 *
 * 只在 `command === 'dev'` 时生效；构建产物不会注入令牌（否则等于把管理员令牌
 * 打进静态资源）。令牌 24 小时过期，每次 `pnpm dev` 重新签发。它没有削弱服务端
 * 的任何校验：验签、角色、AK/SK 都还在，只是浏览器这边跳过了一次表单。
 */
function isTruthy(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

/** 只取顶层 `jwt:` 块里的 `key:`，避免命中注释或其它块里的同名项。 */
function readJwtKey(configPath: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(configPath, 'utf8');
  } catch {
    return undefined;
  }
  const block = text.split(/^jwt:[ \t]*$/m)[1]?.split(/^\S/m)[0] ?? '';
  return block.match(/^\s+key:\s*["']?([^"'\s#]+)["']?/m)?.[1];
}

function mintDevToken(): string | undefined {
  if (!isTruthy(process.env.DEV_BYPASS_LOGIN)) return undefined;

  const chatConfigPath =
    process.env.DEV_ONEXAI_CHAT_CONFIG ||
    path.join(homedir(), '.onexai', 'oai-chat-apiserver.yaml');
  const key = process.env.DEV_ONEXAI_JWT_KEY || readJwtKey(chatConfigPath);

  if (!key) {
    throw new Error(
      `DEV_BYPASS_LOGIN 已开启，但读不到 jwt.key。` +
        `请确认 ${chatConfigPath} 中存在顶层 jwt.key，` +
        `或用 DEV_ONEXAI_JWT_KEY 直接给出密钥。`
    );
  }

  // 两个服务必须共用同一把密钥；不一致时令牌会在另一边 401，而错误现场看起来
  // 像「登录成功但管理面打不开」——先在这里说清楚。
  const agentConfigPath =
    process.env.DEV_ONEXAI_AGENT_CONFIG ||
    path.join(homedir(), '.onexai', 'oai-agent-apiserver.yaml');
  const agentKey = readJwtKey(agentConfigPath);
  if (agentKey && agentKey !== key) {
    console.warn(
      `[onexai-console] ${agentConfigPath} 的 jwt.key 与 ${chatConfigPath} 不一致，` +
        `agent 服务（9181）会拒绝这枚令牌。`
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const userID = randomUUID();
  // 字段与 onexai 的 bearer.Claims 对齐（internal/pkg/authn/bearer/auth.go）。
  const claims = {
    user_id: userID,
    name: 'dev-bypass',
    provider: 'dev-bypass',
    is_sre: true,
    is_admin: true,
    sub: userID,
    iat: now,
    exp: now + 24 * 60 * 60,
  };

  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode(claims);
  const signature = createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/**
 * OneX智能平台（独立应用）。
 *
 * # 两种运行形态
 *
 * - **独立运行**：自己的 dev server（3010）/ 独立部署，`BrowserRouter`。
 * - **被嵌入**：宿主（OneX 控制台）通过 Wujie 或 iframe 加载本应用。Wujie 下
 *   走 `MemoryRouter`，路由前缀由宿主 props 的 `basePath` 决定；iframe 下没有
 *   特殊要求，`BrowserRouter` 照常工作。宿主入口见 onex-console 的
 *   `apps/main/src/hooks/useSubAppConfig.ts`。
 *
 * # 两个后端
 *
 * - chat（9180）：登录、值班组、会话、工单。浏览器面唯一签发令牌的地方。
 * - agent（9181）：`/v1/admin/*` 管理面与 `/v1/admin/agent/*` 调试运行。
 *
 * 两者共用同一枚 Bearer 令牌，前提是它们的 `jwt.key` 是同一个值——见两份
 * `~/.onexai/oai-{chat,agent}-apiserver.yaml` 的注释。
 *
 * 开发期走本应用自带的代理；部署时用 `PUBLIC_ONEXAI_{CHAT,AGENT}_BASE_URL`
 * 指向网关或直连地址，不改代码。
 */
export default defineConfig(({ command }) => {
  const { publicVars, parsed } = loadEnv({ prefixes: ['PUBLIC_', 'DEV_'] });

  // loadEnv 只把 PUBLIC_* 写回 process.env，DEV_* 只在 parsed 里。
  if (parsed) {
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith('DEV_') && value !== undefined) process.env[key] = value;
    }
  }

  // 旁路只属于 dev server：构建产物里出现管理员令牌等于把它公开。
  if (command !== 'dev' && isTruthy(process.env.DEV_BYPASS_LOGIN)) {
    console.warn('[onexai-console] DEV_BYPASS_LOGIN 只对 `pnpm dev` 生效，已忽略。');
  }
  const devToken = command === 'dev' ? mintDevToken() : undefined;
  if (devToken) {
    console.warn(
      '[onexai-console] 登录旁路已开启（DEV_BYPASS_LOGIN）：已注入 24 小时有效的管理员令牌。' +
        '仅用于本机开发。'
    );
  }

  const chatTarget = process.env.DEV_ONEXAI_CHAT_TARGET || 'http://localhost:9180';
  const agentTarget = process.env.DEV_ONEXAI_AGENT_TARGET || 'http://localhost:9181';

  // 部署在子路径时（如 `/onexai/`），资源前缀与路由 basename 都要跟着变；
  // 独立域名部署保持默认 `/` 与空 basename。
  const assetPrefix = process.env.PUBLIC_ASSET_PREFIX || '/';

  return {
    plugins: [
      pluginReact({
        swcReactOptions: {
          runtime: 'automatic',
          importSource: 'react',
        },
      }),
      // `loadPaths` 让业务 `*.module.scss` 能用 `@use '../../styles/mixins'` 之外的
      // 包名写法解析共享样式（与 onex-console 保持同一套 Sass 配置）。
      pluginSass({
        sassLoaderOptions: {
          sassOptions: {
            loadPaths: [path.resolve(process.cwd(), 'node_modules')],
          },
        },
      }),
    ],
    source: {
      entry: {
        index: './src/main.tsx',
      },
      define: {
        // 兜底：确保可选变量始终被定义（真实值由 ...publicVars 覆盖）。
        ...Object.fromEntries(
          OPTIONAL_PUBLIC_VARS.map(key => [`process.env.${key}`, 'undefined'] as const)
        ),
        ...publicVars,
        // 放在 publicVars 之后：这是运行时算出来的值，`.env` 里不该也不需要写它。
        ...(devToken ? { 'process.env.PUBLIC_DEV_JWT': JSON.stringify(devToken) } : {}),
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
      },
    },
    resolve: {
      alias: {
        '@': './src',
      },
    },
    html: {
      title: 'OneX 智能平台',
      favicon: './src/assets/logo.svg',
      meta: {
        viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      tags: [
        {
          tag: 'script',
          head: true,
          append: false,
          children: THEME_BOOTSTRAP_SCRIPT,
        },
      ],
    },
    output: {
      assetPrefix,
    },
    server: {
      port: 3010,
      // 端口被占用时直接报错，避免静默换端口后宿主仍指向 3010。
      strictPort: true,
      // Wujie / iframe 嵌入时，宿主与子应用不同源（本机 dev 是不同端口），需要 CORS。
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      proxy: {
        '/api/onexai/chat': {
          target: chatTarget,
          changeOrigin: true,
          // 群会话走 `GET /v1/ws?token=`：代理必须转发 Upgrade，否则握手在
          // 开发环境里永远失败，而生产直连时又正常——这种差异最难查。
          ws: true,
          pathRewrite: { '^/api/onexai/chat': '' },
        },
        '/api/onexai/agent': {
          target: agentTarget,
          changeOrigin: true,
          pathRewrite: { '^/api/onexai/agent': '' },
        },
      },
    },
    tools: {
      postcss: {
        postcssOptions: {
          plugins: [['@tailwindcss/postcss'], ['autoprefixer']],
        },
      },
    },
  };
});
