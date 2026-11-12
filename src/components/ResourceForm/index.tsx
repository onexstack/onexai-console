import { Collapse, Form } from 'antd';
import type { Rule, RuleRender } from 'antd/es/form';
import { InfoCircleOutlined } from '@ant-design/icons';

import type { FieldOption, FieldSpec, ResourceSpec } from '@/api/resources';
import type { WebhookAuthValue } from '@/components/WebhookAuthForm/value';
import { useIsMobile } from '@/ui';
import { FieldHint } from '@/ui/components/FieldHint';

import ResourceFieldControl from './fields';
import { editableFields, nameOf } from './form-model';
import styles from './styles.module.scss';

export interface ResourceFormFieldsProps {
  spec: ResourceSpec;
  isCreate: boolean;
  /**
   * 当前记录所属命名空间：引用候选只保留同空间的资源。
   * 空字符串或未传表示不过滤。
   */
  scopeNamespace?: string;
  /**
   * 只渲染这些字段（按表单顺序）。缺省渲染全部可编辑字段。
   *
   * 整页表单按详情页签分区渲染，一次只传一个分区；弹窗不分区分组。
   */
  fields?: string[];
  /**
   * 动态候选：按字段键覆盖描述符里的静态 `options`。
   *
   * MCP 的「允许的工具 / 需审批的工具」在连通性测试后才拿得到候选，测试结果
   * 存在时优先于描述符；空数组表示「还没有候选」，不是「清空描述符」。
   */
  fieldOptions?: Record<string, FieldOption[] | undefined>;
  /** 这些字段暂时不可编辑（如 MCP 测试通过前不能选工具）。 */
  disabledFields?: readonly string[];
  /** 当前记录的主键；编辑时用于 `excludeSelf` 的引用候选过滤。 */
  currentId?: string;
}

/** 由字段描述渲染一组 `Form.Item`。 */
export default function ResourceFormFields({
  spec,
  isCreate,
  scopeNamespace,
  fields,
  fieldOptions,
  disabledFields,
  currentId,
}: ResourceFormFieldsProps) {
  const isMobile = useIsMobile('lg');
  const editable = editableFields(spec, isCreate).filter(
    field => !fields || fields.includes(field.key)
  );
  const normal = editable.filter(field => !field.advanced);
  const advanced = editable.filter(field => field.advanced);

  const renderField = (field: FieldSpec) => (
    <Form.Item
      key={field.key}
      name={nameOf(field)}
      // 说明文字默认照火山引擎表单的样子铺在字段下方：常驻、随输入框一起读。
      // `helpInTooltip` 的字段（如 API Key）改画在字段名右侧的问号里，避免长说明
      // 把表单行高撑得参差不齐。必填星号交回 antd 默认（Label 前置红 *）。
      label={
        field.help && field.helpInTooltip ? (
          <span className={styles.labelWithHint}>
            {field.label}
            <FieldHint>{field.help}</FieldHint>
          </span>
        ) : (
          field.label
        )
      }
      extra={
        field.help && !field.helpInTooltip ? (
          <span className={styles.hint}>
            <InfoCircleOutlined aria-hidden className={styles.hintIcon} />
            <span>{field.help}</span>
          </span>
        ) : undefined
      }
      // 条件必填依赖另一个字段（如 mode）：声明 dependencies，切换时
      // Form.Item 才会重渲染，必填星号和规则一起更新。
      dependencies={
        field.requiredWhen
          ? [
              field.requiredWhen.field.includes('.')
                ? field.requiredWhen.field.split('.')
                : field.requiredWhen.field,
            ]
          : undefined
      }
      // 长字段（URL、模板）占满标签右侧的剩余宽度；移动端由 vertical 布局接管。
      wrapperCol={!isMobile && field.wide ? { flex: '1 1 0' } : undefined}
      // 鉴权是模式 + 值的组合控件：刚切到「填写令牌」就报「请粘贴」太吵，
      // 留到失焦或提交时再校验。
      validateTrigger={field.kind === 'webhookAuth' ? 'onBlur' : undefined}
      rules={rulesOf(field, isCreate)}
    >
      <ResourceFieldControl
        field={field}
        isCreate={isCreate}
        scopeNamespace={scopeNamespace}
        resourceKey={spec.key}
        optionsOverride={fieldOptions?.[field.key]}
        forceDisabled={disabledFields?.includes(field.key)}
        currentId={currentId}
      />
    </Form.Item>
  );

  return (
    <>
      {normal.map(renderField)}
      {advanced.length > 0 && (
        <Collapse
          className={styles.advanced}
          // forceRender 是承重的：折叠时不挂载的字段不会注册进 Form，创建时
          // 高级字段的值和校验会一起消失。这里只“藏起来”，不卸载。
          items={[
            {
              key: 'advanced',
              label: '高级设置',
              forceRender: true,
              children: <>{advanced.map(renderField)}</>,
            },
          ]}
        />
      )}
    </>
  );
}

