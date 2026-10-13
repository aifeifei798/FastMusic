import React, { useEffect, useRef, useState } from 'react';
import { Activity, BarChart2, Waves, Disc } from 'lucide-react';
import { currentTheme, VISUALIZER_PALETTE, type VisualizerPalette } from '../utils/theme';

export type VisualizerMode = 'bars' | 'wave' | 'circle' | 'mirrored' | 'none';

interface AudioVisualizerProps {
  isPlaying: boolean;
  mediaElement?: HTMLMediaElement | null;
  visualizerMode?: VisualizerMode;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  isPlaying,
  mediaElement,
  visualizerMode = 'bars'
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const [isAudioContextActive, setIsAudioContextActive] = useState<boolean>(false);

  // Consume the AnalyserNode owned by the player (VideoJsPlayer wires
  // source -> 均衡izer -> analyser -> destination and publishes it on window).
  // The visualizer no longer owns the audio graph, so it never re-connects the
  // media source and can never clobber the equalizer's signal path.
  useEffect(() => {
    const win = window as unknown as { _fastMusicAnalyser?: AnalyserNode | null };
    const shared = win._fastMusicAnalyser;
    if (shared) {
      analyserRef.current = shared;
      setIsAudioContextActive(true);
    } else {
      analyserRef.current = null;
      setIsAudioContextActive(false);
    }
  }, [isPlaying]);

  // Main Canvas Rendering Loop with real Web Audio frequency data + silky fallback
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let phase = 0;
    const bufferLength = 128;
    const freqData = new Uint8Array(bufferLength);
    const timeData = new Uint8Array(bufferLength);
    const smoothBars = new Float32Array(bufferLength).fill(4);

