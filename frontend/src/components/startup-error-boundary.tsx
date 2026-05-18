import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class StartupErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ error, errorInfo });
    // eslint-disable-next-line no-console
    console.error("Janus Dash startup error", error, errorInfo);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <StartupErrorScreen
        title="Janus Dash couldn't start"
        message={this.state.error.message || String(this.state.error)}
        details={this.state.errorInfo?.componentStack || this.state.error.stack}
      />
    );
  }
}

export function StartupErrorScreen({
  title,
  message,
  details,
}: {
  title: string;
  message: string;
  details?: string | null;
}) {
  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <p style={styles.eyebrow}>Startup error</p>
        <h1 style={styles.title}>{title}</h1>
        <p style={styles.message}>{message}</p>
        {details ? <pre style={styles.details}>{details}</pre> : null}
        <p style={styles.hint}>
          Please send this screen to support. You can also try closing the app
          from the app switcher and reopening it.
        </p>
      </section>
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    padding: "24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f8f9fa",
    color: "#333333",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  card: {
    width: "100%",
    maxWidth: "520px",
    padding: "20px",
    border: "1px solid #e0e0e0",
    borderRadius: "12px",
    background: "#ffffff",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
  },
  eyebrow: {
    margin: "0 0 8px",
    color: "#721c24",
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  },
  title: {
    margin: "0 0 12px",
    fontSize: "22px",
    lineHeight: 1.2,
  },
  message: {
    margin: "0 0 16px",
    color: "#666666",
    overflowWrap: "anywhere" as const,
  },
  details: {
    maxHeight: "260px",
    overflow: "auto",
    margin: "0 0 16px",
    padding: "12px",
    borderRadius: "8px",
    background: "#161e2a",
    color: "#e8edf3",
    fontSize: "12px",
    lineHeight: 1.4,
    whiteSpace: "pre-wrap" as const,
  },
  hint: {
    margin: 0,
    color: "#666666",
    fontSize: "13px",
  },
};