/** 字段的校验规则：必填、数值范围、文本格式，全部来自描述符。 */
function rulesOf(field: FieldSpec, isCreate: boolean): Rule[] {
  const rules: Rule[] = [];
  const required =
    field.required || (field.requiredOnCreate && isCreate) || (field.key === 'name' && isCreate);

  if (required) {
    const verb =
      field.kind === 'select' ||
      field.kind === 'checklist' ||
      field.kind === 'timezone' ||
      field.kind === 'user' ||
      field.valueEnum
        ? '请选择'
        : '请输入';
    rules.push({
      required: true,
      // 勾选列表的值是数组：不带 `type: 'array'` 时空数组不会命中 required。
      ...(field.kind === 'checklist' ? { type: 'array' as const } : {}),
      message: `${verb}${field.label}`,
    });
  }

  if (field.kind === 'number' && (field.min !== undefined || field.max !== undefined)) {
    const message =
      field.min !== undefined && field.max !== undefined
        ? `${field.label}必须在 ${field.min} 到 ${field.max} 之间`
        : field.min !== undefined
          ? `${field.label}不能小于 ${field.min}`
          : `${field.label}不能大于 ${field.max}`;
    rules.push({ type: 'number', min: field.min, max: field.max, message });
  }

  if (field.pattern) {
    rules.push({
      pattern: field.pattern,
      message: field.patternMessage ?? `${field.label}格式不正确`,
    });
  }

  // 鉴权控件把两个线上字段合成了一个对象值，必填只能按模式判断。
  if (field.kind === 'webhookAuth') {
    rules.push({
      validator: (_, value) => {
        const auth = (value ?? {}) as WebhookAuthValue;
        if (auth.mode === 'token' && !String(auth.token ?? '').trim()) {
          return Promise.reject(new Error('请粘贴鉴权令牌'));
        }
        if (auth.mode === 'secret' && !String(auth.secretRef ?? '').trim()) {
          return Promise.reject(new Error('请选择凭据 Secret'));
        }
        return Promise.resolve();
      },
    });
  }

  // ClientConfig 的地址是对象里的 url；声明了 requireUrl 的资源只接受 URL。
  if (field.kind === 'clientConfig' && field.clientConfigOptions?.requireUrl) {
    rules.push({
      validator: (_, value) => {
        const url = (value as { url?: unknown } | undefined)?.url;
        const text = typeof url === 'string' ? url.trim() : '';
        if (!text) return Promise.reject(new Error('请输入回调地址'));
        if (!/^https?:\/\/\S+$/.test(text)) {
          return Promise.reject(new Error('请填写以 http:// 或 https:// 开头的回调地址'));
        }
        return Promise.resolve();
      },
    });
  }

  // 条件必填：规则在渲染/校验时读取依赖字段的当前值。注意不激活时不能带
  // `whitespace`——async-validator 的 whitespace 规则对空串无条件报错。
  // `createOnly` 的字段在编辑时直接不生成规则（写-only 值服务端不回显）。
  if (field.requiredWhen && !(field.requiredWhen.createOnly && !isCreate)) {
    const { field: dependsOn, equals, message } = field.requiredWhen;
    const accepted = Array.isArray(equals) ? equals : [equals];
    const dependency = dependsOn.includes('.') ? dependsOn.split('.') : dependsOn;
    const verb =
      field.kind === 'select' ||
      field.kind === 'checklist' ||
      field.kind === 'timezone' ||
      field.kind === 'user' ||
      field.valueEnum
        ? '请选择'
        : '请输入';

    const conditionalRule: RuleRender = form => {
      const current = String(form.getFieldValue(dependency) ?? '');
      return accepted.includes(current)
        ? { required: true, whitespace: true, message: message ?? `${verb}${field.label}` }
        : { required: false };
    };
    rules.push(conditionalRule);
  }

  return rules;
}
