import type { ReactNode } from 'react';
import { Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useStore } from '@/contexts/useStore';
import { cn } from '@/lib/utils';
import {
  downloadCsv,
  formatCell,
  isNumericFormat,
  printReport,
  type ReportColumn,
} from '@/lib/reportExport';

interface ReportTableProps<T> {
  title: string;
  description?: ReactNode;
  /** Shown under the title when printed, e.g. the period. */
  subtitle?: string;
  columns: ReportColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** One entry per column; numbers are formatted like the column. */
  footer?: (string | number | null)[];
  /** Key figures printed above the table. */
  summary?: [string, string][];
  fileName: string;
  emptyText?: string;
  /** Extra controls next to the export buttons (filters etc.). */
  toolbar?: ReactNode;
}

export function ReportTable<T>({
  title,
  description,
  subtitle,
  columns,
  rows,
  rowKey,
  footer,
  summary,
  fileName,
  emptyText = 'No data for this period',
  toolbar,
}: ReportTableProps<T>) {
  const { settings } = useStore();
  const numeric = (c: ReportColumn<T>) => isNumericFormat(c.format);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-lg">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length === 0}
            onClick={() => downloadCsv(fileName, columns, rows, footer)}
          >
            <Download className="w-4 h-4 mr-1.5" />
            Excel (CSV)
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length === 0}
            onClick={() =>
              printReport({ title, storeName: settings.storeName, subtitle, summary, columns, rows, footer })
            }
          >
            <Printer className="w-4 h-4 mr-1.5" />
            Print
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="max-h-[560px] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted">
              <TableRow>
                {columns.map((c) => (
                  <TableHead key={c.header} className={cn('whitespace-nowrap', numeric(c) && 'text-right')}>
                    {c.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="py-10 text-center text-muted-foreground">
                    {emptyText}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={rowKey(row)}>
                    {columns.map((c) => (
                      <TableCell key={c.header} className={cn(numeric(c) && 'text-right whitespace-nowrap')}>
                        {c.render ? c.render(row) : formatCell(c.format, c.value(row))}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
            {footer && rows.length > 0 && (
              <TableFooter className="sticky bottom-0 bg-muted">
                <TableRow>
                  {columns.map((c, i) => (
                    <TableCell key={c.header} className={cn('font-bold', numeric(c) && 'text-right whitespace-nowrap')}>
                      {typeof footer[i] === 'number' ? formatCell(c.format, footer[i]) : footer[i]}
                    </TableCell>
                  ))}
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'bad' }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={cn(
            'mt-1 text-xl font-bold',
            tone === 'good' && 'text-success',
            tone === 'bad' && 'text-destructive'
          )}
        >
          {value}
        </p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
