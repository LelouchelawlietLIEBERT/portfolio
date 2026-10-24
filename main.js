/* =========================================================================
   CINEMATIC BEYOND ENGINE — CORE CONTROLLER
   ========================================================================= */

// Configuration Constants
const TOTAL_FRAMES = 240;
const SINGULARITY_FRAME = 180; // Singularity transition occurs at frame 180 (scroll 75%)
const IMAGES_DIR = './public/frames/';
const FRAME_PREFIX = 'ezgif-frame-';
const FRAME_EXTENSION = '.jpg';
const FRAME_PAD_LENGTH = 3; // Assets are ezgif-frame-001.jpg ... ezgif-frame-240.jpg
const INITIAL_PRELOAD_COUNT = 24; // Enough frames to cover the opening section instantly
const PRELOAD_CONCURRENCY = 4;

// Verified frame sequence built from the real files under public/frames/
const frameUrl = (frameIndex) => {
    const frameNumber = String(frameIndex + 1).padStart(FRAME_PAD_LENGTH, '0');
    return `${IMAGES_DIR}${FRAME_PREFIX}${frameNumber}${FRAME_EXTENSION}`;
};

// State Variables
const images = new Array(TOTAL_FRAMES).fill(null);
const frameStatus = new Uint8Array(TOTAL_FRAMES); // 0 = idle, 1 = loading, 2 = ready, 3 = failed
const framePromises = new Array(TOTAL_FRAMES).fill(null);
let loadedFrameCount = 0;
let failedFrameCount = 0;
let scrollPercent = 0;
let currentFrame = 0;
let targetFrame = 0;
const frameEasing = 0.16; // Catches up quickly to prevent any perceived lag
let smoothScrollY = 0;
const scrollEasing = 0.08; // Glides smoothly behind scroll Y
let isLoaded = false;
let lastScrollY = 0;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Technical Skills Constellation Configurations
const skillWords = [
    "C++", "Python", "JavaScript", "WebRTC", "WebSockets",
    "React", "Next.js", "Node.js", "Flask", "TensorFlow",
    "PyTorch", "MongoDB", "MySQL", "Git", "AWS EC2",
    "Linux", "Nginx", "Render"
];
const skillNodes = [];
let mouseX = -9999;
let mouseY = -9999;
let currentActiveSectionIndex = -1;

// Grid Canvas Time Variable
let gridTime = 0;

// Canvas Contexts
let gridCanvas, gridCtx;

// Particle System State
const particles = [];
const PARTICLE_COUNT = 85;

// Web Audio Synth State
let audioCtx = null;
let rumbleOsc = null;
let rumbleGain = null;
let rumbleFilter = null;
let windNoiseNode = null;
let windFilter = null;
let windGain = null;
let celestialGain = null;
let celestialOscs = [];
let delayNode = null;
let audioEnabled = false;

/* =========================================================================
   1. PROGRESSIVE FRAME PRELOADER (REAL ASSETS, BOUNDED CONCURRENCY)
   ========================================================================= */
const updatePreloaderUI = (percent) => {
    const preloaderPercentage = document.getElementById('preloader-percentage');
    const preloaderFill = document.getElementById('preloader-fill');
    const safePercent = Math.max(0, Math.min(100, Math.round(percent)));

    if (preloaderPercentage) {
        preloaderPercentage.textContent = String(safePercent).padStart(2, '0');
    }
    if (preloaderFill) {
        preloaderFill.style.width = `${safePercent}%`;
    }
};

const loadFrame = (index) => {
    if (index < 0 || index >= TOTAL_FRAMES) {
        return Promise.resolve(null);
    }

    if (frameStatus[index] === 2) {
        return Promise.resolve(images[index]);
    }
    if (frameStatus[index] === 3) {
        return Promise.resolve(null);
    }
    if (frameStatus[index] === 1) {
        return framePromises[index];
    }

    frameStatus[index] = 1;

    framePromises[index] = new Promise((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        img.fetchPriority = index < INITIAL_PRELOAD_COUNT ? 'high' : 'low';

        const settle = (loaded) => {
            if (loaded) {
                images[index] = img;
                frameStatus[index] = 2;
                loadedFrameCount += 1;
                resolve(img);
            } else {
                frameStatus[index] = 3;
                failedFrameCount += 1;
                if (failedFrameCount === 1) {
                    console.warn(`Could not load animation frame ${frameUrl(index)}. The procedural backdrop will remain as a fallback.`);
                }
                resolve(null);
            }
        };

        img.onload = () => settle(true);
        img.onerror = () => settle(false);
        img.src = frameUrl(index);
    });

    return framePromises[index];
};

const preloadFrameIndices = async (indices, concurrency = PRELOAD_CONCURRENCY, onSettled = null) => {
    if (!indices.length) return;

    let cursor = 0;
    const workerCount = Math.max(1, Math.min(concurrency, indices.length));

    const workers = Array.from({ length: workerCount }, async () => {
        while (cursor < indices.length) {
            const index = indices[cursor++];
            await loadFrame(index);
            if (onSettled) onSettled(index);
        }
    });

    await Promise.all(workers);
};

const preloadRemainingFrames = async () => {
    // First pass: one frame every 8 indices, so every scroll position has a nearby fallback.
    const keyFrames = [];
    for (let i = INITIAL_PRELOAD_COUNT; i < TOTAL_FRAMES; i += 8) {
        keyFrames.push(i);
    }
    keyFrames.push(TOTAL_FRAMES - 1);
    await preloadFrameIndices(keyFrames, 4);

    // Second pass: fill in the gaps.
    const remaining = [];
    for (let i = INITIAL_PRELOAD_COUNT; i < TOTAL_FRAMES; i += 1) {
        if (frameStatus[i] === 0) remaining.push(i);
    }
    await preloadFrameIndices(remaining, PRELOAD_CONCURRENCY);

    if (failedFrameCount > 0) {
        console.warn(`${failedFrameCount} animation frame(s) could not be loaded; the nearest available frame is used.`);
    }
};

const preloadImages = async () => {
    const preloader = document.getElementById('preloader');
    const startTime = performance.now();
    const minimumDuration = 1200;
    const initialIndices = Array.from(
        { length: Math.min(INITIAL_PRELOAD_COUNT, TOTAL_FRAMES) },
        (_, index) => index
    );

    let settled = 0;
    updatePreloaderUI(0);

    await preloadFrameIndices(initialIndices, 4, () => {
        settled += 1;
        updatePreloaderUI((settled / initialIndices.length) * 100);
    });

    const elapsed = performance.now() - startTime;
    if (elapsed < minimumDuration) {
        await new Promise((r) => setTimeout(r, minimumDuration - elapsed));
    }

    isLoaded = true;
    updatePreloaderUI(100);

    if (preloader) {
        preloader.classList.add('loaded');
    }

    // Continue loading the rest of the sequence without blocking the page.
    preloadRemainingFrames();
};

/* =========================================================================
   1b. FRAME LOOKUP & RENDER LAYER
   ========================================================================= */
const getNearestLoadedFrame = (frameIndex) => {
    const clamped = Math.min(TOTAL_FRAMES - 1, Math.max(0, Math.round(frameIndex)));

    if (frameStatus[clamped] === 2) {
        return images[clamped];
    }

    // Walk outward so fast scrubs still show the closest available frame.
    for (let offset = 1; offset < TOTAL_FRAMES; offset += 1) {
        const before = clamped - offset;
        const after = clamped + offset;

        if (before >= 0 && frameStatus[before] === 2) return images[before];
        if (after < TOTAL_FRAMES && frameStatus[after] === 2) return images[after];
    }

    return null;
};

const drawFrameLayer = (frameIdx) => {
    if (!gridCtx || !gridCanvas) return false;

    const frame = getNearestLoadedFrame(frameIdx);
    if (!frame) return false;

    gridCtx.save();
    gridCtx.fillStyle = '#000000';
    gridCtx.fillRect(0, 0, gridCanvas.width, gridCanvas.height);
    drawImageCover(
        gridCtx,
        frame,
        0,
        0,
        gridCanvas.width,
        gridCanvas.height
    );
    gridCtx.restore();
    return true;
};

/* =========================================================================
   2. CANVAS ASPECT-RATIO RESIZING (COVER SIMULATION)
   ========================================================================= */
const resizeCanvases = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    if (gridCanvas) {
        gridCanvas.width = width;
        gridCanvas.height = height;
    }
    
    // Re-align interactive technical constellation coordinates target locations
    if (isLoaded) {
        initSkillNodes();
    }
};

