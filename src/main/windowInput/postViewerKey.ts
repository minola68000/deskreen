import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { app } from 'electron';
import { parseViewerKey } from '../../common/viewerKeyInput';
import { windowHandleToken } from '../windowAudioDelay/pcmDelay';
import { keyMessages } from './keyMessages';

const POSTER_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;
public static class DeskKey {
  [DllImport("user32.dll")]
  public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")]
  public static extern bool IsChild(IntPtr parent, IntPtr child);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr child, string cls, string title);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder name, int count);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")]
  public static extern bool GetGUIThreadInfo(uint threadId, ref GUI info);
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr GetDesktopWindow();
  [DllImport("user32.dll")]
  public static extern IntPtr GetShellWindow();
  [DllImport("user32.dll", EntryPoint = "GetWindowLong")]
  public static extern int GetWindowLong(IntPtr hWnd, int index);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  public struct GUI {
    public int cbSize;
    public int flags;
    public IntPtr hwndActive;
    public IntPtr hwndFocus;
    public IntPtr hwndCapture;
    public IntPtr hwndMenuOwner;
    public IntPtr hwndMoveSize;
    public IntPtr hwndCaret;
    public RECT rcCaret;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public INPUTUNION u;
  }
  public static void Consider(IntPtr hwnd, ref IntPtr best, ref long bestArea) {
    StringBuilder name = new StringBuilder(256);
    GetClassName(hwnd, name, 256);
    if (name.ToString() == "Chrome_RenderWidgetHostHWND") {
      RECT rect;
      if (GetWindowRect(hwnd, out rect)) {
        long area = (long)(rect.Right - rect.Left) * (rect.Bottom - rect.Top);
        if (area > bestArea) {
          bestArea = area;
          best = hwnd;
        }
      }
    }
    IntPtr child = IntPtr.Zero;
    while (true) {
      child = FindWindowEx(hwnd, child, null, null);
      if (child == IntPtr.Zero) return;
      Consider(child, ref best, ref bestArea);
    }
  }
  public static IntPtr Target(long hwnd) {
    IntPtr root = new IntPtr(hwnd);
    uint pid;
    uint tid = GetWindowThreadProcessId(root, out pid);
    GUI info = new GUI();
    info.cbSize = Marshal.SizeOf(typeof(GUI));
    if (GetGUIThreadInfo(tid, ref info) && info.hwndFocus != IntPtr.Zero &&
        (info.hwndFocus == root || IsChild(root, info.hwndFocus))) {
      return info.hwndFocus;
    }
    IntPtr best = IntPtr.Zero;
    long bestArea = -1;
    Consider(root, ref best, ref bestArea);
    return best != IntPtr.Zero ? best : root;
  }
  public static void Activate(IntPtr top, IntPtr child) {
    uint pid;
    IntPtr fore = GetForegroundWindow();
    uint foreThread = fore == IntPtr.Zero ? 0 : GetWindowThreadProcessId(fore, out pid);
    uint targetThread = GetWindowThreadProcessId(top, out pid);
    uint current = GetCurrentThreadId();
    if (foreThread != 0) AttachThreadInput(current, foreThread, true);
    if (targetThread != 0 && targetThread != foreThread) AttachThreadInput(current, targetThread, true);
    SetForegroundWindow(top);
    if (child != IntPtr.Zero) SetFocus(child);
    if (targetThread != 0 && targetThread != foreThread) AttachThreadInput(current, targetThread, false);
    if (foreThread != 0) AttachThreadInput(current, foreThread, false);
  }
  static List<IntPtr> zOrder;
  static EnumProc zEnum;
  static bool Collect(IntPtr hwnd, IntPtr lParam) {
    zOrder.Add(hwnd);
    return true;
  }
  public static IntPtr[] Snapshot() {
    zOrder = new List<IntPtr>();
    if (zEnum == null) zEnum = Collect;
    EnumWindows(zEnum, IntPtr.Zero);
    return zOrder.ToArray();
  }
  static bool Skip(IntPtr hwnd) {
    if (hwnd == GetDesktopWindow() || hwnd == GetShellWindow()) return true;
    StringBuilder name = new StringBuilder(256);
    GetClassName(hwnd, name, 256);
    string cls = name.ToString();
    return cls == "Progman" || cls == "WorkerW";
  }
  public static void Restore(IntPtr[] order) {
    uint flags = 0x0001 | 0x0002 | 0x0010 | 0x0200;
    for (int i = order.Length - 1; i >= 0; i--) {
      IntPtr hwnd = order[i];
      if (!IsWindow(hwnd) || Skip(hwnd)) continue;
      int ex = GetWindowLong(hwnd, -20);
      IntPtr insert = (ex & 8) != 0 ? new IntPtr(-1) : IntPtr.Zero;
      SetWindowPos(hwnd, insert, 0, 0, 0, 0, flags);
    }
  }
  public static void TypeKey(int msg, long wParam, long lParam) {
    INPUT input = new INPUT();
    input.type = 1;
    input.u.ki.wVk = (ushort)wParam;
    input.u.ki.wScan = (ushort)((lParam >> 16) & 0xFF);
    uint flags = 0;
    if (msg == 0x101) flags |= 2;
    if ((lParam & 0x1000000) != 0) flags |= 1;
    input.u.ki.dwFlags = flags;
    SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void TypeChar(ushort ch) {
    INPUT[] inputs = new INPUT[2];
    inputs[0].type = 1;
    inputs[0].u.ki.wScan = ch;
    inputs[0].u.ki.dwFlags = 4;
    inputs[1].type = 1;
    inputs[1].u.ki.wScan = ch;
    inputs[1].u.ki.dwFlags = 6;
    SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
  }
}
"@
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ($line -eq '') { continue }
  $parts = $line.Split('|', 2)
  if ($parts.Length -lt 2) { continue }
  $root = [IntPtr]([int64]$parts[0])
  $target = [DeskKey]::Target([int64]$parts[0])
  $order = [DeskKey]::Snapshot()
  $previous = [DeskKey]::GetForegroundWindow()
  [DeskKey]::Activate($root, $target)
  foreach ($item in $parts[1].Split(';')) {
    if ($item -eq '') { continue }
    $n = $item.Split(',')
    if ($n.Length -ne 3) { continue }
    $msg = [int]$n[0]
    if ($msg -eq 258) {
      [DeskKey]::TypeChar([uint16]$n[1])
    } else {
      [DeskKey]::TypeKey($msg, [int64]$n[1], [int64]$n[2])
    }
  }
  Start-Sleep -Milliseconds 30
  [DeskKey]::Restore($order)
  if ($previous -ne [IntPtr]::Zero -and $previous -ne $root) {
    [DeskKey]::Activate($previous, $previous)
  }
}
`;

let poster: ChildProcess | null = null;
let quitHooked = false;

function ensurePoster(): ChildProcess | null {
	if (process.platform !== 'win32') return null;
	if (poster && poster.stdin && poster.exitCode === null) return poster;
	if (!quitHooked) {
		quitHooked = true;
		app.on('before-quit', () => {
			poster?.kill();
			poster = null;
		});
	}
	const executable = path.join(
		process.env.SystemRoot || 'C:\\Windows',
		'System32',
		'WindowsPowerShell',
		'v1.0',
		'powershell.exe',
	);
	const encoded = Buffer.from(POSTER_SCRIPT, 'utf16le').toString('base64');
	poster = spawn(
		executable,
		['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
		{ windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] },
	);
	poster.stderr?.on('data', (buf: Buffer) => {
		console.error('window key poster', buf.toString());
	});
	poster.on('exit', () => {
		poster = null;
	});
	return poster;
}

export function postViewerKey(sourceId: string, payload: unknown): void {
	const hwnd = windowHandleToken(sourceId);
	const parsed = parseViewerKey(payload);
	if (!hwnd || !parsed) return;
	const messages = keyMessages(parsed);
	if (messages.length === 0) return;
	const proc = ensurePoster();
	if (!proc?.stdin) return;
	const line = `${hwnd}|${messages.map((message) => `${message.msg},${message.wParam},${message.lParam}`).join(';')}\n`;
	proc.stdin.write(line);
}
