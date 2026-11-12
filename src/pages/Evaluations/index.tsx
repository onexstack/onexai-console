import { useLocation, useNavigate } from 'react-router';
import { Empty, Tabs } from 'antd';
import { useTranslation } from 'react-i18next';

import { ResourceShell } from '@/ui/components/ResourceShell';

import {
  EVALUATIONS_VIEWS,
  evaluationsPath,
  viewFromPathname,
  type EvaluationsView,
} from './constants';

/**
 * 评测中心（占位）。
 *
 * 后端评测能力尚未接入，这里只保留导航入口与路由，避免侧栏出现打不开的死链；
 * 三个视图共用这一份占位页，接入后按视图替换为数据集、任务与报告的真实内容。
 */
export default function EvaluationsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const view = viewFromPathname(location.pathname);

  return (
    <ResourceShell title={t('评测中心')}>
      <Tabs
        activeKey={view}
        items={EVALUATIONS_VIEWS.map(item => ({ key: item.key, label: t(item.label) }))}
        onChange={key => navigate(evaluationsPath(key as EvaluationsView))}
      />
      <div style={{ padding: '64px 0' }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('评测中心建设中，敬请期待')}
        />
      </div>
    </ResourceShell>
  );
}
