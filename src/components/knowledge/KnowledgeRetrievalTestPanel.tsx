import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Col,
  Descriptions,
  Empty,
  Input,
  InputNumber,
  Row,
  Slider,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';

import { useIsMobile } from '@/ui';
import { testKnowledgeBaseRetrieval } from '@/api/knowledge';
import type {
  KnowledgeRetrievalHit,
  KnowledgeRetrievalTestInput,
  KnowledgeRetrievalTestResult,
} from '@/api/types';

const { Paragraph, Text } = Typography;

/** 记录里与召回测试相关的字段；记录本身来自通用详情页，是弱类型。 */
export interface KnowledgeBaseRetrievalSubject {
  platform?: string;
  topK?: number;
  scoreThreshold?: number;
}

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 50;

/**
 * 知识库召回测试。
 *
 * 只对 RAGFlow 记录开放：参数直接映射到 RAGFlow 的检索请求，而 Dify 的检索
 * 模型没有这些旋钮。这里严格按 `platform === 'ragflow'` 判断，空值不放行——
 * 服务端 `InferPlatform` 同样把空值解析成 Dify，两边对同一份记录给出相同结论。
 *
 * 请求只在按下「检索」时发出：拖动滑块不应该产生一次昂贵的平台调用。
 * 阈值和 Dense Weight 填 0 表示不覆盖，交由记录 / 部署配置决定，因此为 0 时
 * 不发送该字段，避免把记录或部署里的值悄悄改成平台默认值。
 */
export default function KnowledgeRetrievalTestPanel({
  name,
  knowledgeBase,
}: {
  name: string;
  knowledgeBase: KnowledgeBaseRetrievalSubject;
}) {
  // 默认值与运行时一致：RAGFlow 的检索会优先用记录自己的 topK 和
  // scoreThreshold，记录没设时才退回部署配置。初值直接取记录值，操作者一眼
  // 看到的就是智能体实际会用的参数；记录里的阈值设得过高时（例如 1），第一次
  // 检索就会如实返回 0 条。
  const defaultTopK =
    typeof knowledgeBase.topK === 'number' && knowledgeBase.topK > 0
      ? knowledgeBase.topK
      : DEFAULT_TOP_K;
  const defaultThreshold =
    typeof knowledgeBase.scoreThreshold === 'number' && knowledgeBase.scoreThreshold > 0
      ? knowledgeBase.scoreThreshold
      : 0;

  const [topK, setTopK] = useState(defaultTopK);
  const [threshold, setThreshold] = useState(defaultThreshold);
  const [denseWeight, setDenseWeight] = useState(0);
  const [rerank, setRerank] = useState(false);
  const [keyword, setKeyword] = useState(false);
  const [query, setQuery] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  // 与下方 Col 的 lg 断点一致：窄屏把检索框排在参数前面，先给主操作。
  const stacked = useIsMobile('lg');

  const run = useMutation<KnowledgeRetrievalTestResult, Error, KnowledgeRetrievalTestInput>({
    mutationFn: input => testKnowledgeBaseRetrieval(name, input),
  });

  const supported = knowledgeBase.platform === 'ragflow';

  const submit = () => {
    const question = query.trim();
    if (!supported || !question || run.isPending) return;
    setLastQuery(question);
    run.mutate({
      query: question,
      topK,
      // 0 表示不覆盖，交给记录 / 部署配置；后端把 nil 解析成记录值，再退回部署值。
      scoreThreshold: threshold > 0 ? threshold : undefined,
      vectorSimilarityWeight: denseWeight > 0 ? denseWeight : undefined,
      rerank,
      keyword,
    });
  };

  const reset = () => {
    setTopK(defaultTopK);
    setThreshold(defaultThreshold);
    setDenseWeight(0);
    setRerank(false);
    setKeyword(false);
    run.reset();
  };

  if (!supported) {
    return (
      <Alert
        type="info"
        showIcon
        message="召回测试目前仅支持 RAGFlow 知识库"
        description="这个知识库的平台不是 RAGFlow，召回参数的语义与 Dify 的检索模型并不相同，因此没有提供测试入口。"
      />
    );
  }

  const result = run.data;
  const ok = result?.ok === true;
  const hits = result?.hits ?? [];

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={8} xl={7} style={stacked ? { order: 2 } : undefined}>
        <Card size="small" title="检索参数">
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Param
              label="结果返回数量"
              hint="本次检索最多返回多少条切片。"
              value={topK}
              onChange={setTopK}
              min={1}
              max={MAX_TOP_K}
              step={1}
              precision={0}
              disabled={run.isPending}
            />
            <Param
              label="相似度阈值"
              hint="低于该分数的切片会被丢弃；0 表示由记录 / 部署 / 平台决定。"
              value={threshold}
              onChange={setThreshold}
              min={0}
              max={1}
              step={0.01}
              precision={2}
              disabled={run.isPending}
            />

            <SwitchRow
              label="重排模型"
              hint="使用部署配置 agent.ragflow.rerank-id 指定的重排模型。"
              checked={rerank}
              onChange={setRerank}
              disabled={run.isPending}
            />
            <SwitchRow
              label="关键词扩展"
              hint="让 RAGFlow 额外抽取关键词参与检索，平台侧多一次模型调用。"
              checked={keyword}
              onChange={setKeyword}
              disabled={run.isPending}
            />

            <Collapse
              size="small"
              items={[
                {
                  key: 'more',
                  label: '更多参数',
                  children: (
                    <Param
                      label="Dense Weight"
                      hint="向量相似度与词相似度的权重；0 表示由部署 / 平台决定。"
                      value={denseWeight}
                      onChange={setDenseWeight}
                      min={0}
                      max={1}
                      step={0.01}
                      precision={2}
                      disabled={run.isPending}
                    />
                  ),
                },
              ]}
            />

            <Button block onClick={reset} disabled={run.isPending}>
              重置参数
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              阈值与 Dense Weight 填 0 时交由记录 / 部署配置决定；检索结果会回显本次实际生效值。
            </Text>
          </Space>
        </Card>
      </Col>

      <Col xs={24} lg={16} xl={17} style={stacked ? { order: 1 } : undefined}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card size="small">
            <Input.Search
              size="large"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="输入想要检索的内容"
              enterButton={
                <Button type="primary" icon={<SearchOutlined />}>
                  检索
                </Button>
              }
              loading={run.isPending}
              disabled={run.isPending}
              allowClear
              onSearch={submit}
            />
          </Card>

          {run.isError && (
            <Alert
              type="error"
              showIcon
              message="召回测试失败"
              description={run.error.message}
            />
          )}

          {run.isPending && <Card size="small" loading />}

          {!run.isPending && result && !ok && (
            <Alert
              type="warning"
              showIcon
              message="检索没有跑通"
              description={result.message || '检索平台没有返回可用结果，请检查平台配置。'}
            />
          )}

          {!run.isPending && result && ok && (
            <Card size="small">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }}>
                  <Descriptions.Item label="问题">{lastQuery}</Descriptions.Item>
                  <Descriptions.Item label="命中">{hits.length} 条</Descriptions.Item>
                  <Descriptions.Item label="耗时">{result.tookMs ?? 0} ms</Descriptions.Item>
                  <Descriptions.Item label="生效 TopK">{result.topK ?? '-'}</Descriptions.Item>
                  <Descriptions.Item label="生效阈值">
                    {formatOptionalNumber(result.scoreThreshold)}
                  </Descriptions.Item>
                  <Descriptions.Item label="生效 Dense Weight">
                    {formatOptionalNumber(result.vectorSimilarityWeight)}
                  </Descriptions.Item>
                  <Descriptions.Item label="重排">
                    {result.rerank ? result.rerankModel || '开' : '关'}
                  </Descriptions.Item>
                  <Descriptions.Item label="关键词扩展">
                    {result.keyword ? '开' : '关'}
                  </Descriptions.Item>
                </Descriptions>

                {hits.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="没有召回任何切片，可以尝试降低相似度阈值或换一个问法"
                  />
                ) : (
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    {hits.map((hit, index) => (
                      <HitCard key={hit.chunkId || `${index}`} hit={hit} rank={index + 1} />
                    ))}
                  </Space>
                )}
              </Space>
            </Card>
          )}

          {!run.isPending && !result && !run.isError && (
            <Card size="small">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="输入问题后开始测试：命中结果、相似度与来源文档都会显示在这里"
              />
            </Card>
          )}
        </Space>
      </Col>
    </Row>
  );
}

