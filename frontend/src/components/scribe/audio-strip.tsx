import { useMemo } from "react";
import { Play } from "lucide-react";

// Stylized SVG waveform — decorative until the backend exposes a playable
// audio URL and metadata.
export function AudioStrip() {
  const bars = useMemo(() => {
    const arr: number[] = [];
    const n = 100;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(
        Math.sin(i * 0.41) +
          Math.sin(i * 1.17) * 0.6 +
          Math.sin(i * 0.07) * 0.4,
      );
      arr.push(0.2 + (v / 2) * 0.9);
    }
    return arr;
  }, []);
  return (
    <div className="janus-audio-strip">
      <button type="button" className="janus-audio-play" disabled title="Audio playback not yet available">
        <Play />
      </button>
      <svg
        className="janus-audio-waveform"
        viewBox="0 0 400 28"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {bars.map((h, i) => {
          const y = 14 - h * 12;
          return (
            <rect
              key={i}
              x={i * 4}
              y={y}
              width="2.4"
              height={h * 24}
              rx="1.2"
              fill="rgba(44, 95, 125, 0.25)"
            />
          );
        })}
      </svg>
      <span className="janus-audio-time">audio not streamed</span>
    </div>
  );
}
