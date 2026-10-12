// FastMusic 品牌徽标(内联 SVG, 不依赖外部资源):
// 渐变圆角方(rose → amber) + 黑胶唱片(同心纹路) + 白色闪电(“快”)。
// 与 public/logo-mark.svg / public/favicon.svg 保持同一几何, 改形状时两边都要同步。
export function LogoMark({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="FastMusic">
      <defs>
        <linearGradient id="fm-brand" x1="10" y1="54" x2="54" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ff3f5f" />
          <stop offset="0.52" stopColor="#f76b3f" />
          <stop offset="1" stopColor="#ffc04a" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#fm-brand)" />
      <circle cx="32" cy="32" r="21" fill="#0b0b12" />
      <circle cx="32" cy="32" r="21" fill="none" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="1.1" />
      <circle cx="32" cy="32" r="15" fill="none" stroke="#ffffff" strokeOpacity="0.14" strokeWidth="1" />
      <circle cx="32" cy="32" r="9" fill="none" stroke="#ffffff" strokeOpacity="0.14" strokeWidth="1" />
      <path d="M37.5 11.5 L22.5 32.5 L29 32.5 L25.5 52.5 L41.5 31 L34 31 Z" fill="#ffffff" />
    </svg>
  );
}
