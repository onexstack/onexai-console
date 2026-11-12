import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  Avatar,
  ConfigProvider,
  Drawer,
  Dropdown,
  Layout,
  Menu,
  Select,
  Tooltip,
  type MenuProps,
  type MenuRef,
} from 'antd';
import {
  GlobalOutlined,
  IdcardOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  SearchOutlined,
  SunOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { isInWujie } from '../wujie';
import { matchMenuPathKey, useMenu } from '../menu';
import { useAppConfig, useLinkHandler, type LinkHandler } from '../hooks';
import { setLocale, toggleCollapsed, useCollapsed, useLocale, type Locale } from '../store';
import { toggleTheme, useThemeState } from '../theme';
import { isAdminOnlyPath } from '../access';
import { evaluateMediaQuery, useIsMobile } from '@/ui/responsive';
import { createSiderMenuTheme } from '@/ui/theme';
import GlobalSearch from '@/components/GlobalSearch';
import GlobalSearchModal from '@/components/GlobalSearch/Modal';
import { QUICK_JUMP_EVENT } from '@/components/GlobalSearch/types';
import { findScrollParent } from '@/lib/scroll';
import { useSessionToken } from '@/auth/tokenStore';
import { decodeClaims } from '@/auth/claims';
import { signOut } from '@/auth/session';
import type { MenuItem } from '../types';
import styles from './styles.module.scss';

const { Header, Sider, Content } = Layout;

/**
 * 折叠时将菜单分组（`type: 'group'`）转换为分割线，并把子项提升到顶层，
 * 避免折叠后仍显示分组标题文字。
 */
function collapseMenuGroups(items: MenuItem[]): MenuItem[] {
  return items.flatMap(item => {
    if (item && typeof item === 'object' && 'type' in item && item.type === 'group') {
      const group = item as Extract<MenuItem, { type: 'group' }>;
      return [{ type: 'divider' } as MenuItem, ...(group.children ?? [])];
    }
    return [item];
  });
}

/**
 * 把叶子菜单项的标签包成 `<Link>`，并接上带修饰键的点击。
 *
 * 包成真锚点之后，中键、状态栏预览、键盘可达全是白拿的；修饰键那一路由
 * `link` 自己 `window.open`（见 `useLinkHandler`），并先 `preventDefault`，
 * `<Link>` 内部看到默认行为已被取消就不会再跳一次。
 *
 * 只包叶子项，且只包以 `/` 开头的 key：有 children 的项自身不是目的地；
 * 用户也可以放非路径的 key，拿它当 `to` 会造出一条坏链接。
 */
/**
 * 从菜单里去掉只对管理员有意义的入口。
 *
 * 名单与后端鉴权一一对应，见 `../access`；这里只是「不显示」，服务端仍然要求
 * 管理员角色，页面也会再拦一次。全局搜索用的是同一份名单，两处不会漂移。
 */
function filterAdminOnlyItems(items: MenuItem[], isAdmin: boolean): MenuItem[] {
  if (isAdmin) return items;
  return items.flatMap(item => {
    const node = item as { key?: unknown; children?: MenuItem[] } | null;
    if (!node) return [];
    if (node.children?.length) {
      const children = filterAdminOnlyItems(node.children, false);
      if (children.length === 0) return [];
      return [{ ...item, children } as MenuItem];
    }
    // 用第一段路径判断，而不是精确 key：`/observability/runs` 这类多段叶子
    // 也要命中 `/observability` 的管理员名单。
    if (typeof node.key === 'string' && isAdminOnlyPath(node.key)) return [];
    return [item];
  });
}

/**
 * 返回包含 `targetKey` 的祖先节点 key（由外到内，不含 `targetKey` 自己）。
 *
 * 用来在进入某个子项时自动展开它的父级 SubMenu；菜单只有两层，但写成递归
 * 之后再加一层也不用改。
 */
function findAncestorKeys(
  items: MenuItem[],
  targetKey: string,
  trail: string[] = []
): string[] | undefined {
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const node = item as { key?: unknown; children?: MenuItem[] };
    const key = typeof node.key === 'string' ? node.key : undefined;
    if (node.children?.length) {
      const found = findAncestorKeys(node.children, targetKey, key ? [...trail, key] : trail);
      if (found) return found;
    } else if (key === targetKey) {
      return trail;
    }
  }
  return undefined;
}

