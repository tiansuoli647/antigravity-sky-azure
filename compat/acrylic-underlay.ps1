$ErrorActionPreference = 'SilentlyContinue'

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Text;
using System.Drawing;
using System.Threading;
using System.Diagnostics;
using System.Windows.Forms;
using System.Runtime.InteropServices;

public class AgAcrylicUnderlay : Form {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    public delegate void WinEventDelegate(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime);

    [StructLayout(LayoutKind.Sequential)] public struct MARGINS { public int l, r, t, b; }
    [StructLayout(LayoutKind.Sequential)] public struct ACCENT_POLICY { public int AccentState; public int AccentFlags; public uint GradientColor; public int AnimationId; }
    [StructLayout(LayoutKind.Sequential)] public struct WINCOMPATTRDATA { public int Attribute; public IntPtr Data; public int SizeOfData; }
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll")] public static extern bool SetThreadDesktop(IntPtr hDesktop);
    [DllImport("user32.dll")] public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumWindowsProc lpfn, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
    [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint crKey, byte bAlpha, uint dwFlags);
    [DllImport("dwmapi.dll")] public static extern int DwmExtendFrameIntoClientArea(IntPtr hWnd, ref MARGINS pMarInset);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);
    [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int dwAttribute, ref int pvAttribute, int cbAttribute);
    [DllImport("user32.dll")] public static extern bool SetWindowCompositionAttribute(IntPtr hwnd, ref WINCOMPATTRDATA data);
    [DllImport("user32.dll")] public static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr hmodWinEventProc, WinEventDelegate lpfnWinEventProc, uint idProcess, uint idThread, uint dwFlags);
    [DllImport("user32.dll")] public static extern bool UnhookWinEvent(IntPtr hWinEventHook);

    private IntPtr hDesk = IntPtr.Zero;
    private IntPtr targetHwnd = IntPtr.Zero;
    private RECT lastRect = new RECT();
    private bool lastZoomed = false;
    private bool isShown = false;
    private byte lastTargetAlpha = 0;
    private bool configEnabled = true;
    private byte configAlpha = 165;
    private string stateFilePath;
    private DateTime lastFileCheck = DateTime.MinValue;
    private WinEventDelegate hookDelegate;
    private IntPtr hookLoc = IntPtr.Zero;
    private IntPtr hookSys = IntPtr.Zero;
    private System.Windows.Forms.Timer syncTimer;

    protected override bool ShowWithoutActivation { get { return true; } }

    public AgAcrylicUnderlay(string statePath, IntPtr desktopHandle) {
        this.stateFilePath = statePath;
        this.hDesk = desktopHandle;
        this.FormBorderStyle = FormBorderStyle.None;
        this.ShowInTaskbar = false;
        this.BackColor = Color.Black;
    }

    protected override CreateParams CreateParams {
        get {
            CreateParams cp = base.CreateParams;
            cp.Style = unchecked((int)0x80000000); // WS_POPUP
            cp.ExStyle |= 0x00000080 | 0x00000020 | 0x08000000; // WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE
            return cp;
        }
    }

    protected override void OnPaintBackground(PaintEventArgs e) {
        e.Graphics.Clear(Color.FromArgb(0, 0, 0, 0));
    }

    private void ConfigureAcrylicSurface() {
        IntPtr hBlur = this.Handle;
        MARGINS m = new MARGINS { l = -1, r = -1, t = -1, b = -1 };
        DwmExtendFrameIntoClientArea(hBlur, ref m);
        int corner = 2; // DWMWCP_ROUND
        DwmSetWindowAttribute(hBlur, 33, ref corner, 4);

        // Windows 11 Start-Menu-grade Gaussian Blur (AccentState = 4 with low-alpha Sky-Azure tint)
        ACCENT_POLICY ap = new ACCENT_POLICY { AccentState = 4, AccentFlags = 2, GradientColor = 0x06F8E8C8, AnimationId = 0 };
        IntPtr ptr = Marshal.AllocHGlobal(Marshal.SizeOf(ap));
        Marshal.StructureToPtr(ap, ptr, false);
        WINCOMPATTRDATA d = new WINCOMPATTRDATA { Attribute = 19, Data = ptr, SizeOfData = Marshal.SizeOf(ap) };
        SetWindowCompositionAttribute(hBlur, ref d);
        Marshal.FreeHGlobal(ptr);
    }

    private void ReloadConfigIfNeeded() {
        if ((DateTime.UtcNow - lastFileCheck).TotalMilliseconds < 250) return;
        lastFileCheck = DateTime.UtcNow;
        try {
            if (File.Exists(stateFilePath)) {
                string raw = File.ReadAllText(stateFilePath, Encoding.UTF8).Trim();
                // Simple format: "enabled|alpha" e.g. "1|165"
                string[] parts = raw.Split('|');
                if (parts.Length >= 2) {
                    configEnabled = (parts[0] != "0");
                    byte a;
                    if (byte.TryParse(parts[1], out a)) {
                        configAlpha = a;
                    }
                }
            }
        } catch {}
    }

    private IntPtr FindAntigravityWindow(out bool anyProcessAlive) {
        Process[] procs = Process.GetProcessesByName("Antigravity");
        anyProcessAlive = (procs != null && procs.Length > 0);
        if (!anyProcessAlive) return IntPtr.Zero;

        int[] pids = new int[procs.Length];
        for (int i = 0; i < procs.Length; i++) pids[i] = procs[i].Id;

        if (targetHwnd != IntPtr.Zero && IsWindow(targetHwnd) && IsWindowVisible(targetHwnd)) {
            uint pid;
            GetWindowThreadProcessId(targetHwnd, out pid);
            if (Array.IndexOf(pids, (int)pid) >= 0) {
                return targetHwnd;
            }
        }

        IntPtr found = IntPtr.Zero;
        int bestArea = 0;
        EnumDesktopWindows(hDesk, (hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) return true;
            uint pid = 0;
            GetWindowThreadProcessId(hWnd, out pid);
            if (Array.IndexOf(pids, (int)pid) < 0) return true;
            var sb = new StringBuilder(128);
            GetClassName(hWnd, sb, 128);
            if (sb.ToString() != "Chrome_WidgetWin_1") return true;
            RECT r;
            GetWindowRect(hWnd, out r);
            int area = Math.Max(0, r.Right - r.Left) * Math.Max(0, r.Bottom - r.Top);
            if (area > bestArea) {
                bestArea = area;
                found = hWnd;
            }
            return true;
        }, IntPtr.Zero);

        return found;
    }

    private bool IsDirectlyBehind(IntPtr target, IntPtr hBlur) {
        IntPtr cur = GetWindow(target, 2); // GW_HWNDNEXT
        int steps = 0;
        while (cur != IntPtr.Zero && steps < 12) {
            if (cur == hBlur) return true;
            if (IsWindowVisible(cur)) {
                var sb = new StringBuilder(64);
                GetClassName(cur, sb, 64);
                string cls = sb.ToString();
                if (cls != "IME" && cls != "MSCTFIME UI" && !cls.StartsWith("SoPY_") && !cls.StartsWith("Sogou_")) {
                    return false;
                }
            }
            cur = GetWindow(cur, 2);
            steps++;
        }
        return false;
    }

    private void SyncNow() {
        ReloadConfigIfNeeded();
        bool alive;
        IntPtr target = FindAntigravityWindow(out alive);
        if (!alive) {
            Application.ExitThread();
            return;
        }

        IntPtr hBlur = this.Handle;
        if (!configEnabled || target == IntPtr.Zero || !IsWindowVisible(target) || IsIconic(target)) {
            if (isShown) {
                ShowWindow(hBlur, 0);
                isShown = false;
            }
            if (!configEnabled && target != IntPtr.Zero && lastTargetAlpha != 255) {
                int ex = GetWindowLong(target, -20);
                SetLayeredWindowAttributes(target, 0, 255, 2);
                SetWindowLong(target, -20, ex & ~0x00080000);
                lastTargetAlpha = 255;
            }
            return;
        }

        if (target != targetHwnd) {
            targetHwnd = target;
            lastTargetAlpha = 0;
            try {
                MARGINS tm = new MARGINS { l = -1, r = -1, t = -1, b = -1 };
                DwmExtendFrameIntoClientArea(target, ref tm);
                ACCENT_POLICY tap = new ACCENT_POLICY { AccentState = 2, AccentFlags = 2, GradientColor = 0x00000000, AnimationId = 0 };
                IntPtr tptr = Marshal.AllocHGlobal(Marshal.SizeOf(tap));
                Marshal.StructureToPtr(tap, tptr, false);
                WINCOMPATTRDATA td = new WINCOMPATTRDATA { Attribute = 19, Data = tptr, SizeOfData = Marshal.SizeOf(tap) };
                SetWindowCompositionAttribute(target, ref td);
                Marshal.FreeHGlobal(tptr);
            } catch {}
        }

        if (lastTargetAlpha != configAlpha) {
            int ex = GetWindowLong(target, -20);
            if ((ex & 0x00080000) == 0) {
                SetWindowLong(target, -20, ex | 0x00080000);
            }
            SetLayeredWindowAttributes(target, 0, configAlpha, 2);
            lastTargetAlpha = configAlpha;
        }

        RECT rExt;
        if (DwmGetWindowAttribute(target, 9, out rExt, Marshal.SizeOf(typeof(RECT))) != 0) {
            GetWindowRect(target, out rExt);
        }
        int w = rExt.Right - rExt.Left;
        int h = rExt.Bottom - rExt.Top;
        if (w <= 80 || h <= 80) {
            if (isShown) {
                ShowWindow(hBlur, 0);
                isShown = false;
            }
            return;
        }

        bool zoomed = IsZoomed(target);
        if (zoomed != lastZoomed) {
            int corner = zoomed ? 1 : 2;
            DwmSetWindowAttribute(hBlur, 33, ref corner, 4);
            lastZoomed = zoomed;
        }

        bool rectChanged = (rExt.Left != lastRect.Left || rExt.Top != lastRect.Top || rExt.Right != lastRect.Right || rExt.Bottom != lastRect.Bottom);
        bool zOrderOk = isShown && IsDirectlyBehind(target, hBlur);

        if (rectChanged || !zOrderOk || !isShown) {
            if (!zOrderOk) {
                uint pid;
                uint targetTid = GetWindowThreadProcessId(target, out pid);
                uint myTid = GetCurrentThreadId();
                bool attached = false;
                if (targetTid != 0 && targetTid != myTid) {
                    attached = AttachThreadInput(myTid, targetTid, true);
                }
                SetWindowPos(hBlur, target, rExt.Left, rExt.Top, w, h, 0x0010 | 0x0040);
                if (attached) {
                    AttachThreadInput(myTid, targetTid, false);
                }
            } else {
                SetWindowPos(hBlur, target, rExt.Left, rExt.Top, w, h, 0x0010 | 0x0004 | 0x0040);
            }
            lastRect = rExt;
            isShown = true;
        }
    }

    private void OnWinEvent(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime) {
        if (idObject != 0) return; // OBJID_WINDOW == 0
        if (hwnd == targetHwnd || eventType == 0x0003 || eventType == 0x0016 || eventType == 0x0017) {
            SyncNow();
        }
    }

    public static void RunDaemon(string statePath) {
        bool createdNew = false;
        using (Mutex mutex = new Mutex(true, @"Local\AgGlassAcrylicUnderlayDaemonV3", out createdNew)) {
            if (!createdNew) return;

            Thread t = new Thread(() => {
                try {
                    IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
                    if (hDesk != IntPtr.Zero) {
                        SetThreadDesktop(hDesk);
                    }
                    using (AgAcrylicUnderlay form = new AgAcrylicUnderlay(statePath, hDesk)) {
                        form.ConfigureAcrylicSurface();
                        form.hookDelegate = new WinEventDelegate(form.OnWinEvent);
                        form.hookLoc = SetWinEventHook(0x8000, 0x800B, IntPtr.Zero, form.hookDelegate, 0, 0, 0);
                        form.hookSys = SetWinEventHook(0x0003, 0x0017, IntPtr.Zero, form.hookDelegate, 0, 0, 0);

                        form.syncTimer = new System.Windows.Forms.Timer();
                        form.syncTimer.Interval = 35;
                        form.syncTimer.Tick += (s, e) => form.SyncNow();
                        form.syncTimer.Start();

                        form.SyncNow();
                        Application.Run();

                        if (form.hookLoc != IntPtr.Zero) UnhookWinEvent(form.hookLoc);
                        if (form.hookSys != IntPtr.Zero) UnhookWinEvent(form.hookSys);
                    }
                } catch (Exception ex) {
                    try { File.WriteAllText(Path.Combine(Path.GetDirectoryName(statePath), "underlay-cs-err.txt"), ex.ToString()); } catch {}
                }
            });
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
            t.Join();
        }
    }
}
"@ -ReferencedAssemblies System.Drawing, System.Windows.Forms

try {
    $stateDir = Join-Path $env:LOCALAPPDATA "AntigravityGlass"
    if (!(Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
    $stateFile = Join-Path $stateDir "underlay-state.txt"
    [AgAcrylicUnderlay]::RunDaemon($stateFile)
} catch {
    $_ | Out-String | Set-Content (Join-Path $env:LOCALAPPDATA "AntigravityGlass\underlay-ps-err.txt") -Encoding UTF8
}
