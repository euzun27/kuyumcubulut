/**
 * Etiket yazıcısına (Zebra ZD421 vb.) doğrudan yazdırma.
 *
 * Tarayıcının yazdırma penceresi 72 × 12 mm gibi küçük sayfaları Zebra
 * sürücüsüne düzgün iletemiyor; bu yüzden etiketler ZPL komutu olarak
 * Windows yazdırma kuyruğuna RAW biçiminde ya da ağ yazıcısının 9100
 * portuna doğrudan gönderilir.
 */

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpError } from '../src/lib/validate';

const isWindows = process.platform === 'win32';

/** "192.168.1.50" veya "192.168.1.50:9100" */
const IP_RE = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/;

function run(file: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', windowsHide: true, timeout: 30000, env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || stdout || error.message).trim()));
      else resolve(stdout);
    });
  });
}

/** PowerShell betiğini tırnak sorunu olmadan çalıştırır. */
function powershell(script: string, env: NodeJS.ProcessEnv = {}) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], env);
}

export async function listPrinters(): Promise<string[]> {
  try {
    const out = isWindows
      ? await powershell('[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_Printer | ForEach-Object { $_.Name }')
      : await run('lpstat', ['-e']);
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/*
 * winspool.drv ile RAW yazdırma. Windows 10/11'deki v4 sürücüleri RAW'ı
 * reddederse (hata 1804) XPS_PASS ile yeniden denenir.
 */
const RAW_PS = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DunyatekRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("HATA " + Marshal.GetLastWin32Error());
    try {
      DOCINFO di = new DOCINFO { pDocName = "Dunyatek etiket", pDataType = "RAW" };
      if (StartDocPrinter(h, 1, di) == 0) {
        int e = Marshal.GetLastWin32Error();
        if (e != 1804) throw new Exception("HATA " + e);
        di.pDataType = "XPS_PASS";
        if (StartDocPrinter(h, 1, di) == 0) throw new Exception("HATA " + Marshal.GetLastWin32Error());
      }
      try {
        StartPagePrinter(h);
        int w;
        if (!WritePrinter(h, data, data.Length, out w) || w != data.Length) throw new Exception("HATA " + Marshal.GetLastWin32Error());
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
[DunyatekRaw]::Send($env:DUNYATEK_YAZICI, [IO.File]::ReadAllBytes($env:DUNYATEK_DOSYA))
`;

const WIN_ERRORS: Record<string, string> = {
  '5': 'Yazıcıya erişim izni yok.',
  '1801': 'Yazıcı bulunamadı. Windows "Yazıcılar ve tarayıcılar" listesindeki adını seçin.',
  '1804': 'Yazıcı sürücüsü doğrudan (RAW) yazdırmayı kabul etmiyor. Zebra ZDesigner sürücüsünü kurun.',
  '1722': 'Yazdırma biriktiricisi (Print Spooler) çalışmıyor.',
  '1797': 'Yazıcı sürücüsü bilinmiyor; Zebra ZDesigner sürücüsünü yeniden kurun.',
};

function sendTcp(host: string, port: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    socket.setTimeout(8000, () => socket.destroy(new Error('zaman aşımı')));
    socket.on('error', (e) => reject(new HttpError(502, `${host}:${port} adresindeki yazıcıya bağlanılamadı (${e.message}). Yazıcının açık ve aynı ağda olduğunu kontrol edin.`)));
    socket.on('connect', () => socket.end(data, () => resolve()));
  });
}

export async function printRaw(printer: string, text: string): Promise<void> {
  const data = Buffer.from(text, 'utf8');
  const ip = IP_RE.exec(printer.trim());
  if (ip) return sendTcp(ip[1], Number(ip[2] || 9100), data);

  const dir = mkdtempSync(join(tmpdir(), 'dunyatek-etiket-'));
  const file = join(dir, `${randomBytes(4).toString('hex')}.zpl`);
  writeFileSync(file, data);
  try {
    if (isWindows) await powershell(RAW_PS, { DUNYATEK_YAZICI: printer, DUNYATEK_DOSYA: file });
    else await run('lp', ['-d', printer, '-o', 'raw', file]);
  } catch (e) {
    const message = (e as Error).message;
    const code = /HATA (\d+)/.exec(message)?.[1];
    const hint = code ? WIN_ERRORS[code] ?? `Windows hata kodu ${code}.` : message.split(/\r?\n/)[0];
    throw new HttpError(502, `"${printer}" yazıcısına gönderilemedi: ${hint}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
