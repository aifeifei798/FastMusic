import React, { useState, useEffect } from 'react';
import { 
  X, 
  Server, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  FolderPlus, 
  Trash2, 
  Folder, 
  Radio, 
  Sliders, 
  FileAudio,
  FileVideo,
  Info
} from 'lucide-react';
import { mediaApi } from '../services/api';
import { ScanResponse } from '../types/media';
import { SCROLLBAR_CLASSES } from '../utils/ui';

interface ServerConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefreshData: () => void;
}

export const ServerConfigModal: React.FC<ServerConfigModalProps> = ({
  isOpen,
  onClose,
  onRefreshData,
}) => {
  const [baseUrl, setBaseUrl] = useState<string>(mediaApi.getBaseUrl());

  // Multiple scan directories list (空列表 = 尚未配置, 打开弹窗时从服务端读取)
  const [directories, setDirectories] = useState<string[]>([]);
  const [newDirPath, setNewDirPath] = useState<string>('');
  
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; trackCount?: number } | null>(null);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  // Load configured directories on mount or open
  useEffect(() => {
    if (!isOpen) return;
    mediaApi.getDirectories().then(dirs => {
      if (dirs && dirs.length > 0) {
        setDirectories(dirs.map(d => d.path));
      }
    }).catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveAndTest = async () => {
    mediaApi.setBaseUrl(baseUrl);
    setIsTesting(true);
    setTestResult(null);

    const res = await mediaApi.testConnection();
    setTestResult(res);
    setIsTesting(false);
    if (res.ok) {
      onRefreshData();
    }
  };

  const handleAddDirectory = () => {
    const trimmed = newDirPath.trim();
    if (!trimmed) return;
    if (directories.includes(trimmed)) return;
    const updated = [...directories, trimmed];
    setDirectories(updated);
    setNewDirPath('');
    mediaApi.updateDirectories(updated);
  };

  const handleRemoveDirectory = (dirToRemove: string) => {
    const updated = directories.filter(d => d !== dirToRemove);
    setDirectories(updated);
    mediaApi.updateDirectories(updated);
  };

  const handleScanAll = async () => {
    setIsScanning(true);
    setScanResult(null);
    setScanError(null);
    try {
      const res = await mediaApi.scanLibrary(directories);
      setScanResult(res);
      onRefreshData();
    } catch (err: any) {
      setScanError(err.message || '扫描请求失败，请检查后端运行状态');
    } finally {
      setIsScanning(false);
    }
  };

  const handleScanSingle = async (dirPath: string) => {
    setIsScanning(true);
    setScanResult(null);
    setScanError(null);
    try {
      const res = await mediaApi.scanLibrary([dirPath]);
      setScanResult(res);
      onRefreshData();
    } catch (err: any) {
      setScanError(err.message || '扫描单目录失败');
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-900/90 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-neutral-100 text-sm sm:text-base">
                Express 多源媒体库与扫描配置
              </h3>
              <p className="text-[11px] text-neutral-400">
                支持多目录联合扫描 · ID3/Vorbis 标签优先提取 · 目录与文件名智能推断
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className={`p-6 space-y-6 overflow-y-auto text-xs text-neutral-300 ${SCROLLBAR_CLASSES}`}>
          {/* Service Base URL & Test */}
          <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-neutral-200">服务端连接配置</span>
              <span className="text-[11px] text-neutral-400">运行环境: Express + CORS</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="留空为同源直连 (推荐) 或输入自定义地址如 http://localhost:3000"
                className="flex-1 px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-xl text-neutral-200 font-mono text-xs focus:outline-none focus:border-rose-500"
              />
              <button
                onClick={handleSaveAndTest}
                disabled={isTesting}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-xl font-medium transition-colors flex items-center gap-1.5 shrink-0"
              >
                {isTesting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-rose-400" />
                )}
                <span>测试连接</span>
              </button>
            </div>
            {testResult && (
              <div
                className={`p-2.5 rounded-xl border flex items-center gap-2 text-xs ${
                  testResult.ok
                    ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                    : 'bg-rose-950/40 border-rose-800 text-rose-300'
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>

          {/* Multi-Directory Management */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="font-medium text-neutral-200 flex items-center gap-1.5">
                <Folder className="w-4 h-4 text-amber-400" />
                <span>扫描根目录列表（可添加任意多个不同存储盘/路径）</span>
              </label>
              <span className="text-[11px] text-neutral-500">已配置 {directories.length} 个路径</span>
            </div>

            {/* List of directories */}
            <div className="space-y-2 mb-3">
              {directories.map((dir, idx) => (
                <div
                  key={idx}
                  className="group flex items-center justify-between p-2.5 bg-neutral-950 border border-neutral-800 rounded-xl hover:border-neutral-700 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <Folder className="w-4 h-4 text-neutral-500 group-hover:text-amber-400 transition-colors shrink-0" />
                    <span className="font-mono text-xs text-neutral-200 truncate select-all">{dir}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleScanSingle(dir)}
                      disabled={isScanning}
                      title="只扫描此目录"
                      className="px-2.5 py-1 text-[11px] bg-neutral-900 hover:bg-neutral-800 text-neutral-300 rounded-lg border border-neutral-800 transition-colors"
                    >
                      单独扫描
                    </button>
                    <button
                      onClick={() => handleRemoveDirectory(dir)}
                      title="移除此目录"
                      className="p-1.5 text-neutral-500 hover:text-rose-400 hover:bg-neutral-900 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add new directory input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newDirPath}
                onChange={(e) => setNewDirPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddDirectory();
                }}
                placeholder="输入绝对路径，例如 /home/you/Music 或 D:/Music"
                className="flex-1 px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-xl text-neutral-200 font-mono text-xs focus:outline-none focus:border-rose-500"
              />
              <button
                onClick={handleAddDirectory}
                disabled={!newDirPath.trim()}
                className="px-3.5 py-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-neutral-200 rounded-xl font-medium transition-colors flex items-center gap-1.5 shrink-0"
              >
                <FolderPlus className="w-3.5 h-3.5 text-emerald-400" />
                <span>添加路径</span>
              </button>
            </div>
          </div>

          {/* Trigger Scan Button */}
          <div className="pt-2">
            <button
              onClick={handleScanAll}
              disabled={isScanning || directories.length === 0}
              className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-rose-900/20"
            >
              {isScanning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>正在扫描各目录多媒体文件与标签元数据...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  <span>扫描所有已配置目录 (POST /api/scan)</span>
                </>
              )}
            </button>

            {/* Scan Result Feedback */}
            {scanResult && (
              <div className="mt-3 p-3.5 rounded-xl bg-neutral-950 border border-emerald-800/60 text-neutral-200 space-y-1.5 animate-in fade-in">
                <div className="flex items-center gap-2 text-emerald-400 font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{scanResult.message}</span>
                </div>
                {scanResult.scan_summary && (
                  <div className="text-[11px] text-neutral-400 grid grid-cols-3 gap-2 pt-1 border-t border-neutral-900">
                    <div>已收录文件: <span className="text-neutral-200 font-mono">{scanResult.scan_summary.total_files}</span></div>
                    <div>带内置标签: <span className="text-emerald-300 font-mono">{scanResult.scan_summary.tagged_files}</span></div>
                    <div>目录/文件名解析: <span className="text-amber-300 font-mono">{scanResult.scan_summary.path_parsed_files}</span></div>
                  </div>
                )}
              </div>
            )}

            {scanError && (
              <div className="mt-3 p-3 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 flex items-center gap-2 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{scanError}</span>
              </div>
            )}
          </div>

          {/* Architecture & Scanning Strategy Info Card */}
          <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2.5">
            <div className="flex items-center gap-2 text-rose-400 font-medium">
              <Info className="w-4 h-4" />
              <span>智能扫描与兼容策略说明</span>
            </div>
            <div className="text-[11px] text-neutral-400 leading-relaxed space-y-1.5">
              <p>
                针对您不同的目录存放情况（如 <code className="text-neutral-300">KuGou/flac</code> 与 <code className="text-neutral-300">youtube</code>、<code className="text-neutral-300">youtube-music</code>）：
              </p>
              <ul className="list-disc pl-4 space-y-1 text-neutral-400">
                <li>
                  <strong className="text-neutral-200">无缝多目录支持</strong>：后端支持维护多个扫描根目录，无论歌曲分布在不同分区还是子文件夹，均可一次性扫描合并索引。
                </li>
                <li>
                  <strong className="text-neutral-200">内置标签优先提取 (music-metadata)</strong>：针对 FLAC/MP3/MP4 等文件，优先读取其内部的 ID3/Vorbis/MP4 元数据标签（标题、歌手、专辑、时长）。
                </li>
                <li>
                  <strong className="text-neutral-200">智能目录与文件名回退</strong>：对于 YouTube 下载或酷狗批量下载等无内置标签的文件，系统自动识别标准分层结构（<code className="text-neutral-300">歌手/专辑/歌曲</code>），并支持从形如 <code className="text-neutral-300">歌手 - 歌名</code> 的文件名中解析出歌手与曲名，专辑自动归类，不会出现混乱或识别失败。
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-neutral-800 bg-neutral-900/90 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-xl text-xs font-medium transition-colors"
          >
            完成并关闭
          </button>
        </div>
      </div>
    </div>
  );
};
