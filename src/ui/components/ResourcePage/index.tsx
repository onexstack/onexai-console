import { useState, useCallback, useEffect, useMemo, useRef, Fragment } from 'react';
import type { ReactNode } from 'react';
import { Button, ConfigProvider, Modal, App, Tooltip, Popconfirm, Spin } from 'antd';
import type { MenuProps } from 'antd';
import {
  ReloadOutlined,
  DownloadOutlined,
  SettingOutlined,
  UnorderedListOutlined,
  ProfileOutlined,
} from '@ant-design/icons';
import { Table } from 'antd';
import type { ColumnType } from 'antd/es/table';
import type { TableRowSelection, FilterValue } from 'antd/es/table/interface';
import { formatDate } from '@/lib/date';
import { readPath } from '@/lib/object-path';
import type { ProTableColumn } from '../ProTable';
import {
  RESOURCE_ACTION_COLUMN,
  RESOURCE_ID_COLUMN_WIDTH,
  RESOURCE_ID_TEXT_MAX_WIDTH,
  RESOURCE_TABLE_LAYOUT,
  RESOURCE_TIME_COLUMN_WIDTH,
} from '../ProTable/layout';
import { SearchTagInput } from '../SearchTagInput';
import type { SearchTag } from '../SearchTagInput';
import type {
  ResourceApi,
  ResourceApiShape,
  ResourceDescriptor,
  ResourceListFilters,
} from '../../types';
import EllipsisText from '../EllipsisText';
import { InfoSection, type InfoItem } from '../DetailPage';
import { ListPagination } from '../Pagination';
import { ResourceNameCell } from '../ResourceNameCell';
import { ResourceCard, ResourceShell } from '../ResourceShell';
import StatusSwitch, { isSwitchOn } from '../StatusSwitch';
import MoreActions from '../MoreActions';
import { useIsMobile } from '../../responsive';
import { pruneFilterState, toFilterSelection } from './filters';
import { MobileCardList } from './mobile-card';
import ColumnSettingsModal from '../ColumnSettings';
import type { ColItem, ColumnLayout } from '../ColumnSettings/types';
import { downloadCsv } from '@/lib/csv';
import styles from './styles.module.scss';

// ─────────────────────── helpers ────────────────────────────────────────────

/**
 * 存在**当前这条历史记录**的 `history.state` 上的键。
 *
 * 与 React Router 自己的 `idx`/`key`/`usr` 并列（写的时候整份展开，不覆盖它们）。
 * 之所以用历史记录而不是 URL：
 *
 * - 不动地址栏，就不会与「列表地址是 `/admin/products`」这类既有断言/收藏打架；
 * - 只在这条记录上生效 —— 从菜单重新进来、新开标签页都是**新的**历史记录，落到的
 *   仍是干净的初始列表，不会把别的入口里用过的筛选莫名其妙地套上来。刷新保留同一
 *   条记录，所以筛选也会保留（这与「列表状态写在地址栏里」的行为一致，是想要的）。
 */
const LIST_STATE_KEY = '__onexResourcePageListState';

/** 从详情页返回时要原样恢复的那几样东西（都是 `api.list` 的入参或它的前身）。 */
interface PersistedListState {
  page: number;
  pageSize: number;
  searchTags: SearchTag[];
  filterState: Record<string, FilterValue | null>;
}

/**
 * 读回当前历史记录里保存的列表状态；没有（或形状不对）时返回 `null`。
 *
 * 形状校验不是洁癖：这段东西来自浏览器历史栈，刷新回来的旧代码可能写过别的形状，
 * 直接信任它会让 `page` 变成 `"2"` 之类的值一路传进接口。
 */
function readPersistedListState(): PersistedListState | null {
  if (typeof window === 'undefined') return null;
  const raw = (window.history.state as Record<string, unknown> | null)?.[LIST_STATE_KEY] as
    Partial<PersistedListState> | undefined;
  if (!raw || typeof raw !== 'object') return null;

  const page = Number(raw.page);
  const pageSize = Number(raw.pageSize);
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 10,
    searchTags: Array.isArray(raw.searchTags) ? raw.searchTags : [],
    filterState: raw.filterState && typeof raw.filterState === 'object' ? raw.filterState : {},
  };
}

/** 把列表状态写进当前历史记录（地址不变）；内容没变时什么都不写。 */
function writePersistedListState(state: PersistedListState): void {
  if (typeof window === 'undefined') return;
  const prev = (window.history.state ?? {}) as Record<string, unknown>;
  if (JSON.stringify(prev[LIST_STATE_KEY]) === JSON.stringify(state)) return;
  window.history.replaceState({ ...prev, [LIST_STATE_KEY]: state }, '');
}

// ─────────────────────── TabView (52.png) ───────────────────────────────────

interface TabViewProps<T extends Record<string, unknown>> {
  data: T[];
  idKey: string;
  columns: ColumnType<T>[];
  loading: boolean;
  /** 渲染选中项详情内容（与列表模式进入的详情页保持一致）；缺省时回退到通用 InfoSection */
  detail?: (item: T, mutate: (updater: (prev: T[]) => T[]) => void) => React.ReactNode;
  mutate: (updater: (prev: T[]) => T[]) => void;
  /** 页签标题直接使用资源 ID（而非 name/title） */
  tabTitleById?: boolean;
}

