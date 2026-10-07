const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Sends raw bytes (ESC/POS) straight to a Windows print queue through the spooler as a RAW job,
// so the printer driver never tries to render a page. Uses PowerShell + winspool.drv, which
// avoids shipping a native Node module. The printer name and file path are passed through
// environment variables, never spliced into the command text.
const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class PosRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.drv", CharSet = CharSet.Ansi, SetLastError = true)] public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Ansi, SetLastError = true)] public static extern bool StartDocPrinter(IntPtr h, int l, [In] DOCINFO d);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int c, out int w);
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("OpenPrinter failed: " + Marshal.GetLastWin32Error());
    try {
      DOCINFO di = new DOCINFO(); di.pDocName = "POS Receipt"; di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, di)) throw new Exception("StartDocPrinter failed: " + Marshal.GetLastWin32Error());
      try {
        StartPagePrinter(h);
        int written;
        bool ok = WritePrinter(h, data, data.Length, out written);
        EndPagePrinter(h);
        if (!ok || written != data.Length) throw new Exception("WritePrinter failed: " + Marshal.GetLastWin32Error());
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
'@
try {
  $bytes = [System.IO.File]::ReadAllBytes($env:POS_RAW_FILE)
  [PosRawPrint]::Send($env:POS_RAW_PRINTER, $bytes)
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 20000;

// One job at a time, so two quick prints can never interleave on the printer.
let queue = Promise.resolve();

function runRawPrint(printerName, data) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomBytes(8).toString('hex');
    const dataFile = path.join(os.tmpdir(), `pos-receipt-${id}.bin`);
    const scriptFile = path.join(os.tmpdir(), `pos-rawprint-${id}.ps1`);
    const cleanup = () => {
      for (const f of [dataFile, scriptFile]) {
        try {
          fs.unlinkSync(f);
        } catch {
          /* already gone */
        }
      }
    };

    try {
      fs.writeFileSync(dataFile, data);
      fs.writeFileSync(scriptFile, PS_SCRIPT, 'utf8');
    } catch (err) {
      cleanup();
      reject(new Error(`Could not prepare print job: ${err.message}`));
      return;
    }

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile],
      {
        windowsHide: true,
        env: { ...process.env, POS_RAW_PRINTER: printerName, POS_RAW_FILE: dataFile },
      }
    );

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill();
      cleanup();
      reject(new Error('Printing timed out'));
    }, TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      cleanup();
      reject(new Error(`Could not start PowerShell: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      cleanup();
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Print failed (exit code ${code})`));
    });
  });
}

/**
 * Prints raw bytes to an installed printer. The caller must pass a name that is in the
 * installed-printers list; the data is capped in size.
 */
function printRaw(printerName, data) {
  if (typeof printerName !== 'string' || !printerName) {
    return Promise.reject(new Error('No printer selected'));
  }
  const buf = Buffer.from(data);
  if (buf.length === 0 || buf.length > MAX_BYTES) {
    return Promise.reject(new Error('Invalid receipt data'));
  }
  const job = queue.then(() => runRawPrint(printerName, buf));
  queue = job.catch(() => {});
  return job;
}

module.exports = { printRaw };
