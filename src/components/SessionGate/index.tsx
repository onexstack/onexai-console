import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, App, Button, Card, Divider, Form, Input, Spin, Tabs, Typography } from 'antd';
import { LockOutlined, MailOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';

import { fetchAuthProviders, fetchLarkAuthorizeURL } from '@/api/auth';
import type { AuthProviders } from '@/api/types';
import { useSessionToken } from '@/auth/tokenStore';
import { signIn, signInWithLark, signUp } from '@/auth/session';
import { displayNamePatch } from '@/lib/display-name';

/**
 * 会话闸：没有 onexai 令牌时渲染登录 / 注册页，有则渲染内容。
 *
 * # 飞书回调落在这里
 *
 * 回调地址是 `${origin}${base}/auth/lark/callback`，而这个组件是未登录时唯一
 * 会渲染的东西，所以回调的 code/state 由它在挂载时读取并交换令牌。好处是回调
 * 页不必再是一棵独立的、绕过会话闸的路由树。令牌永远不会出现在 URL 里：回调
 * 拿到的是 code，换成令牌的请求由浏览器发往后端。
 *
 * # 闸放在路由外层
 *
 * 应用只有一个 `DefaultLayout`，新增页面不该依赖作者记得在每个页面包一层。令牌
 * 状态由 `tokenStore` 广播，登录 / 退出 / 401 都会让这里重新渲染。
 */
export default function SessionGate({ children }: { children: ReactNode }) {
  const token = useSessionToken();
  if (token) return <>{children}</>;
  return <AuthPage />;
}

const DEFAULT_PROVIDERS: AuthProviders = {
  local: true,
  registration: true,
  lark: false,
};

/** 应用基路径；回调地址与跳转都要带上它。 */
function basePath(): string {
  return (process.env.PUBLIC_BASE_PATH || '').replace(/\/+$/, '');
}

/** 当前路径去掉基路径，作为飞书登录成功后的落点。 */
function currentRedirect(): string {
  const base = basePath();
  let path = window.location.pathname;
  if (base && path.startsWith(base)) path = path.slice(base.length);
  if (!path || path === '/' || path.startsWith('/auth/lark/callback')) {
    return '/workbench';
  }
  return path;
}

function LoginForm({ providers }: { providers: AuthProviders }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (values: { username: string; password: string }) => {
    setLoading(true);
    setError(null);
    try {
      await signIn(values.username, values.password);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form layout="vertical" onFinish={handleSubmit} requiredMark={false}>
      <Form.Item
        name="username"
        label="用户名"
        rules={[{ required: true, message: '请输入用户名' }]}
      >
        <Input prefix={<UserOutlined />} placeholder="用户名" autoComplete="username" />
      </Form.Item>
      <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
        <Input.Password
          prefix={<LockOutlined />}
          placeholder="密码"
          autoComplete="current-password"
        />
      </Form.Item>
      {error && (
        <Form.Item>
          <Alert type="error" showIcon title={error} />
        </Form.Item>
      )}
      <Button type="primary" htmlType="submit" loading={loading} disabled={!providers.local} block>
        登录
      </Button>
    </Form>
  );
}

function RegisterForm() {
  const [form] = Form.useForm();
  // 显示名默认跟随用户名；用户手改过显示名后不再覆盖。
  const displayNameEdited = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (values: {
    username: string;
    password: string;
    confirm: string;
    displayName?: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      await signUp(values.username, values.password, values.displayName);
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={handleSubmit}
      requiredMark={false}
      onValuesChange={changed => {
        const patch = displayNamePatch(
          changed as Record<string, unknown>,
          { nameKey: 'username', displayNameKey: 'displayName' },
          displayNameEdited
        );
        if (patch) form.setFieldValue(patch.name, patch.value);
      }}
    >
      <Form.Item name="displayName" label="显示名（可选）">
        <Input prefix={<UserOutlined />} placeholder="在控制台和飞书里显示的名字" />
      </Form.Item>
      <Form.Item
        name="username"
        label="用户名"
        rules={[
          { required: true, message: '请输入用户名' },
          {
            pattern: /^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/,
            message: '3-32 位，以字母或数字开头，只允许字母、数字、下划线、点和连字符',
          },
        ]}
      >
        <Input prefix={<UserOutlined />} placeholder="登录用用户名" autoComplete="username" />
      </Form.Item>
      <Form.Item
        name="password"
        label="密码"
        rules={[
          { required: true, message: '请输入密码' },
          { min: 8, message: '密码至少 8 位' },
        ]}
      >
        <Input.Password
          prefix={<LockOutlined />}
          placeholder="至少 8 位"
          autoComplete="new-password"
        />
      </Form.Item>
      <Form.Item
        name="confirm"
        label="确认密码"
        dependencies={['password']}
        rules={[
          { required: true, message: '请再次输入密码' },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('password') === value) return Promise.resolve();
              return Promise.reject(new Error('两次输入的密码不一致'));
            },
          }),
        ]}
      >
        <Input.Password
          prefix={<LockOutlined />}
          placeholder="再输入一次"
          autoComplete="new-password"
        />
      </Form.Item>
      {error && (
        <Form.Item>
          <Alert type="error" showIcon title={error} />
        </Form.Item>
      )}
      <Button type="primary" htmlType="submit" loading={loading} block>
        注册并登录
      </Button>
    </Form>
  );
}

