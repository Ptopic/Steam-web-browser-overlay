# Steam Web Browser Overlay

Windows Electron app that opens a browser panel (default: right 1/3 of screen) with a global shortcut you can map to a controller button.

## Features

- Toggle overlay with shortcut (default: `F9`)
- Fullscreen dark backdrop + browser panel on the right side
- Remembers last visited URL
- Configurable default URL (e.g. IGN game guide)
- Simple settings window
- Minimize-to-tray behavior when settings window is closed
- Tray click reopens settings; tray menu includes Toggle Overlay + Quit
- Basic controller navigation inside web pages (virtual cursor + click + scroll)

## Setup

```bash
npm install
npm run start
```

## Open settings

```bash
npm run settings
```

In settings you can set:
- Default URL
- Toggle shortcut
- Width ratio (0.333 = one third)

## Controller mapping (PS button)

Map your PS button to the same shortcut used by this app.

Options:
- DS4Windows
- Steam Input chord mapping

Example mapping:
- PS button -> `F9`

Then pressing PS toggles this overlay.

## Controller controls in overlay

- Left stick: move virtual cursor
- Cross / A: click
- Right stick (vertical): smooth scroll
- D-pad up/down: step scroll
- Circle / B: browser back
- Square / X: browser forward
- Triangle / Y: fast scroll up
- L1 / R1: previous/next focusable element
- R3 (right stick click): toggle true mouse lock mode (center crosshair)
- Options/Start, PS/Home (when exposed), Touchpad press, or Share/Create: close/toggle overlay
- Emergency close combo: L3 + R3 together

In mouse lock mode, cursor is hidden, crosshair stays centered, and sticks scroll the page while Cross/A clicks the centered element.

## Build Windows installer

```bash
npm run build
```

Output will be in `dist/`.
