import breaks from '@bytemd/plugin-breaks';
import gfm from '@bytemd/plugin-gfm';
import highlight from '@bytemd/plugin-highlight';
import type { BytemdPlugin } from 'bytemd';

import { CODE_COPY_PLUGIN } from './codeCopy';

/**
 * 插件实例必须是模块级常量。
 *
 * bytemd 的 React 绑定每次渲染都会比较 `plugins` 的身份；在组件里现场 `gfm()`
 * 会让流式增量每个节拍都重建一次渲染管线。
 */
export const MARKDOWN_PLUGINS: BytemdPlugin[] = [gfm(), breaks(), highlight(), CODE_COPY_PLUGIN];