// Cover Aspect Ratio Rendering
const drawImageCover = (ctx, img, x, y, w, h, offsetX = 0.5, offsetY = 0.5) => {
    if (!img) return;
    
    const iw = img.width;
    const ih = img.height;
    const r = Math.min(w / iw, h / ih);
    
    let nw = iw * r;
    let nh = ih * r;
    let cx, cy, cw, ch;
    
    if (nw < w) { nw = w; nh = ih * (w / iw); }
    if (nh < h) { nh = h; nw = iw * (h / ih); }
    
    cw = iw / (nw / w);
    ch = ih / (nh / h);
    
    cx = (iw - cw) * offsetX;
    cy = (ih - ch) * offsetY;
    
    // Bounds clamps
    if (cx < 0) cx = 0;
    if (cy < 0) cy = 0;
    if (cw > iw) cw = iw;
    if (ch > ih) ch = ih;
    
    ctx.drawImage(img, cx, cy, cw, ch, x, y, w, h);
};

/* =========================================================================
   3. PROCEDURAL VOLUMETRIC NEBULA OVERLAY (FALLBACK + FRAME ENHANCEMENT)
   ========================================================================= */
const drawProceduralNebula = (frameIdx, hasFrame = false) => {
    if (frameIdx >= SINGULARITY_FRAME) return; // Only draw in dark space phase
    
    const w = gridCanvas.width;
    const h = gridCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    
    const progress = frameIdx / SINGULARITY_FRAME; // 0 to 1
    
    // Sucked-in gravitational space compression factor
    const compression = 1.0 - Math.pow(progress, 3) * 0.9;
    
    gridCtx.save();
    
    // Solid space backing only when no frame image is available (fallback mode)
    if (!hasFrame) {
        gridCtx.fillStyle = '#000000';
        gridCtx.fillRect(0, 0, w, h);
    }
    
    // Nebulae 1: Deep Indigo Cosmic Dust
    const nebRadius1 = Math.max(w, h) * 0.95 * compression;
    const grad1 = gridCtx.createRadialGradient(cx, cy, 0, cx, cy, nebRadius1);
    grad1.addColorStop(0, hasFrame ? 'rgba(8, 0, 36, 0.22)' : 'rgba(8, 0, 36, 0.45)');
    grad1.addColorStop(0.5, hasFrame ? 'rgba(4, 0, 16, 0.12)' : 'rgba(4, 0, 16, 0.25)');
    grad1.addColorStop(1, 'rgba(0, 0, 0, 0)');
    gridCtx.fillStyle = grad1;
    gridCtx.fillRect(0, 0, w, h);
    
    // Nebulae 2: Deep Violet Gravitational Ring (shifted slightly by gridTime for organic breathing)
    const nebRadius2 = Math.max(w, h) * 0.55 * compression;
    const nebX = cx + Math.sin(gridTime * 0.4) * 30 * compression;
    const nebY = cy + Math.cos(gridTime * 0.4) * 20 * compression;
    const grad2 = gridCtx.createRadialGradient(nebX, nebY, 10, nebX, nebY, nebRadius2);
    grad2.addColorStop(0, hasFrame ? 'rgba(32, 0, 56, 0.18)' : 'rgba(32, 0, 56, 0.35)');
    grad2.addColorStop(0.6, hasFrame ? 'rgba(12, 0, 24, 0.08)' : 'rgba(12, 0, 24, 0.15)');
    grad2.addColorStop(1, 'rgba(0, 0, 0, 0)');
    gridCtx.fillStyle = grad2;
    gridCtx.fillRect(0, 0, w, h);
    
    // Nebulae 3: Concentric Cyan Accretion Flow (near core, grows intense near singularity)
    if (progress > 0.3) {
        const nebRadius3 = Math.min(w, h) * 0.38 * (0.5 + progress * 0.5) * compression;
        const grad3 = gridCtx.createRadialGradient(cx, cy, 2, cx, cy, nebRadius3);
        const nebOpacity = (hasFrame ? 0.16 : 0.26) * Math.pow((progress - 0.3) / 0.7, 2);
        grad3.addColorStop(0, `rgba(0, 240, 255, ${nebOpacity})`);
        grad3.addColorStop(0.4, `rgba(0, 100, 255, ${nebOpacity * 0.45})`);
        grad3.addColorStop(1, 'rgba(0, 0, 0, 0)');
        gridCtx.fillStyle = grad3;
        gridCtx.fillRect(0, 0, w, h);
    }
    
    gridCtx.restore();
};

/* =========================================================================
   3b. PROCEDURAL AI SINGULARITY CORE & ACCRETION HALO
   ========================================================================= */
const drawProceduralCore = (frameIdx) => {
    const w = gridCanvas.width;
    const h = gridCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    
    const isBeyond = frameIdx >= SINGULARITY_FRAME;
    
    if (!isBeyond) {
        // Gravitational collapse phase (0 to 180)
        const progress = frameIdx / SINGULARITY_FRAME; // 0 to 1
        
        // CRITICAL FIX: Clamp coreRadius strictly above 0.1 to avoid IndexSizeError in createRadialGradient
        const coreRadius = Math.max(0.1, Math.pow(progress, 5) * Math.min(w, h) * 0.14 + (Math.random() * 0.6));
        
        // 1. Accretion Disk (Procedural Synapse Halo)
        // CRITICAL FIX: Ensure haloRadius is always strictly greater than coreRadius
        const haloRadius = coreRadius + Math.max(10, (Math.min(w, h) * 0.22) * (0.3 + progress * 0.7));
        
        gridCtx.save();
        
        // Draw rotating accretion ring bands
        const ringCount = 4;
        for (let i = 0; i < ringCount; i++) {
            const rot = gridTime * (0.8 - i * 0.15) * (1.0 + progress * 1.5);
            const scaleY = 0.35 - (progress * 0.15); // flattens into 3D Einstein-Rosen disk
            
            gridCtx.translate(cx, cy);
            gridCtx.rotate(rot);
            gridCtx.scale(1.0, scaleY);
            
            const grad = gridCtx.createRadialGradient(0, 0, coreRadius * 0.6, 0, 0, haloRadius * (0.8 + i * 0.1));
            const opacity = (0.28 - i * 0.05) * (0.4 + progress * 0.6);
            grad.addColorStop(0, `rgba(0, 240, 255, 0)`);
            grad.addColorStop(0.3, `rgba(0, 240, 255, ${opacity})`);
            grad.addColorStop(0.6, `rgba(142, 241, 255, ${opacity * 0.5})`);
            grad.addColorStop(1, `rgba(0, 240, 255, 0)`);
            
            gridCtx.fillStyle = grad;
            gridCtx.beginPath();
            gridCtx.arc(0, 0, haloRadius * (0.8 + i * 0.1), 0, Math.PI * 2);
            gridCtx.fill();
            
            // Draw a fine bright wireframe ring
            gridCtx.strokeStyle = `rgba(0, 240, 255, ${opacity * 0.35})`;
            gridCtx.lineWidth = 1.0;
            gridCtx.beginPath();
            gridCtx.arc(0, 0, coreRadius + (haloRadius - coreRadius) * (0.2 + i * 0.2), 0, Math.PI * 2);
            gridCtx.stroke();
            
            // Undo scale & rotation
            gridCtx.scale(1.0, 1 / scaleY);
            gridCtx.rotate(-rot);
            gridCtx.translate(-cx, -cy);
        }
        
        // 2. Gravitational Lensing Halo (Volumetric blur backing)
        const lensGrad = gridCtx.createRadialGradient(cx, cy, coreRadius * 0.8, cx, cy, coreRadius * 2.8);
        lensGrad.addColorStop(0, 'rgba(0, 0, 0, 1)');
        lensGrad.addColorStop(0.2, `rgba(0, 240, 255, ${0.45 * progress})`);
        lensGrad.addColorStop(0.5, `rgba(0, 100, 255, ${0.15 * progress})`);
        lensGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        
        gridCtx.fillStyle = lensGrad;
        gridCtx.beginPath();
        gridCtx.arc(cx, cy, coreRadius * 3.0, 0, Math.PI * 2);
        gridCtx.fill();
        
        // 3. Event Horizon (The absolute black core)
        if (coreRadius > 2) {
            gridCtx.fillStyle = '#000000';
            gridCtx.shadowColor = '#00f0ff';
            gridCtx.shadowBlur = 15 + progress * 25;
            
            gridCtx.beginPath();
            gridCtx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
            gridCtx.fill();
            
            gridCtx.shadowBlur = 0; // reset shadow
        }
        
        gridCtx.restore();
    } else {
        // Serene Rebirth Core in the white dimension (180 to 240)
        const beyondProgress = (frameIdx - SINGULARITY_FRAME) / (TOTAL_FRAMES - SINGULARITY_FRAME);
        const coreRadius = Math.min(w, h) * 0.06 * (1.0 - beyondProgress * 0.3);
        
        // Soft golden/cyan floating center cluster
        gridCtx.save();
        
        const grad = gridCtx.createRadialGradient(cx, cy, 2, cx, cy, coreRadius * (2.5 + Math.sin(gridTime * 2.0) * 0.3));
        const alpha = 0.35 * (1.0 - beyondProgress * 0.8);
        grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
        grad.addColorStop(0.2, `rgba(229, 193, 88, ${alpha * 0.8})`);
        grad.addColorStop(0.6, `rgba(0, 240, 255, ${alpha * 0.3})`);
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        gridCtx.fillStyle = grad;
        gridCtx.beginPath();
        gridCtx.arc(cx, cy, coreRadius * 3.5, 0, Math.PI * 2);
        gridCtx.fill();
        
        // Draw delicate orbiting golden electron rings
        const orbitCount = 2;
        gridCtx.strokeStyle = `rgba(229, 193, 88, ${0.15 * (1.0 - beyondProgress)})`;
        gridCtx.lineWidth = 1.0;
        for (let i = 0; i < orbitCount; i++) {
            gridCtx.beginPath();
            gridCtx.ellipse(cx, cy, coreRadius * 1.5, coreRadius * 0.5, gridTime * 0.6 + i * Math.PI/2, 0, Math.PI * 2);
            gridCtx.stroke();
        }
        
        gridCtx.restore();
    }
};

