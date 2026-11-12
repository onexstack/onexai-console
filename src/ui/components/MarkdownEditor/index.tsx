import { Editor } from '@bytemd/react';
import zhHans from 'bytemd/locales/zh_Hans.json';

import 'bytemd/dist/index.css';
import 'highlight.js/styles/github.css';
import '@/styles/markdown.scss';

import { MARKDOWN_PLUGINS } from '../MarkdownViewer/plugins';
import styles from './styles.module.scss';

export interface MarkdownEditorProps {
  /** 当前 Markdown 正文（受控，由 `Form.Item` 注入）。 */
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
}

/**
 * Markdown 编辑器：bytemd 的左右分栏（编辑 + 预览）。
 *
 * 与 `MarkdownViewer` 共用同一组插件，编辑时看到的就是详情/消息里的渲染结果。
 * 样式文件在这里显式导入：oncall 表单路由可能把 MarkdownViewer 所在的 chunk
 * 拆走，不能依赖它的副作用导入。
 */
export default function MarkdownEditor({
  value,
  onChange,
  disabled,
  id,
  placeholder,
}: MarkdownEditorProps) {
  return (
    <div id={id} className={disabled ? `${styles.editor} ${styles.disabled}` : styles.editor}>
      <Editor
        value={typeof value === 'string' ? value : ''}
        onChange={next => onChange?.(next)}
        plugins={MARKDOWN_PLUGINS}
        locale={zhHans}
        mode="split"
        placeholder={placeholder ?? '支持 Markdown'}
      />
    </div>
  );
}
