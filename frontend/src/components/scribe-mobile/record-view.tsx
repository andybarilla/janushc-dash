import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Check, Mic, UploadCloud } from "lucide-react";
import {
  useCreateScribeSession,
  useUploadScribeAudio,
} from "@/lib/scribe-queries";

type Phase = "idle" | "recording" | "review" | "uploading";

const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

function supportedMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return (
    RECORDING_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ??
    ""
  );
}

function extensionFor(mimeType: string) {
  return mimeType.includes("ogg") ? "ogg" : "webm";
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function apiErrorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message.trim() : null;
  }
  return null;
}

interface Props {
  onBack: () => void;
  onSaved: (sessionId: string) => void;
}

export function MRecordView({ onBack, onSaved }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [patientId, setPatientId] = useState("");
  const [department, setDepartment] = useState("dept-1");
  const [seconds, setSeconds] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const objectUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const createSession = useCreateScribeSession();
  const uploadAudio = useUploadScribeAudio();

  // Timer ticks once per second during recording.
  useEffect(() => {
    if (phase !== "recording") return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  // Tear down stream / object URL when the view unmounts.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      const recorder = mediaRecorderRef.current;
      if (recorder) {
        // Drop the onstop callback so a late stop event doesn't set state on an
        // unmounted component.
        recorder.onstop = null;
        if (recorder.state === "recording") recorder.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      mediaRecorderRef.current = null;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  const startRecording = async () => {
    if (!supported) {
      setError("Recording is not supported in this browser.");
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = supportedMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      chunksRef.current = [];
      streamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        if (!mountedRef.current) return;
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        const ext = extensionFor(type);
        const recordedFile = new File(
          [blob],
          `mobile-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`,
          { type },
        );
        setFile(recordedFile);
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setRecordingUrl(url);
        setPhase("review");
      };
      recorder.start();
      setSeconds(0);
      setPhase("recording");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Microphone permission was denied or unavailable.",
      );
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      mediaRecorderRef.current = null;
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
  };

  const reset = () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setRecordingUrl(null);
    setFile(null);
    setSeconds(0);
    setError(null);
  };

  const handleSave = async () => {
    if (!file) return;
    const patient = patientId.trim() || `mobile-${Date.now()}`;
    setError(null);
    setPhase("uploading");
    try {
      const session = await createSession.mutateAsync({
        patient_id: patient,
        encounter_id: `enc-${patient}-${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")}`,
        department_id: department,
      });
      await uploadAudio.mutateAsync({ id: session.id, file });
      reset();
      onSaved(session.id);
    } catch (err) {
      setError(apiErrorMessage(err) ?? "Failed to save recording.");
      setPhase("review");
    }
  };

  const handleDiscard = () => {
    reset();
    onBack();
  };

  const handleBack = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      // We're discarding the recording, so don't transition to review when the
      // stop event fires asynchronously.
      recorder.onstop = null;
      if (recorder.state === "recording") recorder.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
    reset();
    onBack();
  };

  const title =
    phase === "idle"
      ? "New session"
      : phase === "recording"
        ? "Recording…"
        : phase === "review"
          ? "Review recording"
          : "Saving";

  return (
    <>
      <div className="m-detail-topbar">
        <button
          type="button"
          className="m-back"
          onClick={handleBack}
          disabled={phase === "uploading"}
        >
          <ChevronLeft />
          <span>Home</span>
        </button>
        <div className="title">{title}</div>
        <span style={{ width: 38, flexShrink: 0 }} />
      </div>

      <div className="m-record-stage">
        {phase === "idle" ? <IdlePhase
          patientId={patientId}
          setPatientId={setPatientId}
          department={department}
          setDepartment={setDepartment}
          onStart={startRecording}
          supported={supported}
          error={error}
        /> : null}

        {phase === "recording" ? <RecordingPhase
          seconds={seconds}
          patientId={patientId.trim() || "new session"}
          onStop={stopRecording}
        /> : null}

        {phase === "review" ? <ReviewPhase
          seconds={seconds}
          patientId={patientId.trim() || "new session"}
          department={department}
          recordingUrl={recordingUrl}
          error={error}
          onSave={handleSave}
          onReRecord={() => {
            reset();
            void startRecording();
          }}
          onDiscard={handleDiscard}
        /> : null}

        {phase === "uploading" ? <UploadingPhase
          seconds={seconds}
          patientId={patientId.trim() || "new session"}
        /> : null}
      </div>
    </>
  );
}

interface IdleProps {
  patientId: string;
  setPatientId: (v: string) => void;
  department: string;
  setDepartment: (v: string) => void;
  onStart: () => void;
  supported: boolean;
  error: string | null;
}

