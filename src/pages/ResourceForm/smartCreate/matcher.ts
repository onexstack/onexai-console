import {
  SELECTION_KINDS,
  SELECTION_LIMITS,
  type SmartCandidate,
  type SmartCatalog,
  type SmartDraft,
  type SmartSelection,
  type SmartSelectionKind,
} from './types';

/**
 * 本地兜底匹配。
 *
 * 不是一个「假 AI」——它是可解释的检索：中文二元组 + ASCII 词 + 领域同义词，
 * 按字段权重与 IDF 打分，再把命中的词作为理由展示出来。模型不可用时它保证流程
 * 仍能走完；模型可用时它也只负责预筛候选与排序，最终选择仍由模型给出。
 */

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'with',
  'agent',
  'assistant',
  'create',
  'build',
  'make',
  'need',
  '一个',
  '一种',
  '以及',
  '进行',
  '使用',
  '用于',
  '通过',
  '可以',
  '能够',
  '需要',
  '支持',
  '完成',
  '实现',
  '帮我',
  '请',
  '创建',
  '新建',
  '智能体',
  '助手',
  '相关',
  '功能',
  '能力',
  '平台',
  '系统',
]);

/** 中文里高频、但不携带领域信息的单字：先删掉再做二元组。 */
const CJK_STOP_CHARS = /[的了和与及或我你他她它这那请问帮]/g;

/** 高频套话：整段删掉，避免「建一」「析助」这类跨词二元组污染打分。 */
const CJK_STOP_PHRASES =
  /(创建一个|新建一个|做一个|实现一个|智能体|助手|帮我|请问|需要|可以|能够|支持|使用|用于|通过|完成|实现|进行|一个|以及|还有|相关|功能|能力|平台|系统)/g;

/** 领域同义词：命中左边时把右边也加入查询词，扩大召回。 */
const SYNONYMS: Record<string, string[]> = {
  k8s: ['kubernetes', '容器', '集群'],
  kubernetes: ['k8s', '容器', '集群'],
  alert: ['告警', '报警', '监控'],
  告警: ['alert', '报警', '监控'],
  报警: ['告警', 'alert'],
  工单: ['ticket', '客服', '支持'],
  ticket: ['工单', '客服'],
  日志: ['log', 'logs', '排查'],
  log: ['日志', '排查'],
  logs: ['日志', '排查'],
  发布: ['deploy', 'deployment', '上线'],
  deploy: ['发布', '上线'],
  deployment: ['发布', 'deploy'],
  数据库: ['db', 'database', 'sql'],
  database: ['数据库', 'db', 'sql'],
  db: ['数据库', 'database'],
  sql: ['数据库', '查询'],
  文档: ['doc', 'docs', '知识库', '资料', '手册'],
  doc: ['文档', 'docs', '知识库'],
  docs: ['文档', 'doc', '知识库'],
  知识库: ['kb', '文档', '资料', '检索', 'rag'],
  kb: ['知识库', '文档', '检索'],
  rag: ['知识库', '检索', '向量'],
  代码: ['code', '研发', '评审'],
  code: ['代码', '研发', '评审'],
  值班: ['oncall', '排班', '轮值'],
  oncall: ['值班', '排班'],
  监控: ['monitor', 'metrics', 'prometheus', '告警'],
  monitor: ['监控', 'metrics'],
  metrics: ['监控', '指标'],
  报表: ['report', '统计', '周报'],
  report: ['报表', '统计', '周报'],
  周报: ['report', '报表'],
  检索: ['search', '查询', '知识库'],
  search: ['检索', '查询'],
};

function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

function cjkTokens(run: string): string[] {
  const cleaned = run.replace(CJK_STOP_CHARS, '');
  if (!cleaned) return [];
  if (cleaned.length === 1) return [cleaned];
  const out: string[] = [];
  for (let i = 0; i < cleaned.length - 1; i += 1) out.push(cleaned.slice(i, i + 2));
  return out;
}

