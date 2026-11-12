import type { SmartDraft } from './types';

/**
 * 「从模版创建智能体」的草案。
 *
 * 只声明对模版的引用，不复制模版的能力：控制器会把模版并入智能体的
 * `status.resolved`，改模版即可让所有引用方生效。把能力展开到草案里，它们就变成
 * 智能体自己的声明，模版后续修改不会再影响这个智能体。
 *
 * `model` 留空：模版的 `modelRef` 只在智能体自己没声明模型时兜底；草案里写死一个
 * 模型会永久压过模版。
 *
 * 名称沿用模版名：它本身已经是合法的资源名，用户仍可在表单里改。命名空间不放进
 * 草案——智能体表单不渲染该字段，创建时从页头的业务空间补齐，入口处会先把页头
 * 切到模版所在空间。
 */
export function buildDraftFromTemplate(template: Record<string, unknown>): SmartDraft {
  const name = String(template.name ?? '');
  return {
    name,
    displayName: String(template.displayName ?? '') || name,
    description: String(template.description ?? ''),
    model: '',
    status: 'enabled',
    prompts: [],
    knowledgeBases: [],
    mcps: [],
    skills: [],
    customCommands: [],
    templateRefs: [name],
    engine: 'template',
  };
}
