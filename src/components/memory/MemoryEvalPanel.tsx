import { useMemo, useState } from 'react';
import { Alert, App, Button, Card, Col, Input, InputNumber, Row, Select, Space, Statistic, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation } from '@tanstack/react-query';

import { evalMemory, type MemoryEvalCase, type MemoryEvalCaseResult } from '@/api/memory';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';

const EMPTY_CASES = `[
  {
    "query": "数据库选型偏好",
    "expectedIds": ["在这里填记忆条目 ID"]
  }
]`;

export default function MemoryEvalPanel({
  memory,
  sessionScoped = false,
}: {
  memory: string;
  sessionScoped?: boolean;
}) {
  const token = useSessionToken();
  const admin = useMemo(() => decodeClaims(token)?.isAdmin === true, [token]);
  const { message } = App.useApp();
  const [subject, setSubject] = useState('');
  const [agent, setAgent] = useState('');
  const [topK, setTopK] = useState(8);
  const [mode, setMode] = useState('hybrid');
  const [casesText, setCasesText] = useState(EMPTY_CASES);

  const run = useMutation({
    mutationFn: async () => {
      let cases: MemoryEvalCase[];
      try {
        const parsed: unknown = JSON.parse(casesText);
        if (!Array.isArray(parsed)) throw new Error('用例必须是 JSON 数组');
        cases = parsed.map(item => {
          const row = item as { query?: unknown; expectedIds?: unknown };
          const query = String(row.query ?? '').trim();
          if (!query) throw new Error('每条用例都需要 query');
          const expectedIds = Array.isArray(row.expectedIds) ? row.expectedIds.map(String) : [];
          return { query, expectedIds };
        });
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : '用例 JSON 解析失败');
      }
      if (!subject.trim()) throw new Error(sessionScoped ? '请填写会话 ID' : '请填写 Subject');
      return evalMemory(memory, {
        cases,
        subject: subject.trim(),
        agent: agent.trim() || undefined,
        topK,
        mode,
      });
    },
    onError: err => message.error(err instanceof Error ? err.message : '评测失败'),
  });

  if (!admin) {
    return <Alert type="warning" showIcon message="评测只对管理员开放。" />;
  }

  const columns: ColumnsType<MemoryEvalCaseResult> = [
    { title: '查询', dataIndex: 'query', ellipsis: true },
    {
      title: 'Precision',
      dataIndex: 'precision',
      width: 110,
      render: value => Number(value ?? 0).toFixed(3),
    },
    {
      title: 'Recall',
      dataIndex: 'recall',
      width: 100,
      render: value => Number(value ?? 0).toFixed(3),
    },
    {
      title: 'MRR',
      dataIndex: 'mrr',
      width: 90,
      render: value => Number(value ?? 0).toFixed(3),
    },
    {
      title: '命中 / 缺失',
      width: 200,
      render: (_, row) => (
        <span>
          {(row.retrievedIds ?? []).length} / {(row.missingIds ?? []).length}
        </span>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="用固定查询与期望记忆 ID 评估检索质量。条目 ID 可在「记忆条目」页签的详情抽屉里复制。"
      />
      <Card size="small">
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space wrap>
            <Input
              style={{ width: 240 }}
              placeholder={sessionScoped ? '会话 ID' : 'Subject'}
              value={subject}
              onChange={event => setSubject(event.target.value)}
            />
            <Input
              style={{ width: 180 }}
              placeholder="Agent（可选）"
              value={agent}
              onChange={event => setAgent(event.target.value)}
            />
            <InputNumber
              min={1}
              max={50}
              value={topK}
              onChange={value => setTopK(Number(value ?? 8))}
              addonBefore="TopK"
            />
            <Select
              style={{ width: 110 }}
              value={mode}
              onChange={setMode}
              options={[
                { label: '混合', value: 'hybrid' },
                { label: '向量', value: 'vector' },
                { label: '关键字', value: 'keyword' },
              ]}
            />
            <Button type="primary" loading={run.isPending} onClick={() => run.mutate()}>
              运行评测
            </Button>
          </Space>
          <Input.TextArea
            rows={10}
            value={casesText}
            onChange={event => setCasesText(event.target.value)}
            style={{ fontFamily: 'monospace' }}
          />
        </Space>
      </Card>

      {run.data && (
        <>
          <Row gutter={16}>
            <Col span={8}>
              <Card size="small">
                <Statistic title="平均 Precision" value={run.data.precision ?? 0} precision={3} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="平均 Recall" value={run.data.recall ?? 0} precision={3} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="平均 MRR" value={run.data.mrr ?? 0} precision={3} />
              </Card>
            </Col>
          </Row>
          <Table<MemoryEvalCaseResult>
            rowKey={(row, index) => `${row.query ?? 'case'}-${index}`}
            size="small"
            columns={columns}
            dataSource={run.data.cases ?? []}
            pagination={false}
          />
        </>
      )}
    </Space>
  );
}