/** 分词：ASCII 词按分隔符拆开，中文按二元组拆开。 */
export function tokenize(text: string): string[] {
  const normalized = normalize(text);
  const out: string[] = [];

  for (const raw of normalized.match(/[a-z0-9][a-z0-9._-]*/g) ?? []) {
    for (const part of raw.split(/[._-]+/)) {
      if (part && !STOPWORDS.has(part)) out.push(part);
    }
  }
  for (const run of normalized.match(/[一-鿿]+/g) ?? []) {
    // A phrase is removed with a separator so the bigrams on either side do not
    // span it ("创建一个告警" must not produce "建一"/"个告").
    const cleaned = run.replace(CJK_STOP_PHRASES, ' ');
    for (const segment of cleaned.split(/\s+/)) {
      for (const token of cjkTokens(segment)) {
        if (!STOPWORDS.has(token)) out.push(token);
      }
    }
  }
  return out;
}

/** 查询词：目标的分词 + 命中的同义词展开。 */
function queryTokens(goal: string): Set<string> {
  const normalized = normalize(goal);
  const tokens = new Set(tokenize(goal));

  for (const [term, synonyms] of Object.entries(SYNONYMS)) {
    if (!normalized.includes(term)) continue;
    for (const token of tokenize(term)) tokens.add(token);
    for (const synonym of synonyms) {
      for (const token of tokenize(synonym)) tokens.add(token);
    }
  }
  return tokens;
}

interface WeightedText {
  text: string;
  weight: number;
  label: string;
}

function fieldsOf(candidate: SmartCandidate): WeightedText[] {
  return [
    { text: candidate.name, weight: 4, label: '名称' },
    { text: candidate.displayName, weight: 5, label: '显示名' },
    { text: candidate.description, weight: 2, label: '描述' },
    { text: candidate.labelsText, weight: 2, label: '标签' },
    { text: `${candidate.detail} ${candidate.extra}`, weight: 1.5, label: '类型信息' },
  ];
}

interface Scored extends SmartCandidate {
  score: number;
  reasons: string[];
}

function allCandidates(catalog: SmartCatalog): SmartCandidate[] {
  return [
    ...catalog.knowledgeBases,
    ...catalog.mcps,
    ...catalog.skills,
    ...catalog.customCommands,
    ...catalog.models,
  ];
}

/** 文档频率：跨全部候选统计一个词出现在多少个候选里，用来压低「服务」这类泛词。 */
function documentFrequency(candidates: SmartCandidate[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const candidate of candidates) {
    const seen = new Set<string>();
    for (const field of fieldsOf(candidate)) {
      for (const token of tokenize(field.text)) seen.add(token);
    }
    for (const token of seen) df.set(token, (df.get(token) ?? 0) + 1);
  }
  return df;
}

function scoreCandidate(
  candidate: SmartCandidate,
  query: Set<string>,
  goalText: string,
  df: Map<string, number>,
  total: number,
  preferredNamespace: string
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const seenReason = new Set<string>();

  for (const field of fieldsOf(candidate)) {
    const fieldTokens = new Set(tokenize(field.text));
    for (const token of query) {
      if (!fieldTokens.has(token)) continue;
      const idf = Math.log(1 + total / (1 + (df.get(token) ?? 0)));
      score += idf * field.weight;
      if (reasons.length < 3 && !seenReason.has(token)) {
        seenReason.add(token);
        reasons.push(`匹配「${token}」（${field.label}）`);
      }
    }
  }

  // 名称/显示名整串出现在目标里：比零散词命中强得多。
  const display = normalize(candidate.displayName);
  const name = normalize(candidate.name);
  if (display.length >= 2 && goalText.includes(display)) {
    score += 6;
    reasons.unshift(`命中显示名「${candidate.displayName}」`);
  } else if (name.length >= 2 && goalText.includes(name)) {
    score += 4;
    reasons.unshift(`命中名称「${candidate.name}」`);
  }

  if (candidate.namespace && candidate.namespace === preferredNamespace) {
    score += 0.5;
    if (reasons.length < 3) reasons.push('同命名空间');
  }

  return { score, reasons: reasons.slice(0, 3) };
}

