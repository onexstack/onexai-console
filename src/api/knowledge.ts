import { agentClient, request } from './client';
import { AGENT } from './endpoints';
import type { KnowledgeRetrievalTestInput, KnowledgeRetrievalTestResult } from './types';

/**
 * 知识库的召回测试。
 *
 * 它只读：后端按记录的平台配置跑一次检索，不写审计、不落库。超时给到 60s，
 * 留出后端 `agent.ragflow.timeout`（默认 30s）的余量，免得客户端先断开而把
 * 一个平台超时显示成网络故障。
 */
export async function testKnowledgeBaseRetrieval(
  name: string,
  input: KnowledgeRetrievalTestInput
): Promise<KnowledgeRetrievalTestResult> {
  return request<KnowledgeRetrievalTestResult>(agentClient, {
    url: AGENT.knowledgeBaseRetrievalTest(name),
    method: 'POST',
    data: input,
    timeout: 60_000,
  });
}
