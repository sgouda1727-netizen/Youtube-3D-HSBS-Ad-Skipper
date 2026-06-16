# YouTube Ad Skipper & Real-Time 3D HSBS Converter

A Chrome Extension that automatically skips YouTube ads and provides a real-time, WebGL-powered 3D Half Side-by-Side (HSBS) converter for standard videos using an on-device depth estimation AI model.

---

## Features

- **Auto Ad Skipping**: Automatically clicks skip buttons and speeds up unskippable ad overlays.
- **Real-Time 3D Conversion**: Converts standard 2D YouTube videos to 3D HSBS format directly on the fly.
- **On-Device Depth Estimation AI**: Runs a local, CPU-based ONNX model inside an isolated extension context without uploading frames or violating your privacy.
- **Interactive Control Panel**:
  - **Depth Amount**: Customize stereoscopic separation strength.
  - **Focus / Convergence**: Change the convergence point (how objects pop in/out of the screen).
  - **Invert Depth Map**: Swap background and foreground depth mapping instantly.
  - **2D Image Adjustment**: Zoom X/Y, Brightness, Contrast, and Saturation settings.
- **Optimized & Zero-Tearing rendering**:
  - Uses `requestVideoFrameCallback` to synchronize WebGL draws with the browser's video compositor frames.
  - Passes image buffers using zero-copy Transferables to prevent memory allocations and lags.
  - Safe Watchdog logic that recovers if the model background thread stalls.

---

## Installation & Setup

### Step 1: Clone or Download the repository
Download this repository as a ZIP or clone it:
```bash
git clone https://github.com/your-username/Youtube-3D-HSBS-Ad-Skipper.git
```

### Step 2: Fetch ONNX Runtime WASM Dependencies
Chrome extensions cannot download dynamic scripts or large WebAssembly files at runtime due to security/CSP restrictions.
1. Open the project folder on your system.
2. Double-click the file named **`setup_3d.bat`**.
   *(This downloads `onnxruntime-web` WASM components and places the AI model inside the folder. Ensure you have python installed).*

### Step 3: Install the Extension in Google Chrome
1. Open Google Chrome.
2. Navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** in the top-left corner.
5. Select the folder containing these files.

---

## How to Use

1. Open any YouTube video.
2. Look for the floating **⚙️ Media Controls** button in the bottom right corner of your browser.
3. Click it and click **Enable 3D HSBS**.
4. Slip on your 3D glasses, stereoscopic viewer, or VR headset and adjust the sliders to tune the depth and convergence!

---

## Tech Stack
- **Extension Core**: Chrome MV3 Content Script / Service Worker
- **Inference Engine**: ONNX Runtime Web v1.16.3 (WASM CPU Threaded SIMD Backend)
- **Shader Pipeline**: WebGL 1.0 (parallax offset mapping fragment shader)