/* =========================================================================
   4. DYNAMIC SPACETIME GRID WARPING ENGINE
   ========================================================================= */
const drawSpacetimeGrid = (frameIdx) => {
    const w = gridCanvas.width;
    const h = gridCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    
    const isBeyond = frameIdx >= SINGULARITY_FRAME;
    
    // A. Soft Volumetric Fog (Radial exposure gradients drawn behind grid lines)
    if (isBeyond) {
        const beyondProgress = (frameIdx - SINGULARITY_FRAME) / (TOTAL_FRAMES - SINGULARITY_FRAME);
        const gradient = gridCtx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(w, h) * 0.55);
        gradient.addColorStop(0, `rgba(255, 255, 255, ${0.45 * beyondProgress})`);
        gradient.addColorStop(0.5, `rgba(240, 253, 255, ${0.2 * beyondProgress})`);
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        gridCtx.fillStyle = gradient;
        gridCtx.fillRect(0, 0, w, h);
    }
    let gravityStrength = 0;
    
    if (!isBeyond) {
        // Gravity increases exponentially as we approach frames 1-180
        const progress = frameIdx / SINGULARITY_FRAME;
        gravityStrength = Math.pow(progress, 4) * 0.9;
    }

    gridTime += 0.015;
    
    // Spacetime Grid Config
    const gridCols = 32;
    const gridRows = 20;
    const stepX = w / gridCols;
    const stepY = h / gridRows;
    
    // Calculate Chromatic Aberration Amount based on distance to Singularity (frames 110-185)
    let aberrationAmount = 0;
    if (frameIdx >= 110 && frameIdx <= 185) {
        if (frameIdx <= 180) {
            const t = (frameIdx - 110) / 70; // 0 to 1
            aberrationAmount = Math.pow(t, 4) * 24; // Max 24px split
        } else {
            const t = (frameIdx - 180) / 5; // 0 to 1
            aberrationAmount = (1 - t) * 24;
        }
    }
    
    // Warping Function
    const warpPoint = (x, y) => {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        let warpedX = x;
        let warpedY = y;
        
        if (isBeyond) {
            // Flowing Wave Geometry in White Wormhole phase (emerging out of singularity)
            const beyondProgress = (frameIdx - SINGULARITY_FRAME) / (TOTAL_FRAMES - SINGULARITY_FRAME);
            
            // Generate elegant multidimensional topology waves
            const waveX = Math.sin(dist * 0.008 - gridTime * 1.8) * 35 * beyondProgress;
            const waveY = Math.cos(dist * 0.008 - gridTime * 1.8) * 35 * beyondProgress;
            
            // Radiate coordinate topology outwards
            const radiate = 1.0 + Math.sin(gridTime * 0.3) * 0.04 * beyondProgress;
            
            warpedX = cx + (dx * radiate) + waveX;
            warpedY = cy + (dy * radiate) + waveY;
        } else {
            // Gravitational lensing coordinate pull towards the singularity center
            if (dist > 10) {
                const warpRadius = Math.min(w, h) * 0.45;
                const pullFactor = gravityStrength * Math.exp(-dist / warpRadius);
                
                warpedX = cx + dx * (1 - pullFactor);
                warpedY = cy + dy * (1 - pullFactor);
            }
        }
        
        return { x: warpedX, y: warpedY };
    };

    // Shared grid line drawer
    const drawGridLines = (strokeColor, lineWidthVal) => {
        gridCtx.save();
        gridCtx.strokeStyle = strokeColor;
        gridCtx.lineWidth = lineWidthVal;
        
        // Draw Horizontal Grid Lines
        for (let r = 0; r <= gridRows; r++) {
            gridCtx.beginPath();
            const startY = r * stepY;
            
            // Walk along horizontal line in segments for fluid curving
            for (let c = 0; c <= gridCols; c++) {
                const startX = c * stepX;
                const pt = warpPoint(startX, startY);
                if (c === 0) {
                    gridCtx.moveTo(pt.x, pt.y);
                } else {
                    gridCtx.lineTo(pt.x, pt.y);
                }
            }
            gridCtx.stroke();
        }
        
        // Draw Vertical Grid Lines
        for (let c = 0; c <= gridCols; c++) {
            gridCtx.beginPath();
            const startX = c * stepX;
            
            for (let r = 0; r <= gridRows; r++) {
                const startY = r * stepY;
                const pt = warpPoint(startX, startY);
                if (r === 0) {
                    gridCtx.moveTo(pt.x, pt.y);
                } else {
                    gridCtx.lineTo(pt.x, pt.y);
                }
            }
            gridCtx.stroke();
        }
        gridCtx.restore();
    };

    // Apply procedural chromatic split or single-pass draw
    if (aberrationAmount > 1.5) {
        // Red-Orange left split (Source screen overlay)
        gridCtx.save();
        gridCtx.translate(-aberrationAmount, 0);
        drawGridLines(`rgba(255, 60, 0, ${0.16 * (1.0 - Math.pow(frameIdx / SINGULARITY_FRAME, 5))})`, 1.0);
        gridCtx.restore();
        
        // Cyan right split (Screen overlay blend)
        gridCtx.save();
        gridCtx.translate(aberrationAmount, 0);
        drawGridLines(`rgba(0, 240, 255, ${0.16 * (1.0 - Math.pow(frameIdx / SINGULARITY_FRAME, 5))})`, 1.0);
        gridCtx.restore();
    } else {
        // Standard draw path
        let strokeStyleVal = '';
        if (isBeyond) {
            let gridOpacity = 0.24;
            if (frameIdx > 204) {
                const decay = (frameIdx - 204) / (TOTAL_FRAMES - 204);
                gridOpacity = 0.24 - decay * 0.16;
            }
            strokeStyleVal = `rgba(229, 193, 88, ${gridOpacity})`;
        } else {
            const opacity = 0.18 * (1.0 - Math.pow(frameIdx / SINGULARITY_FRAME, 5));
            strokeStyleVal = `rgba(0, 240, 255, ${opacity})`;
        }
        drawGridLines(strokeStyleVal, 1.0);
    }
    
    // B. Concentric 3D Hologram Rings (Rotating perspective wireframe spatial sculpture in white dimension)
    if (isBeyond) {
        const beyondProgress = (frameIdx - SINGULARITY_FRAME) / (TOTAL_FRAMES - SINGULARITY_FRAME);
        const opacity = 0.09 * beyondProgress;
        const radius = Math.min(w, h) * 0.22;
        
        gridCtx.save();
        gridCtx.strokeStyle = `rgba(229, 193, 88, ${opacity})`;
        gridCtx.lineWidth = 1.2;
        
        const ringCount = 3;
        for (let r = 0; r < ringCount; r++) {
            gridCtx.beginPath();
            const segments = 64;
            
            // Rotate rings slightly out of phase for 3D concentric gyro coordinate lines
            const angleX = gridTime * 0.35 + r * (Math.PI / 3);
            const angleY = gridTime * 0.25 - r * (Math.PI / 4);
            
            for (let i = 0; i <= segments; i++) {
                const theta = (i / segments) * Math.PI * 2;
                
                // 3D coordinates on circle circumference
                let x3d = Math.cos(theta) * radius;
                let y3d = Math.sin(theta) * radius;
                let z3d = 0;
                
                // Rotation X
                let cosX = Math.cos(angleX), sinX = Math.sin(angleX);
                let yRot = y3d * cosX - z3d * sinX;
                let zRot = y3d * sinX + z3d * cosX;
                
                // Rotation Y
                let cosY = Math.cos(angleY), sinY = Math.sin(angleY);
                let xRot = x3d * cosY + zRot * sinY;
                let zFinal = -x3d * sinY + zRot * cosY;
                
                // Projection parameters
                const fov = 400;
                const distance = 400;
                const scale = fov / (distance + zFinal);
                
                const projX = cx + xRot * scale;
                const projY = cy + yRot * scale;
                
                if (i === 0) {
                    gridCtx.moveTo(projX, projY);
                } else {
                    gridCtx.lineTo(projX, projY);
                }
            }
            gridCtx.stroke();
        }
        gridCtx.restore();
    }
};

