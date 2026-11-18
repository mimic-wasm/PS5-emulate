using System.Diagnostics;
using System.Runtime.InteropServices;
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
    private const int VkF8 = 0x77;

    private static readonly HashSet<int> HeldKeys = new();
    private static readonly object PadLock = new();
    private static readonly HashSet<int> MappedKeys = new()
    {
        0x57, 0x41, 0x53, 0x44,
        0x58, 0x45, 0x52, 0x46,
        0x51, 0x47, 0x5A, 0x43,
        0x09, 0x08, 0x50, 0x54,
        0x25, 0x26, 0x27, 0x28
    };

    private static IDualShock4Controller? pad;
    private static IntPtr keyboardHook;
    private static IntPtr mouseHook;
    private static HookProcedure? keyboardProcedure;
    private static HookProcedure? mouseProcedure;
    private static Timer? mouseResetTimer;
    private static bool hasMousePosition;
    private static int previousMouseX;
    private static int previousMouseY;

    private delegate IntPtr HookProcedure(int code, IntPtr message, IntPtr data);

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        public int X;
        public int Y;
    }

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

    [DllImport("user32.dll", SetLastError = true)]
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

    private static int Main()
    {
        try
        {
            using var client = new ViGEmClient();
            pad = client.CreateDualShock4Controller();
            pad.Connect();

            pad.SetAxisValue(DualShock4Axis.LeftThumbX, 128);
            pad.SetAxisValue(DualShock4Axis.LeftThumbY, 128);
            pad.SetAxisValue(DualShock4Axis.RightThumbX, 128);
            pad.SetAxisValue(DualShock4Axis.RightThumbY, 128);
            pad.SetSliderValue(DualShock4Slider.LeftTrigger, 0);
            pad.SetSliderValue(DualShock4Slider.RightTrigger, 0);

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

            Console.WriteLine("READY");

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
                catch
                {
                }

                pad = null;
            }
        }
    }

    private static IntPtr KeyboardCallback(int code, IntPtr message, IntPtr data)
    {
        if (code < 0) return CallNextHookEx(IntPtr.Zero, code, message, data);

        int eventType = message.ToInt32();
        bool pressed = eventType == WmKeyDown || eventType == WmSysKeyDown;
        bool released = eventType == WmKeyUp || eventType == WmSysKeyUp;

        if (!pressed && !released)
            return CallNextHookEx(IntPtr.Zero, code, message, data);

        var keyData = Marshal.PtrToStructure<KeyboardData>(data);
        int key = (int)keyData.VirtualKey;

        if (key == VkF8 && pressed)
        {
            PostQuitMessage(0);
            return new IntPtr(1);
        }

        if (!MappedKeys.Contains(key))
            return CallNextHookEx(IntPtr.Zero, code, message, data);

        lock (PadLock)
        {
            if (pressed) HeldKeys.Add(key);
            if (released) HeldKeys.Remove(key);
            UpdateKeyboardState();
        }

        return new IntPtr(1);
    }

    private static IntPtr MouseCallback(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0 && message.ToInt32() == WmMouseMove)
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
                            byte rightX = (byte)Math.Clamp(128 + deltaX * 4, 0, 255);
                            byte rightY = (byte)Math.Clamp(128 + deltaY * 4, 0, 255);
                            pad.SetAxisValue(DualShock4Axis.RightThumbX, rightX);
                            pad.SetAxisValue(DualShock4Axis.RightThumbY, rightY);
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

    private static void UpdateKeyboardState()
    {
        if (pad is null) return;

        bool up = HeldKeys.Contains(0x57);
        bool left = HeldKeys.Contains(0x41);
        bool down = HeldKeys.Contains(0x53);
        bool right = HeldKeys.Contains(0x44);

        int horizontal = (right ? 1 : 0) - (left ? 1 : 0);
        int vertical = (down ? 1 : 0) - (up ? 1 : 0);
        double diagonalScale = horizontal != 0 && vertical != 0 ? 0.7071 : 1.0;

        byte leftX = (byte)Math.Clamp(128 + (int)Math.Round(horizontal * 127 * diagonalScale), 0, 255);
        byte leftY = (byte)Math.Clamp(128 + (int)Math.Round(vertical * 127 * diagonalScale), 0, 255);

        pad.SetAxisValue(DualShock4Axis.LeftThumbX, leftX);
        pad.SetAxisValue(DualShock4Axis.LeftThumbY, leftY);

        pad.SetButtonState(DualShock4Button.Cross, HeldKeys.Contains(0x58));
        pad.SetButtonState(DualShock4Button.Circle, HeldKeys.Contains(0x45));
        pad.SetButtonState(DualShock4Button.Square, HeldKeys.Contains(0x52));
        pad.SetButtonState(DualShock4Button.Triangle, HeldKeys.Contains(0x46));
        pad.SetButtonState(DualShock4Button.ShoulderLeft, HeldKeys.Contains(0x51));
        pad.SetButtonState(DualShock4Button.ShoulderRight, HeldKeys.Contains(0x47));
        pad.SetSliderValue(DualShock4Slider.LeftTrigger, HeldKeys.Contains(0x5A) ? (byte)255 : (byte)0);
        pad.SetSliderValue(DualShock4Slider.RightTrigger, HeldKeys.Contains(0x43) ? (byte)255 : (byte)0);
        pad.SetButtonState(DualShock4Button.Options, HeldKeys.Contains(0x09));
        pad.SetButtonState(DualShock4Button.Share, HeldKeys.Contains(0x08));
        pad.SetButtonState(DualShock4SpecialButton.Ps, HeldKeys.Contains(0x50));
        pad.SetButtonState(DualShock4SpecialButton.Touchpad, HeldKeys.Contains(0x54));

        bool dpadUp = HeldKeys.Contains(0x26);
        bool dpadDown = HeldKeys.Contains(0x28);
        bool dpadLeft = HeldKeys.Contains(0x25);
        bool dpadRight = HeldKeys.Contains(0x27);

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
