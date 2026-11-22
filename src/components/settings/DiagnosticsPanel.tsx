import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { Activity, Copy, Download, FolderOpen, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useStore } from '@/contexts/useStore';
import { logger, redact, serializeError, type LogCategory, type LogEntry, type LogLevel } from '@/lib/logger';
import { getLastCloudRefreshMs, getScanStats } from '@/lib/perfStats';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const LEVEL_STYLE: Record<LogLevel, string> = {
  debug: 'text-muted-foreground',
  info: 'text-foreground',
  warn: 'text-warning',
  error: 'text-destructive',
};
const CATEGORIES: Array<LogCategory | 'all'> = ['all', 'sync', 'auth', 'db', 'cloud', 'pos', 'print', 'perf', 'ui', 'app'];

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Admin-only: sync status, waiting changes with their full errors, recent log, and log export. */
export function DiagnosticsPanel() {
  const { syncStatus, syncQueue, manualSync, discardSyncOp } = useStore();
  const [level, setLevel] = useState<LogLevel>('info');
  const [category, setCategory] = useState<LogCategory | 'all'>('all');
  const [, tick] = useState(0);

  // Re-read the in-memory log when it changes, and the clock-based figures every 5 s.
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 5000);
    return () => window.clearInterval(id);
  }, []);
  const logVersion = useSyncExternalStore(
    (listener) => logger.subscribe(listener),
    () => logger.recent().length + (logger.recent()[logger.recent().length - 1]?.ts ?? '')
  );

  const entries = useMemo(
    () =>
      logger
        .recent()
        .filter((e) => LEVEL_RANK[e.level] >= LEVEL_RANK[level] && (category === 'all' || e.cat === category))
        .slice(-200)
        .reverse(),
    // logVersion changes whenever a line is added
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [level, category, logVersion]
  );

  const scan = getScanStats();
  const cloudMs = getLastCloudRefreshMs();
  const oldest = syncQueue[0];

  const summary = () =>
    [
      `Online: ${syncStatus.online ? 'yes' : 'no'}   Live updates: ${syncStatus.live ? 'yes' : 'no'}`,
      `Waiting: ${syncStatus.pending}   Set aside: ${syncStatus.failed}`,
      `Uploads paused for sign-in: ${syncStatus.authPaused ? 'yes' : 'no'}`,
      `Last synced: ${syncStatus.lastSyncedAt ?? 'never'}`,
      oldest ? `Oldest waiting: ${oldest.label} from ${oldest.createdAt}` : 'Nothing waiting',
      syncStatus.blocked ? `Blocked on: ${syncStatus.blocked.label} (${syncStatus.blocked.kind}) ${syncStatus.blocked.error}` : '',
      syncStatus.lastError ? `Last error: ${syncStatus.lastError}` : '',
    ]
      .filter(Boolean)
      .join('\n');

  const diagnostics = () => ({
    sync: {
      ...syncStatus,
      queue: syncQueue.map(({ payload: _payload, ...rest }) => rest), // counts and errors only, not the data
    },
    scan,
    lastCloudRefreshMs: cloudMs,
    recentLog: logger.recent().slice(-200),
  });

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summary());
      toast.success('Summary copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  const openFolder = async () => {
    if (!window.posLog) {
      toast.info('Log files are only written by the desktop app.');
      return;
    }
    try {
      await window.posLog.openFolder();
    } catch (err) {
      toast.error(`Could not open the logs folder: ${serializeError(err).message}`);
    }
  };

  const exportBundle = async () => {
    logger.flush();
    if (!window.posLog) {
      downloadJson('pos-diagnostics.json', redact(diagnostics()));
      return;
    }
    try {
      const path = await window.posLog.exportBundle(diagnostics());
      toast.success(`Diagnostics saved: ${path}`, { duration: 10000 });
    } catch (err) {
      toast.error(`Could not export diagnostics: ${serializeError(err).message}`);
    }
  };

  const exportOp = (id: string) => {
    const op = syncQueue.find((o) => o.id === id);
    if (op) downloadJson(`waiting-change-${op.id}.json`, op);
  };

  return (
    <Card className="card-interactive">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <CardTitle>Diagnostics</CardTitle>
        </div>
        <CardDescription>
          Why an upload is stuck, what the app has been doing, and logs to send to support. Passwords and tokens are never
          recorded.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Sync status */}
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="Internet" value={syncStatus.online ? 'Online' : 'Offline'} />
          <Stat label="Live updates" value={syncStatus.live ? 'Connected' : 'Not connected'} />
          <Stat label="Waiting / set aside" value={`${syncStatus.pending} / ${syncStatus.failed}`} />
          <Stat
            label="Last synced"
            value={syncStatus.lastSyncedAt ? formatDistanceToNow(new Date(syncStatus.lastSyncedAt), { addSuffix: true }) : 'Never'}
          />
          <Stat
            label="Oldest waiting"
            value={oldest ? formatDistanceToNow(new Date(oldest.createdAt), { addSuffix: true }) : 'None'}
          />
          <Stat label="Avg scan (last 50)" value={scan.averageMs === null ? 'No scans yet' : `${Math.round(scan.averageMs)} ms`} />
          <Stat label="Worst scan" value={scan.worstMs === null ? '-' : `${Math.round(scan.worstMs)} ms`} />
          <Stat label="Last cloud refresh" value={cloudMs === null ? '-' : `${(cloudMs / 1000).toFixed(1)} s`} />
        </div>

        {syncStatus.authPaused && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            Uploads are paused because this PC is no longer signed in. Sign out and sign in again; the waiting changes upload
            afterwards.
          </p>
        )}
        {syncStatus.needsDbUpdate && (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            The database setup is out of date. Run MULTI_PC_SETUP.sql in Supabase, then press Retry now.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void manualSync()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Retry now
          </Button>
          <Button size="sm" variant="outline" onClick={() => void openFolder()}>
            <FolderOpen className="mr-2 h-4 w-4" /> Open logs folder
          </Button>
          <Button size="sm" variant="outline" onClick={() => void exportBundle()}>
            <Download className="mr-2 h-4 w-4" /> Export diagnostics
          </Button>
          <Button size="sm" variant="outline" onClick={() => void copySummary()}>
            <Copy className="mr-2 h-4 w-4" /> Copy summary
          </Button>
        </div>

        {/* Waiting changes */}
        <div>
          <h3 className="mb-2 text-sm font-semibold">Waiting changes</h3>
          {syncQueue.length === 0 ? (
            <p className="text-sm text-muted-foreground">Everything on this PC is uploaded.</p>
          ) : (
            <div className="max-h-80 space-y-2 overflow-auto">
              {syncQueue.map((op) => (
                <div key={op.id} className="rounded-md border border-border/60 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{op.label}</span>
                      {op.parked ? <Badge variant="destructive">Set aside</Badge> : <Badge variant="secondary">Waiting</Badge>}
                      {op.lastErrorKind && <Badge variant="outline">{op.lastErrorKind}</Badge>}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => exportOp(op.id)}>
                        <Download className="mr-1 h-3.5 w-3.5" /> Export
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" className="text-destructive">
                            <Trash2 className="mr-1 h-3.5 w-3.5" /> Discard
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Discard this change?</AlertDialogTitle>
                            <AlertDialogDescription>
                              {op.label} from {new Date(op.createdAt).toLocaleString()} will never be uploaded, so other PCs and
                              the cloud will not get it. It is recorded in the log first. Only do this for a change the database
                              keeps rejecting.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep it</AlertDialogCancel>
                            <AlertDialogAction onClick={() => discardSyncOp(op.id)}>Discard permanently</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Saved {formatDistanceToNow(new Date(op.createdAt), { addSuffix: true })} · {op.retryCount} attempt
                    {op.retryCount === 1 ? '' : 's'}
                  </p>
                  {op.lastError && <p className="mt-1 break-words text-xs">{op.lastError}</p>}
                  {op.lastErrorDetail && (
                    <p className="mt-1 break-words font-mono text-[11px] text-muted-foreground">
                      {[
                        op.lastErrorDetail.code && `code ${op.lastErrorDetail.code}`,
                        op.lastErrorDetail.status && `status ${op.lastErrorDetail.status}`,
                        op.lastErrorDetail.message,
                        op.lastErrorDetail.details,
                        op.lastErrorDetail.hint && `hint: ${op.lastErrorDetail.hint}`,
                      ]
                        .filter(Boolean)
                        .join(' | ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent log */}
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Recent log</h3>
            <div className="flex gap-2">
              <Select value={level} onValueChange={(v) => setLevel(v as LogLevel)}>
                <SelectTrigger className="h-8 w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="debug">Everything</SelectItem>
                  <SelectItem value="info">Info +</SelectItem>
                  <SelectItem value="warn">Warnings +</SelectItem>
                  <SelectItem value="error">Errors</SelectItem>
                </SelectContent>
              </Select>
              <Select value={category} onValueChange={(v) => setCategory(v as LogCategory | 'all')}>
                <SelectTrigger className="h-8 w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c === 'all' ? 'All areas' : c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="max-h-72 overflow-auto rounded-md border border-border/60 bg-muted/30 p-2 font-mono text-[11px] leading-relaxed">
            {entries.length === 0 ? (
              <p className="p-2 text-muted-foreground">Nothing logged at this level yet.</p>
            ) : (
              entries.map((e, i) => <LogLine key={`${e.ts}-${i}`} entry={e} />)
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  const time = new Date(entry.ts).toLocaleTimeString();
  return (
    <div className={`break-words ${LEVEL_STYLE[entry.level]}`}>
      <span className="text-muted-foreground">{time}</span> [{entry.cat}] {entry.msg}
      {entry.data !== undefined && <span className="text-muted-foreground"> {JSON.stringify(entry.data).slice(0, 300)}</span>}
    </div>
  );
}