/* =========================================================================
   5. COSMIC PARTICLE & STAR-STREAK DYNAMICS
   ========================================================================= */
const initParticles = () => {
    particles.length = 0;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
            x: Math.random(),
            y: Math.random(),
            speedZ: Math.random() * 0.004 + 0.001, // Forward speed (stars zoom)
            size: Math.random() * 1.5 + 0.5,
            angle: Math.random() * Math.PI * 2,
            alpha: Math.random() * 0.7 + 0.3,
            color: '#ffffff'
        });
    }
};

// 3D Orbit Node Generation
const initSkillNodes = () => {
    if (!gridCanvas) return;
    const w = gridCanvas.width;
    const h = gridCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    
    // PERFECT CENTER - Centered focal anchor visually framed by holographic panels
    const centerX = cx;
    const centerY = cy;
    
    skillNodes.length = 0;
    skillWords.forEach((word, idx) => {
        const layer = idx % 3; // concentric layers spread
        const angle = (idx / skillWords.length) * Math.PI * 2;
        const radius = (layer + 1) * 70 + Math.random() * 25; // radius spread
        
        const targetX = centerX + Math.cos(angle) * radius;
        const targetY = centerY + Math.sin(angle) * radius;
        
        skillNodes.push({
            name: word,
            x: targetX + (Math.random() * 80 - 40),
            y: targetY + (Math.random() * 80 - 40),
            vx: Math.random() * 0.4 - 0.2,
            vy: Math.random() * 0.4 - 0.2,
            targetX: targetX,
            targetY: targetY,
            baseRadius: radius,
            baseAngle: angle,
            active: false
        });
    });
};const drawSkillConstellation = (frameIdx) => {
    if (!gridCanvas || frameIdx < SINGULARITY_FRAME) return;
    
    const w = gridCanvas.width;
    const h = gridCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    
    // NEW CONSTELLATION TIMELINE ENVELOPE:
    // - Frames 180-184: Fast cinematic emergence (ramps rapidly from 0.0 to 1.0)
    // - Frames 184-198: FULL POWER STATE (solid 1.0, brightest, sharpest, most interactive)
    // - Frames 198-202: Elegant cinematic fade-out begins
    // - Frames 202-204: Constellation dissolves smoothly into Terminus reveal (ramps down to 0.0)
    let constellationAlpha = 0;
    if (frameIdx >= SINGULARITY_FRAME && frameIdx <= 204) {
        if (frameIdx < 184) {
            constellationAlpha = (frameIdx - SINGULARITY_FRAME) / 4;
        } else if (frameIdx <= 198) {
            constellationAlpha = 1.0;
        } else {
            constellationAlpha = Math.max(0, 1.0 - (frameIdx - 198) / 6);
        }
    }
    
    if (constellationAlpha <= 0) return; // Completely hidden outside Section 4
    
    // PERFECT CENTER - Centered focal anchor visually framed by holographic panels
    const centerX = cx;
    const centerY = cy;
    
    // 1. Update node physics (Magnetic Spring Repulsion Engine)
    skillNodes.forEach((node, idx) => {
        node.baseAngle += 0.0012; // slow organic circular drift
        
        // Base orbit target coordinates
        let targetX = centerX + Math.cos(node.baseAngle) * node.baseRadius;
        let targetY = centerY + Math.sin(node.baseAngle) * node.baseRadius;
        
        // Mouse coordinates distance
        const dx = mouseX - node.x;
        const dy = mouseY - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Tactile premium magnetic repulsion: push node target coordinates away from cursor
        node.active = false;
        if (mouseX !== -9999 && dist < 180) {
            node.active = true;
            // Snappy quadratic repulsion curve for natural magnetic tactile behavior
            const force = Math.pow(1.0 - dist / 180, 2) * 65; // Max 65px push, highly responsive
            const angleToMouse = Math.atan2(dy, dx);
            targetX -= Math.cos(angleToMouse) * force;
            targetY -= Math.sin(angleToMouse) * force;
        }
        
        // Snappy spring physics to pull coordinate nodes toward target positions
        const ax = (targetX - node.x) * 0.15; // Increased spring stiffness
        const ay = (targetY - node.y) * 0.15;
        node.vx += ax;
        node.vy += ay;
        
        // Organic thermal ripples
        node.vx += Math.sin(gridTime * 1.5 + idx) * 0.015;
        node.vy += Math.cos(gridTime * 1.5 - idx) * 0.015;
        
        // Update coordinates with premium settlement dampening (friction) for maximum stability
        node.x += node.vx;
        node.y += node.vy;
        node.vx *= 0.80; // Optimized dampening
        node.vy *= 0.80;
    });
    
    // 2. Draw coordinate connectives (Neural Spacetime Lines)
    gridCtx.save();
    for (let i = 0; i < skillNodes.length; i++) {
        const nodeA = skillNodes[i];
        for (let j = i + 1; j < skillNodes.length; j++) {
            const nodeB = skillNodes[j];
            const dx = nodeB.x - nodeA.x;
            const dy = nodeB.y - nodeA.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < 135) {
                const lineOpacity = (1.0 - dist / 135) * 0.45 * constellationAlpha;
                const isActive = nodeA.active || nodeB.active;
                
                // Pass 1: Wide low-opacity glow thread
                gridCtx.strokeStyle = isActive ? `rgba(0, 240, 255, ${lineOpacity * 0.25})` : `rgba(229, 193, 88, ${lineOpacity * 0.22})`;
                gridCtx.lineWidth = isActive ? 3.0 : 2.0;
                gridCtx.beginPath();
                gridCtx.moveTo(nodeA.x, nodeA.y);
                gridCtx.lineTo(nodeB.x, nodeB.y);
                gridCtx.stroke();
                
                // Pass 2: Thin bright core filament
                gridCtx.strokeStyle = isActive ? `rgba(255, 255, 255, ${lineOpacity * 0.95})` : `rgba(229, 193, 88, ${lineOpacity * 0.85})`;
                gridCtx.lineWidth = isActive ? 0.9 : 0.6;
                gridCtx.beginPath();
                gridCtx.moveTo(nodeA.x, nodeA.y);
                gridCtx.lineTo(nodeB.x, nodeB.y);
                gridCtx.stroke();
            }
        }
    }
    gridCtx.restore();
    
    // 3. Draw nodes labels & Holographic Stars (Technological Neurons)
    skillNodes.forEach((node) => {
        const alpha = constellationAlpha;
        
        // Dynamic node scale easing
        if (node.scale === undefined) node.scale = 1.0;
        const targetScale = node.active ? 1.35 : 1.0;
        node.scale += (targetScale - node.scale) * 0.15;
        
        const scale = node.scale;
        
        gridCtx.save();
        
        // A. Outermost Luminous Aura (Layered Glow / Bloom)
        const outerGlowGrad = gridCtx.createRadialGradient(node.x, node.y, 2, node.x, node.y, 24 * scale);
        const glowOpacity = node.active ? 0.55 : 0.35;
        const glowColor = node.active ? '0, 240, 255' : '229, 193, 88';
        outerGlowGrad.addColorStop(0, `rgba(${glowColor}, ${glowOpacity * alpha})`);
        outerGlowGrad.addColorStop(0.4, `rgba(${glowColor}, ${(glowOpacity * 0.4) * alpha})`);
        outerGlowGrad.addColorStop(1, `rgba(${glowColor}, 0)`);
        
        gridCtx.fillStyle = outerGlowGrad;
        gridCtx.beginPath();
        gridCtx.arc(node.x, node.y, 24 * scale, 0, Math.PI * 2);
        gridCtx.fill();
        
        // B. Pulsating Ring (Delicate wide boundary ring, pulses on active/hover)
        gridCtx.strokeStyle = node.active ? `rgba(0, 240, 255, ${0.25 * alpha})` : `rgba(229, 193, 88, ${0.15 * alpha})`;
        gridCtx.lineWidth = 0.6;
        gridCtx.beginPath();
        const pulseRadius = 11 * scale + (node.active ? Math.sin(gridTime * 8.0) * 1.5 : 0);
        gridCtx.arc(node.x, node.y, pulseRadius, 0, Math.PI * 2);
        gridCtx.stroke();
        
        // C. Crisp Inner Wireframe Ring
        gridCtx.strokeStyle = node.active ? `rgba(0, 240, 255, ${0.85 * alpha})` : `rgba(229, 193, 88, ${0.55 * alpha})`;
        gridCtx.lineWidth = 0.8;
        gridCtx.beginPath();
        gridCtx.arc(node.x, node.y, 7 * scale, 0, Math.PI * 2);
        gridCtx.stroke();
        
        // D. High-Tech HUD Crosshairs / Ticks
        gridCtx.strokeStyle = node.active ? `rgba(0, 240, 255, ${0.9 * alpha})` : `rgba(229, 193, 88, ${0.6 * alpha})`;
        gridCtx.lineWidth = 0.7;
        const innerR = 7.5 * scale;
        const outerR = 11.5 * scale;
        
        // Up
        gridCtx.beginPath();
        gridCtx.moveTo(node.x, node.y - innerR);
        gridCtx.lineTo(node.x, node.y - outerR);
        gridCtx.stroke();
        
        // Down
        gridCtx.beginPath();
        gridCtx.moveTo(node.x, node.y + innerR);
        gridCtx.lineTo(node.x, node.y + outerR);
        gridCtx.stroke();
        
        // Left
        gridCtx.beginPath();
        gridCtx.moveTo(node.x - innerR, node.y);
        gridCtx.lineTo(node.x - outerR, node.y);
        gridCtx.stroke();
        
        // Right
        gridCtx.beginPath();
        gridCtx.moveTo(node.x + innerR, node.y);
        gridCtx.lineTo(node.x + outerR, node.y);
        gridCtx.stroke();
        
        // E. Sharp Luminous Core (brilliant neuron center)
        gridCtx.fillStyle = '#ffffff';
        gridCtx.shadowColor = node.active ? '#00f0ff' : '#e5c158';
        gridCtx.shadowBlur = node.active ? 10 : 5;
        
        gridCtx.beginPath();
        gridCtx.arc(node.x, node.y, 2.5 * scale, 0, Math.PI * 2);
        gridCtx.fill();
        
        gridCtx.restore(); // Safety restore prevents shadowBlur canvas leakage!
        
        // --- TYPOGRAPHY: Razor-sharp high contrast anchored labels ---
        gridCtx.save();
        gridCtx.font = "500 12px 'Space Grotesk', sans-serif";
        gridCtx.textAlign = 'center';
        
        // Round coordinates to integer pixels for perfect clarity
        const labelX = Math.round(node.x);
        const labelY = Math.round(node.y - 14 * scale);
        
        // 1. Solid high-contrast white outline backing
        gridCtx.strokeStyle = `rgba(255, 255, 255, ${0.92 * alpha})`;
        gridCtx.lineWidth = 3.5;
        gridCtx.lineJoin = 'round';
        gridCtx.strokeText(node.name, labelX, labelY);
        
        // 2. High-contrast solid text draw
        gridCtx.fillStyle = node.active ? '#005b66' : `rgba(14, 16, 21, ${alpha})`;
        gridCtx.fillText(node.name, labelX, labelY);
        
        gridCtx.restore();
    });
};

