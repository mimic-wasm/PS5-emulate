using System.Runtime.InteropServices;
using System.Text.Json;
using Nefarius.ViGEm.Client;
using Nefarius.ViGEm.Client.Targets;
using Nefarius.ViGEm.Client.Targets.DualShock4;

internal static class Program
{
    private const int WhKeyboardLl = 13;
    private const int WhMouseLl = 14;
    private const int WmKeyDown = 0x0100;
    private const int WmKeyUp = 0x0101;
    private const int WmSysKeyDown = 0x0104;
    private const int WmSysKeyUp = 0x0105;
    private const int WmMouseMove = 0x0200;
    private const int VkF1 = 0x70;
    private const int VkF8 = 0x77;
    private const int VkEscape = 0x1B;

    private static readonly object PadLock = new();
    private static readonly Dictionary<string, int> DefaultBindings = new()
    {
        ["moveUp"] = 0x57, ["moveLeft"] = 0x41, ["moveDown"] = 0x53, ["moveRight"] = 0x44,
        ["cross"] = 0x58, ["circle"] = 0x45, ["square"] = 0x52, ["triangle"] = 0x46,
        ["l1"] = 0x51, ["r1"] = 0x47, ["l2"] = 0x5A, ["r2"] = 0x43,
        ["options"] = VkEscape, ["share"] = 0x08, ["ps"] = 0x50, ["touchpad"] = 0x54,
        ["dpadUp"] = 0x26, ["dpadDown"] = 0x28, ["dpadLeft"] = 0x25, ["dpadRight"] = 0x27
    };

    private static Dictionary<string, int> KeyBindings = new(DefaultBindings);
    private static HashSet<int> MappedKeys = DefaultBindings.Values.ToHashSet();
    private static readonly HashSet<int> HeldKeys = new();
    private static IDualShock4Controller? pad;
    private static IntPtr keyboardHook;
    private static IntPtr mouseHook;
    private static HookProcedure? keyboardProcedure;
    private static HookProcedure? mouseProcedure;
    private static Timer? mouseResetTimer;
    private static volatile bool capturePaused;
    private static bool f1Held;
    private static bool hasMousePosition;
    private static int previousMouseX;
    private static int previousMouseY;
    private static string settingsFile = string.Empty;

    private delegate IntPtr HookProcedure(int code, IntPtr message, IntPtr data);

    [StructLayout(LayoutKind.Sequential)]
    private struct Point { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardData
    {
        public uint VirtualKey;
        public uint ScanCode;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseData
    {
        public Point Position;
        public uint MouseDataValue;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Message
    {
        public IntPtr Window;
        public uint Id;
        public UIntPtr WParam;
        public IntPtr LParam;
        public uint Time;
        public Point Position;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int hookType, HookProcedure callback, IntPtr module, uint threadId);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")]
    private static extern int GetMessage(out Message message, IntPtr window, uint minimum, uint maximum);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref Message message);
    [DllImport("user32.dll")]
    private static extern void PostQuitMessage(int exitCode);

    private static int Main(string[] args)
    {
        try
        {
            settingsFile = args.Length > 0 ? args[0] : string.Empty;
            LoadSettings();

            using var client = new ViGEmClient();
            pad = client.CreateDualShock4Controller();
            pad.Connect();
            ResetPad();

            mouseResetTimer = new Timer(_ =>
            {
                lock (PadLock)
                {
                    if (pad is null) return;
                    pad.SetAxisValue(DualShock4Axis.RightThumbX, 128);
                    pad.SetAxisValue(DualShock4Axis.RightThumbY, 128);
                }
            }, null, Timeout.Infinite, Timeout.Infinite);

            keyboardProcedure = KeyboardCallback;
            mouseProcedure = MouseCallback;
            keyboardHook = SetWindowsHookEx(WhKeyboardLl, keyboardProcedure, IntPtr.Zero, 0);
            if (keyboardHook == IntPtr.Zero)
                throw new InvalidOperationException("Could not install the keyboard hook. Windows error: " + Marshal.GetLastWin32Error());

            mouseHook = SetWindowsHookEx(WhMouseLl, mouseProcedure, IntPtr.Zero, 0);
            if (mouseHook == IntPtr.Zero)
                throw new InvalidOperationException("Could not install the mouse hook. Windows error: " + Marshal.GetLastWin32Error());

            var inputThread = new Thread(ReadCommands) { IsBackground = true };
            inputThread.Start();

            Console.WriteLine("READY");
            Console.Out.Flush();

            while (GetMessage(out var message, IntPtr.Zero, 0, 0) > 0)
            {
                TranslateMessage(ref message);
                DispatchMessage(ref message);
            }

            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("ERROR: " + error.Message);
            Console.Error.Flush();
            return 1;
        }
        finally
        {
            mouseResetTimer?.Dispose();
            if (keyboardHook != IntPtr.Zero) UnhookWindowsHookEx(keyboardHook);
            if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook);

            lock (PadLock)
            {
                try
                {
                    if (pad is not null)
                    {
                        pad.Disconnect();
                        pad.Dispose();
                    }
                }
                catch { }
                pad = null;
            }
        }
    }

