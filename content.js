// --- AUTO AD SKIPPER ---
function skipAds() {
    const skipButtons = document.querySelectorAll('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button');
    if (skipButtons && skipButtons.length > 0) {
        skipButtons.forEach(button => {
            if (button && button.click) button.click();
        });
    }

    const adOverlay = document.querySelector('.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout');
    if (adOverlay) {
        document.querySelectorAll('video').forEach(video => {
            if (video && !isNaN(video.duration)) video.playbackRate = 16; 
        });
    }
}
setInterval(skipAds, 500);

// --- 3D ENGINE STATE ---
let is3DEnabled = false;
let isInferring = false;
let glContext = null;
let glCanvas = null;
let animationId = null;
let rVfcCallbackId = null;
let shaderProgram = null;
let videoTexture = null;
let depthTexture = null;
let lastInferenceTime = 0;
let onnxTimeoutId = null;

let IN_DIM = 518; 
let offscreenCanvas = document.createElement('canvas');
let offscreenCtx = offscreenCanvas.getContext('2d', {willReadFrequently: true});
offscreenCanvas.width = IN_DIM;
offscreenCanvas.height = IN_DIM;

let latestDepthData = new Uint8Array(IN_DIM * IN_DIM);

// --- INJECT IFRAME WORKER ---
let aiIframe = document.createElement('iframe');
aiIframe.style.display = 'none';
aiIframe.src = chrome.runtime.getURL('ai_worker.html');
document.documentElement.appendChild(aiIframe); // Append to root so it persists

let initResolve = null;
window.addEventListener('message', (event) => {
    if (event.data.type === 'INIT_ONNX_RES') {
        if (initResolve) {
            if (event.data.success && event.data.inDim) {
                IN_DIM = event.data.inDim;
                // Re-initialize offscreen canvas and arrays with correct dimensions
                offscreenCanvas.width = IN_DIM;
                offscreenCanvas.height = IN_DIM;
                offscreenCtx = offscreenCanvas.getContext('2d', {willReadFrequently: true});
                latestDepthData = new Uint8Array(IN_DIM * IN_DIM);
            }
            initResolve(event.data);
        }
    }
    if (event.data.type === 'INFER_RES') {
        if (event.data.success && event.data.depthData) {
            latestDepthData.set(new Uint8Array(event.data.depthData));
            const video = document.querySelector('video');
            if (video && video.paused) {
                drawWebGLFrame();
            }
        }
        isInferring = false;
        if (is3DEnabled) {
            // Inference chaining: request next frame immediately
            requestAnimationFrame(runONNXLoop);
        }
    }
});

async function initONNX() {
    document.getElementById('yt-ctrl-3d-toggle').innerText = 'Loading AI Model (Please wait...)';
    return new Promise(resolve => {
        initResolve = (res) => {
            if (res.success) {
                document.getElementById('yt-ctrl-3d-toggle').innerText = 'Disable 3D HSBS';
                resolve(true);
            } else {
                alert("Failed to load 3D Depth Model in isolated worker!\n\nError details: " + (res.error || "Unknown error"));
                document.getElementById('yt-ctrl-3d-toggle').innerText = 'Enable 3D HSBS (Failed)';
                resolve(false);
            }
        };
        aiIframe.contentWindow.postMessage({ type: 'INIT_ONNX' }, '*');
    });
}

