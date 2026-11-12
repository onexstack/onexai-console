import { CopyButton } from '@/ui/components/CopyButton';

/**
 * 接入示例代码块：等宽字体 + 右上角复制。
 *
 * 示例一长，用户就会整段选中复制——而这恰好是最容易漏掉开头或结尾的做法。
 * 复制按钮与正文共用同一个字符串，复制到的就是看到的。
 */
export default function CodeBlock({
  code,
  ariaLabel = '复制命令',
}: {
  code: string;
  ariaLabel?: string;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', top: 6, right: 6 }}>
        <CopyButton value={code} ariaLabel={ariaLabel} />
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
        }}
      >
        {code}
      </pre>
    </div>
  );
}
