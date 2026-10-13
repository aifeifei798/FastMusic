import { useEffect, useState } from 'react';

// 窄屏（手机）阈值：与 Tailwind 的 sm 断点一致，但用 JS 判断，因为
// 折叠播放器 / 均衡器 sheet 这类"结构"变化不能只靠 utility 类。
export const COMPACT_BREAKPOINT = 768;

/** 当前视口是否属于"手机/窄屏"布局。响应式：窗口 resize 或旋转时自动更新。 */
export function useIsCompact(): boolean {
  const [compact, setCompact] = useState<boolean>(
    typeof window !== 'undefined' && window.innerWidth < COMPACT_BREAKPOINT
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(`(max-width: ${COMPACT_BREAKPOINT - 1}px)`);
    setCompact(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setCompact(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return compact;
}