function IdlePhase({
  patientId,
  setPatientId,
  department,
  setDepartment,
  onStart,
  supported,
  error,
}: IdleProps) {
  return (
    <>
      <div className="m-record-form">
        <label className="field-label" htmlFor="m-rec-patient">Patient</label>
        <input
          id="m-rec-patient"
          className="field"
          value={patientId}
          onChange={(e) => setPatientId(e.target.value)}
          placeholder="Patient ID"
          autoComplete="off"
        />
        <label className="field-label" htmlFor="m-rec-dept">Department</label>
        <select
          id="m-rec-dept"
          className="field"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        >
          <option value="dept-1">Department 1</option>
          <option value="dept-2">Department 2</option>
        </select>
      </div>
      <div className="m-record-center">
        <button
          type="button"
          className="m-rec-btn"
          onClick={onStart}
          disabled={!supported}
          aria-label="Start recording"
        >
          <Mic />
        </button>
        <div className="m-rec-hint">Tap to start recording</div>
        <div className="m-rec-detail">
          Audio is saved on your device first. It uploads in the background, then is transcribed and extracted automatically.
        </div>
        {error ? <div className="m-rec-error">{error}</div> : null}
        {!supported ? (
          <div className="m-rec-error">
            Recording is not supported in this browser.
          </div>
        ) : null}
      </div>
    </>
  );
}

function RecordingPhase({
  seconds,
  patientId,
  onStop,
}: {
  seconds: number;
  patientId: string;
  onStop: () => void;
}) {
  return (
    <div className="m-record-center">
      <div className="m-rec-timer">{fmt(seconds)}</div>
      <div className="m-rec-meta">
        <span className="rec-dot" />
        <span>Recording · {patientId}</span>
      </div>
      <RecordingWave />
      <button
        type="button"
        className="m-rec-btn recording"
        onClick={onStop}
        aria-label="Stop recording"
      >
        <span className="rec-square" />
      </button>
      <div className="m-rec-detail">
        Tap the square to stop. You'll be able to play it back before saving.
      </div>
    </div>
  );
}

interface ReviewProps {
  seconds: number;
  patientId: string;
  department: string;
  recordingUrl: string | null;
  error: string | null;
  onSave: () => void;
  onReRecord: () => void;
  onDiscard: () => void;
}

function ReviewPhase({
  seconds,
  patientId,
  department,
  recordingUrl,
  error,
  onSave,
  onReRecord,
  onDiscard,
}: ReviewProps) {
  return (
    <>
      <div className="m-record-center">
        <div className="m-saved-check">
          <Check />
        </div>
        <div className="m-saved-title">Recorded {fmt(seconds)}</div>
        <div className="m-rec-detail">
          {patientId} · {department}
          <br />
          Saved on device. Ready to queue for transcription.
        </div>
        {recordingUrl ? (
          <div
            className="m-audio"
            style={{ width: "90%", maxWidth: 340, margin: "8px auto 0" }}
          >
            <audio
              controls
              src={recordingUrl}
              style={{ width: "100%" }}
              aria-label="Recorded audio playback"
            >
              <track kind="captions" />
            </audio>
          </div>
        ) : null}
        {error ? <div className="m-rec-error">{error}</div> : null}
      </div>
      <div className="m-record-actions">
        <button type="button" className="m-record-save" onClick={onSave}>
          <UploadCloud />
          Save & queue for processing
        </button>
        <div className="btn-row">
          <button type="button" className="m-record-secondary" onClick={onReRecord}>
            Re-record
          </button>
          <button
            type="button"
            className="m-record-secondary danger"
            onClick={onDiscard}
          >
            Discard
          </button>
        </div>
      </div>
    </>
  );
}

function UploadingPhase({
  seconds,
  patientId,
}: {
  seconds: number;
  patientId: string;
}) {
  return (
    <div className="m-record-center">
      <div className="m-saved-check upload">
        <UploadCloud />
      </div>
      <div className="m-saved-title">Uploading…</div>
      <div className="m-upload-progress">
        <div className="bar" />
      </div>
      <div className="m-rec-detail">
        {patientId} · {fmt(seconds)}
        <br />
        Once uploaded, transcription will start automatically.
      </div>
    </div>
  );
}

// Live waveform during recording — 36 bars driven by a sine-ish JS animator.
// Matches the design's "every 3rd bar solid red, rest tinted at 55%" pattern.
function RecordingWave() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 110);
    return () => window.clearInterval(id);
  }, []);
  const N = 36;
  const bars: number[] = [];
  for (let i = 0; i < N; i++) {
    const phase = tick * 0.4 + i * 0.6;
    const h = 0.15 + Math.abs(Math.sin(phase) * 0.45 + Math.sin(phase * 1.7) * 0.25);
    bars.push(h);
  }
  return (
    <svg
      className="m-rec-wave"
      viewBox={`0 0 ${N * 7} 60`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {bars.map((h, i) => {
        const barH = h * 50;
        return (
          <rect
            key={i}
            x={i * 7 + 1}
            y={30 - barH / 2}
            width="4"
            height={barH}
            rx="2"
            fill={i % 3 === 0 ? "#DC2626" : "rgba(220,38,38,0.55)"}
          />
        );
      })}
    </svg>
  );
}

