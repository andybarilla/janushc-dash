import { useEffect, useRef, useState } from "react";
import { FileText, Mic, RotateCcw, Square, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  RECORDING_CHUNK_MS,
  createRecordingDraft,
  deleteRecordingDraft,
  saveRecordingDraftChunk,
  updateRecordingDraftMetadata,
} from "@/lib/recording-drafts";
import {
  useCreateScribeSession,
  useScribeDepartments,
  useTodayAppointments,
  useUploadScribeAudio,
  useUploadScribeDocument,
  type ScribeAppointment,
} from "@/lib/scribe-queries";

const ACCEPTED_FORMATS = ".mp3,.m4a,.wav,.webm,.ogg";
const ACCEPTED_DOCUMENT_FORMATS = ".pdf,.png,.jpg,.jpeg,.tif,.tiff";
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
  initialSource?: EncounterSource;
  initialAudioFile?: File | null;
  initialDepartmentId?: string;
  initialAppointmentId?: string;
  initialAutoTranscribe?: boolean;
  initialRecordingDraftId?: string | null;
  onLocalRecordingsChanged?: () => void;
  extraAppointment?: ScribeAppointment;
}

type EncounterSource = "record" | "document";

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

export function UploadModal({
  open,
  onClose,
  onCreated,
  initialSource = "record",
  initialAudioFile = null,
  initialDepartmentId,
  initialAppointmentId,
  initialAutoTranscribe,
  initialRecordingDraftId = null,
  onLocalRecordingsChanged,
  extraAppointment,
}: Props) {
  const [departmentId, setDepartmentId] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [encounterSource, setEncounterSource] = useState<EncounterSource>(initialSource);
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [autoTranscribe, setAutoTranscribe] = useState(true);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [localRecordingDraftId, setLocalRecordingDraftId] = useState<string | null>(initialRecordingDraftId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const nextChunkIndexRef = useRef(0);
  const pendingDraftWritesRef = useRef<Set<Promise<void>>>(new Set());

  const createSession = useCreateScribeSession();
  const uploadAudio = useUploadScribeAudio();
  const uploadDocument = useUploadScribeDocument();
  const departmentsQuery = useScribeDepartments();
  const appointmentsQuery = useTodayAppointments(departmentId);
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const fetchedAppointments = appointmentsQuery.data ?? [];
  const appointments =
    extraAppointment &&
    !fetchedAppointments.some((a) => a.appointment_id === extraAppointment.appointment_id)
      ? [extraAppointment, ...fetchedAppointments]
      : fetchedAppointments;
  const selectedAppointment = appointments.find((a) => a.appointment_id === appointmentId);
  const patientId = selectedAppointment?.patient_id ?? "";

  useEffect(() => {
    if (open) setEncounterSource(initialSource);
  }, [open, initialSource]);

  useEffect(() => {
    if (!open || !initialAudioFile) return;
    setEncounterSource("record");
    setFile(initialAudioFile);
    setRecordingUrl(URL.createObjectURL(initialAudioFile));
    setRecordingState("recorded");
    if (initialDepartmentId) setDepartmentId(initialDepartmentId);
    if (initialAppointmentId) setAppointmentId(initialAppointmentId);
    if (typeof initialAutoTranscribe === "boolean") setAutoTranscribe(initialAutoTranscribe);
    setLocalRecordingDraftId(initialRecordingDraftId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialAudioFile, initialRecordingDraftId]);

  useEffect(() => {
    if (!open) return;
    return () => {
      mediaRecorderRef.current?.state === "recording" && mediaRecorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    };
  }, [open, recordingUrl]);

  // Reset recording/selection state when the modal closes so stale state
  // (e.g. a recovered audio file pre-fill) doesn't survive into the next open.
  // URL revocation is handled by the cleanup effect above; skip it here.
  useEffect(() => {
    if (open) return;
    setFile(null);
    setDocumentFile(null);
    setAppointmentId("");
    setRecordingUrl(null);
    setRecordingSeconds(0);
    setRecordingState("idle");
    setRecordingError(null);
    setLocalRecordingDraftId(null);
  }, [open]);

  useEffect(() => {
    if (recordingState !== "recording") return;
    const intervalId = window.setInterval(() => {
      setRecordingSeconds((seconds) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [recordingState]);

  useEffect(() => {
    if (recordingState !== "recording" || !localRecordingDraftId) return;
    const writePromise = updateRecordingDraftMetadata(localRecordingDraftId, {
      elapsedSeconds: recordingSeconds,
      patientId,
      appointmentId,
      patientName: selectedAppointment?.patient_name,
      appointmentTime: selectedAppointment?.time,
      departmentId,
      autoTranscribe,
      nextChunkIndex: nextChunkIndexRef.current,
    })
      .catch(() => setRecordingError("Recording is continuing, but local recovery storage is unavailable."))
      .finally(() => {
        pendingDraftWritesRef.current.delete(writePromise);
      });
    pendingDraftWritesRef.current.add(writePromise);
  }, [appointmentId, autoTranscribe, departmentId, localRecordingDraftId, patientId, recordingSeconds, recordingState, selectedAppointment]);

  useEffect(() => {
    const first = departmentsQuery.data?.[0];
    if (!departmentId && first) {
      setDepartmentId(first.id);
    }
  }, [departmentId, departmentsQuery.data]);

  if (!open) return null;

  const busy =
    createSession.isPending ||
    uploadAudio.isPending ||
    uploadDocument.isPending;
  const recordingSupported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";
  const error =
    apiErrorMessage(createSession.error) ||
    apiErrorMessage(uploadAudio.error) ||
    apiErrorMessage(uploadDocument.error) ||
    recordingError ||
    null;

  const clearRecording = () => {
    const draftId = localRecordingDraftId;
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    setRecordingUrl(null);
    setRecordingSeconds(0);
    setRecordingState("idle");
    setRecordingError(null);
    if (encounterSource === "record") {
      setFile(null);
    }
    setLocalRecordingDraftId(null);
    if (draftId) {
      void Promise.allSettled(Array.from(pendingDraftWritesRef.current))
        .then(() => deleteRecordingDraft(draftId))
        .finally(() => onLocalRecordingsChanged?.());
    }
  };

  const reset = () => {
    setAppointmentId("");
    setFile(null);
    setDocumentFile(null);
    setEncounterSource(initialSource);
    clearRecording();
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (documentInputRef.current) documentInputRef.current.value = "";
  };

  const handleSourceChange = (source: EncounterSource) => {
    setEncounterSource(source);
    setRecordingError(null);
    if (source === "document") {
      clearRecording();
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } else {
      // record
      setDocumentFile(null);
      if (documentInputRef.current) documentInputRef.current.value = "";
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
      nextChunkIndexRef.current = 0;
      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      const type = recorder.mimeType || mimeType || "audio/webm";
      if (currentUserId) {
        try {
          const draft = await createRecordingDraft({
            ownerUserId: currentUserId,
            mimeType: type,
            fileExtension: recordingExtension(type),
            patientId,
            appointmentId,
            patientName: selectedAppointment?.patient_name,
            appointmentTime: selectedAppointment?.time,
            departmentId,
            autoTranscribe,
            elapsedSeconds: 0,
          });
          setLocalRecordingDraftId(draft.draftId);
          onLocalRecordingsChanged?.();
        } catch {
          setRecordingError("Recording is continuing, but local recovery storage is unavailable.");
        }
      } else {
        setRecordingError("Recording is continuing, but local recovery storage is unavailable.");
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size <= 0) return;
        chunksRef.current.push(event.data);
        setLocalRecordingDraftId((draftId) => {
          if (!draftId) return draftId;
          const chunkIndex = nextChunkIndexRef.current;
          nextChunkIndexRef.current += 1;
          const writePromise = saveRecordingDraftChunk(draftId, chunkIndex, event.data)
            .catch(() => setRecordingError("Recording is continuing, but local recovery storage is unavailable."))
            .finally(() => {
              pendingDraftWritesRef.current.delete(writePromise);
            });
          pendingDraftWritesRef.current.add(writePromise);
          return draftId;
        });
      };
      recorder.onstop = () => {
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
        onLocalRecordingsChanged?.();
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
      };
      recorder.start(RECORDING_CHUNK_MS);
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
    if (!appointmentId || !patientId) return;
    if (encounterSource === "document") {
      if (!documentFile) return;
      const session = await createSession.mutateAsync({
        patient_id: patientId,
        appointment_id: appointmentId,
        department_id: departmentId,
      });
      await uploadDocument.mutateAsync({ id: session.id, file: documentFile });
      onCreated?.(session.id);
      reset();
      onClose();
    } else {
      if (!file) return;
      const session = await createSession.mutateAsync({
        patient_id: patientId,
        appointment_id: appointmentId,
        department_id: departmentId,
      });
      await uploadAudio.mutateAsync({ id: session.id, file, autoTranscribe });
      if (localRecordingDraftId) {
        await Promise.allSettled(Array.from(pendingDraftWritesRef.current));
        await deleteRecordingDraft(localRecordingDraftId);
        onLocalRecordingsChanged?.();
      }
      onCreated?.(session.id);
      reset();
      onClose();
    }
  };

  const headIcon =
    encounterSource === "document" ? (
      <FileText style={{ width: 18, height: 18, color: "var(--janus-primary)" }} />
    ) : (
      <Mic style={{ width: 18, height: 18, color: "var(--janus-primary)" }} />
    );

  const headTitle =
    encounterSource === "document" ? "Upload encounter document" : "Add encounter audio";

  return (
    <div className="janus-modal-backdrop" onClick={onClose}>
      <div
        className="janus-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="janus-modal-head">
          {headIcon}
          <h3>{headTitle}</h3>
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
          <div className="janus-segmented-control" role="tablist" aria-label="Encounter source">
            <button
              type="button"
              className={encounterSource === "record" ? "active" : ""}
              onClick={() => handleSourceChange("record")}
              disabled={busy || recordingState === "recording"}
            >
              Record in browser
            </button>
            <button
              type="button"
              className={encounterSource === "document" ? "active" : ""}
              onClick={() => handleSourceChange("document")}
              disabled={busy || recordingState === "recording"}
            >
              Upload document
            </button>
          </div>

          <div>
            <label className="janus-label" htmlFor="upload-department">
              Department
            </label>
            <select
              id="upload-department"
              className="janus-input"
              value={departmentId}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                setAppointmentId("");
              }}
              disabled={busy || departmentsQuery.isLoading}
            >
              {departmentsQuery.isLoading ? (
                <option value="">Loading…</option>
              ) : (
                departmentsQuery.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))
              )}
            </select>
            {departmentsQuery.isError ? (
              <div className="janus-error-text">Could not load departments.</div>
            ) : null}
          </div>
          <div>
            <label className="janus-label" htmlFor="upload-patient">
              Patient
            </label>
            <select
              id="upload-patient"
              className="janus-input"
              value={appointmentId}
              onChange={(e) => setAppointmentId(e.target.value)}
              disabled={busy || !departmentId || appointmentsQuery.isLoading}
            >
              <option value="">
                {appointmentsQuery.isLoading
                  ? "Loading…"
                  : appointments.length === 0
                    ? "No appointments booked today"
                    : "Select patient…"}
              </option>
              {appointments.map((a) => (
                <option key={a.appointment_id} value={a.appointment_id}>
                  {a.time} · {a.patient_name}
                </option>
              ))}
            </select>
            {appointmentsQuery.isError ? (
              <div className="janus-error-text">Could not load appointments.</div>
            ) : null}
          </div>

          {encounterSource === "record" ? (
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
          {encounterSource === "document" ? (
            <div className="janus-recording-panel">
              <input
                ref={documentInputRef}
                type="file"
                accept={ACCEPTED_DOCUMENT_FORMATS}
                onChange={(e) => setDocumentFile(e.target.files?.[0] ?? null)}
                style={{ display: "none" }}
              />
              <div className="janus-recording-actions">
                <button
                  type="button"
                  className="janus-btn janus-btn-ghost janus-btn-sm"
                  onClick={() => documentInputRef.current?.click()}
                  disabled={busy}
                >
                  <FileText />
                  Choose document
                </button>
              </div>
              {documentFile ? (
                <div className="janus-help-text">
                  {documentFile.name} ({(documentFile.size / 1024 / 1024).toFixed(1)} MB)
                </div>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <div className="janus-error-text">
              {encounterSource === "document"
                ? `Upload failed: ${error}`
                : `Audio failed: ${error}`}
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
              !appointmentId ||
              (encounterSource === "document" ? !documentFile : !file)
            }
          >
            {busy
              ? "Processing…"
              : encounterSource === "document" || autoTranscribe
                ? "Save & process"
                : "Save audio"}
          </button>
        </div>
      </div>
    </div>
  );
}
