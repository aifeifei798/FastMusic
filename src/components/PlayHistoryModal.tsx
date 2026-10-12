import React, { useState, useMemo } from 'react';
import { X, History, Trash2, Play, Film, Music, Search } from 'lucide-react';
import { MediaItem, PlayHistoryItem } from '../types/media';

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
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
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
      <div className="w-full max-w-xl bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-900/90">
          <div className="flex items-center gap-2.5">
            <History className="w-5 h-5 text-rose-500" />
            <div>
              <h3 className="font-semibold text-neutral-100 text-sm sm:text-base">
                播放历史记录
              </h3>
              <p className="text-[11px] text-neutral-400">
                已保存在本地 localStorage 中，共 {history.length} 条播放记录
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {history.length > 0 && (
              <button
                onClick={onClearHistory}
                title="清空全部历史记录"
                className="px-2.5 py-1 rounded-lg text-neutral-400 hover:text-rose-400 hover:bg-neutral-800 transition-colors text-xs flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>清空</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search bar inside history */}
        {history.length > 0 && (
          <div className="px-5 py-2.5 border-b border-neutral-800/80 bg-neutral-950/40 flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-neutral-500" />
            <input
              type="text"
              placeholder="在播放历史中搜索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-neutral-500 hover:text-neutral-300"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* History List */}
        <div className="flex-1 overflow-y-auto p-3 divide-y divide-neutral-800/50">
          {filteredHistory.length === 0 ? (
            <div className="py-16 text-center text-neutral-500 flex flex-col items-center">
              <History className="w-12 h-12 stroke-1 text-neutral-600 mb-3" />
              <p className="text-sm font-medium text-neutral-300">
                {history.length === 0 ? '暂无播放历史记录' : '未找到匹配的播放记录'}
              </p>
              <p className="text-xs text-neutral-500 mt-1 max-w-xs">
                {history.length === 0
                  ? '点击任意曲目开始播放，系统将自动记录并保存在本地浏览器中。'
                  : '请尝试更换搜索关键字。'}
              </p>
            </div>
          ) : (
            filteredHistory.map((item, idx) => {
              const isVideo = item.track.media_type === 'video';
              return (
                <div
                  key={`${item.track.id}-${item.playedAt}-${idx}`}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-neutral-800/60 transition-colors cursor-pointer group"
                  onClick={() => onPlayTrack(item.track)}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {/* Cover or Icon */}
                    <div className="w-10 h-10 rounded-lg bg-neutral-800 border border-neutral-700/80 flex items-center justify-center shrink-0 overflow-hidden relative">
                      {item.track.cover_url ? (
                        <img
                          src={item.track.cover_url}
                          alt={item.track.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : isVideo ? (
                        <Film className="w-4 h-4 text-rose-400" />
                      ) : (
                        <Music className="w-4 h-4 text-neutral-400" />
                      )}
                    </div>

                    {/* Metadata */}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-neutral-100 group-hover:text-rose-300 truncate">
                        {item.track.title}
                      </div>
                      <div className="text-[11px] text-neutral-400 truncate mt-0.5 flex items-center gap-2">
                        <span className="text-neutral-300">{item.track.artist}</span>
                        <span aria-hidden="true" className="text-neutral-600">·</span>
                        <span className="truncate">{item.track.album}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions & Timestamp */}
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <span className="text-[11px] font-mono text-neutral-500 tabular-nums">
                      {formatTimeAgo(item.playedAt)}
                    </span>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveItem(item.track.id);
                      }}
                      title="从历史中移除"
                      className="p-1.5 rounded-lg text-neutral-500 hover:text-rose-400 hover:bg-neutral-700/60 transition-colors opacity-0 group-hover:opacity-100"
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
        <div className="px-6 py-3 border-t border-neutral-800 bg-neutral-900/90 flex items-center justify-between text-[11px] text-neutral-400">
          <span>点击任意曲目即可直接再次播放</span>
          <button
            onClick={onClose}
            className="px-3.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg transition-colors text-xs"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