const triggerInteractiveWarpBurst = (clickX, clickY) => {
    if (!gridCanvas) return;
    const w = gridCanvas.width;
    const h = gridCanvas.height;
    
    // Convert click coordinates to 0-1 range
    const normX = clickX / w;
    const normY = clickY / h;
    
    // Inject 14 temporary energetic blast particles
    for (let i = 0; i < 14; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 0.012 + 0.004;
        
        particles.push({
            x: normX,
            y: normY,
            speedZ: speed,
            size: Math.random() * 2.5 + 1.2,
            angle: angle,
            alpha: 1.0,
            color: '#00f0ff', // Glowing neon cyan energy blast!
            temporary: true,
            life: 1.0 // Fades out over time
        });
    }
    
    // Cap particle system to prevent bloat
    if (particles.length > PARTICLE_COUNT + 100) {
        // Remove oldest temporary particles
        const tempIdx = particles.findIndex(p => p.temporary);
        if (tempIdx !== -1) particles.splice(tempIdx, 14);
    }
};

const drawParticles = (frameIdx) => {
    const w = gridCanvas.width;
    const h = gridCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    
    const isBeyond = frameIdx >= SINGULARITY_FRAME;
    let stretchFactor = 0;
    
    if (!isBeyond && frameIdx >= 60) {
        // Particles stretch dramatically near the horizon event (frames 60-180)
        stretchFactor = Math.pow((frameIdx - 60) / 120, 3.5) * 45;
    }
    
    for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        
        // Handle temporary burst particles (radial explosions from clicks)
        if (p.temporary) {
            p.x += Math.cos(p.angle) * p.speedZ;
            p.y += Math.sin(p.angle) * p.speedZ;
            p.life -= 0.015; // Slow decay for smooth trail fade
            p.alpha = Math.max(0, p.life);
            
            if (p.life <= 0) {
                particles.splice(i, 1);
                i--;
                continue;
            }
            
            const pxTemp = p.x * w;
            const pyTemp = p.y * h;
            
            // Adjust blast colors for high-contrast visibility on white vs black screens
            const body = document.body;
            const isLuminous = body.classList.contains('luminous-mode');
            p.color = isLuminous ? '#008ba3' : '#00f0ff';
            const shadowColor = isLuminous ? 'rgba(0, 139, 163, 0.45)' : '#00f0ff';
            
            gridCtx.save();
            gridCtx.globalAlpha = p.alpha;
            gridCtx.fillStyle = p.color;
            gridCtx.shadowColor = shadowColor;
            gridCtx.shadowBlur = 8;
            gridCtx.beginPath();
            gridCtx.arc(pxTemp, pyTemp, p.size, 0, Math.PI * 2);
            gridCtx.fill();
            gridCtx.restore();
            
            continue; // Skip standard drawing
        }
        
        // 1. Particle Coordinates Updates
        if (isBeyond) {
            // Luminous wormhole: floating dreamlike dust rising upwards
            const speedProgress = (frameIdx - SINGULARITY_FRAME) / (TOTAL_FRAMES - SINGULARITY_FRAME);
            p.y -= (0.001 + Math.sin(p.angle) * 0.0005) * (1.0 + speedProgress * 2.0);
            p.x += Math.cos(p.angle + gridTime) * 0.0005;
            
            // CRITICAL CONTRAST FIX: Rich Gold & Deep Cyan for stunning visibility on white screen
            p.color = i % 2 === 0 ? '#b58f22' : '#0097a7';
        } else {
            // Dark space: radial zooming stars (radiating out from center representing approach)
            p.speedZ += 0.00002 * (frameIdx / 15); // Accelerate into singularity
            
            // Map coordinates relative to center
            const radAngle = p.angle;
            const radius = Math.sqrt(Math.pow(p.x - 0.5, 2) + Math.pow(p.y - 0.5, 2)) + p.speedZ;
            
            // Reset particles that escape boundaries or compress too close
            if (radius > 0.85 || radius < 0.01) {
                p.x = 0.5 + (Math.random() * 0.1 - 0.05);
                p.y = 0.5 + (Math.random() * 0.1 - 0.05);
                p.speedZ = Math.random() * 0.003 + 0.001;
                p.angle = Math.random() * Math.PI * 2;
            } else {
                p.x = 0.5 + Math.cos(radAngle) * radius;
                p.y = 0.5 + Math.sin(radAngle) * radius;
            }
            
            // Gorgeous mix of cyan and white warp trails for stunning visibility
            p.color = i % 3 === 0 ? '#00f0ff' : '#ffffff';
        }
        
        // 2. Render Mechanics
        const px = p.x * w;
        const py = p.y * h;
        
        if (isBeyond) {
            // Draw floating glowing cyan/gold dots with high contrast
            let drawX = px;
            let drawY = py;
            
            // REBIRTH MOUSE PHYSICS: Organic Repulsion (particles push away from mouse)
            if (mouseX !== -9999) {
                const dx = mouseX - px;
                const dy = mouseY - py;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                if (dist < 220) {
                    const force = (1.0 - dist / 220) * 35; // push them away slightly
                    const angleToMouse = Math.atan2(dy, dx);
                    
                    drawX -= Math.cos(angleToMouse) * force;
                    drawY -= Math.sin(angleToMouse) * force;
                }
            }
            
            const opacity = p.alpha * (0.55 + 0.4 * Math.sin(gridTime + i)); // Increased base alpha to make them crisp
            gridCtx.fillStyle = p.color;
            gridCtx.globalAlpha = opacity;
            gridCtx.beginPath();
            gridCtx.arc(drawX, drawY, p.size * 1.5, 0, Math.PI * 2);
            gridCtx.fill();
        } else {
            // Approach: stars stretch into relativistic streaks toward singularity
            // Let them get brighter and more energetic as warp speed increases instead of fading!
            const compressionProgress = frameIdx / SINGULARITY_FRAME;
            gridCtx.globalAlpha = p.alpha * (0.65 + compressionProgress * 0.35);
            gridCtx.strokeStyle = p.color;
            gridCtx.lineWidth = p.size;
            
            // GRAVITATIONAL MOUSE LENSING DISTORTION
            let drawX = px;
            let drawY = py;
            
            if (mouseX !== -9999) {
                const dx = mouseX - px;
                const dy = mouseY - py;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                if (dist < 240) {
                    const force = (1.0 - dist / 240) * 45; // Max 45px displacement
                    const angleToMouse = Math.atan2(dy, dx);
                    
                    // Pull particles towards the cursor to represent localized gravity warping!
                    drawX += Math.cos(angleToMouse) * force;
                    drawY += Math.sin(angleToMouse) * force;
                }
            }
            
            gridCtx.beginPath();
            gridCtx.moveTo(drawX, drawY);
            
            // Calculate relativistic elongation direction (vector pointing to center singularity)
            const dx = cx - px;
            const dy = cy - py;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist > 5) {
                const vecX = dx / dist;
                const vecY = dy / dist;
                const length = stretchFactor * (1.5 - dist / Math.max(w, h));
                
                // Draw streak stretching outward along vector
                gridCtx.lineTo(drawX - vecX * length, drawY - vecY * length);
                gridCtx.stroke();
            }
        }
    }
    gridCtx.globalAlpha = 1.0; // Reset canvas context alpha
};

