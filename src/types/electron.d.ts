export {};

declare global {
  interface Window {
    /** Present only inside the Electron desktop app (see electron/preload.cjs). */
    posPrinter?: {
      list(): Promise<Array<{ name: string; isDefault: boolean }>>;
      print(printerName: string, bytes: Uint8Array): Promise<void>;
    };
  }
}
