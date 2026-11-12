import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Drawer } from 'antd';
import type { DrawerProps } from 'antd';
import clsx from 'clsx';

import { useIsMobile } from '../../responsive';
import styles from './styles.module.scss';

const KEYBOARD_STEP = 16;
const KEYBOARD_STEP_LARGE = 64;

/** localStorage 键统一带前缀，避免与其它应用的宽度记忆撞车。 */
const STORAGE_PREFIX = 'onexai-console_drawer_';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function storageName(storageKey?: string): string | undefined {
  return storageKey ? `${STORAGE_PREFIX}${storageKey}_width` : undefined;
}

function readWidth(
  name: string | undefined,
  fallback: number,
  minWidth: number,
  maxWidth: number
): number {
  if (!name) return fallback;
  try {
    const parsed = Number(window.localStorage.getItem(name));
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return clamp(parsed, minWidth, maxWidth);
  } catch {
    // 隐私模式 / 禁用存储：退回默认宽度，不影响本次使用。
    return fallback;
  }
}

function writeWidth(name: string | undefined, value: number): void {
  if (!name) return;
  try {
    window.localStorage.setItem(name, String(Math.round(value)));
  } catch {
    // 写不进去就当这次没记住，不打断交互。
  }
}

function setGlobalDragging(active: boolean): void {
  document.body.style.cursor = active ? 'col-resize' : '';
  document.body.style.userSelect = active ? 'none' : '';
}

export interface ResizableDrawerProps extends Omit<
  DrawerProps,
  'size' | 'width' | 'height' | 'resizable' | 'drawerRender'
> {
  /** 初始宽度（px），也是双击手柄恢复的宽度。默认 560。 */
  defaultWidth?: number;
  /** 最小宽度（px），默认 360。 */
  minWidth?: number;
  /** 最大宽度（px）；缺省时只受视口宽度约束。 */
  maxWidth?: number;
  /** 传了就记住用户拖出来的宽度：`onexai-console_drawer_<storageKey>_width`。 */
  storageKey?: string;
}

/**
 * 可拖拽调整宽度的抽屉。
 *
 * 交互与 `ChatSplitPane` 保持一致：指针拖拽（含触屏）、rAF 节流、键盘
 * （←/→、Home/End）、双击手柄恢复默认宽度、localStorage 记忆。
 *
 * 手柄借 rc-drawer 的 `drawerRender` 注入：该回调收到的是
 * `.ant-drawer-section`（`role="dialog"`）的 React 元素，把节点 clone 一份
 * 追加到手柄放在对话框内部，屏幕阅读器不会把它当成模态框外的内容。
 * 注意 `drawerRender` 未出现在 antd 文档里，升级 antd 时类型检查会兜底。
 *
 * 移动端（<768px）抽屉本来就占满整屏，不渲染手柄。
 */