/** 给整个目录打分并按分数排序；返回新的对象，不修改入参。 */
export function rankCatalog(
  goal: string,
  catalog: SmartCatalog,
  preferredNamespace: string
): SmartCatalog {
  const query = queryTokens(goal);
  const goalText = normalize(goal);
  const all = allCandidates(catalog);
  const df = documentFrequency(all);
  const total = Math.max(all.length, 1);

  const rank = (list: SmartCandidate[]): Scored[] =>
    list
      .map(candidate => ({
        ...candidate,
        ...scoreCandidate(candidate, query, goalText, df, total, preferredNamespace),
      }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return {
    knowledgeBases: rank(catalog.knowledgeBases),
    mcps: rank(catalog.mcps),
    skills: rank(catalog.skills),
    customCommands: rank(catalog.customCommands),
    models: rank(catalog.models),
  };
}

function pickSelections(
  candidates: SmartCandidate[],
  limit: number,
  threshold: number
): SmartSelection[] {
  return candidates
    .filter(candidate => (candidate.score ?? 0) >= threshold)
    .slice(0, limit)
    .map(candidate => ({
      name: candidate.name,
      reason: (candidate.reasons ?? []).join('；') || '与目标相关',
    }));
}

function slugify(text: string): string {
  return normalize(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
}

/** 生成一个 DNS-1123 兼容、且不与现有智能体重名的名称。 */
export function suggestName(goal: string, existing: Set<string>): string {
  const words = tokenize(goal)
    .filter(token => /^[a-z0-9]+$/.test(token) && token.length > 1)
    .slice(0, 3);
  let base = slugify(words.join('-')) || 'agent';
  // 一个词的目标（例如只有 "k8s"）不足以说明角色，补一个后缀；
  // 这也是本地兜底里最常见的形态。
  if (words.length < 2 && !base.endsWith('-assistant')) base = `${base}-assistant`;
  if (!/^[a-z0-9]/.test(base)) base = `agent-${base}`;
  if (!/[a-z0-9]$/.test(base)) base = `${base}-agent`;

  let candidate = base;
  for (let index = 2; existing.has(candidate) && index <= 20; index += 1) {
    candidate = `${base}-${index}`;
  }
  if (existing.has(candidate)) {
    candidate = `${base}-${Date.now().toString(36).slice(-4)}`;
  }
  return candidate;
}

/** 从目标里提取一个可读的显示名；不做花哨的 NLP，宁可朴素但稳定。 */
export function suggestDisplayName(goal: string, catalog: SmartCatalog): string {
  const explicit = goal.match(/(?:叫|名为|叫做)\s*[「“"]?([^，。,\s」”"]{1,20})/);
  if (explicit?.[1]) return explicit[1].trim();

  const clause = goal
    .split(/[，。；,.;\n]/)[0]
    ?.trim()
    .replace(
      /^(帮我|请|我想|我需要|需要|创建一个|创建|新建一个|新建|做一个|做|实现一个|实现)\s*/,
      ''
    )
    .trim();

  if (clause && clause.length <= 20) {
    return /(助手|智能体|专家|机器人)$/.test(clause) ? clause : `${clause}助手`;
  }

  const top = [
    ...catalog.knowledgeBases,
    ...catalog.mcps,
    ...catalog.skills,
    ...catalog.customCommands,
  ].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  if (top?.displayName) return `${top.displayName}助手`.slice(0, 20);
  return '智能助手';
}

/** 生成一个完整的本地草案。 */
export function buildLocalDraft(
  goal: string,
  catalog: SmartCatalog,
  existingAgentNames: Set<string>,
  preferredNamespace: string
): SmartDraft {
  const ranked = rankCatalog(goal, catalog, preferredNamespace);
  const limitOf = (kind: SmartSelectionKind) => SELECTION_LIMITS[kind];

  const selections = {} as Record<SmartSelectionKind, SmartSelection[]>;
  // 阈值相对「全部能力里的最高分」，而不是每类各自的最高分：一个只在描述里
  // 蹭到「kubernetes」的命令不该因为它是本类第一就被自动选中。
  const globalTop = Math.max(0, ...SELECTION_KINDS.map(kind => ranked[kind][0]?.score ?? 0));
  const threshold = Math.max(1, globalTop * 0.35);
  for (const kind of SELECTION_KINDS) {
    selections[kind] = pickSelections(ranked[kind], limitOf(kind), threshold);
  }

  const topModel = ranked.models[0];
  const model = topModel && (topModel.score ?? 0) > 0 ? topModel.name : '';

  return {
    name: suggestName(goal, existingAgentNames),
    displayName: suggestDisplayName(goal, ranked),
    description: `根据「${goal.trim().slice(0, 120)}」创建，已自动匹配可用能力。`,
    model,
    status: 'enabled',
    knowledgeBases: selections.knowledgeBases,
    mcps: selections.mcps,
    skills: selections.skills,
    customCommands: selections.customCommands,
    engine: 'local',
  };
}
