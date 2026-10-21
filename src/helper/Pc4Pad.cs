// PC4 Pad: turns PlayStation controllers (DUALSHOCK 4 / DualSense, USB or Bluetooth) into Xbox 360
// controllers, the way DS4Windows does: it reads the controller's HID reports and feeds a virtual Xbox pad
// through the ViGEmBus driver. Rumble from games goes back to the controller.
//
// PC4 compiles this file with the C# compiler that ships with Windows (.NET Framework 4) and talks to it
// over stdin/stdout:
//   args: <PC4 process id> [emulate|ds4|watch]   (emulate: a virtual Xbox 360 pad; ds4: a virtual DUALSHOCK 4 that
//         passes the controller through untouched, so PC4 can take it for the Quick Menu during a game;
//         watch: no virtual pad, only the PS / Share buttons and volume)
//   in:  "config key=value ..."  "quit"  "rumble <0-255> <0-255> <ms>"  "volume [0..1]"  "mute 0|1"
//   out: one JSON object per line: status, error, log, button ({"button":"ps"|"share","event":"tap"|"hold"}), volume
//   args: standby <PC4 exe> [args...]   (built as pc4wake.exe, a windowless copy started with Windows: while PC4 isn't
//         running it watches for the PS / Xbox Guide button, or a Bluetooth controller connecting, and starts PC4)
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

static class Native
{
    public const uint GENERIC_READ = 0x80000000, GENERIC_WRITE = 0x40000000;
    public const uint FILE_SHARE_READ = 1, FILE_SHARE_WRITE = 2, OPEN_EXISTING = 3;
    public const uint FILE_FLAG_OVERLAPPED = 0x40000000, FILE_ATTRIBUTE_NORMAL = 0x80;
    public const int DIGCF_PRESENT = 2, DIGCF_DEVICEINTERFACE = 0x10;
    public const int ERROR_IO_PENDING = 997, ERROR_SHARING_VIOLATION = 32;

    [StructLayout(LayoutKind.Sequential)]
    public struct SP_DEVICE_INTERFACE_DATA { public int cbSize; public Guid InterfaceClassGuid; public int Flags; public IntPtr Reserved; }

    [StructLayout(LayoutKind.Sequential)]
    public struct HIDD_ATTRIBUTES { public int Size; public ushort VendorID; public ushort ProductID; public ushort VersionNumber; }

