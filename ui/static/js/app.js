const canvasZ = document.getElementById('canvasZ');
const canvasW = document.getElementById('canvasW');
const ctxZ = canvasZ.getContext('2d');
const ctxW = canvasW.getContext('2d');

const singleBtn = document.getElementById('runSingleBtn');
const parallelBtn = document.getElementById('runParallelBtn');
const pointInput = document.getElementById('pointCount');
const durationEl = document.getElementById('duration');

const SIZE = 500;
canvasZ.width = SIZE; canvasZ.height = SIZE;
canvasW.width = SIZE; canvasW.height = SIZE;

const SCALE_Z = 60;
const SCALE_W = 180;
const OFFSET_Z = { x: SIZE / 2, y: SIZE / 2 + 100 };
const OFFSET_W = { x: SIZE / 2, y: SIZE - 50 };

let points = [];
let currentHover = null;
let hoverController = null;

function toComplex(x, y, offset, scale) {
    return { re: (x - offset.x) / scale, im: -(y - offset.y) / scale };
}

function toScreen(c, offset, scale) {
    return { x: offset.x + c.re * scale, y: offset.y - c.im * scale };
}

function drawGrid(ctx, offset, scale, isZPlane) {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, SIZE, SIZE);
    
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(0, offset.y); ctx.lineTo(SIZE, offset.y);
    ctx.moveTo(offset.x, 0); ctx.lineTo(offset.x, SIZE);
    ctx.stroke();

    if (isZPlane) {
        const p0 = toScreen({ re: 0, im: 0 }, offset, scale);
        const pi = toScreen({ re: 0, im: 1 }, offset, scale);
        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(pi.x, pi.y);
        ctx.stroke();
        
        ctx.fillStyle = '#ff0055';
        ctx.beginPath(); ctx.arc(p0.x, p0.y, 4, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(pi.x, pi.y, 4, 0, Math.PI*2); ctx.fill();
    } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.setLineDash([5, 5]);
        const center = toScreen({ re: 0, im: 0 }, offset, scale);
        
        const len = 600;
        const x1 = center.x + len * Math.cos(Math.PI/4);
        const y1 = center.y - len * Math.sin(Math.PI/4);
        const x2 = center.x + len * Math.cos(3*Math.PI/4);
        const y2 = center.y - len * Math.sin(3*Math.PI/4);

        ctx.beginPath(); ctx.moveTo(center.x, center.y); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(center.x, center.y); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.setLineDash([]);
    }
}

function drawPoints() {
    points.forEach(p => {
        const sz = toScreen(p.z, OFFSET_Z, SCALE_Z);
        ctxZ.fillStyle = p.color;
        ctxZ.fillRect(sz.x, sz.y, 2, 2);

        const sw = toScreen(p.w, OFFSET_W, SCALE_W);
        ctxW.fillStyle = p.color;
        ctxW.fillRect(sw.x, sw.y, 2, 2);
    });
}

function drawHover() {
    if (!currentHover) return;

    const { x, y, z, w } = currentHover;
    ctxZ.strokeStyle = 'white';
    ctxZ.lineWidth = 1;
    ctxZ.beginPath(); ctxZ.arc(x, y, 5, 0, Math.PI*2); ctxZ.stroke();
    ctxZ.fillStyle = 'white';
    ctxZ.font = '12px monospace';
    ctxZ.fillText(`z: ${z.re.toFixed(2)} + ${z.im.toFixed(2)}i`, 10, 20);

    if (w) {
        const sw = toScreen(w, OFFSET_W, SCALE_W);
        const originW = toScreen({ re: 0, im: 0 }, OFFSET_W, SCALE_W);

        ctxW.strokeStyle = 'rgba(255,255,255,0.1)';
        ctxW.beginPath(); ctxW.moveTo(originW.x, originW.y); ctxW.lineTo(sw.x, sw.y); ctxW.stroke();

        ctxW.strokeStyle = 'white';
        ctxW.lineWidth = 2;
        ctxW.beginPath(); ctxW.arc(sw.x, sw.y, 5, 0, Math.PI*2); ctxW.stroke();

        ctxW.fillStyle = 'white';
        ctxW.font = '12px monospace';
        ctxW.fillText(`w: ${w.re.toFixed(2)} + ${w.im.toFixed(2)}i`, 10, 20);
    }
}

function draw() {
    drawGrid(ctxZ, OFFSET_Z, SCALE_Z, true);
    drawGrid(ctxW, OFFSET_W, SCALE_W, false);
    drawPoints();
    drawHover();
}

async function fetchPoints(mode) {
    const count = parseInt(pointInput.value, 10) || 5000;
    const payload = { count };

    setLoading(true);
    durationEl.textContent = `Running ${mode} with ${count} points...`;

    try {
        const res = await fetch(`/api/compute/${mode}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`Server responded ${res.status}`);
        const data = await res.json();

        points = data.points || [];
        durationEl.textContent = `Mode: ${data.mode} | Duration: ${data.durationMs} ms | Points: ${points.length}`;
        draw();
    } catch (err) {
        console.error(err);
        durationEl.textContent = 'Computation failed. Check console for details.';
    } finally {
        setLoading(false);
    }
}

function setLoading(state) {
    singleBtn.disabled = state;
    parallelBtn.disabled = state;
}

function handleHoverRequest(z) {
    if (hoverController) {
        hoverController.abort();
    }

    const controller = new AbortController();
    hoverController = controller;

    const params = new URLSearchParams({ re: z.re, im: z.im });
    fetch(`/api/map-point?${params.toString()}`, { signal: controller.signal })
        .then(res => {
            if (!res.ok) throw new Error(`map-point failed: ${res.status}`);
            return res.json();
        })
        .then(data => {
            if (!currentHover) return;
            currentHover.w = data.w;
            draw();
        })
        .catch(err => {
            if (err.name === 'AbortError') return;
            console.error(err);
        });
}

canvasZ.addEventListener('mousemove', (e) => {
    const rect = canvasZ.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const z = toComplex(x, y, OFFSET_Z, SCALE_Z);

    currentHover = { x, y, z, w: null };
    draw();
    handleHoverRequest(z);
});

canvasZ.addEventListener('mouseleave', () => {
    currentHover = null;
    if (hoverController) {
        hoverController.abort();
    }
    draw();
});

singleBtn.addEventListener('click', () => fetchPoints('single'));
parallelBtn.addEventListener('click', () => fetchPoints('parallel'));

fetchPoints('single');