export default function ResizableDrawer({
  defaultWidth = 560,
  minWidth = 360,
  maxWidth,
  storageKey,
  placement = 'right',
  open,
  rootClassName,
  children,
  ...rest
}: ResizableDrawerProps) {
  const isMobile = useIsMobile();
  const horizontal = placement === 'left' || placement === 'right';
  const name = storageName(storageKey);

  // 首次渲染就按已存宽度取值，避免抽屉先按默认宽度闪一下。
  const [desiredWidth, setDesiredWidth] = useState(() =>
    readWidth(name, defaultWidth, minWidth, maxWidth ?? Number.POSITIVE_INFINITY)
  );
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth
  );
  const [dragging, setDragging] = useState(false);

  const desiredRef = useRef(desiredWidth);
  const dragRef = useRef<{ startX: number; startWidth: number; max: number } | null>(null);
  const frameRef = useRef<number | null>(null);

  // 两层宽度：desiredWidth 是用户意图，窗口临时变窄只收窄显示，不覆盖意图。
  const maxAllowed = useMemo(
    () => Math.max(minWidth, Math.min(maxWidth ?? viewportWidth, viewportWidth)),
    [maxWidth, minWidth, viewportWidth]
  );
  const width = clamp(desiredWidth, minWidth, maxAllowed);

  const cancelDrag = useCallback(() => {
    dragRef.current = null;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    setGlobalDragging(false);
    setDragging(false);
  }, []);

  useEffect(() => {
    const onWindowResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, []);

  // 抽屉关闭 / 切到移动端时 handle 会卸载，必须收尾，否则 body 的
  // col-resize / user-select 会留在页面上。
  useEffect(() => {
    if (!open || isMobile) cancelDrag();
  }, [cancelDrag, isMobile, open]);

  useEffect(() => () => cancelDrag(), [cancelDrag]);

  const commitWidth = useCallback(
    (next: number, persist: boolean) => {
      const clamped = clamp(next, minWidth, maxAllowed);
      desiredRef.current = clamped;
      setDesiredWidth(clamped);
      if (persist) writeWidth(name, clamped);
    },
    [maxAllowed, minWidth, name]
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    // 让键盘用户拖完可以直接用方向键继续微调。
    event.currentTarget.focus({ preventScroll: true });
    // 视口刚变窄时 width 可能小于用户意图；从这一次按下开始以显示宽度为准。
    desiredRef.current = width;
    dragRef.current = { startX: event.clientX, startWidth: width, max: maxAllowed };
    event.currentTarget.setPointerCapture(event.pointerId);
    setGlobalDragging(true);
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    // 右侧抽屉的手柄在左缘：指针向左 → 变宽；左侧抽屉反过来。
    const delta = placement === 'left' ? event.clientX - drag.startX : drag.startX - event.clientX;
    const next = clamp(drag.startWidth + delta, minWidth, drag.max);
    desiredRef.current = next;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setDesiredWidth(next);
    });
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    setDesiredWidth(desiredRef.current);
    setGlobalDragging(false);
    setDragging(false);
    writeWidth(name, desiredRef.current);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP;
    // 按手柄的物理方向：右侧抽屉的 ← 变宽，左侧抽屉相反。
    const grow = placement === 'left' ? -1 : 1;
    // Home/End 对应手柄在水平方向的两端：右侧抽屉 Home 最宽、End 最窄。
    const homeWidth = placement === 'left' ? minWidth : maxAllowed;
    const endWidth = placement === 'left' ? maxAllowed : minWidth;
    let next: number;
    switch (event.key) {
      case 'ArrowLeft':
        next = width + step * grow;
        break;
      case 'ArrowRight':
        next = width - step * grow;
        break;
      case 'Home':
        next = homeWidth;
        break;
      case 'End':
        next = endWidth;
        break;
      default:
        return;
    }
    event.preventDefault();
    commitWidth(next, true);
  };

  const resetWidth = () => commitWidth(defaultWidth, true);

  const showHandle = open && !isMobile && horizontal;

  const handle = showHandle ? (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="调整抽屉宽度"
      aria-valuemin={minWidth}
      aria-valuemax={Math.round(maxAllowed)}
      aria-valuenow={Math.round(width)}
      aria-valuetext={`${Math.round(width)} 像素`}
      tabIndex={0}
      className={clsx(
        styles.handle,
        placement === 'left' ? styles.handleEnd : styles.handleStart,
        dragging && styles.handleDragging
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
      onDoubleClick={resetWidth}
      onKeyDown={handleKeyDown}
    />
  ) : null;

  return (
    <Drawer
      {...rest}
      open={open}
      placement={placement}
      size={isMobile ? '100%' : width}
      rootClassName={clsx(rootClassName, dragging && styles.dragging)}
      drawerRender={node => {
        if (!handle) return node;
        // 把 handle 追加到 role="dialog" 的 section 里（见组件注释）。
        if (!isValidElement<{ children?: ReactNode }>(node)) {
          return (
            <>
              {node}
              {handle}
            </>
          );
        }
        return cloneElement(node, undefined, node.props.children, handle);
      }}
    >
      {children}
    </Drawer>
  );
}
