import { agentClient, request } from './client';
import { AGENT } from './endpoints';
import type {
  MemorySearchHit,
  MemoryStats,
  MemorySubject,
  PlatformMemoryAudit,
  PlatformMemoryEntry,
} from './types';
import { decodeClaims } from '@/auth/claims';
import { getToken } from '@/auth/tokenStore';

/**
 * 记忆库条目的领域 API。
 *
 * 普通用户走 `/v1/user/memories/:memory/...`，服务端强制 subject = 当前登录
 * 用户；管理员走 `/v1/admin/agent/memories/:memory/...`，可以显式指定 subject。
 * 路由选择在这里收敛，页面不关心两种形状的差别。
 */

function isAdmin(): boolean {
  return decodeClaims(getToken())?.isAdmin === true;
}

function baseFor(memory: string): string {
  return isAdmin() ? AGENT.memoryAdminEntries(memory) : AGENT.memoryUserEntries(memory);
}

function itemFor(memory: string, id: string): string {
  return isAdmin() ? AGENT.memoryAdminEntry(memory, id) : AGENT.memoryUserEntry(memory, id);
}

function searchFor(memory: string): string {
  return isAdmin() ? AGENT.memoryAdminSearch(memory) : AGENT.memoryUserSearch(memory);
}

function batchDeleteFor(memory: string): string {
  return isAdmin() ? AGENT.memoryAdminBatchDelete(memory) : AGENT.memoryUserBatchDelete(memory);
}

function statsFor(memory: string): string {
  return isAdmin() ? AGENT.memoryAdminStats(memory) : AGENT.memoryUserStats(memory);
}

export interface MemoryEntryListParams {
  memory: string;
  agent?: string;
  subject?: string;
  type?: string;
  status?: string;
  source?: string;
  q?: string;
  sessionId?: string;
  runId?: string;
  tag?: string;
  offset?: number;
  limit?: number;
  sort?: string;
}

export interface MemoryEntryListResult {
  entries: PlatformMemoryEntry[];
  count: number;
}

export async function listMemoryEntries(
  params: MemoryEntryListParams
): Promise<MemoryEntryListResult> {
  const { memory, subject, ...rest } = params;
  return request<MemoryEntryListResult>(agentClient, {
    url: baseFor(memory),
    method: 'GET',
    params: isAdmin() ? { ...rest, subject } : rest,
  });
}

export async function createMemoryEntry(
  memory: string,
  entry: Partial<PlatformMemoryEntry>
): Promise<PlatformMemoryEntry> {
  const data = await request<{ entry: PlatformMemoryEntry }>(agentClient, {
    url: baseFor(memory),
    method: 'POST',
    data: { entry: { ...entry, memory } },
  });
  return data.entry;
}

export async function getMemoryEntry(
  memory: string,
  id: string,
  subject?: string
): Promise<PlatformMemoryEntry> {
  const data = await request<{ entry: PlatformMemoryEntry }>(agentClient, {
    url: itemFor(memory, id),
    method: 'GET',
    params: isAdmin() ? { subject } : undefined,
  });
  return data.entry;
}

export async function updateMemoryEntry(
  memory: string,
  id: string,
  entry: Partial<PlatformMemoryEntry>,
  subject?: string
): Promise<PlatformMemoryEntry> {
  const data = await request<{ entry: PlatformMemoryEntry }>(agentClient, {
    url: itemFor(memory, id),
    method: 'PATCH',
    data: isAdmin() ? { entry, subject } : { entry },
  });
  return data.entry;
}

export async function deleteMemoryEntry(
  memory: string,
  id: string,
  subject?: string
): Promise<void> {
  await request<unknown>(agentClient, {
    url: itemFor(memory, id),
    method: 'DELETE',
    params: isAdmin() ? { subject } : undefined,
  });
}

export async function batchDeleteMemoryEntries(
  memory: string,
  ids: string[],
  subject?: string
): Promise<void> {
  await request<unknown>(agentClient, {
    url: batchDeleteFor(memory),
    method: 'POST',
    data: isAdmin() ? { ids, subject } : { ids },
  });
}

export interface MemorySearchParams {
  memory: string;
  query: string;
  mode?: string;
  agent?: string;
  subject?: string;
  types?: string[];
  tags?: string[];
  topK?: number;
  minScore?: number;
  maxTokens?: number;
  explain?: boolean;
  persist?: boolean;
}

export interface MemorySearchResult {
  hits: MemorySearchHit[];
  vectorCandidates?: number;
  keywordCandidates?: number;
  tookMs?: number;
  tokenCount?: number;
  degraded?: boolean;
}

export async function searchMemoryEntries(params: MemorySearchParams): Promise<MemorySearchResult> {
  const { memory, ...body } = params;
  return request<MemorySearchResult>(agentClient, {
    url: searchFor(memory),
    method: 'POST',
    data: isAdmin() ? body : { ...body, subject: undefined },
  });
}

export async function getMemoryStats(memory: string, subject?: string): Promise<MemoryStats> {
  const data = await request<{ stats: MemoryStats }>(agentClient, {
    url: statsFor(memory),
    method: 'GET',
    params: isAdmin() ? { subject } : undefined,
  });
  return data.stats;
}

export async function listMemorySubjects(
  memory: string,
  params: { agent?: string; q?: string; offset?: number; limit?: number } = {}
): Promise<{ subjects: MemorySubject[]; count: number }> {
  return request<{ subjects: MemorySubject[]; count: number }>(agentClient, {
    url: AGENT.memoryAdminSubjects(memory),
    method: 'GET',
    params,
  });
}

export interface MemoryEvalCase {
  query: string;
  expectedIds: string[];
}

export interface MemoryEvalCaseResult {
  query?: string;
  precision?: number;
  recall?: number;
  mrr?: number;
  retrievedIds?: string[];
  missingIds?: string[];
}

export interface MemoryEvalResult {
  cases?: MemoryEvalCaseResult[];
  precision?: number;
  recall?: number;
  mrr?: number;
}

export async function evalMemory(
  memory: string,
  params: { cases: MemoryEvalCase[]; subject: string; agent?: string; topK?: number; mode?: string }
): Promise<MemoryEvalResult> {
  return request<MemoryEvalResult>(agentClient, {
    url: AGENT.memoryAdminEval(memory),
    method: 'POST',
    data: params,
  });
}

export interface ReembedResult {
  scanned?: number;
  updated?: number;
  failed?: number;
  remaining?: number;
}

export async function reembedMemory(
  memory: string,
  params: { dryRun?: boolean; limit?: number } = {}
): Promise<ReembedResult> {
  return request<ReembedResult>(agentClient, {
    url: AGENT.memoryAdminReembed(memory),
    method: 'POST',
    data: params,
  });
}

export async function listMemoryAudit(
  memory: string,
  params: { subject?: string; action?: string; offset?: number; limit?: number } = {}
): Promise<{ audits: PlatformMemoryAudit[]; count: number }> {
  return request<{ audits: PlatformMemoryAudit[]; count: number }>(agentClient, {
    url: AGENT.memoryAdminAudit(memory),
    method: 'GET',
    params,
  });
}

export async function purgeMemorySubject(memory: string, subject: string): Promise<number> {
  const data = await request<{ deleted: number }>(agentClient, {
    url: AGENT.memoryAdminPurge(memory, subject),
    method: 'DELETE',
  });
  return data.deleted;
}
