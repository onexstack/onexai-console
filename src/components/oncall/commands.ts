/**
 * 值班组详情页的命令入口。
 *
 * 控制台页面与 Lark / 命令台执行的是同一套 slash 命令；这里只负责把当前值班组
 * 代入命令模板，不在前端重复实现业务逻辑。写命令带 `<...>` 占位符，由用户替换后再执行。
 */
export type DutyCommandCategory = '查询' | '排班' | '代班' | '不可用与节假日' | '升级';

export interface DutyCommandEntry {
  key: string;
  category: DutyCommandCategory;
  label: string;
  description: string;
  command: string;
  /** 写命令需要管理员权限，非管理员不展示。 */
  adminOnly?: boolean;
}

export interface BuildDutyCommandsOptions {
  group: string;
  timezone?: string;
}

/** 生成值班组详情页展示的命令列表。 */
export function buildDutyCommands({ group, timezone }: BuildDutyCommandsOptions): DutyCommandEntry[] {
  const zone = timezone || 'Asia/Shanghai';
  const nowHint = `按 ${zone} 时区`;
  return [
    {
      key: 'current',
      category: '查询',
      label: '查询当前值班',
      description: '当前值班人、备值班、图层、是否代班与交接时间',
      command: `/duty current ${group}`,
    },
    {
      key: 'duty',
      category: '查询',
      label: '当前值班（简洁）',
      description: '只列出当前值班组的主值班与备值班',
      command: `/duty ${group}`,
    },
    {
      key: 'timeline',
      category: '排班',
      label: '查看排班时间线',
      description: '未来 7 天的生效时间线（含代班与不可用）',
      command: `/duty timeline ${group} --days 7`,
    },
    {
      key: 'timeline-layers',
      category: '排班',
      label: '查看分层时间线',
      description: '按轮转图层分别查看时间线',
      command: `/duty timeline ${group} --days 7 --layer`,
    },
    {
      key: 'schedule',
      category: '排班',
      label: '查看排班定义',
      description: '时区、图层、轮转类型与参与者',
      command: `/duty schedule ${group}`,
    },
    {
      key: 'schedule-set',
      category: '排班',
      label: '保存排班定义',
      description: '替换图层定义；请先替换 <...> 占位符',
      adminOnly: true,
      command: `/duty schedule set ${group} --timezone ${zone} --layer "name=Primary,rotation=weekly,start=<开始时间>,shift=604800,users=<用户1>|<用户2>"`,
    },
    {
      key: 'override',
      category: '代班',
      label: '查看代班',
      description: '当前所有 Override',
      command: `/duty override ${group}`,
    },
    {
      key: 'override-add',
      category: '代班',
      label: '新增代班',
      description: `时间使用 RFC3339 或 YYYY-MM-DD（${nowHint}）`,
      adminOnly: true,
      command: `/duty override add ${group} --user <代班人> --start <开始时间> --end <结束时间>`,
    },
    {
      key: 'override-rm',
      category: '代班',
      label: '删除代班',
      description: '从「查看代班」的列表里取 ID',
      adminOnly: true,
      command: `/duty override rm ${group} --id <代班ID>`,
    },
    {
      key: 'unavailable',
      category: '不可用与节假日',
      label: '查看不可用',
      description: '当前所有不可用记录',
      command: `/duty unavailable ${group}`,
    },
    {
      key: 'unavailable-add',
      category: '不可用与节假日',
      label: '标记不可用',
      description: '日期使用 YYYY-MM-DD',
      adminOnly: true,
      command: `/duty unavailable add ${group} --user <值班人> --start-date <开始日期> --end-date <结束日期> --reason <原因>`,
    },
    {
      key: 'unavailable-rm',
      category: '不可用与节假日',
      label: '删除不可用',
      description: '从「查看不可用」的列表里取 ID',
      adminOnly: true,
      command: `/duty unavailable rm ${group} --id <记录ID>`,
    },
    {
      key: 'holiday',
      category: '不可用与节假日',
      label: '查看节假日',
      description: '当前所有节假日标记',
      command: `/duty holiday ${group}`,
    },
    {
      key: 'holiday-add',
      category: '不可用与节假日',
      label: '添加节假日',
      description: '日期使用 YYYY-MM-DD',
      adminOnly: true,
      command: `/duty holiday add ${group} --date <日期> --name <节假日名称>`,
    },
    {
      key: 'holiday-rm',
      category: '不可用与节假日',
      label: '删除节假日',
      description: '从「查看节假日」的列表里取 ID',
      adminOnly: true,
      command: `/duty holiday rm ${group} --id <节假日ID>`,
    },
    {
      key: 'escalation',
      category: '升级',
      label: '查看升级策略',
      description: '启用状态、自动升级级别与层级',
      command: `/duty escalation ${group}`,
    },
    {
      key: 'escalation-set',
      category: '升级',
      label: '保存升级策略',
      description: '替换层级定义；target 可为 schedule/users/both',
      adminOnly: true,
      command: `/duty escalation set ${group} --enabled --auto --from-level 2 --tier "timeout=300,target=schedule,group=<目标组>"`,
    },
    {
      key: 'escalation-trigger',
      category: '升级',
      label: '手动升级工单',
      description: '立即向策略指定人员发送升级通知',
      adminOnly: true,
      command: `/duty escalation trigger ${group} --ticket <工单ID>`,
    },
  ];
}

/** 按页面展示顺序分组。 */
export function groupDutyCommands(entries: DutyCommandEntry[]): Array<{
  category: DutyCommandCategory;
  entries: DutyCommandEntry[];
}> {
  const order: DutyCommandCategory[] = ['查询', '排班', '代班', '不可用与节假日', '升级'];
  return order
    .map(category => ({ category, entries: entries.filter(entry => entry.category === category) }))
    .filter(group => group.entries.length > 0);
}