/**
 * 浏览器侧的 state 存储键。
 *
 * 后端的 state 是签名过的，能证明「这串 state 是我们签的」，但证明不了
 * 「这次授权是这个浏览器发起的」：攻击者可以先自己发起一次授权，再把回调
 * 链接发给别人，让别人以攻击者的身份登录（login CSRF）。把发起时的 state
 * 记在这个标签页里，回调时比对一次，就把「谁发起的」补上了。
 */
const LARK_STATE_KEY = 'onexai_console_lark_state';

function rememberLarkState(state: string): void {
  try {
    window.sessionStorage.setItem(LARK_STATE_KEY, state);
  } catch {
    // 隐私模式下 sessionStorage 可能不可用；此时回调会按「没有记录」拒绝，
    // 用户重新点一次登录即可，不会静默放行。
  }
}

function consumeLarkState(): string | null {
  try {
    const value = window.sessionStorage.getItem(LARK_STATE_KEY);
    window.sessionStorage.removeItem(LARK_STATE_KEY);
    return value;
  } catch {
    return null;
  }
}

function AuthPage() {
  const { message } = App.useApp();
  const [providers, setProviders] = useState<AuthProviders>(DEFAULT_PROVIDERS);
  const [larkLoading, setLarkLoading] = useState(false);
  const [callbackError, setCallbackError] = useState<string | null>(null);
  const [callbackPending, setCallbackPending] = useState(false);
  // React 18 StrictMode runs effects twice in development. The authorization
  // code is single-use, so the second run must not exchange it again (or
  // overwrite the state check the first run already consumed).
  const callbackStarted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetchAuthProviders()
      .then(next => {
        if (!cancelled) setProviders(next);
      })
      // 读取失败时保留默认值：登录表单仍然会发请求，由真正的登录错误说话，
      // 而不是让整页因为一次配置读取失败变得不可用。
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // 飞书回调：URL 上带 code + state 时，先换令牌再进应用。
  useEffect(() => {
    if (callbackStarted.current) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const denied = params.get('error');
    if (denied) {
      setCallbackError('飞书授权被取消或失败，请重试');
      return;
    }
    if (!code || !state) return;

    const expected = consumeLarkState();
    if (!expected || expected !== state) {
      setCallbackError('飞书登录状态无效，请重新发起登录');
      return;
    }

    callbackStarted.current = true;
    let cancelled = false;
    setCallbackPending(true);
    signInWithLark(code, state)
      .then(redirect => {
        const base = basePath();
        // 去掉回调参数，避免刷新时再次交换一个已经用过的 code。
        window.history.replaceState({}, '', `${base}/auth/lark/callback`);
        const target = redirect && redirect.startsWith('/') ? redirect : '/workbench';
        window.location.replace(`${base}${target}`);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setCallbackError(err instanceof Error ? err.message : '飞书登录失败');
        }
      })
      .finally(() => {
        if (!cancelled) setCallbackPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLarkLogin = async () => {
    setLarkLoading(true);
    try {
      const { url } = await fetchLarkAuthorizeURL(currentRedirect());
      const state = new URL(url).searchParams.get('state');
      if (!state) throw new Error('飞书授权地址缺少 state');
      rememberLarkState(state);
      window.location.assign(url);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '无法开始飞书登录');
      setLarkLoading(false);
    }
  };

  const showTabs = providers.registration;

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 16px' }}>
      <Card style={{ width: 460 }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          登录 OneX 智能平台
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          账号由本平台管理，与 OneX 控制台的登录是两套身份。登录后可在此账号上绑定飞书，
          之后在飞书里向机器人提问会按你的账号识别你。
        </Typography.Paragraph>

        {callbackError && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            title={callbackError}
            action={
              <Button size="small" onClick={() => setCallbackError(null)}>
                重试
              </Button>
            }
          />
        )}

        {callbackPending ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <Spin />
            <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
              正在完成飞书登录…
            </Typography.Paragraph>
          </div>
        ) : showTabs ? (
          <Tabs
            items={[
              {
                key: 'login',
                label: '登录',
                children: <LoginForm providers={providers} />,
              },
              {
                key: 'register',
                label: '注册',
                children: <RegisterForm />,
              },
            ]}
          />
        ) : (
          <LoginForm providers={providers} />
        )}

        {providers.lark && (
          <>
            <Divider plain style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              或
            </Divider>
            <Button
              block
              icon={<TeamOutlined />}
              loading={larkLoading}
              onClick={() => void handleLarkLogin()}
            >
              使用飞书登录
            </Button>
          </>
        )}

        {!providers.local && (!providers.registration || !providers.lark) && (
          <Alert
            style={{ marginTop: 16 }}
            type="warning"
            showIcon
            title="本部署没有可用的登录方式，请联系管理员"
          />
        )}

        <Typography.Paragraph
          type="secondary"
          style={{ fontSize: 12, marginTop: 20, marginBottom: 0 }}
        >
          <MailOutlined style={{ marginRight: 6 }} />
          忘记密码请联系管理员重置；已绑定飞书的账号也可以直接用飞书登录。
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