/**
 * 等展开动画结束后再执行 `run`。
 *
 * inline 子菜单用 CSSMotion 把 `ul` 的高度从 0 过渡到内容高度（约 200ms）；
 * 动画期间侧栏的 `scrollHeight` 被这个 0 高度钳着，此刻滚动会被浏览器截断到
 * 旧的底部。等高度长完再滚，目标位置才是算出来的那个。
 */
function runAfterExpand(list: HTMLElement, run: () => void): void {
  let done = false;
  let timer = 0;

  function finish() {
    if (done) return;
    done = true;
    list.removeEventListener('transitionend', onTransitionEnd);
    window.clearTimeout(timer);
    run();
  }

  function onTransitionEnd(event: TransitionEvent) {
    if (event.target === list && event.propertyName === 'height') finish();
  }

  list.addEventListener('transitionend', onTransitionEnd);
  // 减少动态效果 / 动画被打断时不会有 transitionend；兜底与 antd 的
  // motionDeadline（500ms）对齐。
  timer = window.setTimeout(finish, 500);
}

/**
 * 最后一次要求滚动的分组。
 *
 * 展开有约 200ms 的动画，滚动要等动画结束才执行；用户连续展开两个分组时，
 * 前一个的动画收尾不该把视图再拽回去。
 */
let latestRevealKey: string | null = null;

/**
 * 展开分组后，把新出现的子项滚进侧栏可视区。
 *
 * 侧栏本身就是滚动容器，展开只是改 `openKeys`，内容会整段长到可视区外，
 * 用户看到的就只是「点了没反应」——分组越靠下越容易踩到。
 *
 * 只在真的超出时才滚：放得下就滚到子列表底边刚好露全（最小滚动）；放不下
 * （比可视区还高）才把分组标题顶到顶部，否则只剩子项、看不出属于哪个分组。
 */
function revealOpenedSubmenu(menu: MenuRef | null, key: string, attempts = 8): void {
  // antd 6 的 MenuRef 把 rc-menu 的能力挂在 `.menu` 上：`findItem` 对 SubMenu
  // 返回标题 div，对叶子项返回 li。这里依赖的是 rc-menu 的公开 ref API，
  // 升级 antd 时由 typecheck 兜底。
  const title = menu?.menu?.findItem({ key });
  const submenu = title?.closest<HTMLElement>('li.ant-menu-submenu');
  if (!title || !submenu) return;
  // `:scope` 保证拿到这一层自己的列表，而不是更深层子菜单的。
  const list = submenu.querySelector<HTMLElement>(':scope > ul.ant-menu-sub');

  // 子列表是展开动画的第一帧之后才挂上的：等它出现，最多再等 8 帧。
  if (!list) {
    if (attempts > 0) {
      requestAnimationFrame(() => revealOpenedSubmenu(menu, key, attempts - 1));
    }
    return;
  }

  const scroller = findScrollParent(title);
  if (!scroller) return;

  const reveal = () => {
    // 等待期间又被收起（收起同样有 transitionend），或者又展开了别的分组：
    // 这两种情况都不该再滚。
    if (latestRevealKey !== key) return;
    if (!submenu.classList.contains('ant-menu-submenu-open') || list.scrollHeight === 0) return;

    const px = (value: string) => Number.parseFloat(value) || 0;
    const style = window.getComputedStyle(scroller);
    const box = scroller.getBoundingClientRect();
    // 桌面端 Sider 给 `position: fixed` 的折叠触发器留了等量 padding-bottom，
    // 这段被盖住、不算可视区；移动端抽屉 body 的 padding 为 0，不影响。
    const visibleTop = box.top + px(style.borderTopWidth) + px(style.paddingTop);
    const visibleBottom = box.bottom - px(style.borderBottomWidth) - px(style.paddingBottom);

    const titleRect = title.getBoundingClientRect();
    // 用列表自己的顶边算，避免漏掉标题与列表之间的 margin；`scrollHeight` 是
    // 内容高度，不受动画里 inline height 的影响。
    const contentBottom = list.getBoundingClientRect().top + list.scrollHeight;
    // 1px 容差：亚像素布局下「刚好贴边」不该再滚一下。
    if (titleRect.top >= visibleTop - 1 && contentBottom <= visibleBottom + 1) return;

    const alignTop = scroller.scrollTop + (titleRect.top - visibleTop);
    const alignBottom = scroller.scrollTop + (contentBottom - visibleBottom);
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const target = Math.min(maxScroll, Math.max(0, Math.min(alignTop, alignBottom)));
    scroller.scrollTo({
      top: target,
      behavior: evaluateMediaQuery('(prefers-reduced-motion: reduce)') ? 'auto' : 'smooth',
    });
  };

  if (list.getBoundingClientRect().height + 1 < list.scrollHeight) {
    runAfterExpand(list, reveal);
  } else {
    reveal();
  }
}

