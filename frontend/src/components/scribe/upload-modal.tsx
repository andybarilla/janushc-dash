import { useEffect, useRef, useState } from "react";
import { ClipboardList, Mic, RotateCcw, Square, X } from "lucide-react";
import {
  useCreateScribeSession,
  useSubmitTranscript,
  useUploadScribeAudio,
} from "@/lib/scribe-queries";

const ACCEPTED_FORMATS = ".mp3,.m4a,.wav,.webm,.ogg";
const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (sessionId: string) => void;
  initialSource?: AudioSource;
}

type AudioSource = "record" | "paste";

type RecordingState = "idle" | "recording" | "recorded";

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function supportedRecordingMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return RECORDING_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function recordingExtension(mimeType: string) {
  return mimeType.includes("ogg") ? "ogg" : "webm";
}

function apiErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message.trim() : null;
  }
  return null;
}

export function UploadModal({ open, onClose, onCreated, initialSource = "record" }: Props) {
  const [patientId, setPatientId] = useState("");
  const [encounterId, setEncounterId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [audioSource, setAudioSource] = useState<AudioSource>(initialSource);
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [autoTranscribe, setAutoTranscribe] = useState(true);
  const [transcript, setTranscript] = useState("");
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const createSession = useCreateScribeSession();
  const uploadAudio = useUploadScribeAudio();
  const submitTranscript = useSubmitTranscript();

  useEffect(() => {
    if (open) setAudioSource(initialSource);
  }, [open, initialSource]);

  useEffect(() => {
    if (!open) return;
    return () => {
      mediaRecorderRef.current?.state === "recording" && mediaRecorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    };
  }, [open, recordingUrl]);

  useEffect(() => {
    if (recordingState !== "recording") return;
    const intervalId = window.setInterval(() => {
      setRecordingSeconds((seconds) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [recordingState]);

  if (!open) return null;

  const busy = createSession.isPending || uploadAudio.isPending || submitTranscript.isPending;
  const recordingSupported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";
  const error =
    apiErrorMessage(createSession.error) ||
    apiErrorMessage(uploadAudio.error) ||
    apiErrorMessage(submitTranscript.error) ||
    recordingError ||
    null;

  const clearRecording = () => {
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    setRecordingUrl(null);
    setRecordingSeconds(0);
    setRecordingState("idle");
    setRecordingError(null);
    if (audioSource === "record") {
      setFile(null);
    }
  };

  const reset = () => {
    setPatientId("");
    setEncounterId("");
    setDepartmentId("");
    setFile(null);
    setTranscript("");
    setAudioSource(initialSource);
    clearRecording();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSourceChange = (source: AudioSource) => {
    setAudioSource(source);
    setRecordingError(null);
    if (source === "paste") {
      clearRecording();
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const startRecording = async () => {
    if (!recordingSupported || busy) return;
    clearRecording();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = supportedRecordingMimeType();
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
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        const extension = recordingExtension(type);
        const recordedFile = new File(
          [blob],
          `browser-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`,
          { type },
        );
        setFile(recordedFile);
        setRecordingUrl(URL.createObjectURL(blob));
        setRecordingState("recorded");
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
      };
      recorder.start();
      setRecordingSeconds(0);
      setRecordingState("recording");
    } catch (err) {
      setRecordingError(
        err instanceof Error
          ? err.message
          : "Microphone permission was denied or unavailable.",
      );
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      mediaRecorderRef.current = null;
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === "recording") {
      recorder.stop();
    }
  };

  const handleSubmit = async () => {
    if (!patientId || !encounterId || !departmentId) return;
    if (audioSource === "paste") {
      if (!transcript.trim()) return;
      const session = await createSession.mutateAsync({
        patient_id: patientId,
        encounter_id: encounterId,
        department_id: departmentId,
      });
      await submitTranscript.mutateAsync({ id: session.id, transcript });
      onCreated?.(session.id);
      reset();
      onClose();
    } else {
      if (!file) return;
      const session = await createSession.mutateAsync({
        patient_id: patientId,
        encounter_id: encounterId,
        department_id: departmentId,
      });
      await uploadAudio.mutateAsync({ id: session.id, file, autoTranscribe });
      onCreated?.(session.id);
      reset();
      onClose();
    }
  };

  return (
    <div className="janus-modal-backdrop" onClick={onClose}>
      <div
        className="janus-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="janus-modal-head">
          {audioSource === "paste"
            ? <ClipboardList style={{ width: 18, height: 18, color: "var(--janus-primary)" }} />
            : <Mic style={{ width: 18, height: 18, color: "var(--janus-primary)" }} />}
          <h3>{audioSource === "paste" ? "Add encounter transcript" : "Add encounter audio"}</h3>
          <button
            type="button"
            className="janus-icon-btn"
            onClick={onClose}
            title="Close"
            disabled={busy || recordingState === "recording"}
          >
            <X />
          </button>
        </div>
        <div className="janus-modal-body">
          <div className="janus-segmented-control" role="tablist" aria-label="Audio source">
            <button
              type="button"
              className={audioSource === "record" ? "active" : ""}
              onClick={() => handleSourceChange("record")}
              disabled={busy || recordingState === "recording"}
            >
              Record in browser
            </button>
            <button
              type="button"
              className={audioSource === "paste" ? "active" : ""}
              onClick={() => handleSourceChange("paste")}
              disabled={busy || recordingState === "recording"}
            >
              Paste transcript
            </button>
          </div>

          <div>
            <label className="janus-label" htmlFor="upload-patient">
              Patient ID
            </label>
            <input
              id="upload-patient"
              className="janus-input"
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
            />
          </div>
          <div>
            <label className="janus-label" htmlFor="upload-encounter">
              Encounter ID
            </label>
            <input
              id="upload-encounter"
              className="janus-input"
              value={encounterId}
              onChange={(e) => setEncounterId(e.target.value)}
            />
          </div>
          <div>
            <label className="janus-label" htmlFor="upload-department">
              Department ID
            </label>
            <input
              id="upload-department"
              className="janus-input"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            />
          </div>

          {audioSource === "record" ? (
            <div className="janus-recording-panel">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_FORMATS}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                style={{ display: "none" }}
              />
              <div className="janus-recording-status">
                <span className={recordingState === "recording" ? "is-recording" : ""} />
                <strong>{formatDuration(recordingSeconds)}</strong>
                <small>
                  {recordingState === "recording"
                    ? "Recording from microphone"
                    : recordingState === "recorded"
                      ? "Recording ready to upload"
                      : "Ready to record"}
                </small>
              </div>
              {recordingUrl ? (
                <audio controls src={recordingUrl} className="janus-recording-audio">
                  <track kind="captions" />
                </audio>
              ) : null}
              {!recordingSupported ? (
                <div className="janus-error-text">
                  Browser recording is not supported in this browser.
                </div>
              ) : null}
              <div className="janus-recording-actions">
                {recordingState === "recording" ? (
                  <button
                    type="button"
                    className="janus-btn janus-btn-danger-ghost janus-btn-sm"
                    onClick={stopRecording}
                    disabled={busy}
                  >
                    <Square />
                    Stop
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="janus-btn janus-btn-primary janus-btn-sm"
                      onClick={startRecording}
                      disabled={!recordingSupported || busy}
                    >
                      <Mic />
                      {recordingState === "recorded" ? "Record again" : "Start recording"}
                    </button>
                    {recordingState === "idle" ? (
                      <button
                        type="button"
                        className="janus-btn janus-btn-ghost janus-btn-sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={busy}
                      >
                        or upload an audio file
                      </button>
                    ) : null}
                  </>
                )}
                {recordingState === "recorded" ? (
                  <button
                    type="button"
                    className="janus-btn janus-btn-ghost janus-btn-sm"
                    onClick={clearRecording}
                    disabled={busy}
                  >
                    <RotateCcw />
                    Discard
                  </button>
                ) : null}
              </div>
              {file && recordingState !== "recorded" ? (
                <div className="janus-help-text">
                  {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
                </div>
              ) : null}
              <div>
                <label className="janus-label" htmlFor="upload-auto-transcribe">
                  Processing
                </label>
                <label className="janus-checkbox-row" htmlFor="upload-auto-transcribe">
                  <input
                    id="upload-auto-transcribe"
                    type="checkbox"
                    checked={autoTranscribe}
                    onChange={(e) => setAutoTranscribe(e.target.checked)}
                    disabled={busy || recordingState === "recording"}
                  />
                  <span>Automatically transcribe after upload</span>
                </label>
              </div>
            </div>
          ) : null}
          {audioSource === "paste" ? (
            <div>
              <label className="janus-label" htmlFor="upload-transcript">
                Transcript
              </label>
              <textarea
                id="upload-transcript"
                className="janus-input"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Paste the encounter transcript here…"
                rows={8}
                disabled={busy}
                style={{ resize: "vertical", fontFamily: "inherit" }}
              />
            </div>
          ) : null}
          {error ? (
            <div className="janus-error-text">
              {audioSource === "paste" ? `Processing failed: ${error}` : `Audio failed: ${error}`}
            </div>
          ) : null}
        </div>
        <div className="janus-modal-foot">
          <button
            type="button"
            className="janus-btn janus-btn-ghost janus-btn-sm"
            onClick={onClose}
            disabled={busy || recordingState === "recording"}
          >
            Cancel
          </button>
          <button
            type="button"
            className="janus-btn janus-btn-primary janus-btn-sm"
            onClick={handleSubmit}
            disabled={
              busy ||
              recordingState === "recording" ||
              !patientId ||
              !encounterId ||
              !departmentId ||
              (audioSource === "paste" ? !transcript.trim() : !file)
            }
          >
            {busy
              ? "Processing…"
              : audioSource === "paste" || autoTranscribe
                ? "Save & process"
                : "Save audio"}
          </button>
        </div>
      </div>
    </div>
  );
}