/* =========================================================================
   6. CINEMATIC SINGULARITY TRANSITION (THE COLLAPSE & BLOOM)
   ========================================================================= */
const runTransitionSequence = (frameIdx) => {
    // A. Visual Canvas violent scale compression & explosion burst (compressing to 0.78, exploding to 1.28)
    let containerScale = 1.0;
    if (frameIdx >= 140 && frameIdx <= 220) {
        if (frameIdx <= 180) {
            // Space coordinates compression
            const progress = (frameIdx - 140) / 40; // 0 to 1
            containerScale = 1.0 - Math.pow(progress, 4) * 0.22; // Compresses to 0.78
        } else if (frameIdx <= 202) {
            // Dimensional explosion out of singularity!
            const progress = (frameIdx - 180) / 22; // 0 to 1
            containerScale = 0.78 + Math.sin(progress * Math.PI) * 0.5; // Sine burst up to ~1.28!
        } else {
            // Settle smoothly back
            const progress = (frameIdx - 202) / 18; // 0 to 1
            containerScale = 1.08 - progress * 0.08;
        }
    }
    
    const viewport = document.getElementById('viewport');
    if (viewport) {
        viewport.style.transform = `scale(${containerScale})`;
    }
    
    // B. Volumetric Exposure Bloom (Blinding White Flash & Eye Adaptation)
    let flashOpacity = 0;
    if (frameIdx >= 168 && frameIdx <= 184) {
        if (frameIdx <= 180) {
            // Blinding buildup
            flashOpacity = Math.pow((frameIdx - 168) / 12, 3);
        } else {
            // Fast cinematic decay to let the constellation shine immediately!
            flashOpacity = 1.0 - (frameIdx - 180) / 4;
        }
    }
    
    const bloom = document.getElementById('bloom-flash');
    if (bloom) {
        bloom.style.opacity = flashOpacity;
    }
    
    // C. Theme Swap Toggle (Body theme shift)
    const body = document.body;
    if (frameIdx >= SINGULARITY_FRAME) {
        if (!body.classList.contains('luminous-mode')) {
            body.classList.add('luminous-mode');
        }
    } else {
        if (body.classList.contains('luminous-mode')) {
            body.classList.remove('luminous-mode');
        }
    }

    // D. Viewport Canvas Stack Fading out at the absolute end of the wormhole (Frames 220-240) to emerge into pure white screen
    let viewportOpacity = 1.0;
    if (frameIdx >= 220) {
        const fadeProgress = (frameIdx - 220) / 20; // 0 to 1
        viewportOpacity = 1.0 - fadeProgress;
    }
    
    if (viewport) {
        viewport.style.opacity = viewportOpacity;
    }
};

/* =========================================================================
   7. INTERACTIVE PROCEDURAL WEB AUDIO SYNTHESIZER
   ========================================================================= */
const initWebAudio = () => {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContextClass();
        
        // 1. Create Synthesizer Nodes
        // Low Frequency Rumble Synth (Oscillator -> Filter -> Gain)
        rumbleOsc = audioCtx.createOscillator();
        rumbleOsc.type = 'sawtooth';
        rumbleOsc.frequency.setValueAtTime(42, audioCtx.currentTime); // 42Hz deep C rumble
        
        const rumbleOsc2 = audioCtx.createOscillator();
        rumbleOsc2.type = 'sine';
        rumbleOsc2.frequency.setValueAtTime(42.5, audioCtx.currentTime); // Detune LFO hover beats
        
        rumbleFilter = audioCtx.createBiquadFilter();
        rumbleFilter.type = 'lowpass';
        rumbleFilter.frequency.setValueAtTime(140, audioCtx.currentTime); // Muffled cutoff
        
        rumbleGain = audioCtx.createGain();
        rumbleGain.gain.setValueAtTime(0.001, audioCtx.currentTime); // Silent at start, fades in
        
        rumbleOsc.connect(rumbleFilter);
        rumbleOsc2.connect(rumbleFilter);
        rumbleFilter.connect(rumbleGain);
        rumbleGain.connect(audioCtx.destination);
        
        // 2. Cosmic Whistling Space Wind (White Noise -> Bandpass Filter -> Gain)
        const bufferSize = audioCtx.sampleRate * 2;
        const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1; // Pure white noise
        }
        
        windNoiseNode = audioCtx.createBufferSource();
        windNoiseNode.buffer = noiseBuffer;
        windNoiseNode.loop = true;
        
        windFilter = audioCtx.createBiquadFilter();
        windFilter.type = 'bandpass';
        windFilter.Q.setValueAtTime(7.0, audioCtx.currentTime); // Highly resonant sweeping
        windFilter.frequency.setValueAtTime(500, audioCtx.currentTime);
        
        windGain = audioCtx.createGain();
        windGain.gain.setValueAtTime(0.001, audioCtx.currentTime);
        
        windNoiseNode.connect(windFilter);
        windFilter.connect(windGain);
        windGain.connect(audioCtx.destination);
        
        // 3. Transcendent Celestial Pad Chords (Synthesized reverb major-7th)
        // Delay Line simulating deep cosmic echo
        delayNode = audioCtx.createDelay(1.5);
        delayNode.delayTime.setValueAtTime(0.45, audioCtx.currentTime);
        
        const delayFeedback = audioCtx.createGain();
        delayFeedback.gain.setValueAtTime(0.55, audioCtx.currentTime);
        
        celestialGain = audioCtx.createGain();
        celestialGain.gain.setValueAtTime(0.001, audioCtx.currentTime);
        
        delayNode.connect(delayFeedback);
        delayFeedback.connect(delayNode); // Feedback loop
        
        celestialGain.connect(audioCtx.destination);
        celestialGain.connect(delayNode);
        delayNode.connect(audioCtx.destination); // Mix echo
        
        // Start Oscillators
        rumbleOsc.start();
        rumbleOsc2.start();
        windNoiseNode.start();
        
        // Warm up gains slowly to bypass snap audio pops
        rumbleGain.gain.exponentialRampToValueAtTime(0.45, audioCtx.currentTime + 1.5);
        windGain.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + 1.5);
        
        audioEnabled = true;
        
        console.log("Procedural Web Audio Engine active.");
    } catch (e) {
        console.error("Web Audio API failed to load", e);
    }
};

