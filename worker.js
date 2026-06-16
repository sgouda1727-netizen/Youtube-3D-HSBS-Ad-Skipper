let depthSession = null;
let isInferring = false;
const IN_DIM = 518;
const inputShape = [1, 3, IN_DIM, IN_DIM];

ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;

async function initONNX() {
    if (depthSession) return { success: true };
    try {
        const modelUrl = chrome.runtime.getURL('depth_model.onnx');
        // Explicitly map files to absolute chrome extension URLs
        ort.env.wasm.wasmPaths = {
            'ort-wasm.wasm': chrome.runtime.getURL('ort-wasm.wasm'),
            'ort-wasm-simd.wasm': chrome.runtime.getURL('ort-wasm-simd.wasm')
        };
        depthSession = await ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'] });
        return { success: true };
    } catch (e) {
        console.error("Iframe ONNX Error:", e);
        return { success: false, error: e.message || String(e) };
    }
}

window.addEventListener('message', async (event) => {
    const message = event.data;
    
    if (message.type === 'INIT_ONNX') {
        const result = await initONNX();
        event.source.postMessage({ 
            type: 'INIT_ONNX_RES', 
            success: result.success, 
            error: result.error 
        }, event.origin);
    }
    
    if (message.type === 'INFER') {
        if (!depthSession || isInferring) {
            return;
        }
        isInferring = true;
        try {
            const imgBuffer = message.imgData;
            const imgData = new Uint8ClampedArray(imgBuffer);
            const floatData = new Float32Array(3 * IN_DIM * IN_DIM);
            const mean = [0.485, 0.456, 0.406];
            const std = [0.229, 0.224, 0.225];
            for (let i = 0; i < IN_DIM * IN_DIM; i++) {
                floatData[i] = ((imgData[i*4] / 255.0) - mean[0]) / std[0]; 
                floatData[IN_DIM*IN_DIM + i] = ((imgData[i*4+1] / 255.0) - mean[1]) / std[1]; 
                floatData[2*IN_DIM*IN_DIM + i] = ((imgData[i*4+2] / 255.0) - mean[2]) / std[2]; 
            }

            const tensor = new ort.Tensor('float32', floatData, inputShape);
            const inputName = depthSession.inputNames[0];
            const results = await depthSession.run({ [inputName]: tensor });
            
            const depthOut = results[depthSession.outputNames[0]].data;
            let dMin = Infinity, dMax = -Infinity;
            for (let i = 0; i < depthOut.length; i++) {
                if (depthOut[i] < dMin) dMin = depthOut[i];
                if (depthOut[i] > dMax) dMax = depthOut[i];
            }
            
            let tempArray = new Uint8Array(IN_DIM * IN_DIM);
            for (let i = 0; i < depthOut.length; i++) {
                let norm = (depthOut[i] - dMin) / (dMax - dMin); 
                tempArray[i] = Math.max(0, Math.min(255, norm * 255));
            }
            
            event.source.postMessage({ type: 'INFER_RES', success: true, depthData: tempArray.buffer }, event.origin, [tempArray.buffer]);
        } catch (e) {
            console.error("Iframe inference error:", e);
            event.source.postMessage({ type: 'INFER_RES', success: false }, event.origin);
        }
        isInferring = false;
    }
});