    private static void ReadCommands()
    {
        string? line;
        while ((line = Console.ReadLine()) is not null)
        {
            switch (line.Trim().ToUpperInvariant())
            {
                case "PAUSE":
                    capturePaused = true;
                    ReleaseAllKeys();
                    break;
                case "RESUME":
                    capturePaused = false;
                    break;
                case "RELOAD":
                    LoadSettings();
                    break;
            }
        }
    }

    private static void LoadSettings()
    {
        var next = new Dictionary<string, int>(DefaultBindings);
        try
        {
            if (!string.IsNullOrWhiteSpace(settingsFile) && File.Exists(settingsFile))
            {
                using var document = JsonDocument.Parse(File.ReadAllText(settingsFile));
                if (document.RootElement.TryGetProperty("keyMappings", out var mappings) && mappings.ValueKind == JsonValueKind.Object)
                {
                    foreach (var property in mappings.EnumerateObject())
                    {
                        if (next.ContainsKey(property.Name) && property.Value.ValueKind == JsonValueKind.String)
                        {
                            int? key = ParseKey(property.Value.GetString() ?? string.Empty);
                            if (key.HasValue) next[property.Name] = key.Value;
                        }
                    }
                }
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("Settings reload: " + error.Message);
        }

        lock (PadLock)
        {
            KeyBindings = next;
            MappedKeys = next.Values.ToHashSet();
            MappedKeys.Add(VkEscape);
            MappedKeys.Add(VkF1);
            MappedKeys.Add(VkF8);
            UpdatePad();
        }
    }

    private static int? ParseKey(string code)
    {
        if (code.Length == 4 && code.StartsWith("Key", StringComparison.Ordinal) && code[3] >= 'A' && code[3] <= 'Z')
            return code[3];
        if (code.Length == 6 && code.StartsWith("Digit", StringComparison.Ordinal) && code[5] >= '0' && code[5] <= '9')
            return code[5];
        if (code.StartsWith("F", StringComparison.Ordinal) && int.TryParse(code[1..], out int functionKey) && functionKey >= 1 && functionKey <= 12)
            return 0x70 + functionKey;
        return code switch
        {
            "Escape" => 0x1B,
            "Backspace" => 0x08,
            "Tab" => 0x09,
            "Space" => 0x20,
            "Enter" => 0x0D,
            "ArrowLeft" => 0x25,
            "ArrowUp" => 0x26,
            "ArrowRight" => 0x27,
            "ArrowDown" => 0x28,
            "ShiftLeft" => 0xA0,
            "ShiftRight" => 0xA1,
            "ControlLeft" => 0xA2,
            "AltLeft" => 0xA4,
            _ => null
        };
    }

    private static IntPtr KeyboardCallback(int code, IntPtr message, IntPtr data)
    {
        if (code < 0) return CallNextHookEx(IntPtr.Zero, code, message, data);

        int eventType = message.ToInt32();
        bool pressed = eventType == WmKeyDown || eventType == WmSysKeyDown;
        bool released = eventType == WmKeyUp || eventType == WmSysKeyUp;
        if (!pressed && !released) return CallNextHookEx(IntPtr.Zero, code, message, data);

        var keyData = Marshal.PtrToStructure<KeyboardData>(data);
        int key = (int)keyData.VirtualKey;

        if (key == VkF8 && pressed)
        {
            PostQuitMessage(0);
            return new IntPtr(1);
        }

        if (key == VkF1)
        {
            f1Held = pressed;
            return CallNextHookEx(IntPtr.Zero, code, message, data);
        }

        if (key == VkEscape && pressed && f1Held)
        {
            capturePaused = true;
            ReleaseAllKeys();
            Console.WriteLine("SETTINGS");
            Console.Out.Flush();
            return new IntPtr(1);
        }

        if (capturePaused) return CallNextHookEx(IntPtr.Zero, code, message, data);
        if (!MappedKeys.Contains(key)) return CallNextHookEx(IntPtr.Zero, code, message, data);

        lock (PadLock)
        {
            if (pressed) HeldKeys.Add(key);
            if (released) HeldKeys.Remove(key);
            UpdatePad();
        }

        return new IntPtr(1);
    }

    private static IntPtr MouseCallback(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0 && !capturePaused && message.ToInt32() == WmMouseMove)
        {
            var mouse = Marshal.PtrToStructure<MouseData>(data);
            int x = mouse.Position.X;
            int y = mouse.Position.Y;

            if (hasMousePosition)
            {
                int deltaX = x - previousMouseX;
                int deltaY = y - previousMouseY;
                if (deltaX != 0 || deltaY != 0)
                {
                    lock (PadLock)
                    {
                        if (pad is not null)
                        {
                            pad.SetAxisValue(DualShock4Axis.RightThumbX, (byte)Math.Clamp(128 + deltaX * 16, 0, 255));
                            pad.SetAxisValue(DualShock4Axis.RightThumbY, (byte)Math.Clamp(128 + deltaY * 16, 0, 255));
                            mouseResetTimer?.Change(45, Timeout.Infinite);
                        }
                    }
                }
            }

            previousMouseX = x;
            previousMouseY = y;
            hasMousePosition = true;
        }

        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }

