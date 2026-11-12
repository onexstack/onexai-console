import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const STICK_THRESHOLD = 48;

/**
 * 消息区吸底。
 *
 * ResizeObserver 同时观察内容层与滚动容器：流式正文每个节拍都会把内容撑高，
 * 只要用户还在底部就继续贴住；用户向上滚动后立即脱离，并显示「回到最新」。
 */
export function useStickToBottom(resetKey?: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuckState] = useState(true);
  const stuckRef = useRef(true);

  const setStuck = useCallback((next: boolean) => {
    stuckRef.current = next;
    setStuckState(next);
  }, []);

  const pin = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, []);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    setStuck(distance <= STICK_THRESHOLD);
  }, [setStuck]);

  const jumpToLatest = useCallback(() => {
    setStuck(true);
    pin();
  }, [pin, setStuck]);

  useLayoutEffect(() => {
    setStuck(true);
    pin();

    const content = contentRef.current;
    const scroll = scrollRef.current;
    if (!content || !scroll || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => {
      if (stuckRef.current) pin();
    });
    observer.observe(content);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [resetKey, pin, setStuck]);

  // 切换线程时回到最新。
  useEffect(() => {
    setStuck(true);
    pin();
  }, [resetKey, pin, setStuck]);

  return { scrollRef, contentRef, stuck, onScroll, jumpToLatest };
}
