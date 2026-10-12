// 滚动条样式: Tailwind 没有 scrollbar utility, 用 arbitrary variant 挂在滚动容器上。
// 每个 overflow-* 的容器都要带这个类(伪元素选择器不能全局继承)。
// 颜色走 index.css 里的 --scrollbar-thumb / --scrollbar-thumb-hover, 深浅主题自动切换。
export const SCROLLBAR_CLASSES = [
  '[&::-webkit-scrollbar]:w-1.5',
  '[&::-webkit-scrollbar]:h-1.5',
  '[&::-webkit-scrollbar-track]:bg-transparent',
  '[&::-webkit-scrollbar-thumb]:bg-[var(--scrollbar-thumb)]',
  '[&::-webkit-scrollbar-thumb]:rounded-full',
  '[&::-webkit-scrollbar-thumb]:hover:bg-[var(--scrollbar-thumb-hover)]',
].join(' ');

// 字母索引条: 横向滚动但不显示滚动条
export const NO_SCROLLBAR_CLASSES = '[&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0';
