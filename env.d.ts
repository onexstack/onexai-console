/// <reference types="@rsbuild/core/types" />

/** Wujie 注入的全局对象；只在被宿主嵌入时存在。 */
interface Window {
  __POWERED_BY_WUJIE__?: boolean;
  __WUJIE_MOUNT?: () => void;
  __WUJIE_UNMOUNT?: () => void;
  $wujie?: {
    props?: Record<string, unknown>;
    bus?: {
      $on: (event: string, cb: (...args: unknown[]) => void) => void;
      $off: (event: string, cb: (...args: unknown[]) => void) => void;
      $emit: (event: string, ...args: unknown[]) => void;
    };
  };
}