// Update Web Audio frequency nodes based on scroll state
const updateSoundscape = (frameIdx) => {
    if (!audioEnabled || !audioCtx) return;
    
    const time = audioCtx.currentTime;
    
    if (frameIdx < SINGULARITY_FRAME) {
        // A. Dark Space Approach
        const progress = frameIdx / SINGULARITY_FRAME;
        
        // rumble cutoff drops (muffling noise under compression)
        const rumbleCutoff = 160 - progress * 105; // 160Hz -> 55Hz
        rumbleFilter.frequency.setTargetAtTime(rumbleCutoff, time, 0.15);
        
        // Rumble volume swells up
        const rumbleVol = 0.45 + progress * 0.45;
        rumbleGain.gain.setTargetAtTime(rumbleVol, time, 0.15);
        
        // Cosmic wind sweep: resonance grows and frequency shifts up to represent warping
        const windFreq = 380 + Math.pow(progress, 3) * 650; // 380Hz -> 1030Hz
        windFilter.frequency.setTargetAtTime(windFreq, time, 0.15);
        windFilter.Q.setTargetAtTime(7.0 + progress * 9.0, time, 0.15); // Q goes up to 16
        
        // Fade wind volume slightly
        windGain.gain.setTargetAtTime(0.12 * (1.0 - progress * 0.4), time, 0.15);
        
        // B. Singularity Sudden vacuum silence (Frames 168-180)
        if (frameIdx >= 165) {
            const silenceProgress = (frameIdx - 165) / 15; // 0 to 1
            const drop = 1.0 - silenceProgress;
            rumbleGain.gain.setTargetAtTime(0.9 * drop, time, 0.05);
            windGain.gain.setTargetAtTime(0.08 * drop, time, 0.05);
        }
        
        // Turn off celestial synth if user scrolls backwards
        celestialGain.gain.setTargetAtTime(0.001, time, 0.4);
        stopCelestialOscs();
    } else {
        // C. White Wormhole Emergence
        const beyondProgress = (frameIdx - SINGULARITY_FRAME) / (TOTAL_FRAMES - SINGULARITY_FRAME);
        
        // Absolute silence in low end
        rumbleGain.gain.setTargetAtTime(0.001, time, 0.25);
        
        // Gentle airy white noise breeze
        windFilter.frequency.setTargetAtTime(680, time, 0.3);
        windFilter.Q.setTargetAtTime(3.0, time, 0.3);
        windGain.gain.setTargetAtTime(0.03, time, 0.3);
        
        // Fade in serene high-dimensional pad chord (F Major 9 - Angelic resonance)
        // Notes: F3 (174.61Hz), C4 (261.63Hz), E4 (329.63Hz), A4 (440Hz), C5 (523.25Hz)
        const chordFrequencies = [174.61, 261.63, 329.63, 440.00, 523.25];
        
        if (celestialOscs.length === 0) {
            chordFrequencies.forEach((freq) => {
                const osc = audioCtx.createOscillator();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, time);
                
                const oscGain = audioCtx.createGain();
                oscGain.gain.setValueAtTime(0.05, time); // Individual level
                
                osc.connect(oscGain);
                oscGain.connect(celestialGain);
                osc.start();
                
                celestialOscs.push(osc);
            });
        }
        
        // Celestial master level fades in beautifully with bloom
        const celestialVol = 0.55 + beyondProgress * 0.25;
        celestialGain.gain.setTargetAtTime(celestialVol, time, 0.5);
    }
};

const stopCelestialOscs = () => {
    if (celestialOscs.length > 0) {
        celestialOscs.forEach(osc => {
            try {
                osc.stop();
            } catch (e) {}
        });
        celestialOscs = [];
    }
};

/* =========================================================================
   8. SCROLL INTERPOLATION LOOP (BUTTERY 60 FPS DECELERATION)
   ========================================================================= */
const tickAnimationLoop = () => {
    // 1. Interpolate Scroll Position for buttery mousewheel smoothing
    const targetScrollY = window.scrollY;
    smoothScrollY += (targetScrollY - smoothScrollY) * scrollEasing;
    
    // Calculate smooth scroll progress
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    if (maxScroll > 0) {
        scrollPercent = Math.max(0, Math.min(1.0, smoothScrollY / maxScroll));
    } else {
        scrollPercent = 0;
    }
    
    // 2. Map smooth progress to target frame index
    targetFrame = scrollPercent * (TOTAL_FRAMES - 1);

    // Linear frame interpolation (current -> target step smoothing)
    currentFrame += (targetFrame - currentFrame) * frameEasing;
    
    // Draw visual stacks at exact interpolated point
    const roundedFrame = Math.min(TOTAL_FRAMES - 1, Math.max(0, Math.round(currentFrame)));
    
    if (isLoaded) {
        // Add dynamic camera drift in the white dimension (frameIdx >= 180) to make it feel breathing & alive
        let driftX = 0;
        let driftY = 0;
        if (!prefersReducedMotion && roundedFrame >= 180) {
            const driftProgress = (roundedFrame - 180) / 60;
            driftX = Math.sin(gridTime * 0.5) * 14 * Math.min(1.0, driftProgress);
            driftY = Math.cos(gridTime * 0.4) * 10 * Math.min(1.0, driftProgress);
        }

        if (gridCtx) {
            gridCtx.save();
            gridCtx.translate(driftX, driftY);
            
            // Clear canvas ONCE at the start of the frame!
            gridCtx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
            
            // Draw the real scroll-frame sequence as the visual base layer
            const hasFrame = drawFrameLayer(roundedFrame);

            // Draw the procedural deep space nebulae as an overlay or fallback
            drawProceduralNebula(roundedFrame, hasFrame);
            
            drawSpacetimeGrid(roundedFrame);
            drawProceduralCore(roundedFrame);
            drawParticles(roundedFrame);
            drawSkillConstellation(roundedFrame); // Renders dynamic node constellation in white dimension!
            gridCtx.restore();
        }
        
        runTransitionSequence(roundedFrame);
        updateSoundscape(roundedFrame);
        
        // Symmetrical Hologram Side Panels Parallax & Breathing Drift
        const leftPanel = document.querySelector('.left-panel');
        const rightPanel = document.querySelector('.right-panel');
        
        if (leftPanel && rightPanel) {
            if (roundedFrame >= 180 && roundedFrame <= 204) {
                // Symmetrical reveal fade-in (matches constellation emerge)
                let panelAlpha = 0;
                if (roundedFrame < 184) {
                    panelAlpha = (roundedFrame - 180) / 4;
                } else if (roundedFrame <= 198) {
                    panelAlpha = 1.0;
                } else {
                    panelAlpha = Math.max(0, 1.0 - (roundedFrame - 198) / 6);
                }
                
                leftPanel.style.opacity = panelAlpha;
                rightPanel.style.opacity = panelAlpha;
                leftPanel.style.pointerEvents = panelAlpha > 0.1 ? 'auto' : 'none';
                rightPanel.style.pointerEvents = panelAlpha > 0.1 ? 'auto' : 'none';
                
                // Scroll-based parallax drift Y
                const scrollFactor = (currentFrame - 180) / 24; // Ranges from 0 to 1 during Section 4
                const leftDriftY = scrollFactor * 45; // Left panel drifts slightly down
                const rightDriftY = -scrollFactor * 35; // Right panel drifts slightly up
                
                // Thermal breathing float (gentle organic oscillation)
                const floatLeftX = Math.sin(gridTime * 0.8) * 8;
                const floatLeftY = Math.cos(gridTime * 0.7) * 6;
                const floatRightX = Math.cos(gridTime * 0.6) * 7;
                const floatRightY = Math.sin(gridTime * 0.9) * 8;
                
                // Apply 3D hardware-accelerated translations
                leftPanel.style.transform = `translate3d(${floatLeftX}px, ${leftDriftY + floatLeftY}px, 0)`;
                rightPanel.style.transform = `translate3d(${floatRightX}px, ${rightDriftY + floatRightY}px, 0)`;
            } else {
                // Reset or hide panels completely when outside Section 4
                leftPanel.style.opacity = 0;
                rightPanel.style.opacity = 0;
                leftPanel.style.pointerEvents = 'none';
                rightPanel.style.pointerEvents = 'none';
            }
        }
        
        // Sync Navbar theme indicators
        updateNavbarActiveLinks(roundedFrame);

        // Cinematic Go Back button fade-in toggle
        const restartBtnEl = document.getElementById('btn-restart');
        if (restartBtnEl) {
            if (roundedFrame >= 200) {
                restartBtnEl.classList.add('btn-visible');
            } else {
                restartBtnEl.classList.remove('btn-visible');
            }
        }
    }
    
    requestAnimationFrame(tickAnimationLoop);
};

/* =========================================================================
   9. INTERACTIVE SCROLL & NAVIGATION MANAGEMENT
   ========================================================================= */
