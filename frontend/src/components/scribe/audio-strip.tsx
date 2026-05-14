import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { api } from "@/lib/api";

interface Props {
  sessionId: string;
  available: boolean;
}

function fmtAudioTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AudioStrip({ sessionId, available }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(Number.NaN);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setAudioUrl(null);
    setLoading(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(Number.NaN);
    setError(null);

    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [sessionId, available]);

  const loadAudio = useCallback(async () => {
    if (audioUrl) return audioUrl;
    setLoading(true);
    setError(null);
    try {
      const blob = await api.fetchBlob(`/api/scribe/sessions/${sessionId}/audio`);
      const nextUrl = URL.createObjectURL(blob);
      objectUrlRef.current = nextUrl;
      setAudioUrl(nextUrl);
      if (audioRef.current) audioRef.current.src = nextUrl;
      return nextUrl;
    } catch {
      setError("Audio unavailable");
      return null;
    } finally {
      setLoading(false);
    }
  }, [audioUrl, sessionId]);

  const togglePlayback = async () => {
    if (!available || loading) return;
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      return;
    }
    const url = await loadAudio();
    if (!url) return;
    try {
      await audio.play();
    } catch {
      setError("Playback blocked");
    }
  };

  const progress = Number.isFinite(duration) && duration > 0 ? currentTime / duration : 0;
  const disabled = !available || loading;
  const label = !available
    ? "audio unavailable"
    : error ?? (loading ? "loading audio…" : `${fmtAudioTime(currentTime)} / ${fmtAudioTime(duration)}`);

  return (
    <div className="janus-audio-strip">
      <button
        type="button"
        className="janus-audio-play"
        disabled={disabled}
        title={available ? (playing ? "Pause audio" : "Play audio") : "No uploaded audio available"}
        onClick={togglePlayback}
      >
        {playing ? <Pause /> : <Play />}
      </button>
      <svg
        className="janus-audio-waveform"
        viewBox="0 0 400 28"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {bars.map((h, i) => {
          const y = 14 - h * 12;
          const isActive = available && i / bars.length <= progress;
          return (
            <rect
              key={i}
              x={i * 4}
              y={y}
              width="2.4"
              height={h * 24}
              rx="1.2"
              fill={isActive ? "rgba(44, 95, 125, 0.85)" : "rgba(44, 95, 125, 0.25)"}
            />
          );
        })}
      </svg>
      <span className="janus-audio-time">{label}</span>
      <audio
        ref={audioRef}
        preload="metadata"
        src={audioUrl ?? undefined}
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
