import { Card, Divider, Space, Tag, Typography } from 'antd';

import styles from './styles.module.scss';

/**
 * Webhook 载荷模板的变量说明。
 *
 * 字段的 `help` 只留一句，完整变量表放在这里：按「运行 / 智能体 / 主体 / 用量」
 * 分组，变量名与后端 `webhook/template.go` 的 `templateVars` 一一对应。模板渲染
 * 结果原样发送，所以示例用等宽代码块而不是普通文本。
 */

interface VariableGroup {
  label: string;
  vars: string[];
}

const VARIABLE_GROUPS: VariableGroup[] = [
  {
    label: '运行与事件',
    vars: ['.event', '.objectKind', '.runID', '.surface', '.sessionKey'],
  },
  {
    label: '智能体',
    vars: ['.agent', '.agents'],
  },
  {
    label: '主体',
    vars: ['.subject.kind', '.subject.id', '.subject.name'],
  },
  {
    // 后端只在 onEnd 的 payload 里填 usage；onStart 拿不到用量。
    label: '用量（仅 onEnd）',
    vars: [
      '.usage.calls',
      '.usage.promptTokens',
      '.usage.completionTokens',
      '.usage.cacheHitTokens',
      '.usage.cacheMissTokens',
    ],
  },
];

const EXAMPLE = `{
  "event": "{{ .event }}",
  "runId": "{{ .runID }}",
  "agent": "{{ .agent }}",
  "subject": {
    "kind": "{{ .subject.kind }}",
    "id": "{{ .subject.id }}"
  },
  "sessionKey": "{{ .sessionKey }}",
  "usage": {
    "calls": {{ .usage.calls }},
    "promptTokens": {{ .usage.promptTokens }}
  }
}`;

export default function WebhookTemplateHelp() {
  return (
    <Card size="small" className={styles.templateHelp} title="模板语法与可用变量">
      <Typography.Paragraph type="secondary" className={styles.templateIntro}>
        使用 <Typography.Text code>Go text/template</Typography.Text> 语法。渲染结果会原样作为请求体
        发送，平台不校验 JSON；缺失的变量渲染为零值。留空时发送默认 JSON 载荷，渲染结果上限
        64 KiB。
      </Typography.Paragraph>

      <div className={styles.templateVars}>
        {VARIABLE_GROUPS.map(group => (
          <div key={group.label} className={styles.templateVarRow}>
            <span className={styles.templateVarLabel}>{group.label}</span>
            <Space size={[6, 6]} wrap>
              {group.vars.map(variable => (
                <Tag key={variable} variant="filled" className={styles.templateVarTag}>
                  {`{{${variable}}}`}
                </Tag>
              ))}
            </Space>
          </div>
        ))}
      </div>

      <Divider className={styles.templateDivider} />
      <Typography.Text type="secondary" className={styles.templateExampleLabel}>
        请求体示例
        <Typography.Text copyable={{ text: EXAMPLE }} className={styles.templateCopy}>
          复制
        </Typography.Text>
      </Typography.Text>
      <pre className={styles.templateExample}>{EXAMPLE}</pre>
    </Card>
  );
}
