// 滚动条样式: Tailwind 没有 scrollbar utility, 用 arbitrary variant 挂在滚动容器上。
// 每个 overflow-* 的容器都要带这个类(伪元素选择器不能全局继承)。
export const SCROLLBAR_CLASSES = [
  '[&::-webkit-scrollbar]:w-1.5',
  '[&::-webkit-scrollbar]:h-1.5',
  '[&::-webkit-scrollbar-track]:bg-transparent',
  '[&::-webkit-scrollbar-thumb]:bg-white/15',
  '[&::-webkit-scrollbar-thumb]:rounded-full',
  '[&::-webkit-scrollbar-thumb]:hover:bg-white/28',
].join(' ');

// 字母索引条: 横向滚动但不显示滚动条
export const NO_SCROLLBAR_CLASSES = '[&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0';