    [StructLayout(LayoutKind.Sequential)]
    public struct HIDP_CAPS
    {
        public ushort Usage, UsagePage, InputReportByteLength, OutputReportByteLength, FeatureReportByteLength;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] public ushort[] Reserved;
        public ushort NumberLinkCollectionNodes, NumberInputButtonCaps, NumberInputValueCaps, NumberInputDataIndices,
            NumberOutputButtonCaps, NumberOutputValueCaps, NumberOutputDataIndices, NumberFeatureButtonCaps,
            NumberFeatureValueCaps, NumberFeatureDataIndices;
    }

    [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr SetupDiGetClassDevs(ref Guid classGuid, IntPtr enumerator, IntPtr hwnd, int flags);
    [DllImport("setupapi.dll", SetLastError = true)]
    public static extern bool SetupDiEnumDeviceInterfaces(IntPtr set, IntPtr devInfo, ref Guid guid, int index, ref SP_DEVICE_INTERFACE_DATA data);
    [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr set, ref SP_DEVICE_INTERFACE_DATA data, IntPtr detail, int size, out int required, IntPtr devInfo);
    [DllImport("setupapi.dll")]
    public static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr sec, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool DeviceIoControl(SafeFileHandle h, uint code, IntPtr inBuf, int inSize, IntPtr outBuf, int outSize, out int returned, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool GetOverlappedResult(SafeFileHandle h, IntPtr overlapped, out int transferred, bool wait);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CancelIoEx(SafeFileHandle h, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr CreateEvent(IntPtr sec, bool manualReset, bool initial, string name);
    [DllImport("kernel32.dll")]
    public static extern bool ResetEvent(IntPtr h);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool ReadFile(SafeFileHandle h, byte[] buf, int size, out int read, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool WriteFile(SafeFileHandle h, byte[] buf, int size, out int written, IntPtr overlapped);

    [DllImport("hid.dll")]
    public static extern void HidD_GetHidGuid(out Guid guid);
    [DllImport("hid.dll", SetLastError = true)]
    public static extern bool HidD_GetAttributes(SafeFileHandle h, ref HIDD_ATTRIBUTES attrs);
    [DllImport("hid.dll", SetLastError = true)]
    public static extern bool HidD_GetPreparsedData(SafeFileHandle h, out IntPtr data);
    [DllImport("hid.dll")]
    public static extern bool HidD_FreePreparsedData(IntPtr data);
    [DllImport("hid.dll")]
    public static extern int HidP_GetCaps(IntPtr data, ref HIDP_CAPS caps);
    [DllImport("hid.dll", SetLastError = true)]
    public static extern bool HidD_GetFeature(SafeFileHandle h, byte[] buf, int size);
    [DllImport("hid.dll", SetLastError = true)]
    public static extern bool HidD_SetOutputReport(SafeFileHandle h, byte[] buf, int size);
    [DllImport("hid.dll", SetLastError = true)]
    public static extern bool HidD_SetNumInputBuffers(SafeFileHandle h, int count);

    // every device interface path of a class
    public static List<string> Interfaces(Guid guid)
    {
        var list = new List<string>();
        IntPtr set = SetupDiGetClassDevs(ref guid, IntPtr.Zero, IntPtr.Zero, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
        if (set == new IntPtr(-1)) return list;
        try
        {
            for (int i = 0; ; i++)
            {
                var data = new SP_DEVICE_INTERFACE_DATA();
                data.cbSize = Marshal.SizeOf(data);
                if (!SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref guid, i, ref data)) break;
                int need;
                SetupDiGetDeviceInterfaceDetail(set, ref data, IntPtr.Zero, 0, out need, IntPtr.Zero);
                IntPtr detail = Marshal.AllocHGlobal(need);
                try
                {
                    Marshal.WriteInt32(detail, IntPtr.Size == 8 ? 8 : 6); // cbSize of SP_DEVICE_INTERFACE_DETAIL_DATA_W
                    if (SetupDiGetDeviceInterfaceDetail(set, ref data, detail, need, out need, IntPtr.Zero))
                        list.Add(Marshal.PtrToStringUni(new IntPtr(detail.ToInt64() + 4)));
                }
                finally { Marshal.FreeHGlobal(detail); }
            }
        }
        finally { SetupDiDestroyDeviceInfoList(set); }
        return list;
    }
}

// ---------------- ViGEmBus: the virtual Xbox 360 controllers ----------------
class Bus : IDisposable
{
    static readonly Guid Iface = new Guid("96E42B22-F5E9-42F8-B043-ED0F932F014F");
    const uint PLUGIN = 0x2AA004, UNPLUG = 0x2AA008, CHECK_VERSION = 0x2AA00C, WAIT_READY = 0x2AA010;
    // CTL_CODE(FILE_DEVICE_BUS_EXTENDER, 0x801 + n, METHOD_BUFFERED, access), as in ViGEm's BusShared.h
    const uint XUSB_NOTIFY = 0x2AE804, XUSB_SUBMIT = 0x2AA808;
    // 0x801 + 0x202 / 0x203, both write-access codes (probed on ViGEmBus 1.22: the read/write form is "not supported")
    const uint DS4_SUBMIT = 0x2AA80C, DS4_NOTIFY = 0x2AA810;
    public readonly SafeFileHandle Handle;
    // a second, synchronous handle for the input reports: they complete at once, so no overlapped wait is needed
    SafeFileHandle sync;

    Bus(SafeFileHandle h) { Handle = h; }

    public static Bus Open()
    {
        foreach (var path in Native.Interfaces(Iface))
        {
            var h = Native.CreateFile(path, Native.GENERIC_READ | Native.GENERIC_WRITE, Native.FILE_SHARE_READ | Native.FILE_SHARE_WRITE,
                IntPtr.Zero, Native.OPEN_EXISTING, Native.FILE_ATTRIBUTE_NORMAL | Native.FILE_FLAG_OVERLAPPED, IntPtr.Zero);
            if (h.IsInvalid) continue;
            var bus = new Bus(h);
            if (bus.Ioctl(CHECK_VERSION, U32(8, 0x0001), null))
            {
                var s = Native.CreateFile(path, Native.GENERIC_READ | Native.GENERIC_WRITE, Native.FILE_SHARE_READ | Native.FILE_SHARE_WRITE,
                    IntPtr.Zero, Native.OPEN_EXISTING, Native.FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
                if (!s.IsInvalid) bus.sync = s;
                return bus;
            }
            h.Dispose();
        }
        return null;
    }

    static byte[] U32(params uint[] v) { var b = new byte[v.Length * 4]; for (int i = 0; i < v.Length; i++) BitConverter.GetBytes(v[i]).CopyTo(b, i * 4); return b; }

    // Reusable unmanaged buffers + event for the reports sent 250 times a second (one per controller thread):
    // no allocations, no new kernel event per report
    public sealed class IoBuf
    {
        public readonly IntPtr Buf = Marshal.AllocHGlobal(128), Ov = Marshal.AllocHGlobal(32), Ev = Native.CreateEvent(IntPtr.Zero, true, false, null);
    }

    public bool Send(IoBuf io, uint code, byte[] input, int len)
    {
        int got;
        if (sync != null)
        {
            Marshal.Copy(input, 0, io.Buf, len);
            return Native.DeviceIoControl(sync, code, io.Buf, len, IntPtr.Zero, 0, out got, IntPtr.Zero);
        }
        for (int i = 0; i < 32; i += 8) Marshal.WriteInt64(io.Ov, i, 0);
        Marshal.WriteIntPtr(io.Ov, IntPtr.Size == 8 ? 24 : 16, io.Ev);
        Native.ResetEvent(io.Ev);
        Marshal.Copy(input, 0, io.Buf, len);
        bool ok = Native.DeviceIoControl(Handle, code, io.Buf, len, IntPtr.Zero, 0, out got, io.Ov);
        if (!ok && Marshal.GetLastWin32Error() == Native.ERROR_IO_PENDING) ok = Native.GetOverlappedResult(Handle, io.Ov, out got, true);
        return ok;
    }

    // DeviceIoControl on the overlapped handle, waiting for the answer
    public bool Ioctl(uint code, byte[] input, byte[] output)
    {
        int inLen = input == null ? 0 : input.Length, outLen = output == null ? 0 : output.Length;
        IntPtr inBuf = Marshal.AllocHGlobal(Math.Max(1, inLen)), outBuf = Marshal.AllocHGlobal(Math.Max(1, outLen));
        IntPtr ov = Marshal.AllocHGlobal(32);
        IntPtr ev = Native.CreateEvent(IntPtr.Zero, true, false, null);
        try
        {
            for (int i = 0; i < 32; i++) Marshal.WriteByte(ov, i, 0);
            Marshal.WriteIntPtr(ov, IntPtr.Size == 8 ? 24 : 16, ev);
            if (inLen > 0) Marshal.Copy(input, 0, inBuf, inLen);
            int got;
            bool ok = Native.DeviceIoControl(Handle, code, inBuf, inLen, outBuf, outLen, out got, ov);
            if (!ok && Marshal.GetLastWin32Error() == Native.ERROR_IO_PENDING) ok = Native.GetOverlappedResult(Handle, ov, out got, true);
            if (ok && outLen > 0) Marshal.Copy(outBuf, output, 0, outLen);
            return ok;
        }
        finally { Native.CloseHandle(ev); Marshal.FreeHGlobal(ov); Marshal.FreeHGlobal(inBuf); Marshal.FreeHGlobal(outBuf); }
    }

    // plugs in a virtual Xbox 360 controller (or a DUALSHOCK 4); returns its serial (1-based) or 0
    public uint Plugin(bool ds4 = false)
    {
        for (uint serial = 1; serial <= 16; serial++)
        {
            var b = new byte[16];
            BitConverter.GetBytes(16u).CopyTo(b, 0);
            BitConverter.GetBytes(serial).CopyTo(b, 4);
            BitConverter.GetBytes(ds4 ? 2u : 0u).CopyTo(b, 8); // DualShock4Wired | Xbox360Wired
            BitConverter.GetBytes((ushort)(ds4 ? 0x054C : 0x045E)).CopyTo(b, 12);
            BitConverter.GetBytes((ushort)(ds4 ? 0x05C4 : 0x028E)).CopyTo(b, 14);
            if (Ioctl(PLUGIN, b, null))
            {
                Ioctl(WAIT_READY, U32(8, serial), null);
                return serial;
            }
        }
        return 0;
    }

    public void Unplug(uint serial) { if (serial != 0) Ioctl(UNPLUG, U32(8, serial), null); }

    public bool Submit(IoBuf io, byte[] b, uint serial, ushort buttons, byte lt, byte rt, short lx, short ly, short rx, short ry)
    {
        BitConverter.GetBytes(20u).CopyTo(b, 0);
        BitConverter.GetBytes(serial).CopyTo(b, 4);
        BitConverter.GetBytes(buttons).CopyTo(b, 8);
        b[10] = lt; b[11] = rt;
        BitConverter.GetBytes(lx).CopyTo(b, 12);
        BitConverter.GetBytes(ly).CopyTo(b, 14);
        BitConverter.GetBytes(rx).CopyTo(b, 16);
        BitConverter.GetBytes(ry).CopyTo(b, 18);
        return Send(io, XUSB_SUBMIT, b, 20);
    }

    // a full DUALSHOCK 4 input report (the 63 bytes after the USB report id: sticks, buttons, triggers, motion,
    // touchpad) through the extended DS4 submit; the size the driver accepts is learned on the first call
    int ds4Size;
    static readonly int[] Ds4Sizes = { 71, 72 };
    public bool SubmitDs4(IoBuf io, byte[] packet, uint serial, byte[] report)
    {
        if (ds4Size != 0) return SubmitDs4As(io, packet, serial, report, ds4Size);
        foreach (int size in Ds4Sizes) if (SubmitDs4As(io, packet, serial, report, size)) { ds4Size = size; return true; }
        return false;
    }
    bool SubmitDs4As(IoBuf io, byte[] b, uint serial, byte[] report, int size)
    {
        b[0] = (byte)size; b[1] = b[2] = b[3] = 0;
        b[4] = (byte)serial; b[5] = (byte)(serial >> 8); b[6] = (byte)(serial >> 16); b[7] = (byte)(serial >> 24);
        Buffer.BlockCopy(report, 0, b, 8, 63);
        if (size > 71) b[71] = 0;
        return Send(io, DS4_SUBMIT, b, size);
    }

    // waits until a game changes the DS4's rumble or light bar; false when the pad is gone
    public bool WaitDs4Output(uint serial, out byte large, out byte small, out byte r, out byte g, out byte bl)
    {
        var req = new byte[16];
        BitConverter.GetBytes(16u).CopyTo(req, 0);
        BitConverter.GetBytes(serial).CopyTo(req, 4);
        var res = new byte[16];
        bool ok = Ioctl(DS4_NOTIFY, req, res);
        small = res[8]; large = res[9]; r = res[10]; g = res[11]; bl = res[12];
        return ok;
    }

    // waits until a game changes the rumble of this pad; false when the pad is gone
    public bool WaitRumble(uint serial, out byte large, out byte small)
    {
        var req = new byte[12];
        BitConverter.GetBytes(12u).CopyTo(req, 0);
        BitConverter.GetBytes(serial).CopyTo(req, 4);
        var res = new byte[12];
        bool ok = Ioctl(XUSB_NOTIFY, req, res);
        large = res[8]; small = res[9];
        return ok;
    }

    public void Dispose() { Handle.Dispose(); if (sync != null) sync.Dispose(); }
}

// ---------------- settings ----------------
class Config
{
    public double LeftDead = 0.08, RightDead = 0.08, TriggerDead = 0.04, AntiDead = 0.0, Curve = 1.0, Rumble = 1.0;
    public bool InvertLY, InvertRY, Exclusive = true, BatteryLight;
    public bool PsMenu, PsHome, ShareCapture; // PC4 takes the PS button (Quick Menu / home) and Share (captures)
    public bool Freeze; // the Quick Menu is open over the game: the virtual pad reports nothing pressed
    public bool Menu;   // the Quick Menu is open over the game: report the buttons to PC4 ("nav"), whatever window has focus
    public string Touchpad = "back";
    public byte R = 0, G = 32, B = 255;

    public void Apply(string line)
    {
        foreach (var part in line.Split(' '))
        {
            int eq = part.IndexOf('=');
            if (eq < 0) continue;
            string k = part.Substring(0, eq), v = part.Substring(eq + 1);
            double d; double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out d);
            switch (k)
            {
                case "ldz": LeftDead = Clamp(d, 0, 0.9); break;
                case "rdz": RightDead = Clamp(d, 0, 0.9); break;
                case "tdz": TriggerDead = Clamp(d, 0, 0.9); break;
                case "adz": AntiDead = Clamp(d, 0, 0.9); break;
                case "curve": Curve = Clamp(d, 0.3, 3); break;
                case "rumble": Rumble = Clamp(d, 0, 1); break;
                case "invly": InvertLY = v == "1"; break;
                case "invry": InvertRY = v == "1"; break;
                case "exclusive": Exclusive = v == "1"; break;
                case "battery": BatteryLight = v == "1"; break;
                case "tp": Touchpad = v; break;
                case "psmenu": PsMenu = v == "1"; break;
                case "pshome": PsHome = v == "1"; break;
                case "sharecap": ShareCapture = v == "1"; break;
                case "freeze": Freeze = v == "1"; break;
                case "menu": Menu = v == "1"; break;
                case "color":
                    var c = v.Split(',');
                    if (c.Length == 3) { R = (byte)int.Parse(c[0]); G = (byte)int.Parse(c[1]); B = (byte)int.Parse(c[2]); }
                    break;
            }
        }
    }

    static double Clamp(double v, double a, double b) { return v < a ? a : v > b ? b : v; }
}

// ---------------- one PlayStation controller ----------------
class Pad
{
    public string Path, Kind, Instance;
    public bool Bluetooth, DualSense, Exclusive;
    public int Battery = -1;
    public bool Charging;
    public uint Serial;
    public volatile bool Alive = true;
    SafeFileHandle hid;
    int inLen, outLen;
    readonly Bus bus;
    readonly Config cfg;
    readonly object writeLock = new object();
    Bus.IoBuf io;                                            // created on the read thread, used only there
    readonly byte[] xusbPacket = new byte[20], ds4Packet = new byte[72];
    byte rumbleLarge, rumbleSmall;
    ushort lastButtons = 0xFFFF; byte lastLt = 1, lastRt = 1; short lastLx = 1, lastLy = 1, lastRx = 1, lastRy = 1;

    public Pad(string path, ushort pid, Bus bus, Config cfg)
    {
        Path = path; this.bus = bus; this.cfg = cfg;
        DualSense = pid == 0x0CE6 || pid == 0x0DF2;
        Kind = DualSense ? (pid == 0x0DF2 ? "DualSense Edge" : "DualSense") : "DUALSHOCK 4";
        // "\\?\hid#vid_054c&pid_09cc&mi_03#8&23ff95cc&0&0000#{guid}" -> "HID\VID_054C&PID_09CC&MI_03\8&23FF95CC&0&0000"
        string p = path.StartsWith(@"\\?\") ? path.Substring(4) : path;
        int g = p.LastIndexOf("#{");
        Instance = (g > 0 ? p.Substring(0, g) : p).Replace('#', '\\').ToUpperInvariant();
    }

    public bool Open()
    {
        uint access = Native.GENERIC_READ | Native.GENERIC_WRITE;
        // exclusive: nothing else (games, Steam) can open the controller while PC4 turns it into an Xbox pad
        if (cfg.Exclusive && Program.Emulate) hid = Native.CreateFile(Path, access, 0, IntPtr.Zero, Native.OPEN_EXISTING, 0, IntPtr.Zero);
        Exclusive = hid != null && !hid.IsInvalid;
        if (!Exclusive) hid = Native.CreateFile(Path, access, Native.FILE_SHARE_READ | Native.FILE_SHARE_WRITE, IntPtr.Zero, Native.OPEN_EXISTING, 0, IntPtr.Zero);
        if (hid.IsInvalid) return false;
        IntPtr pre;
        if (!Native.HidD_GetPreparsedData(hid, out pre)) return false;
        var caps = new Native.HIDP_CAPS();
        Native.HidP_GetCaps(pre, ref caps);
        Native.HidD_FreePreparsedData(pre);
        inLen = caps.InputReportByteLength; outLen = caps.OutputReportByteLength;
        Bluetooth = inLen > 64;
        Native.HidD_SetNumInputBuffers(hid, 4); // fresh input, no backlog
        if (Bluetooth)
        {
            // asking for the calibration report switches a Bluetooth pad to its full input reports
            var f = new byte[DualSense ? 41 : 37];
            f[0] = 0x05;
            Native.HidD_GetFeature(hid, f, f.Length);
        }
        return true;
    }

    public void Run()
    {
        var buf = new byte[Math.Max(inLen, 64)];
        var rumbleThread = new Thread(RumbleLoop) { IsBackground = true };
        if (Program.Emulate)
        {
            Serial = bus.Plugin(Program.Ds4);
            if (Serial == 0) { Program.Error(Program.Ds4 ? "Could not create the virtual DUALSHOCK 4" : "Could not create the virtual Xbox controller"); Alive = false; return; }
            rumbleThread.Start();
            Program.Status(); // its slot: PC4 waits for it before starting a game with passthrough
        }
        WriteOutput();
        while (Alive)
        {
            int n;
            if (!Native.ReadFile(hid, buf, inLen, out n, IntPtr.Zero) || n == 0)
            {
                if (Alive) Program.Log("controller read ended: error " + Marshal.GetLastWin32Error() + ", " + n + " bytes, report size " + inLen);
                break; // unplugged
            }
            Parse(buf, n);
        }
        Alive = false;
        if (Program.Emulate) bus.Unplug(Serial);
        hid.Dispose();
    }

    public void Stop() { Alive = false; try { Native.CancelIoEx(hid, IntPtr.Zero); hid.Dispose(); } catch { } }

    // ---- input: PlayStation report -> Xbox report ----
    void Parse(byte[] r, int n)
    {
        int o; // offset of the left stick X byte
        if (!DualSense)
        {
            if (r[0] == 0x01) o = 1;                  // USB, or Bluetooth before full reports
            else if (r[0] == 0x11) o = 3;             // Bluetooth full report
            else return;
        }
        else
        {
            if (r[0] == 0x01 && !Bluetooth) o = 1;    // USB
            else if (r[0] == 0x31) o = 2;             // Bluetooth full report
            else if (r[0] == 0x01) { SimpleDualSense(r); return; }
            else return;
        }
        byte lx = r[o], ly = r[o + 1], rx = r[o + 2], ry = r[o + 3];
        byte b0, b1, b2, l2, r2;
        if (!DualSense) { b0 = r[o + 4]; b1 = r[o + 5]; b2 = r[o + 6]; l2 = r[o + 7]; r2 = r[o + 8]; }
        else { l2 = r[o + 4]; r2 = r[o + 5]; b0 = r[o + 7]; b1 = r[o + 8]; b2 = r[o + 9]; }
        ReadBattery(r, n, o);
        Emit(lx, ly, rx, ry, b0, b1, b2, l2, r2, DualSense ? null : r, o, n);
    }

    // DualSense over Bluetooth before full reports: DS4-like layout
    void SimpleDualSense(byte[] r) { Emit(r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], null, 0, 0); }

    int batteryTick;
    void ReadBattery(byte[] r, int n, int o)
    {
        if (++batteryTick % 250 != 0 && Battery >= 0) return;
        int i = DualSense ? o + 52 : o + 29;
        if (i >= n) return;
        byte v = r[i];
        if (DualSense) { Battery = Math.Min(100, (v & 0x0F) * 10 + 5); Charging = (v & 0xF0) == 0x10; }
        else { bool cable = (v & 0x10) != 0; int level = v & 0x0F; Charging = cable && level < 11; Battery = Math.Min(100, level * (cable ? 100 / 11 : 10) + 5); }
        if (cfg.BatteryLight && Battery / 10 != lastBatteryShown) { lastBatteryShown = Battery / 10; WriteOutput(); }
        // PC4 shows the level in its top bars: tell it when it changes (not the first read, the pad's status follows that)
        if (lastBatteryReported != -1 && (Battery != lastBatteryReported || Charging != lastChargingReported)) Program.Status();
        lastBatteryReported = Battery; lastChargingReported = Charging;
    }
    int lastBatteryShown = -1, lastBatteryReported = -1;
    bool lastChargingReported;

    int lastNav = -1;
    bool wasFrozen;
    ushort heldBack; // buttons still down from the Quick Menu: the game gets them once they're let go and pressed again

    // raw / ro / rn: a DUALSHOCK 4's own report (from the left stick byte on), passed through as is in ds4 mode
    void Emit(byte lx, byte ly, byte rx, byte ry, byte b0, byte b1, byte b2, byte l2, byte r2, byte[] raw, int ro, int rn)
    {
        ushort x = 0;
        int hat = b0 & 0x0F;
        if (hat == 7 || hat == 0 || hat == 1) x |= 0x0001; // up
        if (hat == 3 || hat == 4 || hat == 5) x |= 0x0002; // down
        if (hat == 5 || hat == 6 || hat == 7) x |= 0x0004; // left
        if (hat == 1 || hat == 2 || hat == 3) x |= 0x0008; // right
        if ((b0 & 0x10) != 0) x |= 0x4000; // square   -> X
        if ((b0 & 0x20) != 0) x |= 0x1000; // cross    -> A
        if ((b0 & 0x40) != 0) x |= 0x2000; // circle   -> B
        if ((b0 & 0x80) != 0) x |= 0x8000; // triangle -> Y
        if ((b1 & 0x01) != 0) x |= 0x0100; // L1 -> LB
        if ((b1 & 0x02) != 0) x |= 0x0200; // R1 -> RB
        if ((b1 & 0x20) != 0) x |= 0x0010; // Options -> Start
        if ((b1 & 0x40) != 0) x |= 0x0040; // L3
        if ((b1 & 0x80) != 0) x |= 0x0080; // R3
        // PS and Share can belong to PC4: a press is held back until it's clear whether it's a tap or a hold
        int now = Environment.TickCount;
        bool psTaken = cfg.PsMenu || cfg.PsHome;
        bool psOn = Track(ref ps, (b2 & 0x01) != 0, now, "ps", psTaken);
        bool shareOn = Track(ref share, (b1 & 0x10) != 0, now, "share", cfg.ShareCapture);
        if (cfg.ShareCapture) x &= unchecked((ushort)~0x0020); // Share makes captures instead of pressing Back
        else if (shareOn) x |= 0x0020;
        if (psOn || now - ps.PulseUntil < 0) x |= 0x0400; // PS -> Guide (or a short Guide tap after a PS tap)
        if ((b2 & 0x02) != 0) { if (cfg.Touchpad == "back") x |= 0x0020; else if (cfg.Touchpad == "guide") x |= 0x0400; else if (cfg.Touchpad == "start") x |= 0x0010; }
        byte lt = Trigger(l2), rt = Trigger(r2);
        short sx, sy, tx, ty;
        Stick(lx, ly, cfg.LeftDead, cfg.InvertLY, out sx, out sy);
        Stick(rx, ry, cfg.RightDead, cfg.InvertRY, out tx, out ty);
        // the Quick Menu over a game is driven from here: it can't rely on having the focus (an administrator game
        // keeps it, and giving it up would minimize fullscreen games)
        if (cfg.Menu)
        {
            int nav = x & 0xF31F; // d-pad, Start, LB, RB, A, B, X, Y
            if (sy > 18000) nav |= 0x0001; else if (sy < -18000) nav |= 0x0002;
            if (sx < -18000) nav |= 0x0004; else if (sx > 18000) nav |= 0x0008;
            if (lt > 128) nav |= 0x10000;
            if (rt > 128) nav |= 0x20000;
            if (nav != lastNav) { lastNav = nav; Program.Send("{\"type\":\"nav\",\"b\":" + nav + "}"); }
        }
        else lastNav = -1; // the first report after the menu opens says what's already held
        if (!Program.Emulate) return;
        if (Program.Ds4) { EmitDs4(lx, ly, rx, ry, b0, b1, b2, l2, r2, raw, ro, rn, psOn || now - ps.PulseUntil < 0, shareOn); return; }
        if (cfg.Freeze) { x = 0; lt = rt = 0; sx = sy = tx = ty = 0; wasFrozen = true; }
        else if (wasFrozen) { wasFrozen = false; heldBack = x; } // the button that closed the menu isn't passed on
        if (heldBack != 0) { heldBack &= x; x = (ushort)(x & ~heldBack); }
        if (x == lastButtons && lt == lastLt && rt == lastRt && sx == lastLx && sy == lastLy && tx == lastRx && ty == lastRy) return;
        lastButtons = x; lastLt = lt; lastRt = rt; lastLx = sx; lastLy = sy; lastRx = tx; lastRy = ty;
        if (io == null) io = new Bus.IoBuf();
        if (!bus.Submit(io, xusbPacket, Serial, x, lt, rt, sx, sy, tx, ty)) { Program.Log("Xbox report refused: error " + Marshal.GetLastWin32Error()); Alive = false; }
    }

    // tap = released within 0.6 s, hold = kept down that long (reported once)
    // ds4 mode: the game gets the controller exactly as it is (no deadzones, touchpad and motion included), minus
    // what PC4 takes (PS, Share for captures) and nothing at all while the Quick Menu is open
    readonly byte[] ds4 = new byte[63];
    bool ds4Hold; // after the menu: buttons stay held back until everything is let go
    void EmitDs4(byte lx, byte ly, byte rx, byte ry, byte b0, byte b1, byte b2, byte l2, byte r2, byte[] raw, int ro, int rn, bool ps, bool share)
    {
        var d = ds4;
        if (raw != null) { Array.Clear(d, 0, 63); Array.Copy(raw, ro, d, 0, Math.Min(63, rn - ro)); }
        else
        {
            // a DualSense: its sticks, buttons and triggers in DS4 order, no touch
            Array.Clear(d, 0, 63);
            d[0] = lx; d[1] = ly; d[2] = rx; d[3] = ry; d[4] = b0; d[5] = b1; d[6] = (byte)(b2 & 0x03); d[7] = l2; d[8] = r2;
            d[34] = 0x80; d[38] = 0x80;
        }
        d[6] = (byte)((d[6] & ~0x01) | (ps ? 0x01 : 0));                     // PS: PC4's, or a short press after a tap
        if (cfg.ShareCapture) d[5] = (byte)(d[5] & ~0x10); else if (!share) d[5] = (byte)(d[5] & ~0x10);
        bool buttons = (d[4] & 0xF0) != 0 || (d[4] & 0x0F) != 8 || (d[5] & 0xF3) != 0 || (d[6] & 0x03) != 0 || d[7] > 30 || d[8] > 30;
        if (cfg.Freeze) { wasFrozen = true; ds4Hold = true; }
        else if (ds4Hold && !buttons) ds4Hold = false;
        if (cfg.Freeze || ds4Hold)
        {
            d[4] = 0x08; d[5] = 0; d[6] = (byte)(d[6] & 0xFC); d[7] = 0; d[8] = 0; // nothing pressed
            if (cfg.Freeze) { d[0] = d[1] = d[2] = d[3] = 0x80; d[34] |= 0x80; d[38] |= 0x80; } // sticks centred, no touch
        }
        // a freshly plugged virtual DS4 refuses reports until Windows has set it up: keep trying for a few seconds
        if (io == null) io = new Bus.IoBuf();
        if (bus.SubmitDs4(io, ds4Packet, Serial, d)) { ds4FailSince = 0; return; }
        int t = Environment.TickCount;
        if (ds4FailSince == 0) ds4FailSince = t;
        else if (t - ds4FailSince > 5000) { Program.Log("DUALSHOCK 4 report refused: error " + Marshal.GetLastWin32Error()); Alive = false; }
    }
    int ds4FailSince;

    struct Btn { public bool Down, HoldSent; public int Since, PulseUntil; }
    Btn ps, share;
    // returns whether the game should see the button pressed right now
    bool Track(ref Btn b, bool down, int now, string name, bool taken)
    {
        if (down && !b.Down) { b.Down = true; b.Since = now; b.HoldSent = false; }
        else if (down && !b.HoldSent && now - b.Since >= 600) { b.HoldSent = true; Program.Button(name, "hold"); }
        else if (!down && b.Down)
        {
            b.Down = false;
            if (!b.HoldSent)
            {
                Program.Button(name, "tap");
                // PS tapped and PC4 doesn't use taps for the home screen: the game gets a short Guide press
                if (taken && name == "ps" && !cfg.PsHome) b.PulseUntil = now + 120;
            }
        }
        return !taken && down;
    }

    byte Trigger(byte v)
    {
        double t = v / 255.0, dz = cfg.TriggerDead;
        if (t <= dz) return 0;
        return (byte)Math.Round(Math.Min(1, (t - dz) / (1 - dz)) * 255);
    }

    // radial deadzone, anti-deadzone and response curve, like DS4Windows' stick settings
    void Stick(byte bx, byte by, double dz, bool invert, out short ox, out short oy)
    {
        double x = (bx - 127.5) / 127.5, y = -(by - 127.5) / 127.5;
        if (invert) y = -y;
        double mag = Math.Sqrt(x * x + y * y);
        if (mag <= dz || mag == 0) { ox = 0; oy = 0; return; }
        double m = Math.Min(1, (mag - dz) / (1 - dz));
        m = Math.Pow(m, cfg.Curve);
        m = cfg.AntiDead + (1 - cfg.AntiDead) * m;
        double k = Math.Min(1, m) / mag;
        ox = (short)Math.Max(-32768, Math.Min(32767, Math.Round(x * k * 32767)));
        oy = (short)Math.Max(-32768, Math.Min(32767, Math.Round(y * k * 32767)));
    }

    // ---- output: rumble + light bar back to the controller ----
    byte gameR, gameG, gameB; bool gameColor; // ds4 mode: the light bar colour the game asked for
    void RumbleLoop()
    {
        if (!Program.Emulate) return;
        while (Alive)
        {
            byte large, small, r = 0, g = 0, bl = 0;
            bool ok = Program.Ds4 ? bus.WaitDs4Output(Serial, out large, out small, out r, out g, out bl) : bus.WaitRumble(Serial, out large, out small);
            if (!ok)
            {
#if TESTLOG
                Program.Log("output wait failed: error " + Marshal.GetLastWin32Error());
#endif
                if (!Alive) break; Thread.Sleep(200); continue;
            }
            rumbleLarge = large; rumbleSmall = small;
            if (Program.Ds4) { gameColor = r != 0 || g != 0 || bl != 0; gameR = r; gameG = g; gameB = bl; }
#if TESTLOG
            Program.Log("game output: rumble " + large + "/" + small + " light " + r + "," + g + "," + bl);
#endif
            WriteOutput();
        }
    }

    public void TestRumble(byte large, byte small, int ms)
    {
        rumbleLarge = large; rumbleSmall = small; WriteOutput();
        new Thread(() => { Thread.Sleep(ms); rumbleLarge = 0; rumbleSmall = 0; WriteOutput(); }) { IsBackground = true }.Start();
    }

    static uint[] crcTable;
    static uint Crc32(byte[] data, int len, byte seed)
    {
        if (crcTable == null)
        {
            crcTable = new uint[256];
            for (uint i = 0; i < 256; i++) { uint c = i; for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1; crcTable[i] = c; }
        }
        uint crc = 0xFFFFFFFF;
        crc = crcTable[(crc ^ seed) & 0xFF] ^ (crc >> 8);
        for (int i = 0; i < len; i++) crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
        return ~crc;
    }

    public void WriteOutput()
    {
        // watch mode only listens: rumble and light bar stay with the game
        if (hid == null || hid.IsInvalid || !Alive || !Program.Emulate) return;
        byte large = (byte)Math.Round(rumbleLarge * cfg.Rumble), small = (byte)Math.Round(rumbleSmall * cfg.Rumble);
        byte cr = cfg.R, cg = cfg.G, cb = cfg.B;
        if (Program.Ds4 && gameColor) { cr = gameR; cg = gameG; cb = gameB; } // the game's own light bar (health, police lights…)
        if (cfg.BatteryLight && Battery >= 0)
        {
            // red when low, yellow in the middle, green when full
            double t = Battery / 100.0;
            cr = (byte)(t < 0.5 ? 255 : Math.Round(255 * (1 - t) * 2)); cg = (byte)(t > 0.5 ? 255 : Math.Round(255 * t * 2)); cb = 0;
        }
        // USB: the full output report through WriteFile; Bluetooth: exactly 78 bytes through SetOutputReport
        var b = new byte[Bluetooth ? 78 : Math.Max(outLen, DualSense ? 48 : 32)];
        if (!DualSense && !Bluetooth)
        {
            b[0] = 0x05; b[1] = 0x07; b[4] = small; b[5] = large; b[6] = cr; b[7] = cg; b[8] = cb;
        }
        else if (!DualSense)
        {
            b[0] = 0x11; b[1] = 0xC0; b[2] = 0x20; b[3] = 0x07; b[4] = 0x04; b[6] = small; b[7] = large; b[8] = cr; b[9] = cg; b[10] = cb;
            Seal(b);
        }
        else
        {
            int o = Bluetooth ? 2 : 1; // Bluetooth has an extra tag byte
            b[0] = (byte)(Bluetooth ? 0x31 : 0x02);
            if (Bluetooth) b[1] = 0x02;
            b[o + 0] = 0x03;           // valid flags: compatible vibration + haptics
            b[o + 1] = 0x04;           // valid flags: light bar colour
            b[o + 2] = small; b[o + 3] = large;
            b[o + 38] = 0x02; b[o + 41] = 0x02; // light bar setup: take the colour
            b[o + 44] = cr; b[o + 45] = cg; b[o + 46] = cb;
            if (Bluetooth) Seal(b);
        }
        lock (writeLock)
        {
            int w;
            if (Bluetooth) { if (!Native.HidD_SetOutputReport(hid, b, b.Length)) Native.WriteFile(hid, b, b.Length, out w, IntPtr.Zero); }
            else if (!Native.WriteFile(hid, b, b.Length, out w, IntPtr.Zero)) Native.HidD_SetOutputReport(hid, b, b.Length);
        }
    }

    // Bluetooth output reports end with a CRC32 of 0xA2 + the report
    void Seal(byte[] b)
    {
        uint crc = Crc32(b, 74, 0xA2);
        BitConverter.GetBytes(crc).CopyTo(b, 74);
    }

    public string Json()
    {
        return "{\"kind\":\"" + Kind + "\",\"bus\":\"" + (Bluetooth ? "Bluetooth" : "USB") + "\",\"slot\":" + Serial +
            ",\"battery\":" + Battery + ",\"charging\":" + (Charging ? "true" : "false") + ",\"exclusive\":" + (Exclusive ? "true" : "false") +
            ",\"instance\":\"" + Instance.Replace("\\", "\\\\") + "\"}";
    }
}

static class XInputGuide
{
    [StructLayout(LayoutKind.Sequential)]
    struct State { public uint Packet; public ushort Buttons; public byte LT, RT; public short LX, LY, RX, RY; }
    [DllImport("xinput1_4.dll", EntryPoint = "#100")]
    static extern int XInputGetStateEx(int index, out State state);

    // polls the Guide button of real Xbox pads (only while no PlayStation pad is being turned into one)
    public static void Run(Func<bool> active)
    {
        bool down = false; int since = 0; bool held = false;
        while (true)
        {
            Thread.Sleep(active() ? 30 : 500);
            if (!active()) { down = false; continue; }
            bool guide = false;
            try { for (int i = 0; i < 4; i++) { State s; if (XInputGetStateEx(i, out s) == 0 && (s.Buttons & 0x0400) != 0) guide = true; } }
            catch { return; } // no XInput 1.4 on this PC
            int now = Environment.TickCount;
            if (guide && !down) { down = true; since = now; held = false; }
            else if (guide && !held && now - since >= 600) { held = true; Program.Button("guide", "hold"); }
            else if (!guide && down) { down = false; if (!held) Program.Button("guide", "tap"); }
        }
    }
}

// ---- system volume (Windows Core Audio) ----
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator
{
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice
{
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetState(out int state);
}
[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection
{
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int Item(int index, out IMMDevice device);
}
[StructLayout(LayoutKind.Sequential)] struct PropertyKey { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Explicit, Size = 24)] struct PropVariant { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr ptr; }
[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore
{
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetAt(int index, out PropertyKey key);
    [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
}
// Windows' own (undocumented but stable since Windows 7) way to change the default sound device
[ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")] class PolicyConfigClient { }
[ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPolicyConfig
{
    [PreserveSig] int GetMixFormat(string id, IntPtr format);
    [PreserveSig] int GetDeviceFormat(string id, int def, IntPtr format);
    [PreserveSig] int ResetDeviceFormat(string id);
    [PreserveSig] int SetDeviceFormat(string id, IntPtr endpoint, IntPtr mix);
    [PreserveSig] int GetProcessingPeriod(string id, int def, IntPtr defaultPeriod, IntPtr minPeriod);
    [PreserveSig] int SetProcessingPeriod(string id, IntPtr period);
    [PreserveSig] int GetShareMode(string id, IntPtr mode);
    [PreserveSig] int SetShareMode(string id, IntPtr mode);
    [PreserveSig] int GetPropertyValue(string id, IntPtr key, IntPtr value);
    [PreserveSig] int SetPropertyValue(string id, IntPtr key, IntPtr value);
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
    [PreserveSig] int SetEndpointVisibility(string id, int visible);
}
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume
{
    [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
    [PreserveSig] int GetChannelCount(out uint count);
    [PreserveSig] int SetMasterVolumeLevel(float db, ref Guid ctx);
    [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
    [PreserveSig] int GetMasterVolumeLevel(out float db);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
    [PreserveSig] int SetChannelVolumeLevel(uint channel, float db, ref Guid ctx);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid ctx);
    [PreserveSig] int GetChannelVolumeLevel(uint channel, out float db);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

static class Volume
{
    static IAudioEndpointVolume Endpoint()
    {
        var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
        IMMDevice dev;
        if (en.GetDefaultAudioEndpoint(0, 1, out dev) != 0) return null; // speakers, multimedia
        var iid = typeof(IAudioEndpointVolume).GUID;
        object o;
        if (dev.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) return null; // CLSCTX_ALL
        return (IAudioEndpointVolume)o;
    }

    public static void Report()
    {
        var v = Endpoint();
        if (v == null) { Program.Send("{\"type\":\"volume\",\"level\":-1}"); return; }
        float level; bool muted;
        v.GetMasterVolumeLevelScalar(out level); v.GetMute(out muted);
        Program.Send("{\"type\":\"volume\",\"level\":" + level.ToString("0.000", CultureInfo.InvariantCulture) + ",\"muted\":" + (muted ? "true" : "false") + "}");
    }

    public static void Set(float level)
    {
        var v = Endpoint(); if (v == null) return;
        var ctx = Guid.Empty;
        v.SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(1, level)), ref ctx);
        bool muted; v.GetMute(out muted);
        if (muted && level > 0) v.SetMute(false, ref ctx);
    }

    public static void Mute(bool on) { var v = Endpoint(); if (v == null) return; var ctx = Guid.Empty; v.SetMute(on, ref ctx); }

    static string Esc(string t) { return (t ?? "").Replace("\\", "\\\\").Replace("\"", "\\\""); }

    // every active output (speakers, headphones, the controller's headset jack, HDMI…) and which one is the default
    public static void Outputs()
    {
        var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
        string def = null;
        IMMDevice d0;
        if (en.GetDefaultAudioEndpoint(0, 1, out d0) == 0) d0.GetId(out def);
        IMMDeviceCollection list;
        var sb = new StringBuilder("{\"type\":\"outputs\",\"list\":[");
        if (en.EnumAudioEndpoints(0, 1, out list) == 0)
        {
            int n; list.GetCount(out n);
            var nameKey = new PropertyKey { fmtid = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"), pid = 14 };
            for (int i = 0; i < n; i++)
            {
                IMMDevice dev; if (list.Item(i, out dev) != 0) continue;
                string id; dev.GetId(out id);
                string name = id;
                IPropertyStore ps;
                if (dev.OpenPropertyStore(0, out ps) == 0)
                {
                    PropVariant v;
                    if (ps.GetValue(ref nameKey, out v) == 0 && v.vt == 31 && v.ptr != IntPtr.Zero) name = Marshal.PtrToStringUni(v.ptr);
                }
                if (i > 0) sb.Append(',');
                sb.Append("{\"id\":\"" + Esc(id) + "\",\"name\":\"" + Esc(name) + "\",\"default\":" + (id == def ? "true" : "false") + "}");
            }
        }
        Program.Send(sb.Append("]}").ToString());
    }

    public static void SetOutput(string id)
    {
        var pc = (IPolicyConfig)new PolicyConfigClient();
        for (int role = 0; role < 3; role++) pc.SetDefaultEndpoint(id, role); // console, multimedia, communications
    }
}

static class Program
{
    public static bool Emulate = true;
    public static bool Ds4; // the virtual pad is a DUALSHOCK 4 (passthrough) rather than an Xbox 360 pad
    public static void Button(string name, string ev) { if (Standby.Active) { Standby.Pressed(name, ev); return; } Send("{\"type\":\"button\",\"button\":\"" + name + "\",\"event\":\"" + ev + "\"}"); }
    static readonly object outLock = new object();
    static readonly Config cfg = new Config();
    static readonly Dictionary<string, Pad> pads = new Dictionary<string, Pad>();
    static Bus bus;
    static volatile bool quit;
    static readonly HashSet<ushort> Sony = new HashSet<ushort> { 0x05C4, 0x09CC, 0x0BA0, 0x0CE6, 0x0DF2 };

    // a broken pipe means PC4 is gone (killed): no exception may end the helper before it has cleaned up
    public static void Send(string json)
    {
        lock (outLock)
        {
            if (orphaned) return;
            try { Console.Out.WriteLine(json); Console.Out.Flush(); } catch { orphaned = quit = true; }
        }
    }
    public static void Log(string msg) { Send("{\"type\":\"log\",\"message\":\"" + msg.Replace("\\", "/").Replace("\"", "'") + "\"}"); }
    public static void Error(string msg) { Send("{\"type\":\"error\",\"message\":\"" + msg.Replace("\"", "'") + "\"}"); }

    public static int PadCount() { lock (pads) { int n = 0; foreach (var p in pads.Values) if (p.Alive) n++; return n; } }

    public static void Status()
    {
        var sb = new StringBuilder("{\"type\":\"status\",\"mode\":\"" + (Ds4 ? "ds4" : Emulate ? "emulate" : "watch") + "\",\"bus\":" + (bus != null || !Emulate ? "true" : "false") + ",\"pads\":[");
        bool first = true;
        lock (pads) foreach (var p in pads.Values) { if (!p.Alive) continue; if (!first) sb.Append(','); sb.Append(p.Json()); first = false; }
        Send(sb.Append("]}").ToString());
    }

    public static bool scanned; // the first scan is done: a Bluetooth pad found after it has just connected
    public static void Scan()
    {
        Guid hidGuid;
        Native.HidD_GetHidGuid(out hidGuid);
        foreach (var path in Native.Interfaces(hidGuid))
        {
            lock (pads) if (pads.ContainsKey(path) && pads[path].Alive) continue;
            // a virtual DUALSHOCK 4 (ours, or DS4Windows'): "hid#vid_054c&pid_05c4&rev_0100#…", no USB interface number;
            // a real first-model DS4 has "&mi_03" on USB, a Bluetooth one a {00001124-…}_vid&0002054c path
            string lp = path.ToLowerInvariant();
            if (lp.Contains("vid_054c&pid_05c4") && !lp.Contains("&mi_") && !lp.Contains("00001124")) continue;
            ushort pid;
            using (var h = Native.CreateFile(path, 0, Native.FILE_SHARE_READ | Native.FILE_SHARE_WRITE, IntPtr.Zero, Native.OPEN_EXISTING, 0, IntPtr.Zero))
            {
                if (h.IsInvalid) continue;
                var a = new Native.HIDD_ATTRIBUTES();
                a.Size = Marshal.SizeOf(a);
                if (!Native.HidD_GetAttributes(h, ref a) || a.VendorID != 0x054C || !Sony.Contains(a.ProductID)) continue;
                IntPtr pre;
                if (!Native.HidD_GetPreparsedData(h, out pre)) continue;
                var caps = new Native.HIDP_CAPS();
                Native.HidP_GetCaps(pre, ref caps);
                Native.HidD_FreePreparsedData(pre);
                if (caps.UsagePage != 0x01 || (caps.Usage != 0x05 && caps.Usage != 0x04)) continue; // the gamepad collection only
                pid = a.ProductID;
            }
            var pad = new Pad(path, pid, bus, cfg);
            if (!pad.Open()) { Error("Could not open the controller (another program may be using it)"); continue; }
            lock (pads) pads[path] = pad;
            if (Standby.Active && scanned && pad.Bluetooth) Standby.Pressed("connect", "tap"); // turned on with PS
            new Thread(() => { pad.Run(); Status(); }) { IsBackground = true, Priority = ThreadPriority.AboveNormal }.Start();
            Thread.Sleep(150);
            Status();
        }
        scanned = true;
    }

    static int Main(string[] args)
    {
        if (args.Length > 1 && args[0] == "standby") return Standby.Run(args);
        // PC4 starts the helper detached (so it outlives a killed PC4 long enough to clean up): there's no console,
        // so UTF-8 goes on the stdout pipe directly (setting Console.OutputEncoding would throw)
        Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)));
        AppDomain.CurrentDomain.UnhandledException += (s, e) => { if (orphaned) RunOnExit(); };
        // leave with PC4: if the parent goes away, so does the helper
        int parent;
        if (args.Length > 0 && int.TryParse(args[0], out parent))
            new Thread(() => { try { Process.GetProcessById(parent).WaitForExit(); } catch { } orphaned = quit = true; Shutdown(); RunOnExit(); Environment.Exit(0); }) { IsBackground = true }.Start();

        Emulate = !(args.Length > 1 && args[1] == "watch");
        Ds4 = args.Length > 1 && args[1] == "ds4";
        if (Emulate)
        {
            bus = Bus.Open();
            if (bus == null) { Error("ViGEmBus driver not found"); Status(); return 2; }
        }
        // Xbox pads' Guide button, when there's no PlayStation pad (those report PS themselves)
        new Thread(() => XInputGuide.Run(() => (cfg.PsMenu || cfg.PsHome) && PadCount() == 0)) { IsBackground = true }.Start();

        new Thread(() =>
        {
            string line;
            while (!quit && (line = Console.In.ReadLine()) != null)
            {
                if (line.StartsWith("config ")) { cfg.Apply(line.Substring(7)); lock (pads) foreach (var p in pads.Values) p.WriteOutput(); }
                else if (line.StartsWith("rumble "))
                {
                    var a = line.Split(' ');
                    lock (pads) foreach (var p in pads.Values) p.TestRumble(byte.Parse(a[1]), byte.Parse(a[2]), int.Parse(a[3]));
                }
                else if (line == "status") Status();
                else if (line == "volume") Volume.Report();
                else if (line.StartsWith("volume ")) { float v; if (float.TryParse(line.Substring(7), NumberStyles.Float, CultureInfo.InvariantCulture, out v)) { Volume.Set(v); Volume.Report(); } }
                else if (line.StartsWith("mute ")) { Volume.Mute(line.EndsWith("1")); Volume.Report(); }
                else if (line == "outputs") { try { Volume.Outputs(); } catch (Exception e) { Error("outputs: " + e.Message); } }
                else if (line.StartsWith("output ")) { try { Volume.SetOutput(line.Substring(7)); Volume.Outputs(); Volume.Report(); } catch (Exception e) { Error("output: " + e.Message); } }
                else if (line.StartsWith("onexit")) onExit = line.Length > 7 ? line.Substring(7).Split('\t') : null;
                else if (line == "quit") { quit = true; break; }
            }
            if (!quit) orphaned = true; // stdin closed without "quit": PC4 is gone
            quit = true;
        }) { IsBackground = true }.Start();

        Status();
        while (!quit)
        {
            try { Scan(); } catch (Exception e) { Error(e.Message); }
            lock (pads) foreach (var k in new List<string>(pads.Keys)) if (!pads[k].Alive) pads.Remove(k);
            for (int i = 0; i < 20 && !quit; i++) Thread.Sleep(100); // look for new controllers every 2 s
        }
        Shutdown();
        if (orphaned) RunOnExit();
        return 0;
    }

    // PC4 went away (killed, crashed) with the controller still hidden: undo it here, since HidHide would keep it
    // hidden from every game, even after a reboot. onexit = <exe> <PC4's note of it> <args…>, sent by PC4.
    static volatile bool orphaned;
    static volatile string[] onExit;
    static int onExitRan;
    static void RunOnExit()
    {
        var c = onExit;
        if (c == null || c.Length < 3 || Interlocked.Exchange(ref onExitRan, 1) != 0) return;
        try
        {
            var args = new StringBuilder();
            // (quotes only where needed: HidHideCLI doesn't recognise a quoted "--dev-unhide")
            for (int i = 2; i < c.Length; i++)
            {
                string a = c[i].Replace("\"", "");
                args.Append(i > 2 ? " " : "").Append(a.IndexOf(' ') >= 0 ? "\"" + a + "\"" : a);
            }
            var psi = new ProcessStartInfo(c[0], args.ToString()) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true };
            using (var p = Process.Start(psi))
            {
                p.StandardInput.Close(); // HidHideCLI waits for more commands otherwise
                if (p.WaitForExit(15000) && p.ExitCode == 0) try { File.Delete(c[1]); } catch { }
            }
        }
        catch { }
    }

    public static void Release() { lock (pads) { foreach (var p in pads.Values) p.Stop(); pads.Clear(); } scanned = false; }

    static void Shutdown()
    {
        lock (pads) foreach (var p in pads.Values) { p.Stop(); if (bus != null && Emulate) bus.Unplug(p.Serial); }
        if (bus != null) bus.Dispose();
    }
}

// pc4wake.exe: starts PC4 in Console Mode when the PS button is pressed, like turning on a PS4. It runs from the
// Windows sign-in (Settings: "Press PS to Start PC4"), lets go of the controller while PC4 runs, and while PC4 is
// closed only reads it (shared, nothing is sent to it).
static class Standby
{
    public static bool Active;
    static volatile bool wake, running;
    static Mutex one;
    public static void Pressed(string name, string ev) { if (ev == "tap") wake = true; }

    public static int Run(string[] args)
    {
        bool mine;
        one = new Mutex(true, @"Local\PC4.PsWake", out mine); // one copy per Windows user (a field: a local could be collected)
        if (!mine) return 0;
        Active = true;
        Program.Emulate = false;
        string exe = args[1];
        var rest = new StringBuilder();
        for (int i = 2; i < args.Length; i++) rest.Append(i > 2 ? " " : "").Append(args[i].IndexOf(' ') >= 0 ? "\"" + args[i] + "\"" : args[i]);
        new Thread(() => XInputGuide.Run(() => !running && Program.PadCount() == 0)) { IsBackground = true }.Start();
        int nextScan = 0, quietUntil = 0;
        while (true)
        {
            if (!File.Exists(exe)) return 0; // PC4 was uninstalled or moved
            bool now = Running(exe);
            if (now != running) { running = now; wake = false; if (now) Program.Release(); }
            int t = Environment.TickCount;
            if (!running)
            {
                if (t - nextScan >= 0) { try { Program.Scan(); } catch { } nextScan = t + 2000; }
                if (wake && t - quietUntil >= 0)
                {
                    quietUntil = t + 15000; // PC4 takes a moment to appear: more presses meanwhile don't start it twice
                    try { Process.Start(new ProcessStartInfo(exe, rest.ToString()) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(exe) }); } catch { }
                }
                wake = false;
            }
            Thread.Sleep(running ? 2000 : 250);
        }
    }

    // PC4 itself, found by its exe path (while developing: that electron.exe)
    static bool Running(string exe)
    {
        foreach (var p in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(exe)))
        {
            try { if (string.Equals(p.MainModule.FileName, exe, StringComparison.OrdinalIgnoreCase)) return true; }
            catch { return true; } // can't look inside (elevated): assume it's PC4
            finally { p.Dispose(); }
        }
        return false;
    }
}