const updateScrollMetric = () => {
    const scrollY = window.scrollY;
    
    // Smooth navigation bar sliding hidden states
    const nav = document.getElementById('navbar');
    if (nav) {
        if (scrollY > lastScrollY && scrollY > 150) {
            nav.classList.add('nav-hidden'); // Scrolling down, hide header
        } else {
            nav.classList.remove('nav-hidden'); // Scrolling up, reveal
        }
    }
    lastScrollY = scrollY;
};

// Navigation section highlight syncing
const updateNavbarActiveLinks = (frameIdx) => {
    const progress = frameIdx / (TOTAL_FRAMES - 1);
    
    let activeIndex = 0;
    let depthText = '';
    
    // Sequence mappings (Void -> Distortion -> Horizon -> Singularity -> Beyond)
    if (progress < 0.2) {
        activeIndex = 0;
        depthText = ((1.0 - progress / 0.2) * 240).toFixed(2);
    } else if (progress < 0.5) {
        activeIndex = 1;
        depthText = ((1.0 - (progress - 0.2) / 0.3) * 120).toFixed(2);
    } else if (progress < 0.75) {
        activeIndex = 2;
        depthText = ((1.0 - (progress - 0.5) / 0.25) * 45).toFixed(2);
    } else if (progress < 0.85) {
        activeIndex = 3;
        depthText = '0.00';
    } else {
        activeIndex = 4;
        depthText = '∞';
    }
    
    // Sync UI elements
    const links = document.querySelectorAll('.nav-link');
    links.forEach((link, idx) => {
        if (idx === activeIndex) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
    
    const depthEl = document.getElementById('depth-value');
    if (depthEl) {
        depthEl.textContent = depthText;
    }
    
    // Sync editorial fade sections with GSAP staggered entrance animations!
    const storySections = [
        'sec-void',
        'sec-distortion',
        'sec-horizon',
        'sec-singularity',
        'sec-beyond'
    ];
    
    if (activeIndex !== currentActiveSectionIndex) {
        currentActiveSectionIndex = activeIndex;
        
        storySections.forEach((secId, idx) => {
            const el = document.getElementById(secId);
            if (el) {
                const content = el.querySelector('.section-content');
                if (content) {
                    if (idx === activeIndex) {
                        content.classList.add('visible');
                        
                        // GSAP Stagger Entrance Timeline Reveal
                        // Staggers headings, paragraphs, cards, manifest listings, and button anchors
                        if (typeof gsap !== 'undefined') {
                            gsap.killTweensOf(content.children);
                            
                            // Determine stagger speed depending on the card elements density
                            const isGrid = content.querySelector('.projects-spacetime-grid, .portfolio-hologram-layout, .achievements-manifest');
                            const targetChildren = isGrid ? content.querySelectorAll('.meta-label, .editorial-heading, .editorial-paragraph, .projects-spacetime-grid > *, .achievements-manifest > *, .portfolio-hologram-layout > *, .terminus-footer-capsules') : content.children;
                            
                            gsap.fromTo(targetChildren, 
                                { 
                                    opacity: 0, 
                                    y: 40,
                                    filter: "blur(6px)"
                                }, 
                                { 
                                    opacity: 1, 
                                    y: 0, 
                                    filter: "blur(0px)",
                                    duration: 0.9, 
                                    ease: "power3.out",
                                    stagger: isGrid ? 0.08 : 0.12,
                                    overwrite: "auto"
                                }
                            );
                        }
                    } else {
                        content.classList.remove('visible');
                        if (typeof gsap !== 'undefined') {
                            const isGrid = content.querySelector('.projects-spacetime-grid, .portfolio-hologram-layout, .achievements-manifest');
                            const targetChildren = isGrid ? content.querySelectorAll('.meta-label, .editorial-heading, .editorial-paragraph, .projects-spacetime-grid > *, .achievements-manifest > *, .portfolio-hologram-layout > *, .terminus-footer-capsules') : content.children;
                            gsap.set(targetChildren, { opacity: 0, y: 40, filter: "blur(6px)" });
                        }
                    }
                }
            }
        });
    }
};

/* =========================================================================
   10. APPLICATION INITIALIZATION LIFECYCLE
   ========================================================================= */
const initApplication = () => {
    // 1. Initialize DOM Nodes
    gridCanvas = document.getElementById('grid-canvas');
    gridCtx = gridCanvas.getContext('2d');
    
    // 2. Setup Events
    window.addEventListener('resize', resizeCanvases);
    window.addEventListener('scroll', updateScrollMetric, { passive: true });
    
    // Skills Constellation & Space Interaction coordinates listeners
    window.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    });
    window.addEventListener('mouseleave', () => {
        mouseX = -9999;
        mouseY = -9999;
    });
    
    // Click listener to inject singularity blasts inside Section 4
    window.addEventListener('click', (e) => {
        const roundedFrame = Math.round(currentFrame);
        // Section 4 active progress is active index 3 (frame 170 to 210)
        if (roundedFrame >= 170 && roundedFrame < 210) {
            triggerInteractiveWarpBurst(e.clientX, e.clientY);
        }
    });
    
    // 3. Initiate systems layout
    smoothScrollY = window.scrollY; // Match initial load coordinates to avoid jumps
    resizeCanvases();
    initParticles();
    
    // Start tick runner
    requestAnimationFrame(tickAnimationLoop);
    
    // 4. Begin actual black hole frames preloading
    preloadImages().then(() => {
        initSkillNodes(); // Initialize skills constellation coordinates target locations
        console.log("Visual assets loaded successfully. Core ready.");
    });
    
    // 5. Audio Toggle Click Hook
    const audioBtn = document.getElementById('audio-toggle');
    const audioStatusText = document.getElementById('audio-status-text');
    
    if (audioBtn) {
        audioBtn.addEventListener('click', () => {
            if (!audioCtx) {
                initWebAudio();
                if (audioEnabled) {
                    audioBtn.classList.add('playing');
                    audioBtn.setAttribute('aria-pressed', 'true');
                    if (audioStatusText) audioStatusText.textContent = "SOUND ON";
                }
            } else {
                if (audioCtx.state === 'suspended') {
                    audioCtx.resume();
                    audioBtn.classList.add('playing');
                    audioBtn.setAttribute('aria-pressed', 'true');
                    if (audioStatusText) audioStatusText.textContent = "SOUND ON";
                } else if (audioCtx.state === 'running') {
                    audioCtx.suspend();
                    audioBtn.classList.remove('playing');
                    audioBtn.setAttribute('aria-pressed', 'false');
                    if (audioStatusText) audioStatusText.textContent = "SOUND OFF";
                }
            }
        });
    }
    
    // 6. Navigation anchors scrolling snaps
    const links = document.querySelectorAll('.nav-link');
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    
    links.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const sectionIndex = parseInt(link.getAttribute('data-section'));
            
            // Map section indices to window scroll progression
            const targets = [0.0, 0.35, 0.62, 0.8, 0.95];
            const scrollPos = targets[sectionIndex] * (document.documentElement.scrollHeight - window.innerHeight);
            
            window.scrollTo({
                top: scrollPos,
                behavior: 'smooth'
            });
        });
    });
    
    // Immersive reverse scroll animation function (Surreal backwards flight)
    const triggerReverseOdyssey = () => {
        const startScrollY = window.scrollY;
        const endScrollY = 0;
        
        if (startScrollY <= 5) return;
        
        const duration = 4500; // 4.5 seconds of highly dramatic reverse travel!
        let startTimestamp = null;
        
        // Premium quintic easeInOut curve (starts slow, rushes fast backwards, settles slowly)
        const easeInOutQuint = (t) => {
            return t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * (--t) * t * t * t * t;
        };
        
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const elapsed = timestamp - startTimestamp;
            const progress = Math.min(1.0, elapsed / duration);
            
            const easedProgress = easeInOutQuint(progress);
            const currentY = startScrollY + (endScrollY - startScrollY) * easedProgress;
            
            window.scrollTo(0, currentY);
            
            if (progress < 1.0) {
                requestAnimationFrame(step);
            }
        };
        requestAnimationFrame(step);
    };

    // Logo Click triggers reverse flight
    const logo = document.getElementById('logo-trigger');
    if (logo) {
        logo.addEventListener('click', (e) => {
            e.preventDefault();
            triggerReverseOdyssey();
        });
    }
    
    // Restart Experience trigger
    const restartBtn = document.getElementById('btn-restart');
    if (restartBtn) {
        restartBtn.addEventListener('click', (e) => {
            e.preventDefault();
            triggerReverseOdyssey();
        });
    }
};

// Start application when DOM is ready
window.addEventListener('DOMContentLoaded', initApplication);