    // canvas 的像素尺寸 = 容器实际尺寸 × DPR（上限 2）。之前写死 800×360，CSS 把它
    // 拉伸到舞台/全屏尺寸，频谱在高分屏上明显发糊。
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };
    resizeCanvas();
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas);

    // 系统「减少动态效果」时降帧；暂停时也降到 ~15fps（频谱只是缓慢的呼吸动画，
    // 60fps 白耗 CPU，手机上尤其明显）
    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let lastFrameAt = 0;

    const render = (now: number) => {
      const minInterval = isPlaying && !reducedMotion ? 0 : 66;
      if (minInterval > 0 && now - lastFrameAt < minInterval) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }
      lastFrameAt = now;

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      // Read the player-owned analyser fresh each frame (the player effect runs
      // after this component's init effect, so window is the reliable source).
      const analyser =
        (window as unknown as { _fastMusicAnalyser?: AnalyserNode | null })._fastMusicAnalyser ??
        analyserRef.current;
      let hasRealAudioSignal = false;

      if (analyser && isPlaying) {
        analyser.getByteFrequencyData(freqData);
        analyser.getByteTimeDomainData(timeData);
        // Check if there is actual non-zero frequency signal
        let sum = 0;
        for (let i = 0; i < 32; i++) {
          sum += freqData[i];
        }
        if (sum > 10) {
          hasRealAudioSignal = true;
        }
      }

      // Smooth phase for fallback/enhancement
      phase += isPlaying ? 0.06 : 0.01;

      // 1. Ambient Background Center Glow based on audio energy
      const centerX = width / 2;
      const centerY = height / 2;
      let bassEnergy = 0;
      if (hasRealAudioSignal) {
        for (let i = 0; i < 8; i++) bassEnergy += freqData[i];
        bassEnergy = bassEnergy / (8 * 255);
      } else if (isPlaying) {
        bassEnergy = 0.25 + 0.15 * Math.sin(phase * 1.5);
      }

      const pal = palette(); // 每帧只读一次主题, 切换后配色自动变
      const glowRadius = Math.max(60, width * 0.45 * (0.8 + bassEnergy * 0.5));
      const gradient = ctx.createRadialGradient(centerX, centerY, 30, centerX, centerY, glowRadius);
      gradient.addColorStop(0, isPlaying ? `${pal.glow[0]}${(0.15 + bassEnergy * 0.25) * pal.glowScale})` : 'rgba(255, 255, 255, 0.02)');
      gradient.addColorStop(0.5, isPlaying ? `${pal.glow[1]}${(0.05 + bassEnergy * 0.1) * pal.glowScale})` : 'rgba(0, 0, 0, 0)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // 2. Render Selected Mode
      if (visualizerMode === 'bars') {
        renderBars(ctx, width, height, freqData, smoothBars, hasRealAudioSignal, isPlaying, phase, pal);
      } else if (visualizerMode === 'wave') {
        renderWave(ctx, width, height, timeData, hasRealAudioSignal, isPlaying, phase, pal);
      } else if (visualizerMode === 'circle') {
        renderCircular(ctx, width, height, centerX, centerY, freqData, hasRealAudioSignal, isPlaying, phase, pal);
      } else if (visualizerMode === 'mirrored') {
        renderMirrored(ctx, width, height, freqData, smoothBars, hasRealAudioSignal, isPlaying, phase, pal);
      }

      animationFrameId = requestAnimationFrame(render);
    };

    // --- Sub-renderers ---
    // 每次调用都读当前主题, 切主题后 canvas 配色自动变
    const palette = () => VISUALIZER_PALETTE[currentTheme()];

    // Mode A: Classic EQ Spectrum Bars
    function renderBars(
      c: CanvasRenderingContext2D,
      w: number,
      h: number,
      freq: Uint8Array,
      smooth: Float32Array,
      hasSignal: boolean,
      active: boolean,
      p: number,
      pal: VisualizerPalette
    ) {
      const numBars = 52;
      const gap = 4;
      const barWidth = Math.max(4, (w - numBars * gap) / numBars);
      const startX = (w - (numBars * (barWidth + gap))) / 2;
      const bottomY = h - 24;

      for (let i = 0; i < numBars; i++) {
        let target = 4;
        if (hasSignal) {
          // Logarithmic/weighted frequency index
          const fIdx = Math.min(bufferLength - 1, Math.floor(Math.pow(i / numBars, 1.25) * 60));
          const val = freq[fIdx] / 255;
          target = Math.max(4, val * (h * 0.65));
        } else if (active) {
          target = Math.sin(p + i * 0.25) * 32 +
                   Math.cos(p * 1.5 + i * 0.15) * 22 +
                   Math.sin(p * 0.7 + i * 0.5) * 18 + 42;
        }

        // Interpolation
        smooth[i] += (target - smooth[i]) * 0.22;
        const barH = Math.max(4, Math.min(h * 0.75, smooth[i]));
        const x = startX + i * (barWidth + gap);
        const y = bottomY - barH;

        // 频谱条: 深色主题亮 rose 渐变, 浅色主题更饱和的深 rose(浅底上浅粉看不见)
        const barGrad = c.createLinearGradient(0, y, 0, bottomY);
        if (active) {
          barGrad.addColorStop(0, pal.barActive[0]);
          barGrad.addColorStop(0.3, pal.barActive[1]);
          barGrad.addColorStop(0.7, pal.barActive[2]);
          barGrad.addColorStop(1, pal.barActive[3]);
        } else {
          barGrad.addColorStop(0, pal.barIdle[0]);
          barGrad.addColorStop(1, pal.barIdle[1]);
        }

        c.fillStyle = barGrad;
        c.beginPath();
        const r = Math.min(barWidth / 2, 4);
        if (c.roundRect) {
          c.roundRect(x, y, barWidth, barH, [r, r, 0, 0]);
        } else {
          c.rect(x, y, barWidth, barH);
        }
        c.fill();

        // Little floating peak caps
        if (active && barH > 12) {
          c.fillStyle = pal.peakCap;
          c.fillRect(x, Math.max(10, y - 4), barWidth, 2);
        }
      }
    }

    // Mode B: Real-time Oscilloscope Waveform
    function renderWave(
      c: CanvasRenderingContext2D,
      w: number,
      h: number,
      time: Uint8Array,
      hasSignal: boolean,
      active: boolean,
      p: number,
      pal: VisualizerPalette
    ) {
      c.lineWidth = 3;
      c.strokeStyle = active ? pal.waveActive : pal.waveIdle;
      c.beginPath();

      const sliceWidth = w / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        let v = 0.5;
        if (hasSignal) {
          v = time[i] / 255.0;
        } else if (active) {
          v = 0.5 + 0.22 * Math.sin(p * 2 + i * 0.12) * Math.cos(p + i * 0.05);
        }

        const y = v * h;
        if (i === 0) {
          c.moveTo(x, y);
        } else {
          c.lineTo(x, y);
        }
        x += sliceWidth;
      }

      c.stroke();

      // Soft glow stroke layer
      if (active) {
        c.lineWidth = 8;
        c.strokeStyle = pal.glowStroke;
        c.stroke();
      }
    }

    // Mode C: Circular Halo Visualizer around the center
    function renderCircular(
      c: CanvasRenderingContext2D,
      w: number,
      h: number,
      cx: number,
      cy: number,
      freq: Uint8Array,
      hasSignal: boolean,
      active: boolean,
      p: number,
      pal: VisualizerPalette
    ) {
      const radius = Math.min(w, h) * 0.32;
      const points = 64;
      const angleStep = (Math.PI * 2) / points;

      c.save();
      c.translate(cx, cy);

      for (let i = 0; i < points; i++) {
        const angle = i * angleStep;
        let magnitude = 6;
        if (hasSignal) {
          const val = freq[i % 48] / 255;
          magnitude = 6 + val * 65;
        } else if (active) {
          magnitude = 6 + Math.abs(Math.sin(p * 1.5 + i * 0.2)) * 36;
        }

        const x1 = Math.cos(angle) * (radius - 10);
        const y1 = Math.sin(angle) * (radius - 10);
        const x2 = Math.cos(angle) * (radius + magnitude);
        const y2 = Math.sin(angle) * (radius + magnitude);

        c.beginPath();
        c.moveTo(x1, y1);
        c.lineTo(x2, y2);
        c.lineWidth = 3;
        c.strokeStyle = active
          ? `hsl(${(i / points) * 60 + 340}, ${pal.circleSat}%, ${pal.circleLight}%)`
          : pal.circleIdle;
        c.lineCap = 'round';
        c.stroke();
      }
      c.restore();
    }

    // Mode D: Mirrored Double-Sided Spectrum (Center Outwards)
    function renderMirrored(
      c: CanvasRenderingContext2D,
      w: number,
      h: number,
      freq: Uint8Array,
      smooth: Float32Array,
      hasSignal: boolean,
      active: boolean,
      p: number,
      pal: VisualizerPalette
    ) {
      const numBars = 48;
      const gap = 3;
      const barWidth = Math.max(3, (w - numBars * gap) / numBars);
      const startX = (w - (numBars * (barWidth + gap))) / 2;
      const centerY = h / 2;

      for (let i = 0; i < numBars; i++) {
        let target = 4;
        if (hasSignal) {
          const fIdx = Math.min(bufferLength - 1, Math.floor(Math.pow(i / numBars, 1.2) * 55));
          target = Math.max(4, (freq[fIdx] / 255) * (h * 0.42));
        } else if (active) {
          target = Math.sin(p + i * 0.3) * 24 + Math.cos(p * 1.2 + i * 0.2) * 16 + 28;
        }

        smooth[i] += (target - smooth[i]) * 0.2;
        const barH = smooth[i];
        const x = startX + i * (barWidth + gap);

        const grad = c.createLinearGradient(0, centerY - barH, 0, centerY + barH);
        if (active) {
          grad.addColorStop(0, pal.barActive[1]);
          grad.addColorStop(0.5, pal.barActive[0]);
          grad.addColorStop(1, pal.barActive[1]);
        } else {
          grad.addColorStop(0, pal.mirroredIdle[0]);
          grad.addColorStop(1, pal.mirroredIdle[1]);
        }

        c.fillStyle = grad;
        c.beginPath();
        if (c.roundRect) {
          c.roundRect(x, centerY - barH, barWidth, barH * 2, [3]);
        } else {
          c.rect(x, centerY - barH, barWidth, barH * 2);
        }
        c.fill();
      }
    }

    render(performance.now());

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
    };
  }, [isPlaying, visualizerMode]);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-surface/95 via-app/95 to-app rounded-2xl border border-line/80 p-6 select-none">
      {/* Background canvas for spectrum */}
      <canvas
        ref={canvasRef}
        width={800}
        height={360}
        className="absolute inset-0 w-full h-full object-cover pointer-events-none opacity-85"
      />

      {/* Mode switcher lives in the player's top overlay bar (same row as the media badge).
          唱片本身由 VideoJsPlayer 的舞台中间列渲染（频谱选"无"时仍然转），这里只画 canvas。 */}
    </div>
  );
};