/** Slider 与数字输入并排，两者编辑同一個值。 */
function Param({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
  precision,
  disabled,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  precision: number;
  disabled?: boolean;
}) {
  return (
    <div>
      <Text strong>{label}</Text>
      <Row gutter={8} align="middle" style={{ marginTop: 4 }}>
        <Col flex="auto">
          <Slider
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        </Col>
        <Col flex="88px">
          <InputNumber
            min={min}
            max={max}
            step={step}
            precision={precision}
            value={value}
            onChange={next => onChange(typeof next === 'number' ? next : min)}
            style={{ width: '100%' }}
            disabled={disabled}
          />
        </Col>
      </Row>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {hint}
      </Text>
    </div>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <Space size={8}>
        <Switch checked={checked} onChange={onChange} disabled={disabled} />
        <Text strong>{label}</Text>
      </Space>
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {hint}
        </Text>
      </div>
    </div>
  );
}

function HitCard({ hit, rank }: { hit: KnowledgeRetrievalHit; rank: number }) {
  const score = hit.score ?? 0;
  const documentName = hit.documentName || '未命名文档';
  return (
    <Card size="small">
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space wrap size={8} align="center">
          <Tag color="blue">#{rank}</Tag>
          <Tag color={scoreColor(score)}>相似度 {formatScore(score)}</Tag>
          {typeof hit.vectorScore === 'number' && hit.vectorScore > 0 && (
            <Tag>向量 {formatScore(hit.vectorScore)}</Tag>
          )}
          <Text strong>{documentName}</Text>
          {hit.chunkId && (
            <Text type="secondary" copyable={{ text: hit.chunkId }} style={{ fontSize: 12 }}>
              {hit.chunkId}
            </Text>
          )}
        </Space>
        <Paragraph
          style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          ellipsis={{ rows: 6, expandable: true, symbol: '展开' }}
          copyable={{ text: hit.content }}
        >
          {hit.content || '（空切片）'}
        </Paragraph>
      </Space>
    </Card>
  );
}

function formatScore(value: number): string {
  return value.toFixed(4);
}

/** 0 表示「交给部署 / 平台决定」，与参数区的提示一致。 */
function formatOptionalNumber(value?: number): string {
  return typeof value === 'number' && value > 0 ? value.toFixed(2) : '部署 / 平台默认';
}

/** 分数只用于快速分层，不是质量结论；颜色阈值与平台无关。 */
function scoreColor(score: number): string {
  if (score >= 0.8) return 'green';
  if (score >= 0.5) return 'blue';
  return 'default';
}
