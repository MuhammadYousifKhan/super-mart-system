import type { Order, OrderItem } from '@/types/pos';
import {
  buildReceiptBytes,
  buildTestPageBytes,
  type PaperColumns,
  type ReceiptStoreSettings,
} from '@/lib/escposReceipt';

export interface ThermalPrinterConfig {
  /** Windows print queue name. Empty means direct printing is off. */
  printerName: string;
  columns: PaperColumns;
}

export interface InstalledPrinter {
  name: string;
  isDefault: boolean;
}

// Stored on this computer only: each till has its own printer.
const STORAGE_KEY = 'pos.thermalPrinter';
const DEFAULT_CONFIG: ThermalPrinterConfig = { printerName: '', columns: 48 };

export function getThermalPrinterConfig(): ThermalPrinterConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw);
    const columns = [32, 42, 48].includes(parsed?.columns) ? parsed.columns : DEFAULT_CONFIG.columns;
    return { printerName: typeof parsed?.printerName === 'string' ? parsed.printerName : '', columns };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveThermalPrinterConfig(config: ThermalPrinterConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* storage unavailable: the setting just won't persist */
  }
}

/** True only inside the desktop app, where the printer bridge exists. */
export function isThermalPrinterAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.posPrinter;
}

export async function listInstalledPrinters(): Promise<InstalledPrinter[]> {
  if (!window.posPrinter) return [];
  return window.posPrinter.list();
}

/** Prints through the configured thermal printer. Throws if it isn't set up or the job fails. */
export async function printReceiptDirect(
  order: Order,
  items: OrderItem[],
  settings: ReceiptStoreSettings
): Promise<void> {
  const config = getThermalPrinterConfig();
  if (!window.posPrinter || !config.printerName) throw new Error('Thermal printer is not set up');
  await window.posPrinter.print(config.printerName, buildReceiptBytes(order, items, settings, config.columns));
}

export async function printTestPage(storeName: string, config: ThermalPrinterConfig): Promise<void> {
  if (!window.posPrinter || !config.printerName) throw new Error('Choose a printer first');
  await window.posPrinter.print(config.printerName, buildTestPageBytes(storeName, config.printerName, config.columns));
}
