import { Button, Pagination, Select } from 'antd';
import { DoubleLeftOutlined, DoubleRightOutlined, DownOutlined } from '@ant-design/icons';
import clsx from 'clsx';

import { useIsMobile } from '../../responsive';
import styles from './styles.module.scss';

export interface ListPaginationProps {
  /** 总条数（服务端 `total`，或前端切片前整表的长度） */
  total: number;
  /** 当前页，1 起 */
  page: number;
  /** 每页条数 */
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  /** 每页条数可选项，默认 `[10, 20, 50, 100]` */
  pageSizeOptions?: number[];
  /**
   * 底栏对齐方式。
   * - `'between'`（默认）：`共 N 条` 靠左、翻页控件靠右 —— 表格底栏。
   * - `'center'`：整条居中 —— 卡片流（如 `/console` 的吸底条）。
   */
  align?: 'between' | 'center';
  /**
   * 总条数不超过一页时整条不渲染（连同每页条数切换器一起），默认 `true`。
   *
   * 单页挂一条「共 N 条」只是噪音，所以默认隐藏；后台 CRUD 表格底的底栏即便单页也
   * 要露出来（那是表格型 UI 的常规），由 `ResourcePage` 显式传 `false`。
   */
  hideOnSinglePage?: boolean;
  /**
   * 翻译函数。
   *
   * 这个包**不 import react-i18next**（它被多个应用共用，其中有的子应用没有 i18n），
   * 所以由调用方把 `useTranslation()` 的 `t` 传进来。缺省实现会把 `{{x}}` 占位符
   * 就地替换掉，至少不会把 `共 {{total}} 条` 这种原文漏到界面上。
   */
  t?: (key: string, options?: Record<string, unknown>) => string;
  /** 追加在外层容器上的类名（调间距用；`.pagination` 自带内边距） */
  className?: string;
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

/** 缺省翻译器：无 i18n 时按 `{{name}}` 就地插值。 */
function defaultT(key: string, options?: Record<string, unknown>): string {
  if (!options) return key;
  return key.replace(/\{\{(\w+)\}\}/g, (raw, name: string) =>
    name in options ? String(options[name]) : raw
  );
}

/**
 * 全仓统一的列表分页条：「共 N 条」· 首页/末页 · 页码 · 每页条数。
 *
 * 页码窗口（省略号收敛、`‹ ›`）交给 antd `<Pagination>`，本组件只负责外围骨架 ——
 * 页大小选择器由我们自己渲染，这样「条/页」走调用方的 `t`，不依赖 antd 语言包，
 * 也不受 antd 5.19+ `totalBoundaryShowSizeChanger`（总数 ≤50 时自动藏掉选择器）的影响。
 *
 * 两条使用路径：
 * - 表格底栏 —— `ResourcePage`（`align='between'`，`hideOnSinglePage={false}`）；
 * - 卡片流 —— `/console` 的吸底条等（`align='center'`）。
 *
 * 刻意不叫 `Pagination`：antd 有同名导出，同时用两者的文件会撞名。
 */
export function ListPagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  align = 'between',
  hideOnSinglePage = true,
  className,
  t = defaultT,
}: ListPaginationProps) {
  const isMobile = useIsMobile();
  // 收敛到合法页：输入 0、999 都不该发出一次越界的请求。
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (hideOnSinglePage && totalPages <= 1) return null;

  const go = (p: number) => onPageChange(Math.max(1, Math.min(p, totalPages)));

  return (
    <div
      className={clsx(styles.pagination, align === 'center' && styles.paginationCenter, className)}
    >
      <span className={styles.paginationTotal}>{t('共 {{total}} 条', { total })}</span>
      <div className={styles.paginationRight}>
        {/* 移动端只保留「上一页 / 页码 / 下一页」：首页/末页与每页条数在 320px 下
            会把整条挤出屏幕，而它们的收益远低于翻页本身。 */}
        {!isMobile && (
          <Button
            icon={<DoubleLeftOutlined />}
            disabled={page <= 1}
            onClick={() => go(1)}
            aria-label={t('第一页')}
            title={t('第一页')}
          />
        )}
        <Pagination
          simple={isMobile}
          current={page}
          pageSize={pageSize}
          total={total}
          showSizeChanger={false}
          showQuickJumper={false}
          onChange={go}
          // 文案全部自带，不读 antd 语言包；缺省 `t` 下退化成中文原文。
          locale={{
            prev_page: t('上一页'),
            next_page: t('下一页'),
            prev_5: t('向前 5 页'),
            next_5: t('向后 5 页'),
            prev_3: t('向前 3 页'),
            next_3: t('向后 3 页'),
          }}
        />
        {!isMobile && (
          <>
            <Button
              icon={<DoubleRightOutlined />}
              disabled={page >= totalPages}
              onClick={() => go(totalPages)}
              aria-label={t('最后一页')}
              title={t('最后一页')}
            />
            <Select
              value={pageSize}
              onChange={v => {
                // 先改页大小再回第一页：换了档位还停在第 7 页，多半落在不存在的页上。
                onPageSizeChange(v);
                onPageChange(1);
              }}
              options={pageSizeOptions.map(n => ({ label: String(n), value: n }))}
              style={{ width: 64 }}
              suffix={<DownOutlined style={{ fontSize: 9 }} />}
              aria-label={t('每页条数')}
              getPopupContainer={() => document.body}
            />
            <span className={styles.paginationLabel}>{t('条/页')}</span>
          </>
        )}
      </div>
    </div>
  );
}
