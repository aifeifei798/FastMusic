import React from 'react';
import { 
  Radio, 
  Shuffle, 
  Sparkles, 
  Music, 
  Film, 
  Volume2, 
  X, 
  SkipForward, 
  Disc3,
  Waves
} from 'lucide-react';
import { MediaItem, RadioChannel } from '../types/media';

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

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-accent-dim/70 via-surface/90 to-purple-dim/70 border border-accent/40 shadow-xl shadow-accent/20 backdrop-blur-md p-4 sm:p-5 transition-all animate-in fade-in slide-in-from-top-4 duration-300">
      {/* Background ambient radio wave glow */}
      <div className="absolute -top-12 -right-12 w-48 h-48 bg-accent/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-12 w-48 h-48 bg-purple/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Left Section: Live Radio Branding & Frequency */}
        <div className="flex items-center gap-3.5">
          <div className="relative w-12 h-12 rounded-xl bg-gradient-to-tr from-accent to-amber flex items-center justify-center text-white shadow-lg shadow-accent/40 shrink-0">
            <Radio className="w-6 h-6 animate-pulse" />
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-accent"></span>
            </span>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tracking-wider uppercase text-accent font-mono">
                FastMusic FM · {frequency}
              </span>
              <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-semibold bg-accent/20 text-accent-soft border border-accent/30">
                LIVE 随心广播
              </span>
            </div>

            <h3 className="text-base sm:text-lg font-bold text-ink tracking-tight flex items-center gap-2 truncate">
              <span>随心电台正在漫游</span>
              {currentTrack && (
                <span className="text-xs font-normal text-ink-3 truncate font-mono">
                  &bull; {currentTrack.title}
                </span>
              )}
            </h3>

            <p className="text-xs text-muted flex items-center gap-1.5 mt-0.5">
              <Sparkles className="w-3 h-3 text-amber" />
              <span>智能全库洗牌算法 · 听完自动无缝切下一首随机曲目</span>
            </p>
          </div>
        </div>

        {/* Center/Right Section: Channel Switchers and Controls */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
          {/* Channel selector */}
          <div className="flex items-center bg-app/80 p-1 rounded-xl border border-line text-xs font-medium">
            <button
              onClick={() => onSwitchChannel('all')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeChannel === 'all'
                  ? 'bg-accent text-white font-semibold shadow-sm'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <Shuffle className="w-3.5 h-3.5" />
              <span>全库漫游</span>
            </button>
            <button
              onClick={() => onSwitchChannel('audio')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeChannel === 'audio'
                  ? 'bg-accent text-white font-semibold shadow-sm'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <Music className="w-3.5 h-3.5" />
              <span>纯音专线</span>
            </button>
            <button
              onClick={() => onSwitchChannel('video')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeChannel === 'video'
                  ? 'bg-accent text-white font-semibold shadow-sm'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>MTV 视听</span>
            </button>
          </div>

          {/* Action: Next Random Track / 切台 */}
          <button
            onClick={onNextRandom}
            title="换一首随机电台曲目"
            className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber to-accent hover:from-amber hover:to-accent text-white text-xs font-semibold shadow-md shadow-amber/30 flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
          >
            <SkipForward className="w-4 h-4 fill-white" />
            <span>切台 / 换一首</span>
          </button>

          {/* Action: Exit Radio Mode */}
          <button
            onClick={onExitRadio}
            title="退出随心电台模式"
            className="p-1.5 rounded-xl bg-surface/90 hover:bg-surface-2 border border-line text-muted hover:text-ink transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
