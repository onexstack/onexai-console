import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { ResizableDrawer, useIsMobile } from '@/ui';

import styles from './splitPane.module.scss';

/** 侧栏默认宽度，以及主区至少保留的宽度。 */
const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const MIN_MAIN_WIDTH = 360;
const KEYBOARD_STEP = 16;
const KEYBOARD_STEP_LARGE = 64;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function readWidth(
  storageKey: string,
  fallback: number,
  minWidth: number,
  maxWidth: number
): number {
  try {
    const parsed = Number(localStorage.getItem(storageKey));
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return clamp(parsed, minWidth, maxWidth);
  } catch {
    // 隐私模式：宽度只是偏好。
    return fallback;
  }
}

function writeWidth(storageKey: string, width: number): void {
  try {
    localStorage.setItem(storageKey, String(Math.round(width)));
  } catch {
    // 同上：写不进去不影响布局。
  }
}

/** 拖拽期间锁住全局光标与选中，松开后恢复。 */
function setGlobalDragging(active: boolean): void {
  if (typeof document === 'undefined') return;
  document.body.style.cursor = active ? 'col-resize' : '';
  document.body.style.userSelect = active ? 'none' : '';
}

/**
 * 右侧停靠面板。
 *
 * 宽屏：中栏 + 可拖拽调宽的右栏，宽度写入 localStorage；窄屏（<992px）右栏
 * 自动改为抽屉，避免把对话挤没。关闭时右栏不渲染，中栏铺满。
 *
 * 宽度分两层：`desiredWidth` 是用户意图（持久化），实际渲染宽度再按容器
 * 可用空间钳制。窗口变窄时主区仍保留 `minMainWidth`，窗口恢复后原宽度回来。
 */
export function ChatSplitPane({
  open,
  onClose,
  side,
  sideId,
  sideLabel,
  storageKey,
  defaultWidth = DEFAULT_WIDTH,
  minWidth = MIN_WIDTH,
  maxWidth = MAX_WIDTH,
  minMainWidth = MIN_MAIN_WIDTH,
  children,
}: {
  open: boolean;
  onClose: () => void;
  side: ReactNode;
  /** 侧栏容器 id，配合触发按钮的 `aria-controls`。 */
  sideId?: string;
  /** 侧栏与拖拽条的可访问名称。 */
  sideLabel: string;
  /** localStorage 键：同一入口的宽度在多标签页/刷新后保持。 */
  storageKey: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  /** 中栏至少保留的宽度，拖拽时据此钳制。 */
  minMainWidth?: number;
  children: ReactNode;
}) {
  const narrow = useIsMobile('lg');

  const [desiredWidth, setDesiredWidth] = useState(() =>
    readWidth(storageKey, defaultWidth, minWidth, maxWidth)
  );
  const [containerWidth, setContainerWidth] = useState(0);
  const [dragging, setDragging] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  /** 最新一次「用户意图」：pointerup 时用它落盘，避免 setState 尚未刷新。 */
  const desiredRef = useRef(desiredWidth);
  /** 抽屉关闭动画期间保留最后一帧内容，避免内容先变空再滑出。 */
  const lastSideRef = useRef<ReactNode>(side);
  if (side != null) lastSideRef.current = side;
  const dragRef = useRef<{ startX: number; startWidth: number; max: number } | null>(null);
  const frameRef = useRef<number | null>(null);

  const maxAllowed = useMemo(() => {
    if (containerWidth <= 0) return maxWidth;
    return Math.max(minWidth, Math.min(maxWidth, containerWidth - minMainWidth));
  }, [containerWidth, maxWidth, minMainWidth, minWidth]);

  const width = clamp(desiredWidth, minWidth, maxAllowed);

  // 面板打开/回到桌面时先同步量一次，避免首帧用 maxWidth 把中栏挤一下。
  useLayoutEffect(() => {
    if (narrow) return;
    const element = rootRef.current;
    if (element) setContainerWidth(Math.round(element.clientWidth));
  }, [narrow, open]);

  // 容器尺寸变化（Sider 折叠、窗口缩放、全屏）时重新计算可用上限。
  useEffect(() => {
    if (narrow) return undefined;
    const element = rootRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      setContainerWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [narrow]);

  useEffect(
    () => () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      setGlobalDragging(false);
    },
    []
  );

  const commitWidth = useCallback(
    (next: number) => {
      const clamped = clamp(next, minWidth, maxWidth);
      desiredRef.current = clamped;
      setDesiredWidth(clamped);
    },
    [maxWidth, minWidth]
  );

  const persistWidth = useCallback(() => {
    writeWidth(storageKey, desiredRef.current);
  }, [storageKey]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startWidth: width, max: maxAllowed };
    event.currentTarget.setPointerCapture(event.pointerId);
    setGlobalDragging(true);
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    // 分隔条在右栏左缘：指针向左 → 右栏变宽。
    const next = clamp(drag.startWidth - (event.clientX - drag.startX), minWidth, drag.max);
    // 先记下最新值，pointerup 可能早于下一帧的 setState。
    desiredRef.current = next;
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setDesiredWidth(next);
    });
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      setDesiredWidth(desiredRef.current);
    }
    setGlobalDragging(false);
    setDragging(false);
    persistWidth();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP;
    let next: number;
    switch (event.key) {
      case 'ArrowLeft':
        next = width + step;
        break;
      case 'ArrowRight':
        next = width - step;
        break;
      case 'Home':
        next = maxAllowed;
        break;
      case 'End':
        next = minWidth;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onClose();
        return;
      default:
        return;
    }
    event.preventDefault();
    commitWidth(Math.min(next, maxAllowed));
    persistWidth();
  };

  const resetWidth = () => {
    commitWidth(Math.min(defaultWidth, maxAllowed));
    persistWidth();
  };

  const canResize = !narrow && open;

  return (
    <>
      <div ref={rootRef} className={`${styles.root} ${dragging ? styles.dragging : ''}`}>
        <div className={styles.main}>{children}</div>

        {canResize ? (
          <div
            id={sideId}
            className={styles.side}
            style={{ width }}
            role="region"
            aria-label={sideLabel}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={`调整${sideLabel}宽度`}
              aria-valuenow={Math.round(width)}
              aria-valuemin={minWidth}
              aria-valuemax={Math.round(maxAllowed)}
              aria-valuetext={`${Math.round(width)} 像素`}
              tabIndex={0}
              className={styles.handle}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              onLostPointerCapture={finishDrag}
              onDoubleClick={resetWidth}
              onKeyDown={handleKeyDown}
            />
            <div className={styles.sideInner}>{side}</div>
          </div>
        ) : null}
      </div>

      {narrow ? (
        <ResizableDrawer
          placement="right"
          open={open}
          onClose={onClose}
          defaultWidth={560}
          minWidth={360}
          storageKey="chat_side_pane"
          closable={false}
          destroyOnHidden
          // 原生全屏时只有全屏元素子树可见，portal 到 body 会被挡在外面。
          getContainer={false}
          styles={{
            body: {
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              padding: 0,
            },
          }}
        >
          <div id={sideId} className={styles.drawerPane} role="region" aria-label={sideLabel}>
            {side ?? lastSideRef.current}
          </div>
        </ResizableDrawer>
      ) : null}
    </>
  );
}
