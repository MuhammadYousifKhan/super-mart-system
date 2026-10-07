import type { ReactNode } from 'react';
import { format } from 'date-fns';
import { escapeHtml as esc } from '@/lib/orderMath';
import { parseLocalDate } from '@/lib/dates';

export type CellFormat = 'money' | 'number' | 'percent' | 'date' | 'text';

export interface ReportColumn<T> {
  header: string;
  /** Raw value: exported to CSV as is, so numbers stay numbers in Excel. */
  value: (row: T) => string | number | null | undefined;
  format?: CellFormat;
  /** Custom on-screen cell (badges etc.). CSV and print still use `value`. */
  render?: (row: T) => ReactNode;
}

export function formatMoney(amount: number): string {
  return `PKR ${amount.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function formatCell(fmt: CellFormat | undefined, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return fmt === 'date' ? '-' : '';
  switch (fmt) {
    case 'money':
      return formatMoney(Number(value));
    case 'number':
      return Number(value).toLocaleString('en-PK', { maximumFractionDigits: 2 });
    case 'percent':
      return `${Number(value).toLocaleString('en-PK', { maximumFractionDigits: 1 })}%`;
    case 'date':
      return format(parseLocalDate(String(value)), 'dd MMM yyyy');
    default:
      return String(value);
  }
}

export const isNumericFormat = (fmt?: CellFormat) => fmt === 'money' || fmt === 'number' || fmt === 'percent';

function csvField(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Downloads rows as a CSV file that opens directly in Excel (UTF-8 with BOM). */
export function downloadCsv<T>(
  fileName: string,
  columns: ReportColumn<T>[],
  rows: T[],
  footer?: (string | number | null)[]
) {
  const lines = [columns.map((c) => csvField(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvField(c.value(row))).join(','));
  if (footer) lines.push(footer.map((v) => csvField(v)).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Prints a report on a normal (A4) printer from a hidden frame. */
export function printReport<T>(args: {
  title: string;
  storeName: string;
  subtitle?: string;
  summary?: [string, string][];
  columns: ReportColumn<T>[];
  rows: T[];
  footer?: (string | number | null)[];
}) {
  const { title, storeName, subtitle, summary, columns, rows, footer } = args;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1100px;height:800px;border:0;';
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  if (!win) {
    frame.remove();
    return;
  }

  const align = (c: ReportColumn<T>) => (isNumericFormat(c.format) ? ' class="num"' : '');
  const head = columns.map((c) => `<th${align(c)}>${esc(c.header)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${columns.map((c) => `<td${align(c)}>${esc(formatCell(c.format, c.value(r)))}</td>`).join('')}</tr>`)
    .join('');
  const foot = footer
    ? `<tfoot><tr>${columns
        .map((c, i) => `<td${align(c)}>${esc(typeof footer[i] === 'number' ? formatCell(c.format, footer[i]) : (footer[i] ?? ''))}</td>`)
        .join('')}</tr></tfoot>`
    : '';
  const summaryHtml = summary?.length
    ? `<div class="summary">${summary
        .map(([k, v]) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`)
        .join('')}</div>`
    : '';

  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4 ${columns.length > 7 ? 'landscape' : 'portrait'}; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #000; margin: 0; }
  h1 { font-size: 18px; margin: 0; }
  .store { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
  .sub { color: #333; margin: 2px 0 10px; }
  .summary { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 12px; }
  .stat { border: 1px solid #999; border-radius: 4px; padding: 6px 10px; min-width: 120px; }
  .stat .k { font-size: 10px; color: #444; }
  .stat .v { font-size: 13px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #eee; font-weight: 700; border-bottom: 2px solid #000; }
  tfoot td { font-weight: 700; border-top: 2px solid #000; border-bottom: none; }
  .num { text-align: right; white-space: nowrap; }
  .printed { margin-top: 10px; font-size: 9px; color: #555; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
</style></head><body>
<div class="store">${esc(storeName)}</div>
<h1>${esc(title)}</h1>
${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}
${summaryHtml}
<table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${columns.length}">No data</td></tr>`}</tbody>${foot}</table>
<div class="printed">Printed ${esc(format(new Date(), 'dd MMM yyyy hh:mm a'))}</div>
</body></html>`);
  win.document.close();

  const cleanup = () => frame.remove();
  win.addEventListener('afterprint', cleanup);
  setTimeout(cleanup, 120000);
  setTimeout(() => {
    win.focus();
    win.print();
  }, 250);
}
