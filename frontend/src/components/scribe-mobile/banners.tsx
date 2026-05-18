import { Ban, RefreshCcw, TriangleAlert } from "lucide-react";

interface FailedProps {
  message: string;
  onRetry?: () => void;
}

export function MFailedBanner({ message, onRetry }: FailedProps) {
  return (
    <div className="m-banner">
      <TriangleAlert />
      <div>
        <strong>Transcription failed</strong>
        {message}
        {onRetry ? (
          <div>
            <button type="button" className="m-banner-retry" onClick={onRetry}>
              <RefreshCcw />
              Retry pipeline
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MRejectedBanner() {
  return (
    <div className="m-banner warning">
      <Ban />
      <div>
        <strong>Encounter rejected</strong>
        This encounter was rejected and will not be sent to the EHR.
      </div>
    </div>
  );
}
