# Steam Web Browser Overlay

Windows Electron app that opens a browser panel (default: right 1/3 of screen) with a global shortcut you can map to a controller button.

## Features

- Toggle overlay with shortcut (default: `Ctrl+Alt+G`)
- Browser window pinned to right side of screen
- Remembers last visited URL
- Configurable default URL (e.g. IGN game guide)
- Simple settings window

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
- PS button -> `Ctrl+Alt+G`

Then pressing PS toggles this overlay.

## Build Windows installer

```bash
npm run build
```

Output will be in `dist/`.
