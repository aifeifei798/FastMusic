import React, { useState, useMemo } from 'react';
import { X, History, Trash2, Play, Film, Music, Search } from 'lucide-react';
import { MediaItem, PlayHistoryItem } from '../types/media';
import { SCROLLBAR_CLASSES } from '../utils/ui';
import { t } from '../utils/i18n';

interface PlayHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  history: PlayHistoryItem[];
  onPlayTrack: (track: MediaItem) => void;
  onRemoveItem: (trackId: string) => void;
  onClearHistory: () => void;
}

export const PlayHistoryModal: React.FC<PlayHistoryModalProps> = ({
  isOpen,
  onClose,
  history,
  onPlayTrack,
  onRemoveItem,
  onClearHistory,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;

  const formatTimeAgo = (timestamp: number): string => {
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 60) return t('刚刚');
    if (diff < 3600) return t('{n} 分钟前', { n: Math.floor(diff / 60) });
    if (diff < 86400) return t('{n} 小时前', { n: Math.floor(diff / 3600) });
    if (diff < 86400 * 7) return t('{n} 天前', { n: Math.floor(diff / 86400) });
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  const filteredHistory = history.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.track.title.toLowerCase().includes(q) ||
      item.track.artist.toLowerCase().includes(q) ||
      item.track.album.toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-surface/90">
          <div className="flex items-center gap-2.5">
            <History className="w-5 h-5 text-accent" />
            <div>
              <h3 className="font-semibold text-ink text-sm sm:text-base">
                {t('播放历史记录')}
              </h3>
              <p className="text-[11px] text-muted">
                {t('已保存在本地 localStorage 中，共 {n} 条播放记录', { n: history.length })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {history.length > 0 && (
              <button
                onClick={onClearHistory}
                title={t('清空全部历史记录')}
                className="px-2.5 py-1 rounded-lg text-muted hover:text-accent hover:bg-surface-2 transition-colors text-xs flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t('清空')}</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface-2 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search bar inside history */}
        {history.length > 0 && (
          <div className="px-5 py-2.5 border-b border-line/80 bg-app/40 flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-muted-2" />
            <input
              type="text"
              placeholder={t('在播放历史中搜索...')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-xs text-ink-2 placeholder-muted-2 focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-muted-2 hover:text-ink-3"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* History List */}
        <div className={`flex-1 overflow-y-auto p-3 divide-y divide-line/50 ${SCROLLBAR_CLASSES}`}>
          {filteredHistory.length === 0 ? (
            <div className="py-16 text-center text-muted-2 flex flex-col items-center">
              <History className="w-12 h-12 stroke-1 text-faint mb-3" />
              <p className="text-sm font-medium text-ink-3">
                {history.length === 0 ? t('暂无播放历史记录') : t('未找到匹配的播放记录')}
              </p>
              <p className="text-xs text-muted-2 mt-1 max-w-xs">
                {history.length === 0
                  ? t('点击任意曲目开始播放，系统将自动记录并保存在本地浏览器中。')
                  : t('请尝试更换搜索关键字。')}
              </p>
            </div>
          ) : (
            filteredHistory.map((item, idx) => {
              const isVideo = item.track.media_type === 'video';
              return (
                <div
                  key={`${item.track.id}-${item.playedAt}-${idx}`}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-surface-2/60 transition-colors cursor-pointer group"
                  onClick={() => onPlayTrack(item.track)}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {/* Cover or Icon */}
                    <div className="w-10 h-10 rounded-lg bg-surface-2 border border-line-strong/80 flex items-center justify-center shrink-0 overflow-hidden relative">
                      {item.track.cover_url ? (
                        <img
                          src={item.track.cover_url}
                          alt={item.track.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : isVideo ? (
                        <Film className="w-4 h-4 text-accent" />
                      ) : (
                        <Music className="w-4 h-4 text-muted" />
                      )}
                    </div>

                    {/* Metadata */}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-ink group-hover:text-accent-soft truncate">
                        {item.track.title}
                      </div>
                      <div className="text-[11px] text-muted truncate mt-0.5 flex items-center gap-2">
                        <span className="text-ink-3">{t(item.track.artist)}</span>
                        <span aria-hidden="true" className="text-faint">·</span>
                        <span className="truncate">{item.track.album}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions & Timestamp */}
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <span className="text-[11px] font-mono text-muted-2 tabular-nums">
                      {formatTimeAgo(item.playedAt)}
                    </span>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveItem(item.track.id);
                      }}
                      title={t('从历史中移除')}
                      className="p-1.5 rounded-lg text-muted-2 hover:text-accent hover:bg-elevated/60 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-line bg-surface/90 flex items-center justify-between text-[11px] text-muted">
          <span>{t('点击任意曲目即可直接再次播放')}</span>
          <button
            onClick={onClose}
            className="px-3.5 py-1 bg-surface-2 hover:bg-elevated text-ink-2 rounded-lg transition-colors text-xs"
          >
            {t('关闭')}
          </button>
        </div>
      </div>
    </div>
  );
};
