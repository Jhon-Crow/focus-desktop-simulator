# Focus Desktop Simulator

A high-performance desktop simulator - a focus tool for Windows with an isometric 3D desk and interactive objects.

![Focus Desktop Simulator](https://img.shields.io/badge/Platform-Windows-blue) ![License](https://img.shields.io/badge/License-Unlicense-green)

## Features

- **Isometric 3D Desk View**: Beautiful rendered desk with realistic lighting and shadows
- **Drag & Drop Objects**: Move objects around your virtual desk - objects lift when dragged and settle when dropped
- **Preset Object Library**: Choose from various desk accessories:
  - Clock (shows real time with animated hands)
  - Desk Lamp (with glowing light effect)
  - Potted Plant
  - Coffee Mug
  - Laptop (with glowing screen)
  - Notebook
  - Pen Holder
  - Books
  - Photo Frame
  - Globe (animated rotation)
  - Trophy
  - Hourglass
- **Object Customization**: Right-click any object to customize:
  - Main color
  - Accent color
  - Delete objects
- **State Persistence**: Your desk layout is automatically saved and restored
- **Real-time Clock Display**: Shows current time in the corner

## Installation

### From Release

1. Download the latest `.exe` installer from the [Releases](https://github.com/Jhon-Crow/focus-desktop-simulator/releases) page
2. Run the installer
3. Launch "Focus Desktop Simulator" from your Start menu

### From Source

```bash
# Clone the repository
git clone https://github.com/Jhon-Crow/focus-desktop-simulator.git
cd focus-desktop-simulator

# Install dependencies
npm install

# Run in development mode
npm start

# Build Windows executable
npm run build
```

## Usage

1. **Add Objects**: Click the menu button (top-left) to open the object preset panel
2. **Move Objects**: Click and drag objects to reposition them on the desk
3. **Customize Objects**: Right-click on any object to open the customization panel
4. **Delete Objects**: Right-click an object and click "Delete Object"

## Tech Stack

- **Electron**: Cross-platform desktop application framework
- **Three.js**: 3D graphics library for WebGL rendering
- **electron-builder**: Packaging and building for Windows

## Development

```bash
# Run with DevTools
npm run dev

# Build directory only (no installer)
npm run build:dir
```

## Inspiration

Inspired by [gogh: Focus with Your Avatar](https://store.steampowered.com/app/3213850/gogh_Focus_with_Your_Avatar/) - but focusing on just the desk experience without the avatar.

## License

This project is released into the public domain under the [Unlicense](LICENSE).
