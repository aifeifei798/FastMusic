import React from 'react';
import { X, Trash2, Play, Music, Film, ListMusic } from 'lucide-react';
import { MediaItem } from '../types/media';

interface PlayQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
  queue: MediaItem[];
  currentIndex: number;
  onSelectIndex: (index: number) => void;
  onRemoveTrack: (index: number) => void;
  onClearQueue: () => void;
}

export const PlayQueueModal: React.FC<PlayQueueModalProps> = ({
  isOpen,
  onClose,
  queue,
  currentIndex,
  onSelectIndex,
  onRemoveTrack,
  onClearQueue,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-900/80">
          <div className="flex items-center gap-2">
            <ListMusic className="w-5 h-5 text-rose-500" />
            <h3 className="font-semibold text-neutral-100 text-sm sm:text-base">
              播放队列 ({queue.length})
            </h3>
          </div>

          <div className="flex items-center gap-2">
            {queue.length > 0 && (
              <button
                onClick={onClearQueue}
                title="清空队列"
                className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-400 hover:bg-neutral-800 transition-colors text-xs flex items-center gap-1"
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

        {/* Content list */}
        <div className="flex-1 overflow-y-auto p-3 divide-y divide-neutral-800/50">
          {queue.length === 0 ? (
            <div className="py-12 text-center text-neutral-500 text-xs">
              播放队列为空，请在媒体库中点击曲目或“+”添加到队列。
            </div>
          ) : (
            queue.map((track, idx) => {
              const isCurrent = idx === currentIndex;
              return (
                <div
                  key={`${track.id}-${idx}`}
                  className={`flex items-center justify-between p-3 rounded-xl transition-colors cursor-pointer group ${
                    isCurrent
                      ? 'bg-rose-950/40 text-rose-300 font-medium'
                      : 'hover:bg-neutral-800/60 text-neutral-300'
                  }`}
                  onClick={() => onSelectIndex(idx)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0">
                      {isCurrent ? (
                        <div className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                      ) : (
                        <span className="text-[11px] font-mono text-neutral-500 tabular-nums">
                          {idx + 1}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="text-xs truncate font-medium">
                        {track.title}
                      </div>
                      <div className="text-[11px] text-neutral-400 truncate mt-0.5 flex items-center gap-1.5">
                        <span>{track.artist}</span>
                        <span>·</span>
                        <span className="uppercase text-[10px] text-neutral-500 font-mono">
                          {track.ext.replace('.', '')}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveTrack(idx);
                      }}
                      className="p-1 rounded hover:bg-neutral-700/80 text-neutral-500 hover:text-rose-400 transition-colors"
                      title="从队列中移除"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
