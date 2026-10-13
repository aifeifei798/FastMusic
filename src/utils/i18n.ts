// 界面文案双语（中文 / English）。
// 策略: t() 的 key 就是中文原文（含 {n} 占位符），英文在下面的 EN 表里查；
// 未收录的 key 原样返回，所以新增文案不会崩，只是暂时保持中文。
// 语言持久化在 localStorage('fastmusic_lang')，默认中文。
export type Lang = 'zh' | 'en';

const STORAGE_KEY = 'fastmusic_lang';

let lang: Lang = 'zh';
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'en' || saved === 'zh') lang = saved;
} catch {
  // localStorage 不可用时保持中文
}

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang): void {
  lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 忽略写入失败
  }
}

export function isEn(): boolean {
  return lang === 'en';
}

// 中文原文 → 英文。key 里的 {x} 占位符在两种语言里都会被替换。
const EN: Record<string, string> = {
  // ---- 页头 / 页脚 / 快捷键 ----
  '点击退出电台模式': 'Exit radio mode',
  '进入随心电台，随机连播': 'Enter radio mode — shuffle the whole library',
  '电台广播中': 'Radio live',
  '随心电台': 'Radio',
  '查看我的收藏列表': 'View favorites',
  '播放历史记录': 'Play history',
  '快捷键说明 (?)': 'Keyboard shortcuts (?)',
  '切换到浅色主题': 'Switch to light theme',
  '切换到深色主题': 'Switch to dark theme',
  '切换主题': 'Toggle theme',
  '切换到英文界面': 'Switch to English interface',
  '切换到中文界面': 'Switch to Chinese interface',
  '切换语言': 'Toggle language',
  '系统配置': 'System config',
  '配置': 'Config',
  '电台广播中 · 点击退出电台模式': 'Radio live · click to exit radio mode',
  '随心电台 · 随机连播': 'Radio · shuffle-play the library',
  '系统配置：扫描目录 / 全库缓存任务':
    'System config: scan directories & library-wide cache jobs',
  '© 2026 FastMusic · 本地媒体流与无损音乐中心':
    '© 2026 FastMusic · Local media streaming & lossless music hub',
  '播放历史': 'History',
  '快捷键说明': 'Shortcuts',
  '键盘快捷键指南': 'Keyboard shortcuts',
  '播放 / 暂停': 'Play / pause',
  '快退 5 秒': 'Rewind 5s',
  '← 方向左键': '←',
  '快进 5 秒': 'Forward 5s',
  '→ 方向右键': '→',
  '调节音量': 'Volume',
  '↑ / ↓ 方向键': '↑ / ↓',
  '切换全屏': 'Fullscreen',
  'F 键': 'F',
  '静音 / 恢复': 'Mute / unmute',
  'M 键': 'M',
  '上一首 / 下一首': 'Previous / next',
  '随心电台 (随机连播)': 'Radio (shuffle)',
  'R 键': 'R',
  '收藏 / 取消收藏当前曲目': 'Favorite / un-favorite current track',
  'S 键': 'S',
  '歌词 开 / 关': 'Lyrics on / off',
  'L 键': 'L',
  '本面板 开 / 关': 'Toggle this panel',
  '我知道了': 'Got it',

  // ---- 曲库工具栏 ----
  '封面预取完成：命中 {hits} / {total}': 'Cover prefetch done: {hits} / {total} matched',
  '歌词预取完成：命中 {hits} / {total}': 'Lyric prefetch done: {hits} / {total} matched',
  '已转码为 {container} sidecar': 'Remuxed to {container} sidecar',
  '正在 remux/转码，完成后自动可播':
    'Remuxing / transcoding — playable as soon as it finishes',
  '转码 {progress}%': 'Transcoding {progress}%',
  '转码中': 'Transcoding',
  '转码中 {progress}%': 'Transcoding {progress}%',
  '排队等待转码（后台队列按文件从小到大处理）':
    'Queued for transcoding (the background queue processes smaller files first)',
  '排队': 'Queued',
  '转码失败': 'Transcode failed',
  '未入转码队列（PRETRANCODE_MKV=0 或新扫描的文件）':
    'Not in the transcode queue (PRETRANCODE_MKV=0 or freshly scanned file)',
  '待转码': 'To transcode',
  '补全封面 {total} 张…': 'Fetching {total} covers…',
  '封面补全：命中 {hits} / {total}': 'Cover backfill: {hits} / {total} matched',
  '曲目 {loaded}/{total}': 'Tracks {loaded}/{total}',
  '歌手 {n}': 'Artists {n}',
  '专辑 {n}': 'Albums {n}',
  '收藏 {n}': 'Favorites {n}',
  '搜索曲目、歌手或专辑...': 'Search tracks, artists or albums…',
  '命中 {n}': '{n} hits',
  '全部': 'All',
  '音乐': 'Audio',
  '曲目': 'Tracks',
  '歌手': 'Artists',
  '专辑': 'Albums',
  '收藏': 'Favorites',
  '全部类型': 'All media types',
  '只看 MTV / 视频': 'MTV / video only',
  '只看音乐 / 音频': 'Audio only',
  '媒体类型': 'Media type',
  'MTV': 'MTV',
  '上一首': 'Previous',
  '下一首': 'Next',
  '播放': 'Play',
  '暂停': 'Pause',
  '展开播放器': 'Expand player',
  '收起播放器': 'Collapse player',
  '更多': 'More',
  '筛选与工具：只看已转码 / 只看有歌词 / 预取封面 / 预取歌词 / 行密度':
    'Filters & tools: transcoded only / lyrics only / prefetch covers / prefetch lyrics / row density',
  '筛选与工具': 'Filters & tools',
  '已转码': 'Transcoded',
  '有歌词': 'Lyrics',
  '只显示已转码(或无需转码)的曲目；排队中和转码中的 .mkv 会被隐藏':
    'Show only transcoded (or already playable) tracks; queued and in-progress .mkv files are hidden',
  '只看已转码': 'Transcoded only',
  '只显示网易云有歌词的曲目（筛选只读服务端歌词缓存，先预取覆盖率更高）':
    'Show only tracks with NetEase lyrics (the filter reads the server lyric cache, so prefetching first gives better coverage)',
  '只看有歌词': 'Lyrics only',
  '列表排序（服务端 /api/tracks 的 sort 参数，默认 = 扫描索引顺序）':
    'Sort order (server-side sort param on /api/tracks; default = scan index order)',
  '默认顺序': 'Default order',
  '标题 A→Z': 'Title A→Z',
  '歌手 A→Z': 'Artist A→Z',
  '专辑 A→Z': 'Album A→Z',
  '时长': 'Duration',
  '文件大小': 'File size',
  '文件日期': 'File date',
  '随机': 'Random',
  '当前紧凑模式，点击恢复标准行高': 'Compact rows — click to restore standard rows',
  '当前标准模式，点击切换紧凑行高（紧凑隐藏专辑列，每屏多几行）':
    'Standard rows — click for compact rows (compact hides the album column, more rows per screen)',
  '紧凑行高': 'Compact rows',
  '标准行高': 'Standard rows',
  '为当前列表条目获取封面（每次最多 200 条）：优先本地内嵌封面，其次 iTunes / 网易云':
    'Fetch covers for the loaded list (max 200 at a time): embedded first, then iTunes / NetEase',
  '获取封面…': 'Fetching covers…',
  '预取封面': 'Prefetch covers',
  '为当前列表条目获取歌词（网易云，每次最多 200 条），缓存到 fastmusic_lyrics.json；「只看有歌词」也依赖这份缓存':
    'Fetch lyrics for the loaded list (NetEase, max 200 at a time) and cache them in fastmusic_lyrics.json; "Lyrics only" relies on this cache',
  '获取歌词…': 'Fetching lyrics…',
  '预取歌词': 'Prefetch lyrics',
  '全库 {total} 个 .mkv：已转码 {ready}，转码中 {running}，排队 {queued}':
    'Library: {total} .mkv files — {ready} ready, {running} running, {queued} queued',
  '，未入队 {n}': ', {n} not queued',
  '，失败 {n}': ', {n} failed',
  '字母索引:': 'A–Z index:',
  '正在筛选:': 'Filtering:',
  '歌手: {name}': 'Artist: {name}',
  '专辑: {name}': 'Album: {name}',
  '清除所有筛选': 'Clear all filters',
  '暂无匹配的媒体文件': 'No matching media files',
  '未在当前筛选中找到曲目。您可以重置筛选，或在「系统配置」里添加扫描目录并重新扫描。':
    'No tracks match the current filters. Reset the filters, or add scan directories in System config and rescan.',
  '打开系统配置 · 扫描目录': 'Open system config · scan directories',
  '曲目标题 / 艺术家': 'Track / Artist',
  '所属专辑': 'Album',
  '格式': 'Format',
  '大小 / 操作': 'Size / Actions',
  '已收藏': 'Favorited',
  '有歌词（网易云歌词缓存）': 'Has lyrics (NetEase lyric cache)',
  '取消收藏': 'Remove from favorites',
  '添加至收藏': 'Add to favorites',
  '正在拉取下一批曲目 (offset={offset})...': 'Loading the next batch (offset {offset})…',
  '已加载 {loaded} / {total} 首 · 向下滚动自动追加':
    'Loaded {loaded} / {total} · scroll down to load more',
  '已加载': 'Loaded',
  '首 · 向下滚动自动追加': '· scroll down to load more',
  '已加载全部': 'Loaded all',
  '首': 'tracks',
  '共收录': 'Total',
  '位艺术家 / UP主': 'artists / creators',
  '张专辑': 'albums',
  '已渲染 {n}': 'showing {n}',
  '已在本地收藏': 'Favorited locally',
  "首曲目 (存储于 localStorage 'favorites')": "tracks (stored in localStorage 'favorites')",
  '回到列表顶部': 'Back to the top of the list',
  '回到顶部': 'Top',
  '共收录 {n} 位艺术家 / UP主': '{n} artists / creators',
  '· 已渲染 {n}': '· showing {n}',
  '按名称': 'By name',
  '按作品数': 'By works',
  '{albums} 张专辑 · {tracks} 首作品': '{albums} albums · {tracks} works',
  '加载更多 ({n})': 'Load more ({n})',
  '共收录 {n} 张专辑': '{n} albums',
  '{n} 首曲目': '{n} tracks',
  '按曲目数': 'By tracks',
  '暂无收藏的曲目': 'No favorites yet',
  '在播放卡片区域或曲目列表中点击心形爱心 (Heart) 按钮，即可将喜爱的无损音乐与高清 MTV 保存到此处。':
    'Click the heart button in the player or in the track list to save your favourite lossless tracks and HD MTVs here.',
  '浏览全部曲目': 'Browse all tracks',
  '已在本地收藏 {n} 首曲目 (存储于 localStorage \'favorites\')':
    '{n} tracks favorited locally (stored in localStorage \'favorites\')',

  // ---- 播放器 ----
  '平': 'Flat',
  '摇滚': 'Rock',
  '流行': 'Pop',
  '古典': 'Classical',
  '电子': 'Electronic',
  '爵士': 'Jazz',
  '未选择曲目': 'No track selected',
  '排队中…': 'Queued…',
  '后台转码排队中…': 'In the background transcode queue…',
  '转码中…': 'Transcoding…',
  '画中画 (Picture in Picture)': 'Picture in Picture',
  '经典柱状频谱 (Bars EQ)': 'Classic bar spectrum',
  '柱状频谱': 'Bars',
  '示波器波形 (Waveform)': 'Oscilloscope waveform',
  '波形图': 'Waveform',
  '光晕环状频谱 (Circular Halo)': 'Circular halo spectrum',
  '光晕环': 'Halo',
  '对称双向频谱 (Mirrored EQ)': 'Mirrored spectrum',
  '对称频谱': 'Mirrored',
  '无频谱': 'No visualizer',
  '无频谱（纯黑舞台，只保留歌词与信息）':
    'No visualizer (plain stage, lyrics and info only)',
  '无': 'None',
  'MKV 需转成 WebM(VP9+Opus) 才能在本机 Chrome 出画面，完成后自动开始播放。':
    'MKV files are remuxed to WebM (VP9 + Opus) so Chrome on this machine can render them; playback starts automatically when it finishes.',
  '歌词来源: 网易云 · {title} - {artist}': 'Lyrics: NetEase · {title} - {artist}',
  '正在播放': 'Now playing',
  '未知歌手': 'Unknown artist',
  '正在从网易云获取歌词…': 'Fetching lyrics from NetEase…',
  '网易云未找到「{title}」的歌词': 'No lyrics found for "{title}" on NetEase',
  '歌词样式': 'Lyric style',
  '字号': 'Size',
  '小': 'Small',
  '中': 'Medium',
  '大': 'Large',
  '宽度': 'Width',
  '窄': 'Narrow',
  '标准': 'Standard',
  '宽': 'Wide',
  '舞台宽度有限，歌词列自动收窄到 {width}px':
    'Stage is narrow — the lyric column is automatically reduced to {width}px',
  '歌词当前关闭 — 打开后设置生效': 'Lyrics are off — these settings apply once enabled',
  '均衡器 · {state} · {preset}': 'Equalizer · {state} · {preset}',
  '手动': 'Manual',
  '均衡器 开/关': 'Equalizer on / off',
  '关': 'Off',
  '开': 'On',
  '重置均衡器 (平)': 'Reset equalizer (flat)',
  '预设: {label}': 'Preset: {label}',
  '频段: {label}': 'Band: {label}',
  '上一首 (Previous)': 'Previous',
  '暂停 (Space)': 'Pause (Space)',
  '播放 (Space)': 'Play (Space)',
  '下一首 (Next)': 'Next',
  '取消静音 (M)': 'Unmute (M)',
  '静音 (M)': 'Mute (M)',
  '音量: {volume}%{boost}': 'Volume: {volume}%{boost}',
  ' ×2 增强': ' ×2 boost',
  '音量增强 ×2 (已开启, 点击关闭)': 'Volume boost ×2 (on — click to disable)',
  '音量增强 ×2 (音乐增强)': 'Volume boost ×2',
  '已收藏 (点击取消收藏)': 'Favorited (click to remove)',
  '收藏当前曲目': 'Favorite this track',
  '模式: {mode}': 'Mode: {mode}',
  '顺序播放': 'Sequential',
  '列表循环': 'Repeat list',
  '单曲循环': 'Repeat one',
  '随机播放': 'Shuffle',
  '退出全屏 (F)': 'Exit fullscreen (F)',
  '全屏播放 (F)': 'Fullscreen (F)',
  '退出剧场模式': 'Exit theater mode',
  '剧场宽屏模式': 'Theater wide mode',
  '隐藏歌词 (L)': 'Hide lyrics (L)',
  '显示歌词 (L)': 'Show lyrics (L)',
  '歌词字号与宽度': 'Lyric size & width',
  '均衡器 (Equalizer) 面板': 'Equalizer panel',

  // ---- 系统配置 ----
  '缓存全部歌曲 / MTV 封面': 'Cache covers for every track / MTV',
  '本地内嵌 → iTunes → 网易云，图片存 covers/':
    'Embedded → iTunes → NetEase, images stored in covers/',
  '缓存全部歌手封面': 'Cache covers for every artist',
  '每个歌手取一条代表曲目解析头像': 'One representative track per artist',
  '缓存全部专辑封面': 'Cache covers for every album',
  '每个专辑取一条代表曲目解析封面': 'One representative track per album',
  '缓存全部歌曲 / MTV 歌词': 'Cache lyrics for every track / MTV',
  '网易云搜索匹配，LRC 存 lyrics/（同标题+歌手只联网一次）':
    'Matched via NetEase search, LRC stored in lyrics/ (each title + artist is fetched once)',
  '{n} 秒': '{n}s',
  '{n} 分钟': '{n} min',
  '{h} 小时 {m} 分': '{h}h {m}m',
  '扫描请求失败，请检查后端运行状态': 'Scan request failed — check that the backend is running',
  '扫描单目录失败': 'Failed to scan that directory',
  '缓存任务启动失败，请检查后端运行状态':
    'Could not start the cache job — check that the backend is running',
  '全库缓存任务 · 转码队列 · 扫描目录 · 服务端连接':
    'Library cache jobs · transcode queue · scan directories · server connection',
  '全库缓存任务': 'Library cache jobs',
  '曲目 {n}': 'Tracks {n}',
  '封面 {n}': 'Covers {n}',
  '歌词 {n}': 'Lyrics {n}',
  '已收录文件:': 'Files indexed:',
  '带内置标签:': 'With embedded tags:',
  '目录/文件名解析:': 'Parsed from folder / file names:',
  '曲目 {tracks} · 歌手 {artists} · 专辑 {albums} · 封面 {covers} · 歌词 {lyrics}':
    'Tracks {tracks} · artists {artists} · albums {albums} · covers {covers} · lyrics {lyrics}',
  '任务在服务器后台运行，关闭弹窗不会中断；结果持久化到':
    'Jobs run on the server in the background and keep going after you close this dialog. Results are stored in',
  '，中断后再次启动会自动跳过已缓存的条目。':
    ' — restarting a job skips entries that are already cached.',
  '全库首次缓存需要较长时间（网易云 / iTunes 有限流，任务会自动节流）。':
    'The first full-library pass takes a while (NetEase / iTunes rate-limit, so jobs throttle automatically).',
  '停止': 'Stop',
  '重新检查': 'Re-check',
  '开始缓存': 'Start caching',
  '已处理 {done} / {total}': 'Processed {done} / {total}',
  '已处理': 'Processed',
  '命中': 'Hits',
  '无结果': 'No result',
  '错误': 'Errors',
  '剩余 {n} 条 · 约 {eta}': '{n} left · about {eta}',
  '已停止 · 剩余 {n} 条': 'Stopped · {n} left',
  '已完成': 'Done',
  '转码 / Remux 状态': 'Transcode / remux status',
  '.mkv 总数 {n}': '{n} .mkv files in total',
  'Chrome 不能直接播放 .mkv，服务端把每个 .mkv 无损换容器成 sidecar（AV1/VP9 → WebM，H.264/HEVC → MP4），写在源文件旁边；sidecar 比源文件新就不再重复转码。':
    'Chrome cannot play .mkv directly, so the server losslessly remuxes each .mkv into a sidecar next to the source (AV1/VP9 → WebM, H.264/HEVC → MP4); a sidecar newer than the source is never re-transcoded.',
  '启动时自动排队全库转码（并发 ': 'The whole library is queued for remuxing at startup (concurrency ',
  '，默认 3），': ', default 3); ',
  ' 可关闭。': ' disables it.',
  '已就绪': 'Ready',
  '失败': 'Failed',
  '没有 .mkv 文件，无需转码。': 'No .mkv files — nothing to transcode.',
  '服务端连接配置': 'Server connection',
  '运行环境: Express + CORS': 'Runtime: Express + CORS',
  '留空为同源直连 (推荐) 或输入自定义地址如 http://localhost:3000':
    'Leave empty for same-origin (recommended), or enter a custom URL such as http://localhost:3000',
  '测试连接': 'Test connection',
  '扫描根目录列表（可添加任意多个不同存储盘/路径）':
    'Scan root directories (add as many drives or paths as you like)',
  '已配置 {n} 个路径': '{n} paths configured',
  '只扫描此目录': 'Scan only this directory',
  '单独扫描': 'Scan alone',
  '移除此目录': 'Remove this directory',
  '输入绝对路径，例如 /home/you/Music 或 D:/Music':
    'Enter an absolute path, e.g. /home/you/Music or D:/Music',
  '添加路径': 'Add path',
  '正在扫描各目录多媒体文件与标签元数据...':
    'Scanning directories for media files and tag metadata…',
  '重新扫描所有已配置目录 (POST /api/scan)': 'Rescan all configured directories (POST /api/scan)',
  '已收录文件: {n}': 'Files indexed: {n}',
  '带内置标签: {n}': 'With embedded tags: {n}',
  '目录/文件名解析: {n}': 'Parsed from folder / file names: {n}',
  '扫描与缓存策略说明': 'How scanning & caching work',
  '针对您不同的目录存放情况（如': 'For the way your directories are organised (e.g.',
  '与': 'and',
  '、': ', ',
  '）：': '):',
  '无缝多目录支持': 'Seamless multi-directory support',
  '：后端支持维护多个扫描根目录，无论歌曲分布在不同分区还是子文件夹，均可一次性扫描合并索引。':
    ': the backend keeps several scan roots, so tracks spread across partitions or subfolders are indexed in one pass.',
  '内置标签优先提取 (music-metadata)': 'Embedded tags first (music-metadata)',
  '：针对 FLAC/MP3/MP4 等文件，优先读取其内部的 ID3/Vorbis/MP4 元数据标签（标题、歌手、专辑、时长）。':
    ': for FLAC / MP3 / MP4 files the internal ID3 / Vorbis / MP4 tags (title, artist, album, duration) are read first.',
  '智能目录与文件名回退': 'Smart folder & filename fallback',
  '：对于 YouTube 下载或酷狗批量下载等无内置标签的文件，系统自动识别标准分层结构（':
    ': for files with no embedded tags (YouTube downloads, KuGou batches), the standard hierarchy is recognised (',
  '歌手/专辑/歌曲': 'Artist / Album / Track',
  ')，并支持从形如 ': '), and names like ',
  '歌手 - 歌名': 'Artist - Track',
  ' 的文件名中解析出歌手与曲名，专辑自动归类，不会出现混乱或识别失败。':
    ' are parsed for artist and title, albums are grouped automatically, with no misclassification.',
  '增量扫描': 'Incremental scanning',
  '：已索引且 (修改时间, 大小) 未变化的文件会被跳过，只有新增或改动的文件才重新解析元数据。':
    ': files already indexed whose (mtime, size) are unchanged are skipped — only new or modified files are re-parsed.',
  '封面 / 歌词缓存': 'Cover & lyric caches',
  '：封面三级兜底（本地内嵌 → iTunes → 网易云）存 ':
    ': covers fall back through embedded → iTunes → NetEase and are stored in ',
  '；歌词来自网易云明文接口，存 ': '; lyrics come from the plain NetEase API and are stored in ',
  '，索引在 ': ', with the indexes in ',
  '完成并关闭': 'Done',

  // ---- 播放历史 ----
  '刚刚': 'Just now',
  '{n} 分钟前': '{n} min ago',
  '{n} 小时前': '{n} h ago',
  '{n} 天前': '{n} d ago',
  '已保存在本地 localStorage 中，共 {n} 条播放记录':
    'Stored locally in localStorage — {n} entries',
  '清空全部历史记录': 'Clear all history',
  '清空': 'Clear',
  '在播放历史中搜索...': 'Search history…',
  '暂无播放历史记录': 'No play history yet',
  '未找到匹配的播放记录': 'No matching history entries',
  '点击任意曲目开始播放，系统将自动记录并保存在本地浏览器中。':
    'Play any track and it is recorded automatically in your browser.',
  '请尝试更换搜索关键字。': 'Try a different search term.',
  '从历史中移除': 'Remove from history',
  '点击任意曲目即可直接再次播放': 'Click any entry to play it again',
  '关闭': 'Close',

  // ---- 电台 ----
  'LIVE 随心广播': 'LIVE radio',
  '随心电台正在漫游': 'Radio is roaming the library',
  '智能全库洗牌算法 · 听完自动无缝切下一首随机曲目':
    'Smart whole-library shuffle · the next random track starts seamlessly',
  '全库漫游': 'Whole library',
  '纯音专线': 'Audio only',
  'MTV 视听': 'MTV / video',
  '换一首随机电台曲目': 'Next random radio track',
  '切台 / 换一首': 'Next track',
  '退出随心电台模式': 'Exit radio mode',

  // ---- API 提示 ----
  'Express / 媒体后端服务连接成功！': 'Backend reachable — connection OK',
  '服务响应错误: 状态码 {status}': 'Server error: status {status}',
  '连接超时，请确认服务已启动': 'Connection timed out — make sure the server is running',
  '无法连接到 {url}。': 'Could not connect to {url}.',
  '当前 Express 服务': 'the current Express server',
  '扫描失败: {status}': 'Scan failed: {status}',
  '未知艺术家': 'Unknown artist',
  '精选集': 'Compilation',
  '未配置流媒体源路径': 'No stream source path configured',
  '转码超时': 'Transcode timed out',
  '未知错误': 'unknown error',
  '本地物理文件已丢失': 'The file is no longer on disk',
  '缺少 title 或 id 参数': 'Missing title or id parameter',
  '获取歌词失败（网易云不可达或被风控）': 'Failed to fetch lyrics (NetEase unreachable or rate-limited)',
  '曲目不存在': 'Track not found',
  '未找到封面': 'No cover found',
  '封面缓存文件丢失': 'Cover cache file is missing',
  '封面获取失败': 'Failed to fetch cover',
  '未知的缓存任务类型': 'Unknown cache job type',
  '未找到该媒体文件': 'Media file not found',
  '媒体文件不存在': 'Media file does not exist',
  '指定目录不存在或为空，保留已入库 {n} 条目（增量不清空）。请配置有效的本地媒体目录。':
    'The given directory does not exist or is empty; the {n} indexed entries were kept (incremental scans never clear the library). Configure a valid local media directory.',
  '强制扫描：指定目录不存在或为空，库已清空。请配置有效的本地媒体目录。':
    'Force scan: the given directory does not exist or is empty, so the library was cleared. Configure a valid local media directory.',
  '扫描过程发生错误: {message}': 'Scan error: {message}',
  '未配置扫描目录。设置环境变量 MEDIA_DIRS="/music,/mtv" 或在「系统配置」里添加后扫描。':
    'No scan directories configured. Set MEDIA_DIRS="/music,/mtv" or add them in System config, then scan.',
  '目录配置已更新': 'Directory configuration updated',
  '扫描完成：新增 {added}，复用 {skipped}，库共 {total} 条目':
    'Scan finished: {added} new, {skipped} reused, {total} entries in the library',
  '转码失败: {error}': 'Transcode failed: {error}',
};

