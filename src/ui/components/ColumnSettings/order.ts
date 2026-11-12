/**
 * 把「保存过的列顺序」与「当前列集合」对齐。
 *
 * 列集合会随页签/描述符变化（例如智能体页的 A2A 页签多出注册来源、协议、服务地址、
 * 技能）。直接丢掉用户排好的顺序会让切一次页签就重置，所以规则是：
 *
 * - 已有的键保持用户顺序，已消失的键丢弃；
 * - 新出现的键**插在它默认顺序里最近的邻居旁边**，而不是一律甩到表格末尾。A2A 页签
 *   新增的四列默认就挨着「类型 / 版本」，跟着邻居走才符合直觉；甩到末尾会让它们
 *   排在「更新时间」之后，看起来像漏排的。
 *
 * 返回的数组只含 `available` 里的键。
 */
export function mergeColumnOrder(saved: string[], available: string[]): string[] {
  const availableSet = new Set(available);
  const result = saved.filter(key => availableSet.has(key));
  const placed = new Set(result);

  available.forEach((key, defaultIndex) => {
    if (placed.has(key)) return;

    // 默认顺序里左侧最近的、已经排好序的邻居，插在它后面。
    let insertAt = -1;
    for (let i = defaultIndex - 1; i >= 0; i -= 1) {
      const position = result.indexOf(available[i] as string);
      if (position >= 0) {
        insertAt = position + 1;
        break;
      }
    }
    // 没有左邻居（新键默认在最前）时，退到右侧最近的邻居前面。
    if (insertAt < 0) {
      for (let i = defaultIndex + 1; i < available.length; i += 1) {
        const position = result.indexOf(available[i] as string);
        if (position >= 0) {
          insertAt = position;
          break;
        }
      }
    }
    // 两边都没有邻居（结果为空）就追加。
    if (insertAt < 0) insertAt = result.length;

    result.splice(insertAt, 0, key);
    placed.add(key);
  });

  return result;
}
