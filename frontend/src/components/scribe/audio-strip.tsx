import { type KeyboardEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function waitForMetadata(audio: HTMLAudioElement) {
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    return Promise.resolve(audio.duration);
  }

  return new Promise<number>((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("error", onError);
    };
    const onLoadedMetadata = () => {
      cleanup();
      resolve(audio.duration);
    };
    const onError = () => {
      cleanup();
      reject(new Error("Unable to load audio metadata"));
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
    audio.addEventListener("error", onError, { once: true });
    audio.load();
  });
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
      if (audioRef.current) {
        audioRef.current.src = nextUrl;
        audioRef.current.load();
      }
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

  const seekToRatio = async (ratio: number) => {
    if (!available || loading) return;
    const audio = audioRef.current;
    if (!audio) return;
    const url = await loadAudio();
    if (!url) return;

    try {
      const metadataDuration = await waitForMetadata(audio);
      if (!Number.isFinite(metadataDuration) || metadataDuration <= 0) return;
      const nextTime = clamp(ratio, 0, 1) * metadataDuration;
      audio.currentTime = nextTime;
      setCurrentTime(nextTime);
      setDuration(metadataDuration);
    } catch {
      setError("Audio unavailable");
    }
  };

  const handleWaveformClick = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    void seekToRatio((event.clientX - rect.left) / rect.width);
  };

  const handleWaveformKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!available || loading) return;
    const step = event.shiftKey ? 30 : 5;
    const knownDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    let nextTime: number | null = null;

    if (event.key === "ArrowLeft") nextTime = Math.max(0, currentTime - step);
    if (event.key === "ArrowRight") nextTime = knownDuration > 0 ? Math.min(knownDuration, currentTime + step) : currentTime + step;
    if (event.key === "Home") nextTime = 0;
    if (event.key === "End" && knownDuration > 0) nextTime = knownDuration;

    if (nextTime === null) return;
    event.preventDefault();
    const ratio = knownDuration > 0 ? nextTime / knownDuration : 0;
    void seekToRatio(ratio);
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
        className={`janus-audio-waveform${available ? " is-seekable" : ""}`}
        viewBox="0 0 400 28"
        preserveAspectRatio="none"
        role="slider"
        tabIndex={available ? 0 : -1}
        aria-label="Audio playback position"
        aria-disabled={!available || loading}
        aria-valuemin={0}
        aria-valuemax={Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0}
        aria-valuenow={Math.round(currentTime)}
        aria-valuetext={`${fmtAudioTime(currentTime)} of ${fmtAudioTime(duration)}`}
        onClick={handleWaveformClick}
        onKeyDown={handleWaveformKeyDown}
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
