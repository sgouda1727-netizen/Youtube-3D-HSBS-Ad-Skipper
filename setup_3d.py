import os
import urllib.request
import shutil

ext_dir = r"C:\Users\I LOVE U BABY\.gemini\antigravity\scratch\YoutubeAdSkipper"
satya_dir = r"D:\SATYA3DMAKER"

urls = {
    "ort.min.js": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.16.3/dist/ort.min.js",
    "ort-wasm.wasm": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.16.3/dist/ort-wasm.wasm",
    "ort-wasm-simd.wasm": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.16.3/dist/ort-wasm-simd.wasm"
}

for name, url in urls.items():
    dest = os.path.join(ext_dir, name)
    if not os.path.exists(dest):
        print(f"Downloading {name}...")
        try:
            urllib.request.urlretrieve(url, dest)
        except Exception as e:
            print(f"Failed to download {name}: {e}")

print("\nSearching for small depth model...")
found = False
for root, dirs, files in os.walk(satya_dir):
    for file in files:
        if file.endswith(".onnx") and "small" in file.lower():
            src = os.path.join(root, file)
            dest = os.path.join(ext_dir, "depth_model.onnx")
            print(f"Found model: {file}")
            print(f"Copying {file} to extension...")
            shutil.copy(src, dest)
            found = True
            break
    if found:
        break

if not found:
    print("WARNING: Could not find a 'small' .onnx model in D:\\SATYA3DMAKER")
else:
    print("Setup complete! You can close this window.")
