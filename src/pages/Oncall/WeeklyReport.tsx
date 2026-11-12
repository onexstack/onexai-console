import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Typography,
} from 'antd';
import { DownloadOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

import { RESOURCE_TABLE_LAYOUT } from '@/ui';
import { ResourceShell } from '@/ui/components/ResourceShell';

/**
 * 值班周报（占位）。
 *
 * 后端还没有周报聚合接口，这一版只把页面骨架和入口立起来：周选择、值班组筛选、
 * 导出/推送都在位，但所有统计值是 `—`、图表与明细区是空态，**不发任何请求**。
 * 这样侧栏不会出现死链，接入真实数据时只需替换各区块的 body，路由与页面骨架不动。
 *
 * 访问范围：所有登录用户。工单列表接口仅管理员可读，因此本页刻意不调用它，
 * 也不放在 `/tickets` 路径下（access.ts 按首段把 `/tickets` 整组隐藏）。
 */
export default function OncallWeeklyReportPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();

  const ticketColumns: ColumnsType<Record<string, unknown>> = [
    { title: t('工单号'), dataIndex: 'ticket_id', key: 'ticket_id', width: 180 },
    { title: t('标题'), dataIndex: 'title', key: 'title' },
    { title: t('状态'), dataIndex: 'status', key: 'status', width: 100 },
    { title: t('级别'), dataIndex: 'level', key: 'level', width: 80 },
    { title: t('负责人'), dataIndex: 'assignee_name', key: 'assignee_name', width: 140 },
    { title: t('创建时间'), dataIndex: 'created_at', key: 'created_at', width: 160 },
  ];

  const priorityColumns: ColumnsType<Record<string, unknown>> = [
    { title: t('工单号'), dataIndex: 'ticket_id', key: 'ticket_id', width: 180 },
    { title: t('标题'), dataIndex: 'title', key: 'title' },
    { title: t('级别'), dataIndex: 'level', key: 'level', width: 80 },
    { title: t('状态'), dataIndex: 'status', key: 'status', width: 100 },
    { title: t('负责人'), dataIndex: 'assignee_name', key: 'assignee_name', width: 140 },
    { title: t('结案总结'), dataIndex: 'summary', key: 'summary' },
  ];

  const toolbar = (
    <Space wrap>
      <DatePicker picker="week" placeholder={t('选择周')} style={{ width: 160 }} />
      <Select disabled placeholder={t('全部值班组')} style={{ width: 180 }} />
      <Button icon={<ReloadOutlined />} onClick={() => message.info(t('数据接入后可用'))}>
        {t('刷新')}
      </Button>
      <Button icon={<DownloadOutlined />} disabled title={t('数据接入后可用')}>
        {t('导出')}
      </Button>
      <Button icon={<SendOutlined />} disabled title={t('数据接入后可用')}>
        {t('推送')}
      </Button>
    </Space>
  );

  return (
    <ResourceShell title={t('值班周报')} subtitle={t('工单与值班的周期性复盘')} toolbar={toolbar}>
      {/* ResourceShell 的容器是 overflow:hidden，长页面必须在内部自己滚。 */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          gap: 16,
          minHeight: 0,
          overflowY: 'auto',
          paddingBottom: 4,
        }}
      >
        <Alert type="info" showIcon title={t('周报数据尚未接入，以下区域为占位')} />

        <SectionCard title={t('工单统计')}>
          <Row gutter={[16, 16]}>
            {[t('新增工单'), t('已解决'), t('未关闭'), t('P1/P2 工单')].map(label => (
              <Col key={label} xs={12} xl={6}>
                <Statistic title={label} value="—" />
              </Col>
            ))}
          </Row>
        </SectionCard>

        <SectionCard title={t('SLA/时效统计')}>
          <Row gutter={[16, 16]}>
            {[t('平均首次响应'), t('平均解决时长'), t('超时工单'), t('超时率')].map(label => (
              <Col key={label} xs={12} xl={6}>
                <Statistic title={label} value="—" />
              </Col>
            ))}
          </Row>
        </SectionCard>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={16}>
            <SectionCard title={t('每日趋势')}>
              <PlaceholderBody minHeight={220} />
            </SectionCard>
          </Col>
          <Col xs={24} xl={8}>
            <SectionCard title={t('值班覆盖')}>
              <PlaceholderBody minHeight={220} />
            </SectionCard>
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <SectionCard title={t('处理人排行')}>
              <PlaceholderBody />
            </SectionCard>
          </Col>
          <Col xs={24} xl={12}>
            <SectionCard title={t('P1/P2 重点工单明细')}>
              <EmptyTable columns={priorityColumns} emptyText={t('数据接入后可用')} />
            </SectionCard>
          </Col>
        </Row>

        <SectionCard title={t('未关闭工单清单')}>
          <EmptyTable columns={ticketColumns} emptyText={t('数据接入后可用')} />
        </SectionCard>

        <SectionCard title={t('周报导出/推送')}>
          <Space orientation="vertical" size={12}>
            <Typography.Text type="secondary">{t('数据接入后可用')}</Typography.Text>
            <Space wrap>
              <Button icon={<DownloadOutlined />} disabled title={t('数据接入后可用')}>
                {t('导出周报')}
              </Button>
              <Button icon={<SendOutlined />} disabled title={t('数据接入后可用')}>
                {t('推送到飞书')}
              </Button>
            </Space>
          </Space>
        </SectionCard>
      </div>
    </ResourceShell>
  );
}

/** 周报里的一个区块卡片；高度跟随 Row 拉伸，保证并排卡片底边对齐。 */
function SectionCard({
  title,
  extra,
  children,
}: {
  title: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card size="small" title={title} extra={extra} style={{ height: '100%' }}>
      {children}
    </Card>
  );
}

/** 图表/排行等未接入区域：居中空态，高度可按区块调整。 */
function PlaceholderBody({ minHeight = 160 }: { minHeight?: number }) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight,
      }}
    >
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('数据接入后可用')} />
    </div>
  );
}

/**
 * 空表也要给真实列头：没有 columns 的空表看起来像组件坏了；有了列头，
 * 接入数据前后列宽和阅读顺序保持一致。
 */
function EmptyTable({
  columns,
  emptyText,
}: {
  columns: ColumnsType<Record<string, unknown>>;
  emptyText: string;
}) {
  return (
    <Table
      size="small"
      rowKey="ticket_id"
      columns={columns}
      dataSource={[]}
      pagination={false}
      {...RESOURCE_TABLE_LAYOUT}
      locale={{
        emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />,
      }}
    />
  );
}
