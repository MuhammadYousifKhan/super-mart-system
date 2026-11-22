import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { logger, serializeError } from '@/lib/logger';

interface State {
  error: Error | null;
  exportedTo: string | null;
}

/** Catches a crash while rendering, logs it with the component stack, and offers a way back. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, exportedTo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('ui', 'React render crash', {
      error: serializeError(error),
      componentStack: info.componentStack?.split('\n').slice(0, 12).join('\n'),
    });
    logger.flush();
  }

  private exportLogs = async () => {
    try {
      if (window.posLog) {
        const path = await window.posLog.exportBundle({ reason: 'error-boundary', error: serializeError(this.state.error) });
        this.setState({ exportedTo: path });
      } else {
        this.setState({ exportedTo: 'Logs are only exported by the desktop app.' });
      }
    } catch (err) {
      this.setState({ exportedTo: `Could not export logs: ${serializeError(err).message}` });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-semibold text-foreground">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            Your data and any unsaved changes are kept on this PC. Reload to continue. If this keeps happening, export
            the logs and send them to support.
          </p>
          <p className="break-words rounded-md bg-muted p-2 text-left font-mono text-xs text-muted-foreground">
            {this.state.error.message}
          </p>
          <div className="flex justify-center gap-3">
            <Button onClick={() => window.location.reload()}>Reload</Button>
            <Button variant="outline" onClick={() => void this.exportLogs()}>
              Export logs
            </Button>
          </div>
          {this.state.exportedTo && <p className="break-words text-xs text-muted-foreground">{this.state.exportedTo}</p>}
        </div>
      </div>
    );
  }
}
