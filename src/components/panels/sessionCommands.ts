import type {
  ChatCommand,
  CommandParameter,
  ContextCustomCommand,
  ContextSkill,
  EffectiveAgent,
} from '@/api/types';

/**
 * 会话命令的合并规则。
 *
 * 智能体详情页的「会话命令」页签只回答一个问题：这个智能体在聊天会话里
 * 到底能输入哪些 `/命令`。权威来源是控制器解析出的生效能力：
 *
 *   - `/effective` 的 `capabilities.commands`：能力编排 spec.commands 授予的
 *     聊天目录命令，条目可能是内置命令名，也可能是 `skill:<技能名>`。
 *   - `/effective` 的 `capabilities.customCommands`：绑定 spec.customCommands
 *     授予的自定义命令。
 *
 * `context-skills` 只是技能候选集（技能仓库里 asCmd=Yes 的项），并不代表已被
 * 授予；`context-commands` 是自定义命令的实时可用集。两者只用来补说明信息，
 * 不能替代上面的授予判断。
 *
 * 重名优先级与聊天端一致：内置 → 技能 → 自定义，后出现的同名命令不会注册
 * （见 internal/chat/pkg/command/custom.go）。别名冲突暂不处理，聊天端会丢弃
 * 与其它命令/别名冲突的别名，这里保留展示。
 */

export const SKILL_COMMAND_PREFIX = 'skill:';

export type CommandSource = 'builtin' | 'skill' | 'custom';

/** 主表一行：当前会话里真的可以输入 /name 调用的命令。 */
export interface SessionCommandRow {
  key: string;
  /** 真正输入的名字；技能命令已去掉 `skill:` 前缀。 */
  name: string;
  source: CommandSource;
  description?: string;
  usage?: string;
  aliases?: string[];
  parameters?: CommandParameter[];
  group?: string;
  /** 技能来源的补充信息。 */
  repo?: string;
  provider?: string;
  /** enrichment 缺失时的降级说明。 */
  note?: string;
}

/** 次要表一行：已授予但当前不可调用，或不会注册。 */
export interface UnavailableCommandRow {
  key: string;
  /** 绑定里的原始授权项，例如 `skill:docs` 或自定义命令名。 */
  grant: string;
  name: string;
  source: CommandSource;
  reason: string;
  detail: string;
}

export interface BuildSessionCommandsInput {
  capabilities?: EffectiveAgent['capabilities'];
  /**
   * `undefined` 表示目录不可用（加载中或读取失败），`[]` 表示已成功读取但为空。
   * 两者必须区分：前者只能降级展示名称，后者才能判定「未收录 / 未加载」。
   */
  chatCommands?: readonly ChatCommand[];
  contextSkills?: readonly ContextSkill[];
  contextCommands?: readonly ContextCustomCommand[];
}

export interface SessionCommands {
  callable: SessionCommandRow[];
  unavailable: UnavailableCommandRow[];
}

const SOURCE_ORDER: Record<CommandSource, number> = {
  builtin: 0,
  skill: 1,
  custom: 2,
};

const DUPLICATE_DETAIL = '同一会话里命令名必须唯一；内置/技能优先，后出现的这条会被聊天端丢弃。';

