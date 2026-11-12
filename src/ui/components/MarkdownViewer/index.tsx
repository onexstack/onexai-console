import { memo } from 'react';
import { Viewer } from '@bytemd/react';

import 'bytemd/dist/index.css';
import 'highlight.js/styles/github.css';
import '@/styles/markdown.scss';

import { MARKDOWN_PLUGINS } from './plugins';
import styles from './styles.module.scss';

export interface MarkdownViewerProps {
  value: string;
  className?: string;
}

/**
 * AI 回复的 Markdown 渲染。
 *
 * 用 bytemd 与参考面板保持一致（GFM / 代码高亮 / 单换行 / 代码块复制）。
 * 流式正文由调用方做节流，这里只负责渲染。
 */
export const MarkdownViewer = memo(function MarkdownViewer({
  value,
  className,
}: MarkdownViewerProps) {
  return (
    <div className={className ? `${styles.markdownBody} ${className}` : styles.markdownBody}>
      <Viewer value={value} plugins={MARKDOWN_PLUGINS} />
    </div>
  );
});

export default MarkdownViewer;
