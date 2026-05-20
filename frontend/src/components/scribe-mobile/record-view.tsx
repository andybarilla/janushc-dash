import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Check, Mic, UploadCloud } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  ACTIVE_RECORDING_DRAFT_ID,
  RECORDING_CHUNK_MS,
  createActiveRecordingDraft,
  saveRecordingDraftChunk,
  updateActiveRecordingDraftMetadata,
  getActiveRecordingDraft,
  buildRecordingDraftBlob,
  deleteActiveRecordingDraft,
  type RecordingDraftMetadata,
} from "@/lib/recording-drafts";
import {
  useCreateScribeSession,
  useUploadScribeAudio,
} from "@/lib/scribe-queries";

type Phase = "idle" | "recording" | "review" | "uploading";

type WakeLockSentinelLike = {
  readonly released?: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

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
  const [autoTranscribe, setAutoTranscribe] = useState(true);
  const [keepAwake, setKeepAwake] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [activeDraft, setActiveDraft] = useState<RecordingDraftMetadata | null>(null);
  const [isCheckingDraft, setIsCheckingDraft] = useState(true);
  const [isRecoveredDraft, setIsRecoveredDraft] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const objectUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const draftIdRef = useRef<string | null>(null);
  const nextChunkIndexRef = useRef(0);
  const pendingDraftWritesRef = useRef<Set<Promise<void>>>(new Set());
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const wakeLockWantedRef = useRef(false);

  const createSession = useCreateScribeSession();
  const uploadAudio = useUploadScribeAudio();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;

  const releaseWakeLock = useCallback(() => {
    wakeLockWantedRef.current = false;
    const wakeLock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (wakeLock && !wakeLock.released) {
      void wakeLock.release().catch((wakeLockError) => {
        console.warn("Unable to release screen wake lock.", wakeLockError);
      });
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    const wakeLockApi = (navigator as WakeLockNavigator).wakeLock;
    if (!keepAwake || !wakeLockApi || wakeLockRef.current) return;

    wakeLockWantedRef.current = true;
    try {
      const wakeLock = await wakeLockApi.request("screen");
      if (!mountedRef.current || !wakeLockWantedRef.current) {
        if (!wakeLock.released) await wakeLock.release();
        return;
      }
      wakeLockRef.current = wakeLock;
      wakeLock.addEventListener("release", () => {
        if (wakeLockRef.current === wakeLock) wakeLockRef.current = null;
      });
    } catch (wakeLockError) {
      console.warn("Unable to keep the screen awake during recording.", wakeLockError);
    }
  }, [keepAwake]);

  useEffect(() => {
    let isCurrent = true;
    if (!currentUserId) {
      setActiveDraft(null);
      setIsCheckingDraft(false);
      return () => {
        isCurrent = false;
      };
    }

    setIsCheckingDraft(true);
    void getActiveRecordingDraft()
      .then((draft) => {
        if (!isCurrent) return;
        if (!draft) {
          setActiveDraft(null);
          return;
        }
        if (draft.ownerUserId === currentUserId) {
          setActiveDraft(draft);
          return;
        }
        setActiveDraft(null);
        void deleteActiveRecordingDraft().catch((deleteError) => {
          console.warn("Unable to delete recording draft for a different user.", deleteError);
        });
      })
      .catch(() => {
        if (isCurrent) setError("Unable to check for interrupted recordings.");
      })
      .finally(() => {
        if (isCurrent) setIsCheckingDraft(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [currentUserId]);

  // Timer ticks once per second during recording.
  useEffect(() => {
    if (phase !== "recording") return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "recording" || !keepAwake) {
      releaseWakeLock();
      return;
    }

    wakeLockWantedRef.current = true;
    void requestWakeLock();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void requestWakeLock();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      releaseWakeLock();
    };
  }, [keepAwake, phase, releaseWakeLock, requestWakeLock]);

  useEffect(() => {
    const draftId = draftIdRef.current;
    if (phase !== "recording" || !draftId) return;
    const writePromise = updateActiveRecordingDraftMetadata({
      elapsedSeconds: seconds,
      patientId: patientId.trim(),
      departmentId: department,
      autoTranscribe,
      nextChunkIndex: nextChunkIndexRef.current,
    })
      .catch(() => {
        if (mountedRef.current && draftIdRef.current === draftId) {
          setStorageWarning("Recording is continuing, but local recovery storage is unavailable.");
        }
      })
      .finally(() => {
        pendingDraftWritesRef.current.delete(writePromise);
      });
    pendingDraftWritesRef.current.add(writePromise);
  }, [autoTranscribe, department, patientId, phase, seconds]);

  // Tear down stream / object URL when the view unmounts. The mounted flag is
  // re-armed on every mount so that StrictMode's dev-only mount/unmount/mount
  // cycle doesn't leave it stuck at false, which would otherwise cause the
  // real recorder.onstop callback to bail out.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const recorder = mediaRecorderRef.current;
      draftIdRef.current = null;
      if (recorder) {
        // Drop callbacks so late recorder events don't set state on an
        // unmounted component or enqueue draft writes after discard.
        recorder.ondataavailable = null;
        recorder.onstop = null;
        if (recorder.state === "recording") recorder.stop();
      }
      releaseWakeLock();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      mediaRecorderRef.current = null;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [releaseWakeLock]);

  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  const startRecording = async (): Promise<boolean> => {
    if (!supported) {
      setError("Recording is not supported in this browser.");
      return false;
    }
    setError(null);
    setStorageWarning(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = supportedMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      chunksRef.current = [];
      draftIdRef.current = null;
      nextChunkIndexRef.current = 0;
      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      const type = recorder.mimeType || mimeType || "audio/webm";
      if (currentUserId) {
        try {
          const draft = await createActiveRecordingDraft({
            ownerUserId: currentUserId,
            mimeType: type,
            fileExtension: extensionFor(type),
            patientId: patientId.trim(),
            departmentId: department,
            autoTranscribe,
            elapsedSeconds: 0,
          });
          draftIdRef.current = ACTIVE_RECORDING_DRAFT_ID;
          nextChunkIndexRef.current = draft.nextChunkIndex;
        } catch {
          setStorageWarning("Recording is continuing, but local recovery storage is unavailable.");
        }
      } else {
        setStorageWarning("Recording is continuing, but local recovery storage is unavailable.");
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size <= 0) return;
        chunksRef.current.push(event.data);
        const draftId = draftIdRef.current;
        if (!draftId) return;
        const chunkIndex = nextChunkIndexRef.current;
        nextChunkIndexRef.current += 1;
        const writePromise = saveRecordingDraftChunk(draftId, chunkIndex, event.data)
          .catch(() => {
            if (mountedRef.current && draftIdRef.current === draftId) {
              setStorageWarning("Recording is continuing, but local recovery storage is unavailable.");
            }
          })
          .finally(() => {
            pendingDraftWritesRef.current.delete(writePromise);
          });
        pendingDraftWritesRef.current.add(writePromise);
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
        setIsRecoveredDraft(false);
        setPhase("review");
      };
      recorder.start(RECORDING_CHUNK_MS);
      setSeconds(0);
      setPhase("recording");
      return true;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Microphone permission was denied or unavailable.",
      );
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      mediaRecorderRef.current = null;
      setPhase("idle");
      return false;
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
  };

  const deleteDraftAfterPendingWrites = async (): Promise<void> => {
    draftIdRef.current = null;
    await Promise.allSettled(Array.from(pendingDraftWritesRef.current));
    await deleteActiveRecordingDraft();
  };

  const reset = () => {
    releaseWakeLock();
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    draftIdRef.current = null;
    nextChunkIndexRef.current = 0;
    setRecordingUrl(null);
    setFile(null);
    setSeconds(0);
    setError(null);
    setStorageWarning(null);
    setActiveDraft(null);
    setIsRecoveredDraft(false);
  };

  const handleRecoverDraft = async () => {
    if (!activeDraft) return;
    setError(null);
    try {
      const blob = await buildRecordingDraftBlob(activeDraft.draftId, activeDraft.mimeType);
      if (blob.size <= 0) throw new Error("No saved audio chunks were found for this interrupted recording.");
      const recoveredFile = new File(
        [blob],
        `mobile-recording-recovered.${activeDraft.fileExtension}`,
        { type: activeDraft.mimeType },
      );
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      setPatientId(activeDraft.patientId);
      setDepartment(activeDraft.departmentId);
      setAutoTranscribe(activeDraft.autoTranscribe);
      setSeconds(activeDraft.elapsedSeconds);
      setFile(recoveredFile);
      setRecordingUrl(url);
      setIsRecoveredDraft(true);
      setPhase("review");
    } catch (err) {
      setError(apiErrorMessage(err) ?? "Unable to recover interrupted recording.");
    }
  };

  const handleDiscardRecoveredDraft = async () => {
    try {
      await deleteDraftAfterPendingWrites();
    } finally {
      setActiveDraft(null);
      reset();
      setPhase("idle");
    }
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
      await uploadAudio.mutateAsync({ id: session.id, file, autoTranscribe });
      try {
        await deleteDraftAfterPendingWrites();
      } catch (deleteError) {
        console.warn("Unable to delete saved recording draft.", deleteError);
      }
      reset();
      onSaved(session.id);
    } catch (err) {
      setError(apiErrorMessage(err) ?? "Failed to save recording.");
      setPhase("review");
    }
  };

  const handleDiscard = async () => {
    try {
      await deleteDraftAfterPendingWrites();
    } catch (deleteError) {
      console.warn("Unable to delete discarded recording draft.", deleteError);
    }
    reset();
    onBack();
  };

  const handleBack = async () => {
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      // We're discarding the recording, so don't transition to review when the
      // stop event fires asynchronously or enqueue more draft writes.
      recorder.ondataavailable = null;
      recorder.onstop = null;
      if (recorder.state === "recording") recorder.stop();
    }
    releaseWakeLock();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
    try {
      await deleteDraftAfterPendingWrites();
    } catch (deleteError) {
      console.warn("Unable to delete discarded recording draft.", deleteError);
    }
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
        {phase === "idle" && !isCheckingDraft && activeDraft ? <RecoveryDraftPhase
          error={error}
          onRecover={handleRecoverDraft}
          onDiscard={handleDiscardRecoveredDraft}
        /> : null}

        {phase === "idle" && !isCheckingDraft && !activeDraft ? <IdlePhase
          patientId={patientId}
          setPatientId={setPatientId}
          department={department}
          setDepartment={setDepartment}
          autoTranscribe={autoTranscribe}
          setAutoTranscribe={setAutoTranscribe}
          keepAwake={keepAwake}
          setKeepAwake={setKeepAwake}
          onStart={startRecording}
          supported={supported}
          error={error}
        /> : null}

        {phase === "recording" ? <RecordingPhase
          seconds={seconds}
          patientId={patientId.trim() || "new session"}
          onStop={stopRecording}
          storageWarning={storageWarning}
        /> : null}

        {phase === "review" ? <ReviewPhase
          seconds={seconds}
          patientId={patientId.trim() || "new session"}
          department={department}
          recordingUrl={recordingUrl}
          autoTranscribe={autoTranscribe}
          error={error}
          isRecoveredDraft={isRecoveredDraft}
          onSave={handleSave}
          onReRecord={() => {
            void (async () => {
              try {
                await deleteDraftAfterPendingWrites();
              } catch (deleteError) {
                console.warn("Unable to delete replaced recording draft.", deleteError);
              }
              reset();
              setPhase("idle");
              await startRecording();
            })();
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
  autoTranscribe: boolean;
  setAutoTranscribe: (v: boolean) => void;
  keepAwake: boolean;
  setKeepAwake: (v: boolean) => void;
  onStart: () => void;
  supported: boolean;
  error: string | null;
}

function IdlePhase({
  patientId,
  setPatientId,
  department,
  setDepartment,
  autoTranscribe,
  setAutoTranscribe,
  keepAwake,
  setKeepAwake,
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
        <label className="field-label" htmlFor="m-rec-auto-transcribe">Processing</label>
        <label className="m-record-toggle" htmlFor="m-rec-auto-transcribe">
          <input
            id="m-rec-auto-transcribe"
            type="checkbox"
            checked={autoTranscribe}
            onChange={(e) => setAutoTranscribe(e.target.checked)}
          />
          <span>Automatically transcribe after upload</span>
        </label>
        <label className="field-label" htmlFor="m-rec-keep-awake">Recording</label>
        <label className="m-record-toggle" htmlFor="m-rec-keep-awake">
          <input
            id="m-rec-keep-awake"
            type="checkbox"
            checked={keepAwake}
            onChange={(e) => setKeepAwake(e.target.checked)}
          />
          <span>Keep screen awake while recording</span>
        </label>
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

function RecoveryDraftPhase({
  error,
  onRecover,
  onDiscard,
}: {
  error: string | null;
  onRecover: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="m-record-center">
      <div className="m-saved-title">Interrupted recording found</div>
      <div className="m-rec-detail">
        We saved audio from a previous recording on this device. Review and save it, or discard it.
      </div>
      {error ? <div className="m-rec-error">{error}</div> : null}
      <div className="m-record-actions">
        <button type="button" className="m-record-save" onClick={onRecover}>
          Recover recording
        </button>
        <button type="button" className="m-record-secondary danger" onClick={onDiscard}>
          Discard
        </button>
      </div>
    </div>
  );
}

function RecordingPhase({
  seconds,
  patientId,
  onStop,
  storageWarning,
}: {
  seconds: number;
  patientId: string;
  onStop: () => void;
  storageWarning: string | null;
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
        Recording is being saved locally as you go. Keep this page open for best results.
      </div>
      {storageWarning ? <div className="m-rec-error">{storageWarning}</div> : null}
    </div>
  );
}

interface ReviewProps {
  seconds: number;
  patientId: string;
  department: string;
  recordingUrl: string | null;
  autoTranscribe: boolean;
  error: string | null;
  onSave: () => void;
  onReRecord: () => void;
  onDiscard: () => void;
  isRecoveredDraft: boolean;
}

function ReviewPhase({
  seconds,
  patientId,
  department,
  recordingUrl,
  autoTranscribe,
  error,
  isRecoveredDraft,
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
          Saved on device. {autoTranscribe ? "Ready to queue for transcription." : "Ready to save without transcription."}
        </div>
        {isRecoveredDraft ? (
          <div className="m-rec-detail">
            Recovered from local device storage. Please review before saving.
          </div>
        ) : null}
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
          {autoTranscribe ? "Save & queue for processing" : "Save recording only"}
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
        Uploading recording…
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

