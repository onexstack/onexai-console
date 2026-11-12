import { useEffect, useRef, useState } from 'react';

/**
 * 流式 Markdown 的渲染节流（默认 100ms）。
 *
 * bytemd 每次渲染都要把整段正文重新解析成 AST；逐 token 渲染会让长回答持续掉帧。
 * 只在 `pending` 时使用，终态直接读原值，避免最后一帧落后。
 */
export function useThrottledValue<T>(value: T, interval = 100): T {
  const [throttled, setThrottled] = useState(value);
  const lastRef = useRef(0);

  useEffect(() => {
    const now = Date.now();
    const remaining = interval - (now - lastRef.current);
    if (remaining <= 0) {
      lastRef.current = now;
      setThrottled(value);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      lastRef.current = Date.now();
      setThrottled(value);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [value, interval]);

  return throttled;
}