function linkifyMenuLabels(items: MenuItem[], link: LinkHandler): MenuItem[] {
  return items.map(item => {
    if (!item || typeof item !== 'object') return item;
    const node = item as { key?: unknown; label?: ReactNode; children?: MenuItem[] };
    if (node.children?.length) {
      return { ...item, children: linkifyMenuLabels(node.children, link) } as MenuItem;
    }
    if (typeof node.key !== 'string' || !node.key.startsWith('/')) return item;
    if (node.label === undefined) return item;
    const to = node.key;
    return {
      ...item,
      label: (
        <Link to={to} onClick={e => void link(to, e)}>
          {node.label}
        </Link>
      ),
    } as MenuItem;
  });
}

/**
 * 默认布局：Header + Sider + Content。
 *
 * 独立运行时显示自己的 Header（Logo / 语言 / 主题）；被 Wujie 嵌入时不显示
 * ——宿主的顶栏在上方，这里再画一条就是两条。
 */
export function DefaultLayout({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  const link = useLinkHandler();
  const location = useLocation();
  const inWujie = isInWujie();
  const { t } = useTranslation();

  const collapsed = useCollapsed();
  const locale = useLocale();
  const theme = useThemeState();

  // 身份只用于展示：隐藏入口不是鉴权，服务端仍会独立校验管理员角色。
  const token = useSessionToken();
  const claims = useMemo(() => decodeClaims(token), [token]);
  // 没有顶栏搜索框时（窄屏 / Wujie）由这个事件叫起模态面板。
  const openSearch = () => window.dispatchEvent(new Event(QUICK_JUMP_EVENT));

  // 移动端（< 992px）：Sider 换成抽屉 + 汉堡入口。992 而不是 768：Sider 至少
  // 200px，在 768–991 的平板上与内容并排仍然过挤。
  const isMobile = useIsMobile('lg');
  const [siderOpen, setSiderOpen] = useState(false);
  const effectiveCollapsed = !isMobile && collapsed;

  const config = useAppConfig();
  const menu = useMenu();
  const visibleMenu = useMemo(
    () => filterAdminOnlyItems(menu, Boolean(claims?.isAdmin)),
    [menu, claims?.isAdmin]
  );

  const renderedMenu = useMemo(
    () =>
      linkifyMenuLabels(effectiveCollapsed ? collapseMenuGroups(visibleMenu) : visibleMenu, link),
    [effectiveCollapsed, visibleMenu, link]
  );

  const layoutConfig = config.layout ?? {};
  const showHeader = layoutConfig.showHeader ?? true;
  const showSider = layoutConfig.showSider ?? true;
  const siderWidth = layoutConfig.siderWidth ?? 200;
  const siderCollapsedWidth = layoutConfig.siderCollapsedWidth ?? 80;
  const themeConfig = config.theme ?? {};

  // 顶栏放得下才用内联输入框。窄屏（< 992px）与 Wujie 嵌入（子应用不画 Header）
  // 都用模态面板，和侧栏的移动端判定保持同一个断点。
  const inlineSearch = !inWujie && showHeader && !isMobile;

  // 侧栏菜单的组件令牌只作用在这两个 Menu 上（见 `createSiderMenuTheme`），
  // 顶栏头像下拉、语言切换等弹出菜单继续走全局主题。
  const siderMenuTheme = useMemo(() => createSiderMenuTheme(theme.resolved), [theme.resolved]);

  const handleMenuClick: MenuProps['onClick'] = ({ key, domEvent }) => {
    // 父级 SubMenu 的合成 key（`hub:*`）不是路由；它本来也不会触发 onClick，
    // 这里再挡一层，避免将来误接。
    if (!key.startsWith('/')) return;
    // 叶子项的标签已经包成 `<Link>`，导航由它承担；这里再 navigate 一次会让
    // ⌘/Ctrl+点击变成「新标签页打开 + 当前页也跳走」。
    if ((domEvent.target as HTMLElement | null)?.closest?.('a')) return;
    navigate(key);
  };

  // 移动端抽屉只在点了叶子项时关：SubMenu 标题不会触发 Menu.onClick，
  // 所以展开父项时抽屉仍然留着。
  const handleMobileMenuClick: MenuProps['onClick'] = info => {
    setSiderOpen(false);
    handleMenuClick(info);
  };

  // 详情页（`/tickets/tkt-1`、`/models/foo`）要回到它的列表入口高亮；
  // `/observability/runs` 这类多段叶子要精确高亮到子页而不是父页。匹配用的是
  // 过滤后的 visibleMenu，非管理员不会按隐藏项算出选中态。
  const firstSegment = location.pathname.split('/').filter(Boolean)[0];
  const selectedKey =
    matchMenuPathKey(visibleMenu, location.pathname) ??
    (firstSegment ? `/${firstSegment}` : config.homePath);

  // 展开态受控：进入某个子项时把它的父级补进 openKeys；用户手动收起的
  // 分组保持收起（只追加、不覆盖）。折叠时 antd 会把开合交给悬浮浮层，
  // 这里不能再插手，否则浮层会被强行顶开。
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  useEffect(() => {
    if (effectiveCollapsed) return;
    const ancestors = findAncestorKeys(visibleMenu, selectedKey);
    if (!ancestors?.length) return;
    setOpenKeys(prev =>
      ancestors.every(key => prev.includes(key)) ? prev : [...new Set([...prev, ...ancestors])]
    );
  }, [effectiveCollapsed, visibleMenu, selectedKey]);

  // 分组展开后把子项滚进视野：用户点开、以及路由变化自动展开祖先，都走这里。
  // 差集而不是只听 `onOpenChange`，是因为上面那条 effect 的自动展开同样会
  // 把内容推到可视区外（例如用 ⌘K 跳到 `/runtime-profiles`）。
  const menuRef = useRef<MenuRef>(null);
  const prevOpenKeysRef = useRef<string[] | null>(null);
  useEffect(() => {
    const previous = prevOpenKeysRef.current;
    // 是否跳过都要先推进快照：折叠态 / 抽屉未挂载时也不能攒下「新展开」，
    // 否则恢复后会平白滚一次。
    prevOpenKeysRef.current = openKeys;
    if (previous === null || effectiveCollapsed) return;

    const deepest = openKeys.filter(key => !previous.includes(key)).at(-1);
    if (!deepest) return;
    // 一次展开多层祖先时只保证最深的那个可见：连续两次平滑滚动会互相覆盖。
    latestRevealKey = deepest;
    revealOpenedSubmenu(menuRef.current, deepest);
  }, [openKeys, effectiveCollapsed]);

  // 顶栏品牌标识：`theme.logo` 是字符串时按图片 URL 渲染，否则原样渲染节点；
  // 未配置时退回应用名首字。品牌只在顶栏出现，侧栏不重复。
  const renderBrandMark = () => {
    const logo = themeConfig.logo;
    if (!logo) {
      return (
        <div className={styles.headerLogoIcon}>
          <span className={styles.headerLogoGlyph}>
            {config.name.substring(0, 1).toUpperCase()}
          </span>
        </div>
      );
    }
    return typeof logo === 'string' ? (
      <img src={logo} alt={config.name} className={styles.headerLogoImg} />
    ) : (
      logo
    );
  };

  // 桌面侧栏与移动端抽屉共用同一个 Menu：两处的选中态、展开态、点击行为必须
  // 一致，只有「点完是否关抽屉」不同，所以差异作为一个参数传进来。
  const renderMenu = (onClick: MenuProps['onClick']) => (
    <ConfigProvider theme={siderMenuTheme}>
      <Menu
        ref={menuRef}
        mode="inline"
        // 一级项的左缩进：rc-menu 按 `inlineIndent × level` 写内联 padding-left，
        // 默认 24 会把图标推到 pill 内 24px 处；参考图是 10px。
        inlineIndent={10}
        selectedKeys={[selectedKey]}
        openKeys={openKeys}
        onOpenChange={setOpenKeys}
        items={renderedMenu}
        onClick={onClick}
        className={styles.menu}
        classNames={{ popup: { root: styles.menuPopup } }}
      />
    </ConfigProvider>
  );

  return (
    <Layout className={styles.layout}>
      {!inWujie && showHeader && (
        <Header className={styles.header}>
          <div className={styles.headerLeft}>
            {isMobile && showSider && (
              <button
                type="button"
                className={styles.mobileMenuBtn}
                aria-label={t('打开导航')}
                onClick={() => setSiderOpen(true)}
              >
                <MenuOutlined />
              </button>
            )}
            <div className={styles.headerLogo} onClick={() => navigate(config.homePath)}>
              {renderBrandMark()}
              <span className={styles.headerLogoText}>{config.name}</span>
            </div>
          </div>

          <div className={styles.headerRight}>
            {layoutConfig.headerExtra}

            {inlineSearch ? (
              <GlobalSearch />
            ) : (
              <Tooltip title={t('快速跳转')}>
                <button
                  type="button"
                  className={styles.searchTrigger}
                  onClick={openSearch}
                  aria-label={t('全局搜索')}
                >
                  <SearchOutlined />
                </button>
              </Tooltip>
            )}

            <Select
              className={styles.langSelect}
              value={locale}
              onChange={value => setLocale(value as Locale)}
              options={[
                { value: 'zh-CN', label: '中文' },
                { value: 'en-US', label: 'English' },
              ]}
              variant="borderless"
              size="small"
              suffix={<GlobalOutlined />}
            />

            <Tooltip title={theme.resolved === 'dark' ? t('切换为亮色') : t('切换为暗色')}>
              <button
                type="button"
                className={styles.themeToggle}
                aria-label={t('切换主题')}
                onClick={toggleTheme}
              >
                {theme.resolved === 'dark' ? <SunOutlined /> : <MoonOutlined />}
              </button>
            </Tooltip>

            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  {
                    key: 'identity',
                    disabled: true,
                    label: (
                      <div className="text-[12px] leading-5">
                        <div className="font-medium">{claims?.name ?? '未登录'}</div>
                        <div className="text-[var(--color-text-tertiary)]">
                          {claims?.isAdmin ? '管理员' : '普通用户'}
                          {claims?.provider ? ` · ${claims.provider}` : ''}
                        </div>
                      </div>
                    ),
                  },
                  { type: 'divider' },
                  { key: 'account', icon: <IdcardOutlined />, label: '账号设置' },
                  { key: 'logout', icon: <LogoutOutlined />, label: '退出登录' },
                ],
                onClick: ({ key }) => {
                  if (key === 'logout') signOut();
                  if (key === 'account') navigate('/account');
                },
              }}
            >
              <button type="button" className={styles.userButton} aria-label={t('用户菜单')}>
                <Avatar size={24} icon={<UserOutlined />} />
                <span className={styles.userName}>{claims?.name ?? '未登录'}</span>
              </button>
            </Dropdown>
          </div>
        </Header>
      )}

      <Layout className={styles.innerLayout}>
        {showSider &&
          (isMobile ? (
            <Drawer
              placement="left"
              open={siderOpen}
              onClose={() => setSiderOpen(false)}
              size="min(86vw, 300px)"
              // 抽屉底色跟桌面侧栏一致（含标题栏）。走 `styles` 而不是类名：
              // antd 的 `.ant-drawer-body` 底色是等特异性规则，后注入会压过
              // CSS Module；内联样式没有这个先后问题。
              styles={{
                body: { padding: 0, background: 'var(--color-sider-bg)' },
                header: { background: 'var(--color-sider-bg)' },
              }}
              title={config.name}
            >
              {renderMenu(handleMobileMenuClick)}
            </Drawer>
          ) : (
            <Sider
              collapsible
              collapsed={collapsed}
              onCollapse={toggleCollapsed}
              width={siderWidth}
              collapsedWidth={siderCollapsedWidth}
              theme={theme.resolved}
              className={styles.sider}
              trigger={
                <div className={styles.trigger}>
                  {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                </div>
              }
            >
              {layoutConfig.siderHeader}
              {renderMenu(handleMenuClick)}
              {layoutConfig.siderFooter}
            </Sider>
          ))}

        <Content className={styles.content}>
          {/* Wujie 模式没有子应用自己的 Header（宿主顶栏在上方），移动端就少了
              一个菜单入口。这里补一条 48px 的工具条：汉堡 + 应用名。 */}
          {inWujie && isMobile && showSider && (
            <div className={styles.wujieMobileBar}>
              <button
                type="button"
                className={styles.mobileMenuBtn}
                aria-label={t('打开导航')}
                onClick={() => setSiderOpen(true)}
              >
                <MenuOutlined />
              </button>
              <span className={styles.wujieMobileTitle}>{config.name}</span>
            </div>
          )}
          {children}
          {/* 顶栏没有内联搜索框时（窄屏 / Wujie）由模态面板兜底，⌘K 照常可用。 */}
          {!inlineSearch && <GlobalSearchModal />}
        </Content>
      </Layout>
    </Layout>
  );
}

export default DefaultLayout;
