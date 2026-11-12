import openaiIcon from '@lobehub/icons-static-svg/icons/openai.svg';
import deepseekIcon from '@lobehub/icons-static-svg/icons/deepseek-color.svg';
import claudeIcon from '@lobehub/icons-static-svg/icons/claude-color.svg';
import geminiIcon from '@lobehub/icons-static-svg/icons/gemini-color.svg';
import doubaoIcon from '@lobehub/icons-static-svg/icons/doubao-color.svg';
import qwenIcon from '@lobehub/icons-static-svg/icons/qwen-color.svg';
import ollamaIcon from '@lobehub/icons-static-svg/icons/ollama.svg';
import wenxinIcon from '@lobehub/icons-static-svg/icons/wenxin-color.svg';

import styles from './styles.module.scss';

/**
 * 内置提供方的品牌图标。
 *
 * 图标来自 `@lobehub/icons-static-svg`（MIT），只静态导入真正用到的 SVG，rsbuild
 * 会把它们作为 URL 资源输出，不会把整个图标包打进产物。
 *
 * 未知提供方（自建网关、vllm 等）用首字母兜底：下拉里仍然能看出「这一项是什么」，
 * 而不是留一个空位。
 */
const ICON_SRC: Record<string, string> = {
  openai: openaiIcon,
  deepseek: deepseekIcon,
  claude: claudeIcon,
  gemini: geminiIcon,
  ark: doubaoIcon,
  qwen: qwenIcon,
  ollama: ollamaIcon,
  qianfan: wenxinIcon,
};

/** 常见别名，允许后端/用户写 anthropic、google、doubao 等。 */
const ALIASES: Record<string, string> = {
  anthropic: 'claude',
  google: 'gemini',
  googleai: 'gemini',
  doubao: 'ark',
  bytedance: 'ark',
  volcengine: 'ark',
  tongyi: 'qwen',
  dashscope: 'qwen',
  aliyun: 'qwen',
  baidu: 'qianfan',
  wenxin: 'qianfan',
};

/** 单色图标在暗色主题下用 CSS 反相，否则黑字压在深底上几乎看不见。 */
const MONO_KEYS = new Set(['openai', 'ollama']);

export interface ProviderIconProps {
  /** `MODEL_PROVIDER_OPTIONS[].icon` 或 provider 值；大小写不敏感。 */
  provider: string;
  size?: number;
  className?: string;
}

export function ProviderIcon({ provider, size = 16, className }: ProviderIconProps) {
  const raw = provider.trim().toLowerCase();
  if (raw === '') return null;
  const key = ALIASES[raw] ?? raw;
  const src = ICON_SRC[key];

  if (!src) {
    return (
      <span
        className={`${styles.fallback} ${className ?? ''}`}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
        aria-hidden
      >
        {key.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden
      className={`${styles.icon} ${MONO_KEYS.has(key) ? styles.mono : ''} ${className ?? ''}`}
    />
  );
}

export default ProviderIcon;
