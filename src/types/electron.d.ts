export {};

declare global {
  interface Window {
    /** Present only inside the Electron desktop app (see electron/preload.cjs). */
    posPrinter?: {
      list(): Promise<Array<{ name: string; isDefault: boolean }>>;
      print(printerName: string, bytes: Uint8Array): Promise<void>;
    };
    /** Present only inside the Electron desktop app: writes the log files (see electron/logger.cjs). */
    posLog?: {
      write(entries: unknown[]): void;
      openFolder(): Promise<void>;
      /** Zips the last 7 days of logs plus diagnostics onto the Desktop; resolves to the path made. */
      exportBundle(diagnostics: unknown): Promise<string>;
    };
  }
}