function TabView<T extends Record<string, unknown>>({
  data,
  idKey,
  columns,
  loading,
  detail,
  mutate,
  tabTitleById,
}: TabViewProps<T>) {
  const [active, setActive] = useState('');

  useEffect(() => {
    if (data.length === 0) {
      setActive('');
      return;
    }
    const stillExists = data.some(d => String(d[idKey]) === active);
    if (!active || !stillExists) setActive(String(data[0]?.[idKey] ?? ''));
  }, [data.length, idKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = data.find(d => String(d[idKey]) === active);
  const displayCols = columns.filter(c => c.key !== 'action' && c.dataIndex);

  // Detect status dot
  const getStatusDot = (item: T) => {
    const s = item['status'] as string | undefined;
    if (!s) return null;
    const colors: Record<string, string> = {
      published: '#52c41a',
      draft: '#d9d9d9',
      archived: '#faad14',
      active: '#52c41a',
      inactive: '#d9d9d9',
      locked: '#ff4d4f',
      revoked: '#ff4d4f',
      running: '#1677ff',
      pending: '#faad14',
      done: '#52c41a',
      failed: '#ff4d4f',
      paused: '#faad14',
    };
    return (
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: colors[s] ?? '#d9d9d9',
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
    );
  };

  return (
    <div className={styles.tabView}>
      <div className={styles.tabHeader}>
        <div className={styles.tabList}>
          {data.map(item => {
            const id = String(item[idKey] ?? '');
            const name = (item['title'] ?? item['name']) as string | undefined;
            const label = tabTitleById ? id : (name ?? id);
            return (
              <button
                key={id}
                className={`${styles.tabItem} ${active === id ? styles.tabItemActive : ''}`}
                onClick={() => setActive(id)}
              >
                {getStatusDot(item)}
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {loading && !selected && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spin />
        </div>
      )}

      {selected && (
        <div className={styles.tabDetail}>
          {detail ? (
            detail(selected, mutate)
          ) : (
            <InfoSection
              title="基本信息"
              items={displayCols.map((col): InfoItem => {
                const di = col.dataIndex as string;
                const raw = selected[di];
                const isId = col.key === idKey;
                let value: React.ReactNode;
                if (isId) {
                  value = raw == null ? '-' : String(raw);
                } else if (col.render) {
                  value = (col.render as (v: unknown, r: T, i: number) => React.ReactNode)(
                    raw,
                    selected,
                    0
                  );
                } else {
                  value = raw == null ? '-' : String(raw);
                }
                return {
                  label: String(col.title),
                  value,
                  rawValue: raw == null ? '' : String(raw),
                  copyable: isId,
                };
              })}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────── ResourcePage (main) ────────────────────────────────

interface Props<T extends Record<string, unknown>, Api extends ResourceApiShape<T>> {
  resource: ResourceDescriptor<T, Api>;
  /**
   * 当前用户能否写这类资源。缺省 `true`。
   *
   * 有些资源「读对所有人开放、写只给管理员」（平台能力编排、记忆库、引用授权、
   * 值班组），服务端会直接 403。列表里的开关、删除、行内改名都是写入口，必须
   * 按这个值收窄，否则普通用户会看到一个点了必然失败的按钮。
   */
  canWrite?: boolean;
  /**
   * 翻译函数（缺省为原样返回 key，便于独立使用/Storybook；接入子应用时透传
   * useTranslation 的 t）。
   *
   * 第二参数是插值选项：删除确认那两句是**拼出来的**（`确定删除此 {名字} 吗？`），
   * 而拼字符串在 i18n 里就是漏译的另一种写法——语序不同的语言没法用拼接还原。
   */
  t?: (key: string, options?: Record<string, unknown>) => string;
  /**
   * 点 ID 单元格时通知调用方。
   *
   * 第三个参数是那次点击的事件：**调用方靠它分辨带修饰键的点击**（⌘/Ctrl+左键、
   * 中键），命中时不 `preventDefault`、让浏览器去开新标签页。传事件而不是在这里
   * 判，是因为这个包**刻意不依赖 react-router**（见 `idHref`）。
   */
  onClickId?: (id: string, item: T, event: React.MouseEvent) => void;
  /**
   * ID 单元格的站内地址。给了它就渲染成真 `<a href>`。
   *
   * # 为什么要有这个口子
   *
   * 「⌘/Ctrl+点击 → 新标签页」、中键、右键「在新标签页中打开 / 复制链接地址」
   * 全都只对**带 `href` 的锚点**生效。只挂 `onClick` 的 `<span>` 没有这些路径，
   * 修饰键会被整个忽略。地址由调用方给 —— 这个包不认识路由，拼不出 `/admin/x/1`
   * 这种路径，而地址的单一来源本来就在调用方那边（宿主是 `utils/routes.ts`）。
   *
   * 普通左键仍由 `onClickId` 处理：调用方在那里 `preventDefault()` 后走 SPA 跳转，
   * 否则一次点击会整页刷新。
   */
  idHref?: (id: string, item: T) => string;
  /**
   * 工具栏最左侧的补充动作，渲染在内置「新建」之后、`extraBatchActions` 之前。
   *
   * 用于资源描述符关掉 `creatable` 后自备「新建」入口（例如创建需要独立页面）。
   */
  leadingActions?: () => React.ReactNode;
  /** Extra batch-action buttons rendered right after 新建, before the delete button */
  extraBatchActions?: (
    selectedKeys: string[],
    mutate: (updater: (prev: T[]) => T[]) => void,
    refresh: () => void
  ) => React.ReactNode;
  /** Extra action buttons rendered right after the delete button */
  trailingActions?: (
    selectedKeys: string[],
    mutate: (updater: (prev: T[]) => T[]) => void,
    refresh: () => void
  ) => React.ReactNode;
  /** Per-row action links rendered to the left of the delete button (e.g. 发布) */
  rowActions?: (item: T, mutate: (updater: (prev: T[]) => T[]) => void) => React.ReactNode;
  /** Extra menu items appended to the per-row 更多 dropdown (e.g. 归档) */
  moreRowActions?: (item: T, mutate: (updater: (prev: T[]) => T[]) => void) => MenuProps['items'];
  /** 页签模式下渲染选中项详情内容（复用详情页组件，与列表模式进入详情保持一致） */
  detail?: (item: T, mutate: (updater: (prev: T[]) => T[]) => void) => React.ReactNode;
  /**
   * 列表加载器就绪时回调，交出 `refresh()`。
   *
   * 给「单元格内即时编辑」与「行内动作」用：列渲染函数只能拿到 `(value, record, index)`，
   * 既拿不到 `rowActions` 的 `mutate`，也无法触发重载。而单元格/动作改完必须
   * **以服务端为准**（重取当前页），不能只改本地数组。
   *
   * 交出去的就是 `loadData` 本身，所以它返回 Promise：动作可以等重取完成再收掉
   * 忙碌态，而不是「更新成功、表格还是旧数据」的那一小段时间里又被点一次。
   */
  onReady?: (api: { refresh: () => Promise<void> }) => void;
  /** 页签标题直接使用资源 ID（而非 name/title）；用于定时任务、任务管理等场景 */
  tabTitleById?: boolean;
  /**
   * 在工具栏上方渲染 `resource.title`（18px/600 的区块标题），对齐控制台的外壳语言。
   *
   * 默认关闭：列表页原本是「进页即表格」，凭空多一行标题会改变已有页面的外观，
   * 由需要它的调用方显式打开。
   */
  showTitle?: boolean;
  /**
   * 从详情页返回时恢复离开前的列表状态（页码、每页条数、搜索标签、列筛选），默认开启。
   *
   * 这些状态本来只活在组件里：一进详情页整棵列表就卸载，返回时回到的是「没筛过的
   * 第一页」，运营点进去看一眼再退回来就得把筛选重设一遍。现在每次变化都写进**当前
   * 这条历史记录**的 `history.state`（见 `LIST_STATE_KEY` 上那段说明），返回时原样
   * 读回；刷新也一样（同一条历史记录）。
   *
   * 关掉它用于「返回时必须是一张全新的表」的场景；目前没有页面需要。
   */
  keepListState?: boolean;
  /**
   * 页面级作用域选择器（当前是「业务空间」）。由调用方注入，渲染在**页面标题行右侧**
   * （与 `resource.title` 同一行；没有标题时单独占标题行）。
   *
   * `src/ui` 刻意不依赖 `@/runtime` / `@/components`，所以选择器本身和它的状态
   * 都留在页面层，这里只负责给它一个所有资源页一致的位置。
   */
  scopeSelector?: ReactNode;
  /**
   * 作用域过滤条件，合并进交给 `api.list` 的 `filters`。同名键时作用域优先：
   * 页头的全局范围比列筛选更接近「用户在看什么」。
   */
  scopeFilters?: ResourceListFilters;
  /**
   * 作用域当前值。变化时把页码拉回第 1 页并清空勾选。
   *
   * 与列表状态分开：业务空间是跨页面的全局选择，不写进 `history.state`。
   */
  scopeKey?: string;
}

export default function ResourcePage<
  T extends Record<string, unknown>,
  Api extends ResourceApiShape<T> = ResourceApi<T>,
>({
  resource,
  canWrite = true,
  t = (key: string) => key,
  onClickId,
  idHref,
  leadingActions,
  extraBatchActions,
  trailingActions,
  rowActions,
  moreRowActions,
  detail,
  onReady,
  tabTitleById,
  showTitle = false,
  keepListState = true,
  scopeSelector,
  scopeFilters,
  scopeKey,
}: Props<T, Api>) {
  // 走 `App.useApp()` 而不是 antd 的静态 `message`：静态方法拿不到 ConfigProvider
  // 的上下文，于是暗色主题下弹出的提示仍然是亮色皮肤，与控制台其余部分脱节。
  //
  // 前提是调用方被 antd 的 `<App>` 包着 —— 宿主（`apps/main/src/App.tsx`）与
  // miniblog（`sub-app-runtime` 的 `AppShell`）都包了。
  const { message } = App.useApp();

  // ── Data state ──
  //
  // 查询状态（页码 / 每页条数 / 搜索标签 / 列筛选）从**当前历史记录**里恢复：
  // 从详情页返回时这条记录就是离开前的那一条，于是 URL 没变、筛选也还在。
  // 只在首帧读一次 —— 之后以组件自己的 state 为准（见下面的写回 effect）。
  const [restoredListState] = useState(readPersistedListState);
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(restoredListState?.page ?? 1);
  const [pageSize, setPageSize] = useState(restoredListState?.pageSize ?? 10);
  const [searchTags, setSearchTags] = useState<SearchTag[]>(restoredListState?.searchTags ?? []);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  // ── UI state ──
  const [viewMode, setViewMode] = useState<'list' | 'tab'>('list');
  const [layout, setLayout] = useState<ColumnLayout>('loose');
  const [colSettingsOpen, setColSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);

  // ── ID helper ──
  /**
   * 只读资源（如运营对象里的「客户线索」）关掉行内删除与批量删除。
   *
   * 两个条件都要：`deletable: false` 是调用方**表态**不要，`api.remove` 缺失是
   * 调用方**没有这个能力**。少了后者，一个只读资源若忘了写 `deletable: false`，
   * 界面上会出现一个点了必然失败的删除——正是这段注释一开始要避免的东西。
   */
  const deletable = canWrite && (resource.deletable ?? true) && !!resource.api.remove;
  /** 同上，用于内置的「新建」。 */
  const creatable = (resource.creatable ?? true) && !!resource.api.create;

  const getId = useCallback((item: T) => String(item[resource.idKey] ?? ''), [resource.idKey]);

  // ── Mutate helper (shared by batch actions and per-row actions) ──
  const mutate = useCallback((updater: (prev: T[]) => T[]) => {
    setData(updater);
  }, []);

  // ── Column filters ──
  //
  // 只在 `resource.serverFilter` 时才有意义（见 `ResourceDescriptor.serverFilter`）：
  // 那是**受控**模式，选中值存在这里、经 `api.list` 交给服务端，antd 既不做本地
  // 过滤、也不自己记选中态。没开这个开关的资源不走这里，行为与从前完全一致。
  const [filterState, setFilterState] = useState<Record<string, FilterValue | null>>(
    restoredListState?.filterState ?? {}
  );

  /**
   * 每次查询状态变化都写回当前历史记录。
   *
   * 写在 effect 里而不是各个 setter 里：四条状态有六七个写入口（筛选、翻页、改页大小、
   * 搜索标签…），逐个补一遍必然漏掉下一轮新增的那一个；这里的依赖数组就是清单本身。
   */
  useEffect(() => {
    if (!keepListState) return;
    writePersistedListState({ page, pageSize, searchTags, filterState });
  }, [keepListState, page, pageSize, searchTags, filterState]);

  /**
   * 当前生效的选中值（列 key → 取值）。它是**两件事的共同入参**：交给 `api.list` 的
   * `filters`，以及 `ProTableColumn.filterOptions`（派生候选）读的那一份选中值 ——
   * 两处刻意同形，见 `filters.ts`。
   */
  const filterSelection = useMemo(() => toFilterSelection(filterState), [filterState]);

  /** 交给 `api.list` 的形状：没筛任何列时不给（`undefined` 与 `{}` 对适配器是同一件事）。 */
  const listFilters = useMemo((): ResourceListFilters | undefined => {
    if (!resource.serverFilter) return undefined;
    return Object.keys(filterSelection).length > 0 ? filterSelection : undefined;
  }, [resource.serverFilter, filterSelection]);

  /**
   * 实际交给 `api.list` 的 filters：列筛选 + 页面作用域（业务空间）。
   *
   * 同名键作用域胜出 —— 页头的全局范围比列筛选更接近「用户在看什么」。没有作用域
   * 时原样返回 `listFilters`，调用行为与引入这个能力之前完全一致。
   */
  const effectiveFilters = useMemo((): ResourceListFilters | undefined => {
    if (!scopeFilters) return listFilters;
    if (!listFilters) return scopeFilters;
    return { ...listFilters, ...scopeFilters };
  }, [listFilters, scopeFilters]);

  /**
   * 作用域切换：回到第 1 页并清空勾选。
   *
   * 用 ref 记住「上一次看到的值」，所以首次挂载不会覆盖从 `history.state` 恢复的
   * 页码；只有真正发生切换才重置。重置会多触发一次加载，但 `loadSeq` 保证旧响应
   * 不落地，而且全量资源本来就有 React Query 缓存，代价只是一次本地过滤。
   */
  const lastScopeKeyRef = useRef(scopeKey);
  useEffect(() => {
    if (lastScopeKeyRef.current === scopeKey) return;
    lastScopeKeyRef.current = scopeKey;
    setPage(1);
    setSelectedKeys([]);
  }, [scopeKey]);

  /**
   * 交给 `api.list` 的搜索标签：只在 `resource.serverSearch` 时出现。
   *
   * 形状与 `filters` 相同（字段 key → 取值数组），语义不同：那边是「等于」，
   * 这里是「包含」。同一下拉里一个字段只会有一个标签（选中即从下拉里消失），
   * 所以数组里至多一个值；用数组只是为了与 `filters` 同一份 `ResourceListFilters`。
   */
  const listSearch = useMemo((): ResourceListFilters | undefined => {
    if (!resource.serverSearch || searchTags.length === 0) return undefined;
    const search: ResourceListFilters = {};
    for (const tag of searchTags) search[tag.fieldKey] = [tag.value];
    return search;
  }, [resource.serverSearch, searchTags]);

  // ── Data loading ──
  //
  // 定义在 `allColumns` **之前**：ID/名称 列的就地改名（`handleRename`）提交成功后
  // 要重取当前页，列渲染的闭包必须能拿到它。
  //
  // 每次查询都是一个带序号的请求，**只有最后一轮**的结果落地：翻页、搜索、改页大小
  // 都会并发地甩出请求，而网络让它们**可能乱序返回**。没有这个序号时，「最后到达
  // 的那个响应赢」是巧合而不是设计——用户点第 3 页，第 2 页的慢响应晚到一步，表里
  // 就是第 2 页的行、分页条却写着第 3 页。
  const loadSeq = useRef(0);
  const loadData = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const res = await resource.api.list({
        page,
        pageSize,
        filters: effectiveFilters,
        search: listSearch,
      });
      // 旧响应不覆盖新列表，也不动 loading（那一轮由更新的请求负责收尾）。
      if (seq !== loadSeq.current) return;
      setData(res.items);
      setTotal(res.total);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      message.error(err instanceof Error ? err.message : t('加载失败'));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [resource, page, pageSize, effectiveFilters, listSearch, message, t]);

  // ── Build base column list (fixed first + extra + time + fixed last) ──
  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await resource.api.remove?.(id);
        message.success(t('删除成功'));
        setSelectedKeys(prev => prev.filter(k => k !== id));
        setData(prev => prev.filter(item => String(item[resource.idKey]) !== id));
      } catch (err) {
        message.error(err instanceof Error ? err.message : t('删除失败'));
      }
    },
    [resource, message, t]
  );

  /**
   * 列表内就地改名（`resource.nameField` 声明了才可达）。
   *
   * 写通路就是各资源自己的 `api.update` —— 适配器已经把 patch 收窄到契约真正
   * 接受的字段（`postResourceApi` 只放 title/postType/content/status），所以这里
   * 不必另开一条。提交成功后**重取当前页**，而不是回写本地数组：本地回写会把
   * 「服务端没接受」显示成「改成功了」，只有重取才以服务端为准。
   *
   * 失败时**抛出**：`ValueWithActions` 靠这个保持编辑态，让用户改完再试一次
   * （提示由这里负责，它只知道失败、不知道是权限还是网络）。
   */
  const handleRename = useCallback(
    async (id: string, field: string, next: string) => {
      const value = next.trim();
      try {
        // 入口只在 `api.update` 存在时渲染（见 ID 列），所以这里可以断言它存在；
        // 用 `?.` 而不是非空断言，是为了让「渲染条件被改坏了」表现为一次静默的
        // no-op 而不是一个 panic——不会有谁把前者当成功能正常。
        await resource.api.update?.(id, { [field]: value });
      } catch (err) {
        message.error(err instanceof Error ? err.message : t('修改失败'));
        throw err;
      }
      message.success(t('修改成功'));
      await loadData();
    },
    [resource, message, t, loadData]
  );

  /**
   * 列表里的状态开关：点击即写回，成功后重取当前页。
   *
   * 与就地改名同一条规矩：**以服务端为准**，不先改本地数组——否则「服务端没接受」
   * 会显示成「改成功了」。失败时提示并抛出，让开关保持原状态。
   */
  const handleSwitchToggle = useCallback(
    async (
      id: string,
      meta: NonNullable<ProTableColumn<T>['switchField']>,
      next: boolean
    ): Promise<void> => {
      const update = resource.api.update;
      if (!update || !canWrite) return;
      const value = next ? (meta.onValue ?? true) : (meta.offValue ?? false);
      try {
        await update(id, { [meta.key]: value });
      } catch (err) {
        message.error(err instanceof Error ? err.message : t('修改失败'));
        throw err;
      }
      message.success(t('修改成功'));
      await loadData();
    },
    [resource, canWrite, message, t, loadData]
  );

  /**
   * 描述符为**主键那一列**声明的东西：标题与单元格渲染。
   *
   * 它俩归描述符，**链接与点击行为归外壳**（见下面 `idCol`）。之所以要这样折一道，
   * 是因为两边同 key 时 `orderedColumns` 按 key 建表、后者胜出，而 `extraColumns`
   * 恰好排在 `idCol` **之后**：描述符那个裸列会把外壳的 ID 列整根顶掉，连
   * `idHref` / `onClickId` 一起丢，表现是「列表行点了没反应、进不去详情」
   * （legal-docs / tiers / points-rules 三页踩在这里；`apps/agent` 那边只有一句
   * 「idKey 字段不要设 column」的注释在提醒，运行期毫无保护）。
   *
   * 注意这条**只对 ID 列成立**：`timeColumns` 与 `actionCol` 排在后面，同 key 时
   * 天然由外壳胜出，描述符声明了也进不来。
   */
  const idColumnOverride = useMemo(():
    | { title: string; render?: (value: unknown, record: T, index: number) => ReactNode }
    | undefined => {
    const declared = (resource.extraColumns ?? []).find(
      c => String(c.key ?? c.dataIndex) === resource.idKey
    );
    if (!declared) return undefined;
    return {
      // 与 `extraCols` 同一条翻译规矩：描述符写的是中文（语言包的键），翻译在这里发生。
      // antd 还允许标题是个函数或 React 节点，但描述符按惯例写的就是一个词；认不出
      // 那种写法就退回外壳缺省的「ID/名称」，而不是把一个函数塞进表头。
      title: typeof declared.title === 'string' ? t(declared.title) : t('ID/名称'),
      // antd 的列渲染还可以返回 `{ children, props }` 这种「单元格对象」，但这里要把它
      // 塞进外壳自己那层链接里，只吃返回 React 节点的那一种 —— 类型收窄（而不是改用法）。
      render: declared.render as
        ((value: unknown, record: T, index: number) => ReactNode) | undefined,
    };
  }, [resource, t]);

  /** 表头与列设置里那张表写的是同一个名字。 */
  const idTitle = idColumnOverride?.title ?? t('ID/名称');

  /**
   * 内容宽度模式（`ResourceDescriptor.autoColumnWidth`）。
   *
   * 两个固定宽度的列（ID 240 / 操作 160）在这个模式下不写 `width`、也不吸附 ——
   * 宽度交给浏览器按内容算。`fixed` 必须一起去掉：rc-table 的吸附偏移量是拿列的
   * `width` 累加出来的，没有宽度的吸附列会算出 0 偏移，粘在错误的位置上。
   *
   * `Table` 在所有模式下都显式传 `tableLayout="auto"`（见 `RESOURCE_TABLE_LAYOUT`
   * 的布局契约），所以这个开关不必再为布局单独兜底：它只负责去掉吸附与固定宽度，
   * 让整张表缩成内容宽度（右侧留白），而不是铺满卡片。
   */
  const autoColumnWidth = Boolean(resource.autoColumnWidth);

  const allColumns = useMemo((): ColumnType<T>[] => {
    const idCol: ColumnType<T> = {
      title: idTitle,
      dataIndex: resource.idKey,
      key: resource.idKey,
      width: autoColumnWidth ? undefined : RESOURCE_ID_COLUMN_WIDTH,
      fixed: autoColumnWidth ? undefined : 'left',
      render: (_: unknown, record: T, index: number) => {
        const id = getId(record);
        const { nameField } = resource;
        // 声明了 nameField 就以它为准（显示什么、改的就是什么）；没声明时沿用
        // 「title 优先、退回 name」的启发式，只用于展示。
        const rawName = nameField ? record[nameField] : (record['title'] ?? record['name']);
        // nameField 存在时，空值也要传：列表是唯一能看见「这条记录没有名字」并补上的
        // 地方。没有 nameField 时，只有名称与主键不同才渲染第二行，避免 idKey=name
        // 的资源把同一个值画两遍。
        const name =
          nameField !== undefined
            ? rawName === undefined || rawName === null
              ? ''
              : String(rawName)
            : rawName !== undefined && rawName !== null && String(rawName) !== id
              ? String(rawName)
              : undefined;
        // 描述符定制了内容就用它的（`tiers` 的档位标签就靠这个），否则就是主键本身。
        const content = idColumnOverride?.render ? idColumnOverride.render(id, record, index) : id;
        // 复制按钮是**锚点外面**的独立控件：放进锚点里，点复制会顺带跳转。
        // 它与名称铅笔共用 `ValueWithActions` 的 `.actionBtn` / `.hoverReveal`：同一套
        // 22px 图标按钮、同一份悬停淡入，不在这里另写一套样式。`rawValue` 必须显式
        // 传主键——`value` 是 React 节点，兜底 `String(value)` 会复制出 `[object Object]`。
        // 主键在 auto 布局下没有可靠的截断点：列宽只是偏好值，超长 ID 会把列
        // 撑开。这里按共享的文本上限（列宽 - 左右 padding - 复制按钮）截断，
        // 让「固定宽度」真的成立。
        const clampedContent = (
          <EllipsisText
            maxWidth={RESOURCE_ID_TEXT_MAX_WIDTH}
            title={typeof content === 'string' ? content : id}
          >
            {content}
          </EllipsisText>
        );
        const idNode = onClickId ? (
          idHref ? (
            // 真锚点：⌘/Ctrl+点击、中键、右键菜单都由浏览器承载。普通左键
            // 由调用方在 `onClickId` 里 `preventDefault` 后走 SPA 跳转。
            <a
              className={styles.idLink}
              href={idHref(id, record)}
              onClick={e => onClickId(id, record, e)}
            >
              {clampedContent}
            </a>
          ) : (
            <span className={styles.idLink} onClick={e => onClickId(id, record, e)}>
              {clampedContent}
            </span>
          )
        ) : (
          <span className={styles.idText}>{clampedContent}</span>
        );

        return (
          <ResourceNameCell
            id={id}
            idNode={idNode}
            name={name}
            copyId={resource.idCopyable !== false}
            // 只有在描述符声明了 nameField 且资源可写时才给改名入口；空名也留入口，
            // 列表是唯一能看见「这条记录没有名字」并补上的地方。
            onRename={
              canWrite && nameField && resource.api.update
                ? next => handleRename(id, nameField, next)
                : undefined
            }
            t={t}
          />
        );
      },
    };

    // 时间字段名可覆盖（见 `ResourceDescriptor.timestamps`）：工单是 snake_case。
    const timestamps = resource.timestamps ?? { createdAt: 'createdAt', updatedAt: 'updatedAt' };
    const timeColumns: ColumnType<T>[] = [
      {
        title: t('创建时间'),
        dataIndex: timestamps.createdAt,
        key: 'createdAt',
        width: RESOURCE_TIME_COLUMN_WIDTH,
        render: (v: string) => (
          <span style={{ whiteSpace: 'nowrap' }}>{v ? formatDate(v) : '-'}</span>
        ),
      },
      {
        title: t('更新时间'),
        dataIndex: timestamps.updatedAt,
        key: 'updatedAt',
        width: RESOURCE_TIME_COLUMN_WIDTH,
        render: (v: string) => (
          <span style={{ whiteSpace: 'nowrap' }}>{v ? formatDate(v) : '-'}</span>
        ),
      },
    ];

    const actionCol: ColumnType<T> = {
      title: t('操作'),
      key: 'action',
      // 操作列吸附内容区右缘（宽度 / fixed / 右对齐见共享预设）。
      // autoColumnWidth 是显式逃生舱：该资源主动放弃吸附与固定宽度。
      ...RESOURCE_ACTION_COLUMN,
      ...(autoColumnWidth ? { width: undefined, fixed: undefined } : null),
      // 列内动作也右对齐（`.actionCell` 是 flex，另配 `justify-content: flex-end`）。
      align: 'right',
      render: (_: unknown, record: T) => {
        const id = getId(record);
        // 「更多」里**只有调用方补的菜单项**。详情不在这里：同一行的主标识本来就是
        // 指向它的真锚点（见上面的 ID 列），菜单里再放一项就是同一目的地的第二个入口。
        const moreItems: MenuProps['items'] = moreRowActions?.(record, mutate) ?? [];
        // 分隔符插在**项目之间**，而不是「有 rowActions 就补一个尾随的」：
        // 后者在「有 rowActions 但没有删除」时会留下一条悬空的 `|`。
        const groups = [
          rowActions?.(record, mutate),
          deletable ? (
            <Popconfirm
              key="delete"
              title={t('确定删除此 {{name}} 吗？', { name: t(resource.name) })}
              okText={t('确定')}
              cancelText={t('取消')}
              okButtonProps={{ danger: true, size: 'small' }}
              onConfirm={() => handleDelete(id)}
            >
              <span className={styles.actionDangerLink}>{t('删除')}</span>
            </Popconfirm>
          ) : null,
          // 「更多」**每一行都渲染**，哪怕这一行的菜单项是空的：操作列末位是一个固定
          // 落点，行与行之间才对得齐，也不会因为「没有可选动作」而让按钮忽隐忽现。
          // 空菜单由 `MoreActions` 渲染为禁用态，不弹空面板。
          <MoreActions key="more" items={moreItems} t={t} />,
        ].filter(Boolean);

        return (
          <div className={styles.actionCell}>
            {groups.map((group, i) => (
              <Fragment key={i}>
                {i > 0 && <span className={styles.actionSep}>|</span>}
                {group}
              </Fragment>
            ))}
          </div>
        );
      },
    };

    // 描述符若也声明了主键那一列，它**已经被折进上面的 ID 列**（标题与渲染），
    // 这里必须把它剔掉，否则同一份数据会并排画两列，且其中一列不是链接。
    const extraCols: ColumnType<T>[] = (resource.extraColumns ?? [])
      .filter(col => String(col.key ?? col.dataIndex) !== resource.idKey)
      .map(col => {
        // 状态开关列：描述符只声明字段与映射，真正的交互（写回 + 重取）在这里装配。
        const { switchField, ...column } = col;
        // 这一列最终的候选项：`filterOptions` 声明了就用**当前选中值**现算（级联），
        // 否则就是描述符里那份常量。下面三处（filters / filterSearch / filteredValue）
        // 必须一起看这一份 —— 漏一处就会出现「派生列不受控而其余列受控」，antd 会在
        // 开发期告警，而且那一列的选中态会飘。`allColumns` 的 deps 里有 `filterState`，
        // 列对象因此随选中值重建。
        const options = col.filterOptions ? col.filterOptions(filterSelection) : col.filters;

        // **空候选 = 这一列在这个筛选条件下没有可筛的东西**，于是整根不画漏斗。
        //
        // 为什么不能把 `[]` 直接交给 antd：它判「这列有没有过滤器」用的是 `filters` 是否
        // 真值（`antd/es/table/hooks/useFilter` 的 `collectFilterStates`），而 `[]` 是真值
        // —— 结果是画出一个**空下拉**，看着像「搜不到东西」。级联把它变成了常态：类型选
        // 训练营 / 知识库时，分类那两列的候选本就是空的（那两类没有分类坐标）。
        //
        // 三处一起摘掉，缺一不可：只摘 `filters` 而留着 `filteredValue`，antd 会警告
        // 「Columns should all contain 'filteredValue' or not contain 'filteredValue'」。
        // 三处都没有时这一列不进 `collectFilterStates`，也就绕开了那条检查。
        const candidates = options && options.length > 0 ? options : undefined;

        return {
          ...column,
          // 候选项已折进下面的 `filters`：antd 不认识这个字段，别让它继续往前传
          // （列对象被原样透传给 antd，见 `ProTableColumn.defaultHidden` 那条注释）。
          filterOptions: undefined,
          // 开关列：直接用可交互的开关替换描述符里的只读渲染。
          ...(switchField && canWrite
            ? {
                render: (_: unknown, record: T) => {
                  // 字段路径可能是嵌套的（`spec.enabled`），不能按顶层键直接索引。
                  const checked = isSwitchOn(
                    switchField,
                    readPath(record as Record<string, unknown>, switchField.key)
                  );
                  return (
                    <StatusSwitch
                      checked={checked}
                      onLabel={switchField.onLabel}
                      offLabel={switchField.offLabel}
                      onChange={next => handleSwitchToggle(getId(record), switchField, next)}
                      confirm={
                        switchField.confirm
                          ? {
                              title: checked
                                ? t('确定停用此{{name}}吗？', { name: t(resource.name) })
                                : t('确定启用此{{name}}吗？', { name: t(resource.name) }),
                              okText: checked ? t('停用') : t('启用'),
                              cancelText: t('取消'),
                            }
                          : undefined
                      }
                    />
                  );
                },
              }
            : {}),
          // 列标题来自描述符（那一侧写的是中文，也就是语言包的键），翻译发生在这里：
          // 描述符是模块级常量，它自己调 t() 会把语言**冻在模块加载那一刻**。
          ...(typeof col.title === 'string' ? { title: t(col.title) } : {}),
          ...(candidates ? { filters: candidates } : {}),
          // 单选列此前一律不给搜索框；2026-10-17 起由描述符自己说了算（`filterSearch`）：
          // 商品/知识库/导入三页的类型、状态、来源等单选漏斗要能按名字模糊找候选项，
          // 而「级联的下游列」仍旧默认不给（多选列保持原来的默认 true）。
          ...(candidates ? { filterSearch: col.filterSearch ?? col.filterMultiple !== false } : {}),
          // 服务端过滤的列是**受控**的：选中态由 `filterState` 说了算，antd 因此不再
          // 本地过滤（它只在 `onFilter` 存在时才筛），也不会自己记一份选中态。
          ...(resource.serverFilter && candidates
            ? { filteredValue: filterState[String(col.key ?? col.dataIndex)] ?? null }
            : {}),
        };
      }) as ColumnType<T>[];

    return [idCol, ...extraCols, ...timeColumns, actionCol];
  }, [
    resource,
    canWrite,
    onClickId,
    idHref,
    getId,
    handleDelete,
    handleRename,
    handleSwitchToggle,
    mutate,
    rowActions,
    moreRowActions,
    deletable,
    filterState,
    filterSelection,
    t,
    idTitle,
    idColumnOverride,
    autoColumnWidth,
  ]);

  // ── Column order / visibility state (initialized from allColumns, excluding fixed) ──
  const draggableKeys = useMemo(
    () =>
      allColumns
        .filter(c => c.key !== resource.idKey && c.key !== 'action')
        .map(c => String(c.key)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allColumns.length, resource.idKey]
  );

  const [colOrder, setColOrder] = useState<string[]>([]);

  /**
   * 列描述符里标了 `defaultHidden` 的列——默认收起来，但**仍然在列设置里**
   * （勾回来即可）。见 `ProTableColumn.defaultHidden`。
   *
   * 只是初始值：`useState` 之后由列设置对话框接管，所以运营勾一下就能把它放回
   * 表格，刷新前一直有效（与列顺序一样，不跨会话持久化）。
   */
  const defaultHiddenKeys = useMemo(
    () =>
      (resource.extraColumns ?? [])
        .filter(c => c.defaultHidden)
        .map(c => String(c.key ?? c.dataIndex)),
    [resource]
  );
  const [hiddenKeys, setHiddenKeys] = useState<string[]>(defaultHiddenKeys);

  useEffect(() => {
    setColOrder(draggableKeys);
  }, [draggableKeys.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Final ordered + visible columns ──
  const orderedColumns = useMemo((): ColumnType<T>[] => {
    // 这里按 key 建表，**同 key 时后者胜出** —— 这条只对时间列与操作列成立（它们在
    // `allColumns` 里排在描述符的 `extraColumns` 之后，外壳的版本因此赢）。ID 列排在
    // 最前面，是反过来的那个，所以描述符声明的主键列已在 `allColumns` 里被折进它、
    // 并从中剔除了，`byKey[resource.idKey]` 取到的必定是外壳那一列（带链接的那个）。
    const byKey = Object.fromEntries(allColumns.map(c => [String(c.key), c]));
    const idCol = byKey[resource.idKey];
    const actionCol = byKey['action'];
    const middle = (colOrder.length > 0 ? colOrder : draggableKeys)
      .filter(k => !hiddenKeys.includes(k))
      .map(k => byKey[k])
      .filter((c): c is ColumnType<T> => Boolean(c))
      // `fixed` 必须和 `width` 一起抹掉：rc-table 的吸附偏移量是拿列的 `width`
      // 累加出来的，一个「没有宽度、却还吸附」的中间列会算出 0 偏移，粘在错误的位置
      // 上（看起来像整张表渲染坏了）。描述符允许写 `fixed`，所以防御要放在这里。
      .map(c => ({ ...c, width: undefined, fixed: undefined as ColumnType<T>['fixed'] }));
    return [idCol, ...middle, actionCol].filter((c): c is ColumnType<T> => Boolean(c));
  }, [allColumns, colOrder, hiddenKeys, resource.idKey, draggableKeys]);

  // ── Column settings items ──
  const colSettingsItems: ColItem[] = useMemo(() => {
    const byKey = Object.fromEntries(allColumns.map(c => [String(c.key), c]));
    const idItem: ColItem = {
      key: resource.idKey,
      // 与表头同一个名字：描述符为主键列写过标题就用它的（「标识」「档位」…）。
      title: idTitle,
      visible: true,
      fixed: true,
    };
    const rest = (colOrder.length > 0 ? colOrder : draggableKeys).map(k => ({
      key: k,
      // 与 `extraCols` 同一个理由：标题是描述符写的中文，翻译在这里发生。
      title: byKey[k]?.title ? t(String(byKey[k]?.title)) : k,
      visible: !hiddenKeys.includes(k),
    }));
    return [idItem, ...rest];
  }, [allColumns, colOrder, hiddenKeys, resource.idKey, draggableKeys, t, idTitle]);

  // ── Search fields for dropdown ──
  //
  // 声明了 `searchFields` 就以它为准：服务端搜索只能筛适配器认识的字段，把一列
  // 不认识的东西摆进下拉，选出来的条件会被静默丢掉 —— 界面上与「没有匹配」无法
  // 区分（见 `ResourceDescriptor.searchFields`）。没声明时沿用列派生那份，行为与
  // 加入这个开关之前逐字相同。
  const searchFields = useMemo(() => {
    if (resource.searchFields) {
      return resource.searchFields.map(f => ({ label: t(f.label), key: f.key }));
    }
    return [
      { label: 'ID', key: resource.idKey },
      // 与 `extraCols` 同一条剔除：主键那一列由上面这一项代表到底即可 —— 描述符再声明
      // 一次，下拉里就会并排出现两条同 key 的选项（搜「标识」和搜「ID」是同一件事）。
      ...(resource.extraColumns ?? [])
        .filter(c => String(c.key ?? c.dataIndex) !== resource.idKey)
        // `searchable: false` 的列不进这份下拉。它此前是个**没人读的声明**（`ProTableColumn`
        // 上写着、这里不看），所以下面是它第一次真的生效 —— 只有显式写了才排除，
        // 没写的列一律照旧，别的页面因此一格都不动。
        //
        // 为什么需要它：搜出来的那一行会按 `item[fieldKey]` 做本地匹配（见 `filteredData`），
        // 而**没有 `dataIndex` 的列**（按钮列之类）在行上根本没有那个键 —— 拿它去搜
        // 恒为「一条都不匹配」，看起来像把整张表筛空了。
        .filter(c => c.searchable !== false)
        .map(c => ({
          label: t(String(c.title)),
          key: String(c.dataIndex ?? c.key),
        })),
      { label: t('创建时间'), key: 'createdAt' },
    ];
  }, [resource, t]);

  /**
   * 直接输入 + 回车时落到的字段。
   *
   * 只认描述符显式声明的 key；声明了却对不上（打错、字段被删）时返回 `null` ——
   * 失败关闭，退回「必须先选字段」的旧行为，而不是拿第一项顶上去。拿第一项顶替会
   * 让一个笔误变成「回车按 ID 搜」，而运营完全看不出来。
   */
  const defaultSearchField = useMemo(() => {
    const key = resource.defaultSearchField;
    if (!key) return null;
    return searchFields.find(field => field.key === key) ?? null;
  }, [resource.defaultSearchField, searchFields]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 把刷新入口交给调用方。单元格内即时编辑与行内动作需要它：列渲染函数拿不到
  // `rowActions` 那个 mutate，而「改完以服务端为准」只能靠重取当前页。
  // 直接交 `loadData`（而不是包一层 `() => void loadData()`）：调用方要能 await
  // 这次重取，否则忙碌态会在表格更新之前就收掉。
  useEffect(() => {
    onReady?.({ refresh: loadData });
  }, [loadData, onReady]);

  // ── Batch delete ──
  const handleBatchDelete = async () => {
    try {
      await resource.api.removeBatch?.(selectedKeys);
      message.success(t('批量删除成功'));
      setData(prev => prev.filter(item => !selectedKeys.includes(getId(item))));
      setSelectedKeys([]);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('批量删除失败'));
    }
  };

  // ── Create ──
  const handleCreate = async () => {
    setCreateLoading(true);
    try {
      await resource.api.create?.();
      message.success(t('创建成功'));
      setCreateOpen(false);
      await loadData();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('创建失败'));
    } finally {
      setCreateLoading(false);
    }
  };

  // ── Download CSV ──
  const handleDownload = useCallback(() => {
    const exportCols = allColumns.filter(c => c.key !== 'action' && c.dataIndex);
    // 显示名已合并进 ID/名称单元格，不再是独立列；导出时补回来，否则 CSV 会丢字段。
    const nameField = resource.nameField;
    const mergedNameCol = nameField
      ? [{ title: t('显示名'), dataIndex: nameField, key: nameField }]
      : [];
    const cols = [...exportCols.slice(0, 1), ...mergedNameCol, ...exportCols.slice(1)];
    const header = cols.map(c => t(String(c.title)));
    // 嵌套列（如 `spec.enabled`）要按点路径取值，直接索引只会导出空单元格。
    const rows = data.map(item =>
      cols.map(c => readPath(item as Record<string, unknown>, String(c.dataIndex)))
    );
    downloadCsv(`${t(resource.name)}-${Date.now()}.csv`, header, rows);
    message.success(t('导出成功'));
  }, [allColumns, data, resource, message, t]);

  /**
   * 搜索标签的本地匹配；`serverSearch` 时**不在这里筛**。
   *
   * 服务端那一轮已经按同一组标签筛过了（`listSearch` 随 `api.list` 发出），再筛一遍
   * 只会重复劳动 —— 更糟的是，它会让「适配器没把 `search` 用上」表现为一个看起来
   * 正常的本地过滤，于是那个 bug 永远没人发现。
   */
  const filteredData = useMemo(() => {
    if (resource.serverSearch) return data;
    if (searchTags.length === 0) return data;
    return data.filter(item =>
      searchTags.every(tag =>
        String((item as Record<string, unknown>)[tag.fieldKey] ?? '')
          .toLowerCase()
          .includes(tag.value.toLowerCase())
      )
    );
  }, [resource.serverSearch, data, searchTags]);

  /**
   * 搜索标签变化：服务端搜索时回到第 1 页并清空勾选。
   *
   * 在第 5 页按名字搜，结果都在第 1 页 —— 停在原地只会看到一张空表。本地匹配
   * （没开 `serverSearch`）保持原来的行为：它只筛手上这一页，翻页本身没有含义。
   */
  const handleSearchTagsChange = useCallback(
    (tags: SearchTag[]) => {
      setSearchTags(tags);
      if (!resource.serverSearch) return;
      setPage(1);
      setSelectedKeys([]);
    },
    [resource.serverSearch]
  );

  const hasSelection = selectedKeys.length > 0;

  /**
   * 勾选列只在「选中的东西真的能派上用场」时才渲染。
   *
   * 能用到选中项的一共三处：批量删除（受 `deletable` 控制）、调用方补的批量按钮
   * （`extraBatchActions` / `trailingActions`）。三样都没有时（只读资源、或纯索引页）
   * 画一列勾选框再显示「已选 N 项」是纯噪音 —— 勾了没有任何下一步。
   */
  const selectable = deletable || Boolean(extraBatchActions || trailingActions);

  // 移动端（< 768px）把表格换成卡片列表：固定列 + 横向滚动在手机上等于不可用
  // （ID 200 + 操作 170 就吃掉 375px 的 370px）。卡片字段从列定义自动推导，
  // 21 个调用点不需要改；描述符可用 `mobileHidden` / `mobilePriority` 或
  // `mobileCard` 逃生舱干预。见 `mobile-card.tsx` 的规则说明。
  const isMobile = useIsMobile();

  const rowSelection: TableRowSelection<T> = {
    selectedRowKeys: selectedKeys,
    onChange: (keys: React.Key[]) => setSelectedKeys(keys as string[]),
    columnWidth: 40,
  };

  // ── Column settings apply ──
  const applyColSettings = (newLayout: ColumnLayout, newItems: ColItem[]) => {
    setLayout(newLayout);
    const draggableItems = newItems.slice(1);
    setColOrder(draggableItems.map(i => i.key));
    setHiddenKeys(draggableItems.filter(i => !i.visible).map(i => i.key));
    setColSettingsOpen(false);
  };

  // ── Render ──
  return (
    <ResourceShell title={showTitle ? t(resource.title) : undefined} titleExtra={scopeSelector}>
      {/* ── Row 1: batch actions + view toggle ── */}
      <div className={styles.toolbar1}>
        <div className={styles.toolbar1Left}>
          {creatable && (
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              新建
            </Button>
          )}
          {leadingActions?.()}
          {extraBatchActions?.(selectedKeys, mutate, loadData)}
          {deletable && (
            <Popconfirm
              disabled={!hasSelection}
              title={t('确定删除选中的 {{count}} 条{{name}}吗？', {
                count: selectedKeys.length,
                name: t(resource.name),
              })}
              okText={t('确定')}
              cancelText={t('取消')}
              okButtonProps={{ danger: true }}
              onConfirm={handleBatchDelete}
            >
              <Button danger disabled={!hasSelection}>
                {t('删除')}
              </Button>
            </Popconfirm>
          )}
          {trailingActions?.(selectedKeys, mutate, loadData)}
          {hasSelection && (
            <span className={styles.selectedCount}>
              {t('已选 {{count}} 项', { count: selectedKeys.length })}
            </span>
          )}
        </div>

        <div className={styles.viewToggle}>
          {(resource.viewToggle ?? true) && (
            <>
              <button
                className={`${styles.viewBtn} ${viewMode === 'list' ? styles.viewBtnActive : ''}`}
                onClick={() => setViewMode('list')}
              >
                <UnorderedListOutlined />
                {t('列表')}
              </button>
              <button
                className={`${styles.viewBtn} ${viewMode === 'tab' ? styles.viewBtnActive : ''}`}
                onClick={() => setViewMode('tab')}
              >
                <ProfileOutlined />
                {t('页签')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Row 2: search + icons (full width) ── */}
      <div className={styles.toolbar2}>
        <SearchTagInput
          tags={searchTags}
          fields={searchFields}
          defaultField={defaultSearchField}
          onTagsChange={handleSearchTagsChange}
          t={t}
        />
        <Tooltip title={t('刷新')}>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={loadData} />
        </Tooltip>
        <Tooltip title={t('导出')}>
          <Button icon={<DownloadOutlined />} onClick={handleDownload} />
        </Tooltip>
        <Tooltip title={t('设置列表字段')}>
          <Button icon={<SettingOutlined />} onClick={() => setColSettingsOpen(true)} />
        </Tooltip>
      </div>

      {/* ── Card ── */}
      <ResourceCard loose={layout === 'loose'}>
        {viewMode === 'list' ? (
          isMobile ? (
            <MobileCardList<T>
              data={filteredData}
              columns={orderedColumns}
              idKey={resource.idKey}
              nameField={resource.nameField}
              loading={loading}
              selectable={selectable}
              selectedKeys={selectedKeys}
              onSelectChange={setSelectedKeys}
              onClickId={onClickId}
              idHref={idHref}
              emptyText={t('暂无数据')}
            />
          ) : (
            <ConfigProvider getPopupContainer={() => document.body}>
              <Table<T>
                columns={orderedColumns}
                dataSource={filteredData}
                rowKey={resource.idKey}
                loading={loading}
                size={layout === 'compact' ? 'small' : 'middle'}
                rowSelection={selectable ? rowSelection : undefined}
                // 布局契约见 `RESOURCE_TABLE_LAYOUT`：中间列按内容、整表铺满卡片、
                // 末列贴住右缘。所有模式共用，不再依赖 rc-table 的推断。
                {...RESOURCE_TABLE_LAYOUT}
                className={autoColumnWidth ? styles.contentWidthTable : undefined}
                sticky
                pagination={false}
                onChange={(_, filters, sorter) => {
                  // AntD handles column-level filtering via onFilter; sorter is client-side
                  void sorter;
                  if (!resource.serverFilter) return;
                  // 服务端过滤：把选中值记下来交给 `api.list`，并回到第 1 页 ——
                  // 在第 5 页按条件筛，结果都在第 1 页，停在原地只会看到一张空表。
                  //
                  // 落库前先过一遍 `pruneFilterState`：派生候选（级联）里已经没有的选中值
                  // 会在这一次 state 更新里被清掉，所以那条矛盾查询**从未发出**——不是先
                  // 查空再纠正。见 `filters.ts`。
                  //
                  // 这里是**覆盖**而不是 `{...filterState, ...filters}` 合并：antd 只报它
                  // 渲染出来的那些列，被列设置藏起来的列它一个字不说。合并会让那条筛选在
                  // 界面上消失之后继续生效，空表也就再没有东西解释它。
                  setFilterState(
                    pruneFilterState(
                      filters as Record<string, FilterValue | null>,
                      resource.extraColumns ?? []
                    )
                  );
                  setPage(1);
                  setSelectedKeys([]);
                }}
              />
            </ConfigProvider>
          )
        ) : (
          <TabView<T>
            data={filteredData}
            idKey={resource.idKey}
            columns={orderedColumns}
            loading={loading}
            detail={detail}
            mutate={mutate}
            tabTitleById={tabTitleById}
          />
        )}
      </ResourceCard>

      {/* ── Pagination (outside card) ── */}
      {viewMode === 'list' && (
        <ListPagination
          total={total}
          page={page}
          pageSize={pageSize}
          // 表格底栏单页时也要露出来（「共 N 条 + 每页条数」是表格型 UI 的常规），
          // 不跟着卡片流那套「单页即隐藏」走。
          hideOnSinglePage={false}
          onPageChange={p => {
            setPage(p);
            setSelectedKeys([]);
          }}
          onPageSizeChange={s => {
            setPageSize(s);
            setPage(1);
            setSelectedKeys([]);
          }}
          t={t}
        />
      )}

      {/* ── Create modal ── */}
      {creatable && (
        <Modal
          title={`新建${t(resource.name)}`}
          open={createOpen}
          onOk={handleCreate}
          onCancel={() => setCreateOpen(false)}
          confirmLoading={createLoading}
          okText="确定"
          cancelText="取消"
        >
          <p>后端 Create 请求体当前为空，将创建一个新的{t(resource.name)}并生成资源 ID。</p>
        </Modal>
      )}

      {/* ── Column settings modal ── */}
      <ColumnSettingsModal
        open={colSettingsOpen}
        layout={layout}
        items={colSettingsItems}
        onOk={applyColSettings}
        onCancel={() => setColSettingsOpen(false)}
      />
    </ResourceShell>
  );
}
