import { X } from "lucide-react";
import type { DiagnosisLab } from "./types";

export function TextEditor({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="janus-section-editor">
      <textarea
        className="janus-editor-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={18}
        autoFocus
      />
      <div className="janus-editor-actions">
        <button
          type="button"
          className="janus-btn janus-btn-primary janus-btn-sm"
          onClick={onSave}
        >
          Save
        </button>
        <button
          type="button"
          className="janus-btn janus-btn-ghost janus-btn-sm"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function LabsEditor({
  rows,
  onChange,
  onSave,
  onCancel,
}: {
  rows: DiagnosisLab[];
  onChange: (rows: DiagnosisLab[]) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const update = (i: number, field: keyof DiagnosisLab, value: string) => {
    const next = rows.map((r, idx) =>
      idx === i ? { ...r, [field]: value } : r,
    );
    onChange(next);
  };
  const addRow = () => onChange([...rows, { diagnosis: "", lab: "" }]);
  const removeRow = (i: number) => onChange(rows.filter((_, idx) => idx !== i));

  return (
    <div className="janus-section-editor">
      <table className="janus-labs-table janus-labs-editor-table">
        <thead>
          <tr>
            <th>Diagnosis</th>
            <th>Lab / Test</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                <input
                  className="janus-editor-input"
                  value={row.diagnosis}
                  onChange={(e) => update(i, "diagnosis", e.target.value)}
                  placeholder="Diagnosis (ICD code)"
                />
              </td>
              <td>
                <input
                  className="janus-editor-input"
                  value={row.lab}
                  onChange={(e) => update(i, "lab", e.target.value)}
                  placeholder="Lab or test"
                />
              </td>
              <td>
                <button
                  type="button"
                  className="janus-section-action"
                  title="Remove row"
                  onClick={() => removeRow(i)}
                >
                  <X />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="janus-editor-actions">
        <button
          type="button"
          className="janus-btn janus-btn-ghost janus-btn-sm"
          onClick={addRow}
        >
          + Add row
        </button>
        <button
          type="button"
          className="janus-btn janus-btn-primary janus-btn-sm"
          onClick={onSave}
        >
          Save
        </button>
        <button
          type="button"
          className="janus-btn janus-btn-ghost janus-btn-sm"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
