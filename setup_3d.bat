@echo off
echo Downloading ONNX Web Engine (v1.16.3)...
"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -Command "Invoke-WebRequest -Uri 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.16.3/dist/ort.min.js' -OutFile 'ort.min.js'"
echo.
echo Downloading WASM engines...
"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -Command "Invoke-WebRequest -Uri 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.16.3/dist/ort-wasm.wasm' -OutFile 'ort-wasm.wasm'"
"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -Command "Invoke-WebRequest -Uri 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.16.3/dist/ort-wasm-simd.wasm' -OutFile 'ort-wasm-simd.wasm'"
echo.
echo Setup complete! Run setup_3d.py to copy the depth model if you haven't already.
pause