// 服务端返回的提示里已经插入了动态数字，无法直接作为 t() 的 key，
// 所以先匹配模板、把数字填回占位符，再走 EN 表。
const SERVER_MESSAGE_PATTERNS: Array<[RegExp, string, string[]]> = [
  [/^扫描完成：新增 (\d+)，复用 (\d+)，库共 (\d+) 条目$/, '扫描完成：新增 {added}，复用 {skipped}，库共 {total} 条目', ['added', 'skipped', 'total']],
  [/^指定目录不存在或为空，保留已入库 (\d+) 条目（增量不清空）。请配置有效的本地媒体目录。$/, '指定目录不存在或为空，保留已入库 {n} 条目（增量不清空）。请配置有效的本地媒体目录。', ['n']],
  [/^扫描过程发生错误: (.+)$/, '扫描过程发生错误: {message}', ['message']],
  [/^转码失败: (.+)$/, '转码失败: {error}', ['error']],
];

export function tServerMessage(msg: string): string {
  if (lang !== 'en' || !msg) return msg;
  for (const [re, key, names] of SERVER_MESSAGE_PATTERNS) {
    const m = msg.match(re);
    if (m) {
      const vars: Record<string, string> = {};
      names.forEach((name, i) => {
        vars[name] = m[i + 1];
      });
      return t(key, vars);
    }
  }
  return t(msg);
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const source = lang === 'en' ? EN[key] ?? key : key;
  if (!vars) return source;
  return source.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
}
