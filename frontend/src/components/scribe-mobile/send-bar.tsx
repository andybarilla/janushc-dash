import { Check, Send } from "lucide-react";

export type SendState = "disabled" | "ready" | "sent";

interface Props {
  state: SendState;
  showApproveAll: boolean;
  onApproveAll: () => void;
  onSend: () => void;
}

export function MSendBar({ state, showApproveAll, onApproveAll, onSend }: Props) {
  const isSent = state === "sent";
  const sendDisabled = state !== "ready";

  return (
    <div className="m-bottom-bar">
      {showApproveAll ? (
        <button type="button" className="m-send-secondary" onClick={onApproveAll}>
          Approve all
        </button>
      ) : null}
      <button
        type="button"
        className="m-send"
        disabled={sendDisabled}
        onClick={sendDisabled ? undefined : onSend}
        aria-disabled={sendDisabled}
      >
        {isSent ? <Check /> : <Send />}
        {isSent ? "Sent to EHR" : "Send to EHR"}
      </button>
    </div>
  );
}
