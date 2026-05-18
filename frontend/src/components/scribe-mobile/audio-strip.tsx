import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { api } from "@/lib/api";

interface Props {
  sessionId: string;
  available: boolean;
}

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const whole = Math.floor(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function MAudioStrip({ sessionId, available }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(Number.NaN);

  const bars = useMemo(() => {
    const arr: number[] = [];
    for (let i = 0; i < 60; i++) {
      const v = Math.abs(
        Math.sin(i * 0.41) +
          Math.sin(i * 1.17) * 0.6 +
          Math.sin(i * 0.07) * 0.4,
      );
      arr.push(0.2 + (v / 2) * 0.9);
    }
    return arr;
  }, []);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [sessionId]);

  const ensureLoaded = async (): Promise<string | null> => {
    if (audioUrl) return audioUrl;
    setLoading(true);
    try {
      const blob = await api.fetchBlob(`/api/scribe/sessions/${sessionId}/audio`);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      setAudioUrl(url);
      return url;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  };

  const togglePlay = async () => {
    if (!available) return;
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      return;
    }
    const url = await ensureLoaded();
    if (!url) return;
    audio.src = url;
    try {
      await audio.play();
    } catch {
      /* playback blocked — ignore */
    }
  };

  const progress = Number.isFinite(duration) && duration > 0 ? currentTime / duration : 0;
  const playedCount = Math.round(progress * bars.length);
  const label = `${fmt(currentTime)} / ${fmt(duration)}`;

  return (
    <div className="m-audio">
      <button
        type="button"
        className="m-audio-play"
        onClick={togglePlay}
        disabled={!available || loading}
        aria-label={playing ? "Pause audio" : "Play audio"}
      >
        {playing ? <Pause /> : <Play />}
      </button>
      <svg className="m-audio-wave" viewBox="0 0 240 24" preserveAspectRatio="none">
        {bars.map((h, i) => {
          const y = 12 - h * 10;
          const isPlayed = i < playedCount;
          return (
            <rect
              key={i}
              x={i * 4}
              y={y}
              width="2.4"
              height={h * 20}
              rx="1.2"
              fill={isPlayed ? "var(--janus-primary)" : "rgba(44,95,125,0.25)"}
            />
          );
        })}
      </svg>
      <span className="m-audio-time">{label}</span>
      <audio
        ref={audioRef}
        preload="metadata"
        hidden
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  );
}
