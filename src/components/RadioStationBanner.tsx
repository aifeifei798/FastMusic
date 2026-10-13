import React from 'react';
import {
  Radio,
  Shuffle,
  Music,
  Film,
  SkipForward,
  X
} from 'lucide-react';
import { MediaItem, RadioChannel } from '../types/media';
import { t } from '../utils/i18n';

interface RadioStationBannerProps {
  isRadioMode: boolean;
  activeChannel: RadioChannel;
  currentTrack: MediaItem | null;
  frequency: string;
  onSwitchChannel: (channel: RadioChannel) => void;
  onNextRandom: () => void;
  onExitRadio: () => void;
  isPlaying?: boolean;
}

// 频道按钮: 纯图标, 名称只在 title / aria-label 里 (窄屏一行装得下)
const CHANNELS: Array<{ channel: RadioChannel; icon: typeof Shuffle; label: string }> = [
  { channel: 'all', icon: Shuffle, label: '全库漫游' },
  { channel: 'audio', icon: Music, label: '纯音专线' },
  { channel: 'video', icon: Film, label: 'MTV 视听' },
];

export const RadioStationBanner: React.FC<RadioStationBannerProps> = ({
  isRadioMode,
  activeChannel,
  currentTrack,
  frequency,
  onSwitchChannel,
  onNextRandom,
  onExitRadio,
  isPlaying = true,
}) => {
  if (!isRadioMode) return null;

  // 'FM 102.4 MHz' → '102.4 MHz'（品牌已经带 FM，避免重复）
  const freq = frequency.replace(/^FM\s+/, '');

  return (
    <div
      className="relative overflow-hidden rounded-xl bg-gradient-to-r from-accent-dim/70 via-surface/90 to-purple-dim/70 border border-accent/40 shadow-lg shadow-accent/20 backdrop-blur-md px-3 py-2 flex items-center gap-2 animate-in fade-in slide-in-from-top-4 duration-300"
      title={t('智能全库洗牌算法 · 听完自动无缝切下一首随机曲目')}
    >
      {/* Background ambient radio wave glow */}
      <div className="absolute -top-12 -right-12 w-48 h-48 bg-accent/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-12 w-48 h-48 bg-purple/10 rounded-full blur-3xl pointer-events-none" />

      {/* Station branding + frequency + what is playing — 一行 */}
      <div className="relative z-10 flex items-center gap-2 min-w-0 flex-1">
        <div className="relative w-8 h-8 rounded-lg bg-gradient-to-tr from-accent to-amber flex items-center justify-center text-white shadow-md shadow-accent/40 shrink-0">
          <Radio className="w-4 h-4 animate-pulse" />
          <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent"></span>
          </span>
        </div>

        <span className="hidden sm:inline text-[11px] font-bold tracking-wider uppercase text-accent font-mono whitespace-nowrap">
          FastMusic FM · {freq}
        </span>
        <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent/20 text-accent-soft border border-accent/30">
          {isPlaying ? t('LIVE 随心广播') : t('随心电台正在漫游')}
        </span>
        {currentTrack && (
          <span className="text-xs text-ink-3 font-mono truncate min-w-0 flex-1" title={currentTrack.title}>
            &bull; {currentTrack.title}
          </span>
        )}
      </div>

      {/* Channel switcher — icon only */}
      <div className="relative z-10 flex items-center gap-1 bg-app/80 p-1 rounded-lg border border-line shrink-0">
        {CHANNELS.map(({ channel, icon: Icon, label }) => (
          <button
            key={channel}
            onClick={() => onSwitchChannel(channel)}
            title={t(label)}
            aria-label={t(label)}
            className={`p-1.5 rounded-lg transition-all cursor-pointer ${
              activeChannel === channel
                ? 'bg-accent text-white shadow-sm'
                : 'text-muted hover:text-ink hover:bg-surface-2/60'
            }`}
          >
            <Icon className="w-4 h-4" />
          </button>
        ))}
      </div>

      {/* 切台 / 换一首 — icon only */}
      <button
        onClick={onNextRandom}
        title={t('切台 / 换一首')}
        aria-label={t('切台 / 换一首')}
        className="p-1.5 rounded-lg bg-gradient-to-r from-amber to-accent text-white shadow-md shadow-amber/30 transition-all active:scale-95 cursor-pointer shrink-0"
      >
        <SkipForward className="w-4 h-4 fill-white" />
      </button>

      {/* Exit radio — icon only */}
      <button
        onClick={onExitRadio}
        title={t('退出随心电台模式')}
        aria-label={t('退出随心电台模式')}
        className="p-1.5 rounded-lg bg-surface/90 hover:bg-surface-2 border border-line text-muted hover:text-ink transition-colors cursor-pointer shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
