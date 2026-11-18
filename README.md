# PS5-emulate

A Windows desktop launcher for the official PlayStation and Xbox Remote Play experiences. It also includes an experimental keyboard-and-mouse to virtual DualShock 4 bridge for PS Remote Play.

This does not emulate PS5 or Xbox hardware. Your console runs the game and streams it to your PC.

## Requirements

- Windows 10/11 x64
- Node.js LTS
- .NET 10 SDK
- ViGEmBus virtual gamepad driver

## Run

1. Install Node.js and the .NET 10 SDK.
2. Install ViGEmBus from the official [ViGEmBus releases](https://github.com/nefarius/ViGEmBus/releases/latest).
3. Restart Windows if the driver installer requests it.
4. Open a terminal in this folder.
5. Run `npm install`.
6. Run `npm start`. This builds the native input bridge and opens the Electron app.

To build only the native bridge, run `npm run build:bridge`.

## Keyboard and mouse mapping

Open **Keyboard controls** in the app and press **Start mapping**. Switch to PS Remote Play after the status says the virtual controller is connected. Press **F8** to stop the bridge immediately.

| Input | Virtual controller |
|---|---|
| WASD | Left analog stick |
| Mouse movement | Right analog stick |
| X / E / R / F | Cross / Circle / Square / Triangle |
| Q / G | L1 / R1 |
| Z / C | L2 / R2 |
| Arrow keys | D-pad |
| Tab / Backspace | Options / Share |
| P / T | PS / Touchpad |

Mapped keyboard keys are intercepted while the bridge is running. Mouse movement is read globally for right-stick input.

## Compatibility limitations

The bridge uses ViGEmBus and creates a virtual **DualShock 4**, not a DualSense. Sony's Windows Remote Play app supports DUALSHOCK 4, DualSense, and DualSense Edge controllers, but individual PS5 games may require DualSense-specific input or reject a virtual DS4. This prototype is not guaranteed to work with every PS5 game.

ViGEmBus and its .NET client were archived and retired by their maintainers in 2023. They no longer receive updates. The project uses the published NuGet client and official archived driver releases. Install drivers only from the official project release page.

## PlayStation and Xbox

- Install the official [PS Remote Play app](https://remoteplay.dl.playstation.net/remoteplay/).
- For Xbox, enable Remote Features on your console and open [Xbox Remote Play](https://www.xbox.com/remoteplay).

This project does not copy game files, modify console firmware, store account passwords, or bypass platform protections. It is independent and is not affiliated with Sony or Microsoft.
