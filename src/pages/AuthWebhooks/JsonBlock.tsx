import { CopyButton } from '@/ui/components/CopyButton';

/**
 * 评审协议返回的原始 JSON。保留原样，便于和 curl / kubectl 的结果对照。
 *
 * 复制按钮放在区块内部而不是卡片标题上：用户要复制的就是眼前这段 JSON，
 * 标题栏上的按钮离它太远，也容易被当成「复制整页」。
 */
export default function JsonBlock({
  value,
  maxHeight = 320,
}: {
  value: unknown;
  maxHeight?: number;
}) {
  const text = JSON.stringify(value, null, 2);
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', top: 6, right: 6 }}>
        <CopyButton value={text} ariaLabel="复制 JSON" />
      </div>
      <pre
        style={{
          margin: 0,
          padding: '12px 44px 12px 12px',
          background: 'var(--ant-color-fill-quaternary, #fafafa)',
          border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
          borderRadius: 6,
          fontSize: 12,
          lineHeight: 1.6,
          overflow: 'auto',
          maxHeight,
        }}
      >
        {text}
      </pre>
    </div>
  );
}
