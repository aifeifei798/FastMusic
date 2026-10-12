// 主题工具: UI 颜色全部走 index.css 里的语义 token(bg-app / text-ink ...),
// 但 canvas 绘制、占位渐变这类 JS 里的颜色需要按主题取不同的值。
export type ThemeName = 'dark' | 'light';

export function currentTheme(): ThemeName {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

// 频谱/波形/环状视觉器的配色: 深色主题是亮 rose 频谱在黑底上,
// 浅色主题是更饱和的深 rose 频谱在浅底上(浅底上的浅粉几乎看不见)。
export const VISUALIZER_PALETTE: Record<ThemeName, {
  glow: [string, string];
  // 浅色主题下 ambient 光晕会把整块舞台染成粉色, 所以强度减半, 更接近 Apple 的克制
  glowScale: number;
  barActive: string[];
  barIdle: string[];
  waveActive: string;
  waveIdle: string;
  glowStroke: string;
  circleIdle: string;
  circleSat: number;
  circleLight: number;
  mirroredIdle: string[];
  peakCap: string;
}> = {
  dark: {
    glow: ['rgba(244, 63, 94, ', 'rgba(251, 113, 133, '],
    glowScale: 1,
    barActive: ['#fda4af', '#f43f5e', '#e11d48', '#9f1239'],
    barIdle: ['#52525b', '#27272a'],
    waveActive: '#f43f5e',
    waveIdle: '#52525b',
    glowStroke: 'rgba(244, 63, 94, 0.25)',
    circleIdle: '#3f3f46',
    circleSat: 90,
    circleLight: 65,
    mirroredIdle: ['#3f3f46', '#27272a'],
    peakCap: '#ffffff',
  },
  light: {
    glow: ['rgba(214, 59, 85, ', 'rgba(229, 107, 131, '],
    glowScale: 0.5,
    barActive: ['#f0a6b4', '#d63b55', '#a82b42', '#7d1f31'],
    barIdle: ['#c9c9d2', '#d8d8e0'],
    waveActive: '#d63b55',
    waveIdle: '#b9b9c4',
    glowStroke: 'rgba(214, 59, 85, 0.22)',
    circleIdle: '#c3c3cc',
    circleSat: 72,
    circleLight: 48,
    mirroredIdle: ['#c9c9d2', '#d8d8e0'],
    peakCap: '#ffffff',
  },
};

// 无封面时的占位渐变: 深色主题用暗色, 浅色主题用柔和的浅色 pastel
export function coverGradient(text: string, theme: ThemeName): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = (h >>> 0) % 360;
  if (theme === 'light') {
    return `linear-gradient(135deg, hsl(${hue} 34% 88%), hsl(${(hue + 45) % 360} 42% 78%))`;
  }
  return `linear-gradient(135deg, hsl(${hue} 40% 24%), hsl(${(hue + 45) % 360} 50% 12%))`;
}
