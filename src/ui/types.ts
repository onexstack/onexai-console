import type { ProTableColumn } from './components/ProTable';

/**
 * 通用组件类型
 */

/**
 * 分页参数
 */
export interface PaginationParams {
  page: number;
  pageSize: number;
}

/**
 * 分页响应
 */
export interface PaginationResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 选项类型
 */
export interface Option<V = string | number> {
  label: string;
  value: V;
  disabled?: boolean;
  children?: Option<V>[];
}

/**
 * 树节点类型
 */
export interface TreeNode<T = unknown> {
  key: string | number;
  title: string;
  children?: TreeNode<T>[];
  data?: T;
  disabled?: boolean;
  isLeaf?: boolean;
}

/**
 * 表单字段类型
 */
export interface FormField {
  name: string;
  label: string;
  required?: boolean;
  rules?: unknown[];
  tooltip?: string;
}

/**
 * 通用 CRUD 资源接口（ResourcePage 消费）
 *
 * 统一 page/pageSize 分页，`total` 可选（大表可省略 COUNT）。
 * 真实实现与 mock 实现共用此签名，由上层 `selectApi` 按环境切换。
 */
/**
 * 列过滤器的当前取值：列 key → 该列选中的取值。
 *
 * 没被筛的列**不出现**（而不是给一个空数组）：实现侧因此不必再区分「这一列没筛」
 * 与「这一列筛了个空」——后者在单选的过滤器里根本不存在。写成数组是为了与 antd
 * `onChange` 交出来的形状一致，也为了将来某一列放开多选时不必再改签名。
 *
 * 同一个形状有**两处**入参：`api.list` 的 `filters`，以及 `ProTableColumn.filterOptions`
 * （派生候选）收到的选中值——「这一轮筛了什么」与「算候选要看什么」刻意是同一份。
 */
export type ResourceListFilters = Record<string, string[]>;

export interface ReadOnlyResourceApi<T> {
  list: (params: {
    page: number;
    pageSize: number;
    /**
     * 列过滤器的选中值。只在资源声明了 `ResourceDescriptor.serverFilter` 时出现
     * ——没声明的话，列过滤器是 antd 的本地过滤，不经过这里（见那个字段）。
     */
    filters?: ResourceListFilters;
    /**
     * 搜索框的标签值（键 → 取值）。只在资源声明了 `ResourceDescriptor.serverSearch`
     * 时出现 ——没声明的话，搜索框是浏览器里的本地匹配，不经过这里（见那个字段）。
     *
     * 形状与 `filters` 相同，语义不同：`filters` 是「等于」，这里是「包含」。
     */
    search?: ResourceListFilters;
  }) => Promise<{ total: number; items: T[] }>;
  get: (id: string) => Promise<T>;
}

