import type { FilterValue } from 'antd/es/table/interface';

import type { ResourceListFilters } from '../../types';
import type { ProTableColumn } from '../ProTable';

/**
 * 列过滤器的两条纯规则：选中值的形状，以及「选中值还算不算数」。
 *
 * # 为什么单独成文件
 *
 * 它们是**规则**，不是某一次渲染的产物：怎么把 antd 的选中态收敛成传给 `api.list`
 * 的形状、派生候选里已经没有的选中值该怎么处理，这两件事都不该埋在
 * `ResourcePage` 那两千行里 —— 埋在那里就只能靠挂载整张表来验（那正是本仓
 * `categoryName` 单独成文件的同一条理由）。
 *
 * 谁也没想到的那一侧是「候选项会变」：列过滤器一直默认候选是常量，于是「选中的值
 * 不在候选里」这个状态从来不存在。级联（`ProTableColumn.filterOptions`）把它变成
 * 了常态，规则就得写明。
 */

/**
 * 当前生效的选中值：列 key → 该列选中的取值，**未筛的列不出现**。
 *
 * 这就是 `api.list` 收到的 `filters`，也是 `ProTableColumn.filterOptions` 收到的
 * 参数——两处刻意同一形状：派生候选项的入参，与「这一轮到底筛了什么」是同一件事。
 *
 * 值统一转成字符串：antd 的 `FilterValue` 允许 `Key | boolean`，而列 key 与取值
 * 到了 `filters` 这一层都是字符串（查询参数、比对候选都按字符串来）。
 */
export function toFilterSelection(state: Record<string, FilterValue | null>): ResourceListFilters {
  const selection: ResourceListFilters = {};
  for (const [key, values] of Object.entries(state)) {
    const selected = (values ?? []).map(String);
    if (selected.length > 0) selection[key] = selected;
  }
  return selection;
}

/**
 * 把「已经不在候选里」的选中值清掉。
 *
 * 只对声明了 `filterOptions` 的列动手：它的候选是**算出来的**，父列一变，先前在旧
 * 父级下选的那个值就落到候选之外，于是它在下拉里根本不存在（只剩漏斗上那个亮着的
 * 标记，想清掉得先想到「重置」再点「确定」），却仍然参与筛选 —— 拼出一个服务端
 * 忠实执行、返回空表的矛盾条件（`category=B & subCategory=X`），看着像「这个分类下
 * 一件商品都没有」。antd 自己指望不上：它只在某一列变更时拿**那一刻的**候选过滤一遍
 * 选中值，而那一刻候选还是旧的。
 *
 * # 判定用的是「这一轮全部已生效的选中值」，而链条可以有三层
 *
 * 商品列表页那三列是 `类型 → 一级分类 → 二级分类`：一次变更里被清掉的**上游**仍然以旧值
 * 出现在入参里。用户把类型改成项目时，一级分类 `cloud-native`（课程的分类）会被判出局，
 * 而二级分类的候选是在同一轮里按那个即将消失的 `cloud-native` 算的。这里**不跑第二遍**，
 * 因为那一步由候选自己的口径兜住了：认不出来 / 属于别的分支的父值一律**回退成该范围的
 * 全量**（见 `packages` 那两列的 `filterOptions`），于是「父值即将出局」与「父值已经不在」
 * 求出的是同一份候选，二级该出局的照样出局 —— 跑第二遍不会改变任何结果（穷举三列的全部
 * 取值组合验证过：两种实现逐项相同）。
 *
 * 反过来说，**「回退成非空」因此是承重的**，不是好看：派生候选若在父值认不出来时给空表，
 * 被清掉的上游就会让下游按旧父值蒙混过关，最终发出 `type=project & subCategory=k8s-dev`
 * 这种服务端忠实执行、返回空表的查询。要改那条回退口径时，这里就得先补上迭代到不动点。
 *
 * # 为什么在 `onChange` 里清，而不是渲染期派生一个「生效值」
 *
 * 派生不写回 state 的话会被**复活**：随后有人把父列清空，候选又变回全集，那个被
 * 剪掉的选中值会重新冒出来并再次参与筛选——一次没人做过的筛选动作。
 *
 * # 为什么整列清、而不是只删越界的那几个
 *
 * 单选的列不存在「部分越界」；多选的列只删越界项会在下拉里留下一个说不清的半勾
 * 状态（勾着的项彼此没什么关系）。候选全变了，这一列的选中值就整体作废。
 *
 * **没有变化时返回传入的那个对象**（同一引用）：`ResourcePage` 直接把它交给
 * `setFilterState`，引用不变就不会多渲染一轮、也不会多发一次请求。
 */
export function pruneFilterState<T>(
  state: Record<string, FilterValue | null>,
  columns: Pick<ProTableColumn<T>, 'key' | 'dataIndex' | 'filterOptions'>[]
): Record<string, FilterValue | null> {
  if (!columns.some(col => col.filterOptions)) return state;

  const selected = toFilterSelection(state);
  let next: Record<string, FilterValue | null> | null = null;

  for (const col of columns) {
    if (!col.filterOptions) continue;
    // 与 `ResourcePage` 的 extraCols 同一个表达式：列 key 缺省回落到 dataIndex。
    const key = String(col.key ?? col.dataIndex);
    const current = state[key];
    if (!current || current.length === 0) continue;

    const allowed = new Set(col.filterOptions(selected).map(item => String(item.value)));
    if (current.every(value => allowed.has(String(value)))) continue;

    next = { ...(next ?? state), [key]: null };
  }

  return next ?? state;
}
