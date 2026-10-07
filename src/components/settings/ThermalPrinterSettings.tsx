import { useCallback, useEffect, useState } from 'react';
import { Printer, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { PaperColumns } from '@/lib/escposReceipt';
import {
  getThermalPrinterConfig,
  isThermalPrinterAvailable,
  listInstalledPrinters,
  printTestPage,
  saveThermalPrinterConfig,
  type InstalledPrinter,
  type ThermalPrinterConfig,
} from '@/lib/thermalPrinter';

const NONE = '__none__';

export function ThermalPrinterSettings({ storeName }: { storeName: string }) {
  const available = isThermalPrinterAvailable();
  const [config, setConfig] = useState<ThermalPrinterConfig>(getThermalPrinterConfig);
  const [printers, setPrinters] = useState<InstalledPrinter[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setPrinters(await listInstalledPrinters());
    } catch {
      toast.error('Could not read the installed printers');
    }
  }, []);

  useEffect(() => {
    if (available) refresh();
  }, [available, refresh]);

  const update = (next: ThermalPrinterConfig) => {
    setConfig(next);
    saveThermalPrinterConfig(next);
  };

  const handleTest = async () => {
    setBusy(true);
    try {
      await printTestPage(storeName, config);
      toast.success('Test page sent to the printer');
    } catch (err) {
      toast.error(`Test print failed: ${err?.message || 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  // A saved printer that is no longer installed should still be visible so it can be changed.
  const names = printers.map((p) => p.name);
  const options = config.printerName && !names.includes(config.printerName) ? [...names, config.printerName] : names;

  return (
    <Card className="card-interactive">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Printer className="w-5 h-5 text-primary" />
          <CardTitle>Thermal Receipt Printer</CardTitle>
        </div>
        <CardDescription>
          {available
            ? 'Choose the receipt printer for this computer. Receipts then print instantly with no print dialog.'
            : 'Direct receipt printing is available in the desktop app only. In the browser, the normal print dialog is used.'}
        </CardDescription>
      </CardHeader>
      {available && (
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Printer</Label>
            <div className="flex gap-2">
              <Select
                value={config.printerName || NONE}
                onValueChange={(v) => update({ ...config, printerName: v === NONE ? '' : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a printer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None (use the print dialog)</SelectItem>
                  {options.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="icon" onClick={refresh} title="Refresh printer list">
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Paper width</Label>
            <Select
              value={String(config.columns)}
              onValueChange={(v) => update({ ...config, columns: Number(v) as PaperColumns })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="48">80mm paper - 48 characters</SelectItem>
                <SelectItem value="42">80mm paper - 42 characters (narrower print area)</SelectItem>
                <SelectItem value="32">58mm paper - 32 characters</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              If the test page ruler wraps onto two lines, pick a smaller number.
            </p>
          </div>

          <Button type="button" variant="outline" onClick={handleTest} disabled={busy || !config.printerName}>
            <Printer className="w-4 h-4 mr-2" />
            {busy ? 'Printing...' : 'Print test page'}
          </Button>
        </CardContent>
      )}
    </Card>
  );
}