export interface ResourceApi<T> extends ReadOnlyResourceApi<T> {
  create: () => Promise<string>;
  /**
   * 部分更新。`patch` 是**要改的字段**，不是整行——后端契约里这些字段都是
   * `optional`，未发送即不改；发空对象是一次 no-op。
   *
   * 参数可选是为了兼容最早那版「配 mock 写的」实现（mock 不需要字段）。
   * 但它绝不该被实现成「忽略 patch、发空 body」：那会让调用方以为改成功了。
   * `patch` 的键用 `Record<string, unknown>` 而不是 `Partial<T>`，因为不同
   * 资源的可更新字段与实体字段并不重合（例如 miniblog 的 `Post.postType`
   * 可改、但 `likeCount` 不可改），由各资源自己在适配器里收窄。
   */
  update: (id: string, patch?: Record<string, unknown>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  removeBatch: (ids: string[]) => Promise<void>;
}

/**
 * `ResourceDescriptor.api` 接受的形状：读接口必需，写接口按资源而定。
 *
 * # 为什么分成三个类型而不是给 `ResourceApi` 加上 `?`
 *
 * 只读资源（onexai 的智能体与知识库，字段由平台对账维护）不该有写入口，也不该
 * 为此塞一个「调用必然失败」的空实现。最省事的写法是把 `ResourceApi` 的写成员
 * 直接标成可选，但那样**每个已有调用方**都要处理 `undefined`——它们调的是自己
 * 资源的写接口，本来就不该怀疑它不存在。
 *
 * 所以写接口的可选性只存在于这里的交集类型上，由 `ResourceDescriptor` 的第二个
 * 类型参数决定：声明 `ResourceDescriptor<Post>` 的资源（写接口完整）拿到的是
 * `ResourceApi<Post>`，调用点一行都不用改；只读资源显式声明
 * `ResourceDescriptor<Agent, ReadOnlyResourceApi<Agent>>`，写成员在类型上就不存在。
 * 一个只读资源想写数据，得先改它的类型声明——这是能拿到的最强保证。
 */
export type ResourceApiShape<T> = ReadOnlyResourceApi<T> &
  Partial<Pick<ResourceApi<T>, 'create' | 'update' | 'remove' | 'removeBatch'>>;

/**
 * 通用 CRUD 资源描述（ResourcePage 的配置入口）
 */
export interface ResourceDescriptor<T, Api extends ResourceApiShape<T> = ResourceApi<T>> {
  /** 主键字段名 */
  idKey: string;
  /**
   * 主键那一列是否在主键旁边给一个「复制」按钮（**默认显示**）。
   *
   * 复制是「主键要拿去别处用」的通用动作（查日志、提单、找客服），所以缺省就开；
   * 按钮只在**悬停这一行或键盘聚焦**时淡入，平时不占视觉噪声。确实不该复制主键的
   * 资源显式写 `false`（例如敏感标识）。
   *
   * Ctrl/⌘ 点击、中键、右键菜单仍由主键上的那个锚点提供；复制按钮是**锚点外面**的
   * 一个独立控件（否则点复制会顺带跳转）。
   */
  idCopyable?: boolean;
  /** 页面标题（i18n key） */
  title: string;
  /**
   * 标题下的一行说明（i18n key）。缺省不渲染。
   *
   * 给「光看标题不知道这一页是干什么的」的页面用（例如知识库这类索引页）。
   */
  subtitle?: string;
  /** 资源名（用于弹窗文案，i18n key） */
  name: string;
  /** ID 列标题（i18n key） */
  idLabel: string;
  /** CRUD 接口 */
  api: Api;
  /**
   * 自动时间列读取的字段名，缺省 `{ createdAt: 'createdAt', updatedAt: 'updatedAt' }`。
   *
   * 绝大多数字段是 camelCase；chat 服务的工单是 snake_case（`created_at` /
   * `updated_at`）。没有这一项时，自动列读不到值、显示 `-`，而描述符里再声明一次
   * `created_at` 作为列就会并排出现两个「创建时间」——一个空、一个有值。
   */
  timestamps?: { createdAt: string; updatedAt: string };
  /** 额外列（插在 ID 列之后） */
  extraColumns?: ProTableColumn<T>[];
  /**
   * 列宽一律按**内容**自适应：ID/名称列与操作列也不写死宽度、不做左右吸附。
   *
   * 缺省 `false`（现状）：中间各列的宽度本来由内容决定（`orderedColumns` 会把
   * 描述符里的 `width` 抹掉），但 ID 列固定 **240px 左吸附**、操作列固定
   * **160px 右吸附、内容右对齐**，好让运营在横向滚动时始终看得见「这是哪条」
   * 与「能做什么」。
   *
   * 打开它，每一列的宽度就是它最宽的那一格，整张表的宽度是各列之和（内容比容器
   * 窄时右边留白，不再被 antd 的 `min-width: 100%` 摊成平均分）；内容放不下时
   * 在**表格内部**横向滚动。代价是 ID 与操作不再吸边，滚动到中段时它们会移出视野
   * ——所以要逐页决定，而不是在这里一刀切。
   *
   * 用到它时，`extraColumns` 里就**不要**再写 `width`：中间列的 `width` 会被
   * `orderedColumns` 抹掉，写了也只是一份读起来像生效的死配置。
   *
   * # 什么时候才该打开
   *
   * **绝大多数页面不该开**：窄表默认由 antd 的 `min-width: 100%` 铺满卡片，比
   * 「左边一张表、右边一片空白」完整；空表时表头也不会缩成半截。这是给「宽表里
   * 那两个固定宽度明显挤压内容」的例外开关（现只有 `/admin/products`）。
   *
   * 确实要开时，三条**同时**满足（先按当前这页的数据实测，不要按列数猜）：
   *
   * - 列多、横向空间紧张：ID 200 + 操作 170 常年占掉视口一大截（`/admin/products`
   *   十几列就是这种），而不是「本来就能一屏放下」；
   * - 内容短且有界：枚举 / 数字 / 日期 / 短链接，翻页时列宽不会跳；
   * - 没有未兜底的长文本 / URL（`ellipsis: true` 在 auto 布局下按 nowrap 的
   *   max-content 算宽，一条长值能把列撑到上千 px）。
   *
   * 其余一律保持默认：ID/操作吸边是宽表行定位与动作入口的常驻骨架。
   */
  autoColumnWidth?: boolean;
  /**
   * 「名称」字段名（如 miniblog 文章是 `title`，任务 / 定时任务是 `name`）。
   *
   * 声明后，列表 ID/名称 列的名称旁会出现一支铅笔（**悬停名称或键盘聚焦时才显示**）：
   * 就地改名，输入框 + ✓/✗ 提交或取消。提交走 `api.update(id, { [nameField]: 新名 })`
   * —— 各资源的适配器已经把这个 patch 收窄到契约真正接受的字段，所以这里不需要另一条
   * 写通路；成功后**重取当前页**，以服务端为准。
   *
   * 不声明就没有改名入口：点赞这类根本没有名称的资源本就不该有；**只读资源不要声明**
   * —— 它们的 `update` 往往是一个恒定 reject 的占位，点了必然失败。
   */
  nameField?: string;
  /**
   * 是否显示内置的「新建」按钮。缺省 `true`（现状）。
   *
   * 内置新建只调 `api.create()`（无参、无表单），适合「建一条占位再由别处补内容」
   * 的资源；如果资源的创建需要用户填字段并走独立页面，把它关掉，改用
   * `ResourcePage` 的 `leadingActions` 自己放按钮。
   */
  creatable?: boolean;
  /**
   * 是否显示「列表 / 页签」视图切换。缺省 `true`（现状）。
   *
   * 详情若已由独立路由承载，这里的页签视图就是重复的第二套，关掉它。
   */
  viewToggle?: boolean;
  /**
   * 是否显示行内「删除」与批量删除。缺省 `true`（现状）。
   *
   * 给**只读资源**用（例如运营对象里的「客户线索」：只有列表，没有编辑也没有删除）。
   * 关掉它，而不是让调用方塞一个「点了会报错」的 remove —— 能点但必然失败的入口
   * 比没有入口更糟。
   */
  deletable?: boolean;
  /**
   * 列过滤器交给服务端处理。缺省 `false`（antd 的本地过滤）。
   *
   * # 为什么默认不是它
   *
   * 本地过滤只筛**当前这一页**。对服务端分页的表来说那是个谎：筛完剩几行，分页
   * 仍报未筛的总数，而空表看起来和「确实没有」一模一样——一个安静的、看起来
   * 完全正确的错答案。
   *
   * # 打开之后发生什么
   *
   * `ResourcePage` 把选中值（列 key → 取值）随 `page`/`pageSize` 一起交给
   * `api.list`，并在筛选变化时把页码拉回第 1 页（否则在第 5 页按条件筛，用户
   * 看到的是一次空列表，而结果都在第 1 页）。列过滤器因此变成**受控**的：
   * 选中态由这里维护，antd 只负责画。
   *
   * 开了它，列上就**不该再写 `onFilter`**：受控列不会走那个函数，留着是一段
   * 读起来像在生效的死代码。所有带 `filters` 的列应当一致（antd 只允许全受控
   * 或全非受控，混着用它会在开发期报警告）。列 key 就是传给 `api.list` 的键，
   * 命名成与查询参数一致最省心。
   *
   * # 派生候选（级联筛选）
   *
   * 列可以不写常量 `filters`，改声明 `ProTableColumn.filterOptions` —— 一个吃当前
   * 选中值、吐候选项的函数（典型：二级分类的候选跟着一级分类走）。选中态只有这里
   * 有，所以也只有在开了这个开关的资源上它才有意义。
   *
   * 派生列还多一条规矩：候选中已经**不存在**的选中值会被清掉（在
   * `Table.onChange` 里，与这次变更同一次 state 更新）。不然界面上会留下一个既
   * 不显示、也点不掉、却仍在筛选的值。见 `ResourcePage/filters.ts`。
   */
  serverFilter?: boolean;
  /**
   * 搜索框（「选择资源属性进行过滤」）的标签值交给服务端，缺省 `false`（本地匹配）。
   *
   * # 为什么要这个开关
   *
   * 本地匹配只筛**当前这一页**。对服务端分页的表来说那是个谎：搜出来是空的，
   * 分页仍报全量，而那个空表看起来和「确实没有」一模一样。商品列表就是这样一张表，
   * 一页十行、全量几百行 —— 搜一个名字而它恰好在第 3 页时，本地匹配答「没有」。
   *
   * # 打开之后发生什么
   *
   * 标签值（标签字段 → 取值）随 `page`/`pageSize` 一起交给 `api.list` 的 `search`，
   * 并且**不再在浏览器里过滤**（否则同一条件会筛两遍）。标签一变，页码回到第 1 页：
   * 在第 5 页按名字搜，结果都在第 1 页，停在原地只会看到一张空表。
   *
   * 打开它的资源要自己保证 `api.list` 真的把 `search` 用上了 —— 一个收了参数却不
   * 过滤的适配器，在界面上与「什么都没搜到」无法区分。
   */
  serverSearch?: boolean;
  /**
   * 搜索框里除列以外的字段（例如商品名：它显示在 ID 列里，本身不是一列）。
   *
   * **声明了它就只提供这一份** —— 列派生的那份不再出现。服务端搜索只能筛它认识的
   * 字段，把一列不认识的东西摆进下拉，选出来的条件会被适配器静默丢掉，看起来像
   * 「没有匹配」。`label` 是语言包的键，翻译在 `ResourcePage` 里发生（与列标题
   * 同一条规矩）。
   */
  searchFields?: { key: string; label: string }[];
  /**
   * 直接输入并按回车时使用的字段 key，必须是 `searchFields` 里的一项。
   *
   * # 为什么必须显式声明，而不是默认取 `searchFields[0]`
   *
   * 那会把**展示顺序**悄悄变成行为契约：调整下拉里两项的先后次序，就会顺手改掉
   * 「回车按什么搜」。而且它会让所有用到搜索框的页面一起开始「直接回车就搜索」——
   * 其中不少页面的 `api.list` 根本没消费 `search`，按出来的条件会被静默丢掉。
   *
   * 声明了它，运营就不必先点开下拉选字段：直接敲关键字回车即可。已经生成过标签的
   * 字段再提交时**替换**原标签的值（同一字段只留一个标签，见 `SearchTagInput`）。
   *
   * 它**只影响提交到哪个字段**，不参与显示：搜索框里不画「名称:」这类常驻前缀，
   * 否则删掉同名标签后那个空前缀会再冒出来，看着像这条筛选删不掉。
   *
   * 找不到这个 key 时失败关闭（当作没声明），不偷偷退回第一项。
   */
  defaultSearchField?: string;
}
