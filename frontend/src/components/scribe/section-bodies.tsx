import type { DiagnosisLab } from "./types";

export function parseDiagnosisCode(raw: string): { name: string; code: string | null } {
  const m = raw.match(/^(.+?)\s*\(([A-Z0-9.]+)\)\s*$/);
  if (!m || !m[1] || !m[2]) return { name: raw, code: null };
  return { name: m[1], code: m[2] };
}

export function HpiBody({ body }: { body: string }) {
  return <p>{body || <em>No content extracted.</em>}</p>;
}

export function PlanBody({ body }: { body: string }) {
  const lines = body
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*])\s*/, "").trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return <p>{body}</p>;
  }
  return (
    <ol className="janus-plan-list">
      {lines.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ol>
  );
}

export function ExamBody({ body }: { body: string }) {
  return <p style={{ whiteSpace: "pre-wrap" }}>{body || <em>No content extracted.</em>}</p>;
}

export function LabsTable({ rows }: { rows: DiagnosisLab[] }) {
  return (
    <table className="janus-labs-table">
      <tbody>
        {rows.map((row, i) => {
          const { name, code } = parseDiagnosisCode(row.diagnosis);
          return (
            <tr key={i}>
              <td>
                {name}
                {code ? <span className="janus-dx-code">{code}</span> : null}
              </td>
              <td>{row.lab}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