export function buildSessionCommands({
  capabilities,
  chatCommands,
  contextSkills,
  contextCommands,
}: BuildSessionCommandsInput): SessionCommands {
  const callable: SessionCommandRow[] = [];
  const unavailable: UnavailableCommandRow[] = [];
  const taken = new Set<string>();
  let sequence = 0;

  const chatByName = new Map((chatCommands ?? []).map(item => [item.name, item]));
  const skillByName = new Map((contextSkills ?? []).map(item => [item.name, item]));
  const customByName = new Map((contextCommands ?? []).map(item => [item.name, item]));

  const addUnavailable = (row: Omit<UnavailableCommandRow, 'key'>) => {
    unavailable.push({
      ...row,
      key: `unavailable:${row.source}:${row.grant || row.name}:${sequence++}`,
    });
  };

  /** 占住一个命令名；已被占用时记录原因并返回 false。 */
  const claim = (name: string, grant: string, source: CommandSource): boolean => {
    if (taken.has(name)) {
      addUnavailable({
        grant,
        name,
        source,
        reason: '与已有命令重名，不会注册',
        detail: DUPLICATE_DETAIL,
      });
      return false;
    }
    taken.add(name);
    return true;
  };

  const rawCommands = capabilities?.commands ?? [];
  const builtinGrants = rawCommands.filter(name => !name.startsWith(SKILL_COMMAND_PREFIX));
  const skillGrants = rawCommands
    .filter(name => name.startsWith(SKILL_COMMAND_PREFIX))
    .map(grant => ({ grant, name: grant.slice(SKILL_COMMAND_PREFIX.length) }));

  // ── 内置命令 ──────────────────────────────────────────────────────────────
  for (const name of builtinGrants) {
    if (!name) {
      addUnavailable({
        grant: name,
        name,
        source: 'builtin',
        reason: '命令名为空',
        detail: '能力编排的 spec.commands 里有无法解析的条目。',
      });
      continue;
    }
    if (!claim(name, name, 'builtin')) continue;

    // chatCommands 为 undefined 时目录不可用，只能降级展示名称。
    const meta = chatByName.get(name);
    if (chatCommands !== undefined) {
      if (!meta) {
        addUnavailable({
          grant: name,
          name,
          source: 'builtin',
          reason: '命令目录中未收录',
          detail: '检查命令名拼写，或该命令是否已从当前部署中移除。',
        });
        continue;
      }
      if (meta.enabled === false) {
        addUnavailable({
          grant: name,
          name,
          source: 'builtin',
          reason: '命令目录中已停用',
          detail: '聊天端不会注册停用的内置命令。',
        });
        continue;
      }
    }

    callable.push({
      key: `builtin:${name}`,
      name,
      source: 'builtin',
      description: meta?.description,
      usage: meta?.usage,
      aliases: meta?.aliases,
      group: meta?.group,
      note: chatCommands === undefined ? '命令目录暂不可用，无法确认命令详情' : undefined,
    });
  }

  // ── 技能命令 ──────────────────────────────────────────────────────────────
  for (const { grant, name } of skillGrants) {
    if (!name) {
      addUnavailable({
        grant,
        name: grant,
        source: 'skill',
        reason: '命令名为空',
        detail: '绑定里写了 `skill:` 但没有跟技能名。',
      });
      continue;
    }
    if (!claim(name, grant, 'skill')) continue;

    // contextSkills 为 undefined 时无法判断技能是否加载，降级展示名称。
    const meta = skillByName.get(name);
    if (meta) {
      callable.push({
        key: `skill:${name}`,
        name,
        source: 'skill',
        description: meta.description,
        repo: meta.repo,
        provider: meta.provider,
      });
    } else if (contextSkills !== undefined) {
      addUnavailable({
        grant,
        name,
        source: 'skill',
        reason: '已授予但未加载',
        detail:
          '技能仓库里没有这个名字的可命令技能：检查是否同命名空间、是否勾选「作为命令（asCmd=Yes）」、提供方参数与远程文档是否可用。',
      });
    } else {
      callable.push({
        key: `skill:${name}`,
        name,
        source: 'skill',
        note: '技能目录暂不可用，无法确认是否已加载',
      });
    }
  }

  // ── 自定义命令 ────────────────────────────────────────────────────────────
  const seenCustom = new Set<string>();
  for (const name of capabilities?.customCommands ?? []) {
    if (!name || seenCustom.has(name)) {
      if (name) {
        addUnavailable({
          grant: name,
          name,
          source: 'custom',
          reason: '与已有命令重名，不会注册',
          detail: '同一条 customCommands 列表里重复授予了同一个名字。',
        });
      }
      continue;
    }
    seenCustom.add(name);
    if (!claim(name, name, 'custom')) continue;

    const meta = customByName.get(name);
    if (meta) {
      callable.push({
        key: `custom:${name}`,
        name,
        source: 'custom',
        usage: meta.usage,
        aliases: meta.aliases,
        parameters: meta.parameters,
      });
    } else if (contextCommands !== undefined) {
      addUnavailable({
        grant: name,
        name,
        source: 'custom',
        reason: '已授予但当前不可用',
        detail: '命令可能已停用、已删除，或与智能体不在同一命名空间。',
      });
    } else {
      callable.push({
        key: `custom:${name}`,
        name,
        source: 'custom',
        note: '自定义命令目录暂不可用，无法确认是否可用',
      });
    }
  }

  callable.sort(
    (a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || a.name.localeCompare(b.name)
  );
  unavailable.sort(
    (a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || a.name.localeCompare(b.name)
  );

  return { callable, unavailable };
}