    private static void ReleaseAllKeys()
    {
        lock (PadLock)
        {
            HeldKeys.Clear();
            UpdatePad();
        }
    }

    private static void ResetPad()
    {
        if (pad is null) return;
        pad.SetAxisValue(DualShock4Axis.LeftThumbX, 128);
        pad.SetAxisValue(DualShock4Axis.LeftThumbY, 128);
        pad.SetAxisValue(DualShock4Axis.RightThumbX, 128);
        pad.SetAxisValue(DualShock4Axis.RightThumbY, 128);
        pad.SetSliderValue(DualShock4Slider.LeftTrigger, 0);
        pad.SetSliderValue(DualShock4Slider.RightTrigger, 0);
    }

    private static bool IsDown(string action) =>
        KeyBindings.TryGetValue(action, out int key) && HeldKeys.Contains(key);

    private static void UpdatePad()
    {
        if (pad is null) return;

        bool up = IsDown("moveUp");
        bool left = IsDown("moveLeft");
        bool down = IsDown("moveDown");
        bool right = IsDown("moveRight");

        int horizontal = (right ? 1 : 0) - (left ? 1 : 0);
        int vertical = (down ? 1 : 0) - (up ? 1 : 0);
        double diagonalScale = horizontal != 0 && vertical != 0 ? 0.7071 : 1.0;

        byte leftX = (byte)Math.Clamp(128 + (int)Math.Round(horizontal * 127 * diagonalScale), 0, 255);
        byte leftY = (byte)Math.Clamp(128 + (int)Math.Round(vertical * 127 * diagonalScale), 0, 255);

        pad.SetAxisValue(DualShock4Axis.LeftThumbX, leftX);
        pad.SetAxisValue(DualShock4Axis.LeftThumbY, leftY);
        pad.SetButtonState(DualShock4Button.Cross, IsDown("cross"));
        pad.SetButtonState(DualShock4Button.Circle, IsDown("circle"));
        pad.SetButtonState(DualShock4Button.Square, IsDown("square"));
        pad.SetButtonState(DualShock4Button.Triangle, IsDown("triangle"));
        pad.SetButtonState(DualShock4Button.ShoulderLeft, IsDown("l1"));
        pad.SetButtonState(DualShock4Button.ShoulderRight, IsDown("r1"));
        pad.SetSliderValue(DualShock4Slider.LeftTrigger, IsDown("l2") ? (byte)255 : (byte)0);
        pad.SetSliderValue(DualShock4Slider.RightTrigger, IsDown("r2") ? (byte)255 : (byte)0);
        pad.SetButtonState(DualShock4Button.Options, IsDown("options"));
        pad.SetButtonState(DualShock4Button.Share, IsDown("share"));
        pad.SetButtonState(DualShock4SpecialButton.Ps, IsDown("ps"));
        pad.SetButtonState(DualShock4SpecialButton.Touchpad, IsDown("touchpad"));

        bool dpadUp = IsDown("dpadUp");
        bool dpadDown = IsDown("dpadDown");
        bool dpadLeft = IsDown("dpadLeft");
        bool dpadRight = IsDown("dpadRight");

        DualShock4DPadDirection direction =
            dpadUp && dpadRight ? DualShock4DPadDirection.Northeast :
            dpadUp && dpadLeft ? DualShock4DPadDirection.Northwest :
            dpadDown && dpadRight ? DualShock4DPadDirection.Southeast :
            dpadDown && dpadLeft ? DualShock4DPadDirection.Southwest :
            dpadUp ? DualShock4DPadDirection.North :
            dpadDown ? DualShock4DPadDirection.South :
            dpadLeft ? DualShock4DPadDirection.West :
            dpadRight ? DualShock4DPadDirection.East :
            DualShock4DPadDirection.None;

        pad.SetDPadDirection(direction);
    }
}