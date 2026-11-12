import type { ReactNode } from 'react';
import { Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import styles from './styles.module.scss';

/**
 * 字段说明：字段名旁边的一个问号图标，说明文字在悬浮（触屏为点击）时弹出。
 *
 * # 为什么不再把说明铺在字段旁边
 *
 * 说明文字此前以两种形态散在表单里：表驱动详情页（`InfoSection`）里是**值右侧**的
 * 一行灰字（`InfoItem.hint`），antd 表单里是**输入框下方**的一行（`Form.Item extra`）。
 * 两种都是常驻文本，于是半栏宽的表单里它被挤成两三行、把行高撑得参差；而且它离字段名
 * 越远，越像在描述上一行的值。收进问号之后，字段名那一列本身就能读出「这个字段有说明」，
 * 正文不再被说明文字切碎。
 *
 * # 为什么图形与间距要照着 antd 抄
 *
 * antd 的 `Form.Item tooltip` 属性自己会画一个问号（`.ant-form-item-tooltip`：
 * `color: colorTextDescription`、`cursor: help`、`margin-inline-start: 4px`）。两类表单
 * 同时存在，只把 antd 那半边换掉、这半边自己配色，页面上就会出现两种深浅的问号。
 * 所以这里的取值与它逐项对齐：`--color-text-tertiary` 在亮/暗两套令牌下正是
 * 45% 的黑与白，与 antd 的 `colorTextDescription` 同值。
 *
 * # 子元素必须是能接 ref 的元素
 *
 * `Tooltip` 要拿到子元素的 DOM 节点才能定位（React 19 没有 `findDOMNode` 兜底）。
 * `QuestionCircleOutlined` 是 antd 图标里 forwardRef 的原生 SVG 包装，安全；这里
 * **不要**改成自绘的函数组件，除非它自己转发 ref。
 */
export function FieldHint({ children }: { children?: ReactNode }) {
  // 没说明就不画问号。空串也算没有——`hint: bound ? t('…') : undefined` 这类调用方
  // 已经在按条件给值，但 `''` 也能从别处漏进来。
  if (children === null || children === undefined || children === '') return null;

  return (
    <Tooltip title={children}>
      <QuestionCircleOutlined className={styles.icon} />
    </Tooltip>
  );
}

export default FieldHint;