function initWebGL(video) {
    if (glCanvas) return;
    
    glCanvas = document.createElement('canvas');
    Object.assign(glCanvas.style, {
        position: 'absolute',
        top: '0', left: '0', width: '100%', height: '100%',
        zIndex: '900', // high enough to be over black background but under youtube UI
        pointerEvents: 'none' 
    });
    
    // Mount it into the main player container so it's guaranteed visible
    const player = document.querySelector('.html5-video-player');
    if (player) {
        player.appendChild(glCanvas);
    } else {
        video.parentNode.insertBefore(glCanvas, video.nextSibling);
    }
    
    const gl = glCanvas.getContext('webgl') || glCanvas.getContext('experimental-webgl');
    if (!gl) {
        alert("Your browser does not support WebGL, cannot render 3D.");
        return;
    }
    glContext = gl;

    const vsSource = `
        attribute vec4 aVertexPosition;
        attribute vec2 aTextureCoord;
        varying vec2 vTextureCoord;
        void main() {
            gl_Position = aVertexPosition;
            vTextureCoord = aTextureCoord;
        }
    `;

    const fsSource = `
        precision mediump float;
        varying vec2 vTextureCoord;
        uniform sampler2D uSamplerVideo;
        uniform sampler2D uSamplerDepth;
        uniform float uDepthAmount;
        uniform float uFocus;
        uniform float uInvertDepth;

        void main() {
            vec2 uv = vTextureCoord;
            
            bool isRightEye = uv.x > 0.5;
            vec2 sourceUV = vec2(uv.x * 2.0, uv.y);
            if (isRightEye) {
                sourceUV.x = (uv.x - 0.5) * 2.0;
            }

            float depthVal = texture2D(uSamplerDepth, sourceUV).r;
            if (uInvertDepth > 0.5) {
                depthVal = 1.0 - depthVal;
            }
            float max_shift = 0.04 * (uDepthAmount / 100.0);
            float disparity = (depthVal - (uFocus / 255.0)) * max_shift;
            
            vec2 shiftedUV = sourceUV;
            if (isRightEye) {
                shiftedUV.x += disparity * 0.5;
            } else {
                shiftedUV.x -= disparity * 0.5;
            }

            shiftedUV.x = clamp(shiftedUV.x, 0.0, 1.0);
            
            vec4 vidColor = texture2D(uSamplerVideo, shiftedUV);
            gl_FragColor = vec4(vidColor.rgb, 1.0); // Force opaque
        }
    `;

    function compileShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader error:', gl.getShaderInfoLog(shader));
        }
        return shader;
    }

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);

    shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    const positions = new Float32Array([
        -1.0, -1.0,  1.0, -1.0,  -1.0,  1.0,
        -1.0,  1.0,  1.0, -1.0,   1.0,  1.0,
    ]);
    const texCoords = new Float32Array([
        0.0, 1.0,  1.0, 1.0,  0.0, 0.0,
        0.0, 0.0,  1.0, 1.0,  1.0, 0.0,
    ]);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

    const vertexPosition = gl.getAttribLocation(shaderProgram, 'aVertexPosition');
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(vertexPosition, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vertexPosition);

    const textureCoord = gl.getAttribLocation(shaderProgram, 'aTextureCoord');
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.vertexAttribPointer(textureCoord, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(textureCoord);

    videoTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    depthTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

// ASYNC BACKGROUND AI LOOP
function runONNXLoop() {
    if (!is3DEnabled) return;
    
    // Clear any pending timeout to prevent duplicate loops
    if (onnxTimeoutId) {
        clearTimeout(onnxTimeoutId);
        onnxTimeoutId = null;
    }
    
    const video = document.querySelector('video');
    if (!video) {
        onnxTimeoutId = setTimeout(runONNXLoop, 150);
        return;
    }

    // Check watchdog: reset inference lock if it has hung for more than 1.5 seconds
    if (isInferring && Date.now() - lastInferenceTime > 1500) {
        console.warn("ONNX Inference watchdog triggered. Resetting lock.");
        isInferring = false;
    }

    if (!isInferring && video.readyState >= 2 && !video.paused) {
        isInferring = true;
        lastInferenceTime = Date.now();
        try {
            offscreenCtx.drawImage(video, 0, 0, IN_DIM, IN_DIM);
            const imgData = offscreenCtx.getImageData(0, 0, IN_DIM, IN_DIM).data;

            // Send to Iframe Worker to prevent freezing the video player!
            // Transfer the buffer for zero-copy performance (removes serialization lag)
            const buffer = imgData.buffer;
            aiIframe.contentWindow.postMessage({
                type: 'INFER', 
                imgData: buffer 
            }, '*', [buffer]);

        } catch (e) {
            console.error("AI Comm Error:", e);
            if (e.name === 'SecurityError') {
                alert("CRITICAL ERROR: YouTube's anti-piracy security (CORS) is blocking the AI from reading the video pixels! The video will remain black.");
                toggle3D();
                return;
            }
            isInferring = false;
        }
    }
    
    // Schedule check-in / fallback interval
    onnxTimeoutId = setTimeout(runONNXLoop, 150);
}

// DRAW A SINGLE WEBGL FRAME
function drawWebGLFrame() {
    if (!is3DEnabled) return;
    
    const video = document.querySelector('video');
    if (!video || !glContext) return;

    if (glCanvas.width !== video.videoWidth && video.videoWidth > 0) {
        glCanvas.width = video.videoWidth;
        glCanvas.height = video.videoHeight;
    }

    try {
        const gl = glContext;
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        gl.useProgram(shaderProgram);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, videoTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        gl.uniform1i(gl.getUniformLocation(shaderProgram, 'uSamplerVideo'), 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, depthTexture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, IN_DIM, IN_DIM, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, latestDepthData);
        gl.uniform1i(gl.getUniformLocation(shaderProgram, 'uSamplerDepth'), 1);

        const depthEl = document.getElementById('yt-ctrl-depth');
        const focusEl = document.getElementById('yt-ctrl-focus');
        const invertDepthEl = document.getElementById('yt-ctrl-invert-depth');
        
        const depthAmt = depthEl ? parseFloat(depthEl.value) : 50.0;
        const focusAmt = focusEl ? parseFloat(focusEl.value) : 128.0;
        const invertDepthVal = (invertDepthEl && invertDepthEl.checked) ? 1.0 : 0.0;
        
        gl.uniform1f(gl.getUniformLocation(shaderProgram, 'uDepthAmount'), depthAmt);
        gl.uniform1f(gl.getUniformLocation(shaderProgram, 'uFocus'), focusAmt);
        gl.uniform1f(gl.getUniformLocation(shaderProgram, 'uInvertDepth'), invertDepthVal);

        gl.drawArrays(gl.TRIANGLES, 0, 6);

    } catch (e) {
        console.error("WebGL Draw Error:", e);
    }
}

// START/STOP WEBGL RENDER LOOP (Synchronized with compositor via rVFC)
function startRenderLoop(video) {
    stopRenderLoop(video);
    
    if (video.requestVideoFrameCallback) {
        const renderCallback = (now, metadata) => {
            if (!is3DEnabled) return;
            drawWebGLFrame();
            rVfcCallbackId = video.requestVideoFrameCallback(renderCallback);
        };
        rVfcCallbackId = video.requestVideoFrameCallback(renderCallback);
    } else {
        const renderFallbackLoop = () => {
            if (!is3DEnabled) return;
            drawWebGLFrame();
            animationId = requestAnimationFrame(renderFallbackLoop);
        };
        animationId = requestAnimationFrame(renderFallbackLoop);
    }
}

function stopRenderLoop(video) {
    if (rVfcCallbackId !== null) {
        const vid = video || document.querySelector('video');
        if (vid && vid.cancelVideoFrameCallback) {
            vid.cancelVideoFrameCallback(rVfcCallbackId);
        }
        rVfcCallbackId = null;
    }
    if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
}

function toggle3D() {
    const video = document.querySelector('video');
    if (!video) return;

    is3DEnabled = !is3DEnabled;
    const btn = document.getElementById('yt-ctrl-3d-toggle');
    
    if (is3DEnabled) {
        btn.innerText = 'Starting 3D...';
        btn.style.background = '#aa5500';
        video.style.opacity = '0'; 
        
        initWebGL(video);
        
        // Draw the first frame immediately
        drawWebGLFrame();

        // Start WebGL render loop synchronized with browser composition
        startRenderLoop(video);

        // Start ONNX asynchronously
        initONNX().then(success => {
            if (success) {
                runONNXLoop();
            } else {
                toggle3D(); 
            }
        });
    } else {
        btn.innerText = 'Enable 3D HSBS';
        btn.style.background = '#444';
        video.style.opacity = '1'; 
        if (glCanvas) {
            glCanvas.remove();
            glCanvas = null;
        }
        stopRenderLoop(video);
        
        if (onnxTimeoutId) {
            clearTimeout(onnxTimeoutId);
            onnxTimeoutId = null;
        }
    }
}


// --- CONTROL PANEL UI ---
function injectControlPanel() {
    if (document.getElementById('yt-custom-control-panel')) return;

    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'yt-custom-toggle-btn';
    toggleBtn.innerText = '⚙️ Media Controls';
    Object.assign(toggleBtn.style, {
        position: 'fixed', bottom: '20px', right: '20px', zIndex: '999999',
        padding: '10px 15px', background: '#ff0000', color: '#fff', border: 'none',
        borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px'
    });

    const panel = document.createElement('div');
    panel.id = 'yt-custom-control-panel';
    Object.assign(panel.style, {
        position: 'fixed', bottom: '70px', right: '20px', zIndex: '999999',
        background: 'rgba(25, 25, 25, 0.95)', color: '#fff', padding: '15px',
        borderRadius: '8px', border: '1px solid #444', width: '250px', display: 'none',
        fontFamily: 'Roboto, Arial, sans-serif'
    });

    panel.innerHTML = `
        <h3 style="margin-top:0; margin-bottom:15px; border-bottom:1px solid #444; padding-bottom:5px; font-size:16px;">MEDIA S CONTROLS</h3>
        
        <button id="yt-ctrl-3d-toggle" style="width:100%; padding:8px; background:#444; color:#fff; border:none; border-radius:4px; cursor:pointer; margin-bottom:15px; font-weight:bold;">Enable 3D HSBS</button>

        <div style="margin-bottom: 10px;">
            <label style="display:block; font-size:12px; margin-bottom:3px;">Depth Amount (3D): <span id="yt-val-depth" style="font-weight:bold; color:#ff5627;">50</span></label>
            <input type="range" id="yt-ctrl-depth" min="0" max="100" step="1" value="50" style="width:100%;">
        </div>

        <div style="margin-bottom: 10px;">
            <label style="display:block; font-size:12px; margin-bottom:3px;">Focus / Convergence (3D): <span id="yt-val-focus" style="font-weight:bold; color:#ff5627;">128</span></label>
            <input type="range" id="yt-ctrl-focus" min="0" max="255" step="1" value="128" style="width:100%;">
        </div>

        <div style="margin-bottom: 15px; display: flex; align-items: center;">
            <input type="checkbox" id="yt-ctrl-invert-depth" style="margin-right: 8px; cursor: pointer;">
            <label for="yt-ctrl-invert-depth" style="font-size:12px; cursor: pointer; user-select: none;">Invert Depth Map</label>
        </div>
        <hr style="border: 0; border-top: 1px solid #444; margin-bottom: 15px;">

        <div style="margin-bottom: 10px;">
            <label style="display:block; font-size:12px; margin-bottom:3px;">Zoom X (Width): <span id="yt-val-zoom-x" style="font-weight:bold; color:#ff5627;">1.00</span></label>
            <input type="range" id="yt-ctrl-zoom-x" min="0.5" max="3" step="0.05" value="1" style="width:100%;">
        </div>

        <div style="margin-bottom: 10px;">
            <label style="display:block; font-size:12px; margin-bottom:3px;">Zoom Y (Height): <span id="yt-val-zoom-y" style="font-weight:bold; color:#ff5627;">1.00</span></label>
            <input type="range" id="yt-ctrl-zoom-y" min="0.5" max="3" step="0.05" value="1" style="width:100%;">
        </div>
        
        <div style="margin-bottom: 10px;">
            <label style="display:block; font-size:12px; margin-bottom:3px;">Brightness: <span id="yt-val-brightness" style="font-weight:bold; color:#ff5627;">1.00</span></label>
            <input type="range" id="yt-ctrl-brightness" min="0" max="2" step="0.05" value="1" style="width:100%;">
        </div>
        
        <div style="margin-bottom: 10px;">
            <label style="display:block; font-size:12px; margin-bottom:3px;">Contrast: <span id="yt-val-contrast" style="font-weight:bold; color:#ff5627;">1.00</span></label>
            <input type="range" id="yt-ctrl-contrast" min="0" max="3" step="0.05" value="1" style="width:100%;">
        </div>

        <div style="margin-bottom: 15px;">
            <label style="display:block; font-size:12px; margin-bottom:3px;">Saturation: <span id="yt-val-saturation" style="font-weight:bold; color:#ff5627;">1.00</span></label>
            <input type="range" id="yt-ctrl-saturation" min="0" max="3" step="0.05" value="1" style="width:100%;">
        </div>
        
        <button id="yt-ctrl-reset" style="width:100%; padding:8px; background:#444; color:#fff; border:none; border-radius:4px; cursor:pointer;">Reset 2D Controls</button>
    `;

    document.body.appendChild(toggleBtn);
    document.body.appendChild(panel);

    toggleBtn.addEventListener('click', () => {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    document.getElementById('yt-ctrl-3d-toggle').addEventListener('click', toggle3D);

    const depthSlider = document.getElementById('yt-ctrl-depth');
    const depthValSpan = document.getElementById('yt-val-depth');
    depthSlider.addEventListener('input', () => {
        depthValSpan.innerText = depthSlider.value;
        drawWebGLFrame();
    });

    const focusSlider = document.getElementById('yt-ctrl-focus');
    const focusValSpan = document.getElementById('yt-val-focus');
    focusSlider.addEventListener('input', () => {
        focusValSpan.innerText = focusSlider.value;
        drawWebGLFrame();
    });

    const invertDepthEl = document.getElementById('yt-ctrl-invert-depth');
    if (invertDepthEl) {
        invertDepthEl.addEventListener('change', () => {
            drawWebGLFrame();
        });
    }

    const zoomXSlider = document.getElementById('yt-ctrl-zoom-x');
    const zoomYSlider = document.getElementById('yt-ctrl-zoom-y');
    const brightnessSlider = document.getElementById('yt-ctrl-brightness');
    const contrastSlider = document.getElementById('yt-ctrl-contrast');
    const saturationSlider = document.getElementById('yt-ctrl-saturation');
    
    function applyFilters() {
        const video = document.querySelector('video');
        if (!video) return;
        video.style.transform = `scaleX(${zoomXSlider.value}) scaleY(${zoomYSlider.value})`;
        video.style.transformOrigin = 'center center';
        video.style.filter = `brightness(${brightnessSlider.value}) contrast(${contrastSlider.value}) saturate(${saturationSlider.value})`;
        
        if (typeof glCanvas !== 'undefined' && glCanvas) {
            glCanvas.style.transform = `scaleX(${zoomXSlider.value}) scaleY(${zoomYSlider.value})`;
            glCanvas.style.transformOrigin = 'center center';
            glCanvas.style.filter = `brightness(${brightnessSlider.value}) contrast(${contrastSlider.value}) saturate(${saturationSlider.value})`;
        }

        // Update labels
        document.getElementById('yt-val-zoom-x').innerText = parseFloat(zoomXSlider.value).toFixed(2);
        document.getElementById('yt-val-zoom-y').innerText = parseFloat(zoomYSlider.value).toFixed(2);
        document.getElementById('yt-val-brightness').innerText = parseFloat(brightnessSlider.value).toFixed(2);
        document.getElementById('yt-val-contrast').innerText = parseFloat(contrastSlider.value).toFixed(2);
        document.getElementById('yt-val-saturation').innerText = parseFloat(saturationSlider.value).toFixed(2);
    }

    [zoomXSlider, zoomYSlider, brightnessSlider, contrastSlider, saturationSlider].forEach(el => el.addEventListener('input', applyFilters));

    document.getElementById('yt-ctrl-reset').addEventListener('click', () => {
        zoomXSlider.value = 1; zoomYSlider.value = 1;
        brightnessSlider.value = 1; contrastSlider.value = 1; saturationSlider.value = 1;
        applyFilters();
    });

    setInterval(applyFilters, 2000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectControlPanel);
} else {
    injectControlPanel();
}
