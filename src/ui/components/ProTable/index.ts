/**
 * `ProTableColumn` 的类型定义。
 *
 * 独立应用只消费这一种列描述（`ResourcePage` / `ResourceDescriptor` 用），
 * 不引入 `ProTable` 组件本身。定义与 onex-console 的 `@onex-console/ui` 同源
 * （2026-11-06 拆分时抽取），改动两边需同步。
 */
import type { TableColumnType, BadgeProps } from 'antd';
import type { ColumnFilterItem } from 'antd/es/table/interface';

export interface ProTableColumn<T = any> extends TableColumnType<T> {
  /** 是否可搜索 */
  searchable?: boolean;
  /** 是否可导出 */
  exportable?: boolean;
  /**
   * 默认不出现在表格里（`ResourcePage` 的「列设置」里仍可勾回来）。
   *
   * 给「填了要能看、平时不该占地方」的字段用：列宽由内容决定的窄列尤其如此——
   * 它省下的横向空间是实打实的，而运营要改它时只要打开列设置勾一下。
   *
   * # 为什么不叫 `hidden`
   *
   * 因为 rc-table（antd Table 的底座）**自己**有一个 `hidden`，而且它是真的把列从
   * 渲染里摘掉——与列设置里那个开关无关。描述符的字段会被原样透传给 antd（见
   * `ResourcePage` 的 `extraCols`），所以叫 `hidden` 会让这一列**永远**回不来：
   * 开关勾上了，`hidden: true` 还在列对象上。名字必须不一样。
   */
  defaultHidden?: boolean;
  /** 值枚举（status 用于渲染状态徽标） */
  valueEnum?: Record<string | number, { text: string; status?: BadgeProps['status'] }>;
  /**
   * 过滤器候选项**由当前选中的其它筛选值派生**（级联筛选）。
   *
   * 与 `filters` 是同一件事的两种写法：一个是常量、一个是算出来的。声明了本字段
   * 就以它为准（`ResourcePage` 会把返回值当作 `filters` 交给 antd），别再写
   * `filters`；`ProTable` 本身**解析不了**它（没有选中值可读），只有
   * `ResourcePage` 会——所以它只在开了 `ResourceDescriptor.serverFilter` 的资源上
   * 有意义。
   *
   * # 三条必须知道的规矩
   *
   * 1. 返回的是**候选全集**，不是按关键词收窄的结果：外壳拿它来判「选中的那个值
   *    还算不算数」（见第 2 条），写成模糊匹配会把用户的选中值抖掉。
   * 2. 选中值必须落在候选里：不在的会被外壳清成 `null`（一次 state 更新，不会先
   *    发出一条自相矛盾的查询）。所以这个函数要**单调**——父值不变时候选就不变。
   * 3. 参数是**这一轮全部已生效的选中值**（列 key → 取值，未筛的列不出现），其中
   *    包含刚刚改过的那一列。因此**不要读自己那一列**：读到的要么是即将被作废的旧
   *    值，要么让候选与选中值互相追着跑。
   * 4. 必须是**无副作用的纯函数**：外壳除了渲染，还会在每次变更时拿它判「哪些选中值
   *    该作废」，缓存、打日志、发请求都会变成一件不该发生的事。
   * 5. 列与列之间必须构成**有向无环图**。外壳套用第 3 条时按「这一轮全部选中值」判，
   *    有环的候选会互相作废，最终把两列的选中值一起清空（表现为「我什么都没动，筛选
   *    自己全没了」）。
   * 6. **认不出来的父值要回退成该范围的全量，而不是空表。** 链条超过两层时（`A → B → C`）
   *    这条是承重的：一次变更里，外壳只判一遍，`C` 看到的 `B` 可能是**这一轮即将被清掉**
   *    的那个旧值。「旧父值」与「没有父值」必须求出同一份候选，否则 `C` 会按一个已经作废
   *    的父级蒙混过关，放出一条服务端忠实执行、返回空表的查询（详见 `ResourcePage/filters.ts`
   *    的 `pruneFilterState`）。
   *
   * 参数刻意写成 `Record<string, string[]>` 而不是 import `ResourceListFilters`：
   * `types/index.ts` 已经 import 了本文件，反向再 import 会绕成一个环（虽然能被
   * `import type` 擦除，但不值得为省一个类型名去绕）。
   */
  filterOptions?: (selected: Record<string, string[]>) => ColumnFilterItem[];
  /**
   * 可交互的状态开关列。
   *
   * 描述符声明它之后，`ResourcePage` 会把这一格渲染成开关：点击即通过
   * `api.update(id, { [key]: value })` 写回，并以服务端重取结果为准。
   *
   * `key` 可以是点路径（如 `spec.enabled`）：写通路按路径只改这一个字段，
   * 不会覆盖父对象里的其余字段。只读字段不要声明。
   */
  switchField?: {
    /** 字段路径，支持 `a.b` 形式的嵌套字段。 */
    key: string;
    /** 开 / 关对应的线上取值；缺省 `true` / `false`。 */
    onValue?: string | boolean;
    offValue?: string | boolean;
    /** 空值是否视为开。 */
    defaultOn?: boolean;
    onLabel?: string;
    offLabel?: string;
    /** 切换前弹二次确认。 */
    confirm?: boolean;
  };
}
