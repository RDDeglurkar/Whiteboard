(() => {
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");

  const state = {
    color: "#111111",
    size: 3,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    items: [],
    drawing: false,
    current: null,
    panning: false,
    spaceDown: false,
    panStart: null,
    dpr: window.devicePixelRatio || 1,
  };

  const pointers = new Map();
  let activePointerId = null;
  let pinch = null;

  const MIN_SCALE = 0.1;
  const MAX_SCALE = 10;

  function resize() {
    state.dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * state.dpr);
    canvas.height = Math.floor(window.innerHeight * state.dpr);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    render();
  }

  function screenToWorld(x, y) {
    return {
      x: (x - state.offsetX) / state.scale,
      y: (y - state.offsetY) / state.scale,
    };
  }

  function applyView() {
    ctx.setTransform(
      state.scale * state.dpr,
      0,
      0,
      state.scale * state.dpr,
      state.offsetX * state.dpr,
      state.offsetY * state.dpr
    );
  }

  function drawStroke(c, item) {
    c.strokeStyle = item.color;
    c.lineWidth = item.size;
    c.lineCap = "round";
    c.lineJoin = "round";
    const pts = item.points;
    if (pts.length < 2) {
      c.beginPath();
      c.arc(pts[0].x, pts[0].y, item.size / 2, 0, Math.PI * 2);
      c.fillStyle = item.color;
      c.fill();
      return;
    }
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const midX = (pts[i].x + pts[i + 1].x) / 2;
      const midY = (pts[i].y + pts[i + 1].y) / 2;
      c.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
    }
    const last = pts[pts.length - 1];
    c.lineTo(last.x, last.y);
    c.stroke();
  }

  function drawGrid() {
    const base = 40;
    let gridSize = base;
    while (gridSize * state.scale < 20) gridSize *= 2;
    while (gridSize * state.scale > 100) gridSize /= 2;

    const topLeft = screenToWorld(0, 0);
    const bottomRight = screenToWorld(window.innerWidth, window.innerHeight);
    const startX = Math.floor(topLeft.x / gridSize) * gridSize;
    const endX = Math.ceil(bottomRight.x / gridSize) * gridSize;
    const startY = Math.floor(topLeft.y / gridSize) * gridSize;
    const endY = Math.ceil(bottomRight.y / gridSize) * gridSize;

    const dotRadius = 1.2 / state.scale;
    ctx.fillStyle = "#cbd5e1";
    for (let x = startX; x <= endX; x += gridSize) {
      for (let y = startY; y <= endY; y += gridSize) {
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    applyView();
    drawGrid();
    for (const item of state.items) drawStroke(ctx, item);
    if (state.current) drawStroke(ctx, state.current);
  }

  function undo() {
    if (state.items.length === 0) return;
    state.items.pop();
    render();
  }

  function buildExportCanvas() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const item of state.items) {
      const pad = item.size / 2;
      for (const p of item.points) {
        if (p.x - pad < minX) minX = p.x - pad;
        if (p.y - pad < minY) minY = p.y - pad;
        if (p.x + pad > maxX) maxX = p.x + pad;
        if (p.y + pad > maxY) maxY = p.y + pad;
      }
    }
    const margin = 20;
    minX -= margin; minY -= margin; maxX += margin; maxY += margin;
    const w = Math.max(1, Math.ceil(maxX - minX));
    const h = Math.max(1, Math.ceil(maxY - minY));

    const targetMin = 2000;
    const fit = Math.max(targetMin / w, targetMin / h, 2);
    const scale = Math.min(fit, 6);

    const out = document.createElement("canvas");
    out.width = Math.ceil(w * scale);
    out.height = Math.ceil(h * scale);
    const octx = out.getContext("2d");
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.scale(scale, scale);
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, w, h);
    octx.translate(-minX, -minY);
    for (const item of state.items) drawStroke(octx, item);
    return out;
  }

  function exportPNG() {
    if (state.items.length === 0) {
      alert("Nothing to export yet.");
      return;
    }
    const out = buildExportCanvas();
    const filename = `whiteboard-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;

    const finish = (blob) => {
      if (!blob) {
        const dataUrl = out.toDataURL("image/png");
        const w = window.open();
        if (w) {
          w.document.write(
            `<title>${filename}</title><body style="margin:0;background:#222;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="${dataUrl}" style="max-width:100%;height:auto;"/></body>`
          );
        } else {
          location.href = dataUrl;
        }
        return;
      }

      if (navigator.canShare && typeof File !== "undefined") {
        try {
          const file = new File([blob], filename, { type: "image/png" });
          if (navigator.canShare({ files: [file] })) {
            navigator
              .share({ files: [file], title: "Whiteboard" })
              .catch((err) => {
                if (err && err.name !== "AbortError") downloadBlob(blob, filename);
              });
            return;
          }
        } catch {}
      }
      downloadBlob(blob, filename);
    };

    if (out.toBlob) out.toBlob(finish, "image/png");
    else finish(null);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function setColor(color) {
    state.color = color;
    document.querySelectorAll(".swatch").forEach((b) =>
      b.classList.toggle("active", b.dataset.color === color)
    );
    const indicator = document.getElementById("color-indicator");
    if (indicator) indicator.style.background = color;
  }

  function positionPopover() {
    const pop = document.getElementById("color-popover");
    const trigger = document.getElementById("color-trigger");
    if (!pop || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const phoneLandscape = window.matchMedia(
      "(orientation: landscape) and (max-height: 600px)"
    ).matches;
    pop.style.visibility = "hidden";
    pop.style.top = "0px";
    pop.style.left = "0px";
    const popRect = pop.getBoundingClientRect();
    let top, left;
    if (phoneLandscape) {
      top = rect.top;
      left = rect.right + 6;
    } else {
      top = rect.bottom + 6;
      left = rect.left;
    }
    const maxLeft = window.innerWidth - popRect.width - 6;
    const maxTop = window.innerHeight - popRect.height - 6;
    if (left > maxLeft) left = maxLeft;
    if (top > maxTop) top = maxTop;
    if (left < 6) left = 6;
    if (top < 6) top = 6;
    pop.style.left = left + "px";
    pop.style.top = top + "px";
    pop.style.visibility = "";
  }

  function toggleColorPopover(force) {
    const pop = document.getElementById("color-popover");
    const trigger = document.getElementById("color-trigger");
    if (!pop || !trigger) return;
    const isHidden = pop.hasAttribute("hidden");
    const open = typeof force === "boolean" ? force : isHidden;
    if (open) {
      pop.removeAttribute("hidden");
      trigger.setAttribute("aria-expanded", "true");
      positionPopover();
    } else {
      pop.setAttribute("hidden", "");
      trigger.setAttribute("aria-expanded", "false");
    }
  }

  function cancelCurrentStroke() {
    if (state.drawing) {
      state.drawing = false;
      state.current = null;
      activePointerId = null;
      render();
    }
    if (state.panning) {
      state.panning = false;
      canvas.classList.remove("panning-active");
    }
  }

  function startPinch() {
    const pts = [...pointers.values()];
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    pinch = {
      startDist: Math.hypot(dx, dy) || 1,
      startCenterX: (pts[0].x + pts[1].x) / 2,
      startCenterY: (pts[0].y + pts[1].y) / 2,
      startScale: state.scale,
      startOffsetX: state.offsetX,
      startOffsetY: state.offsetY,
    };
  }

  function updatePinch() {
    if (!pinch || pointers.size < 2) return;
    const pts = [...pointers.values()];
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    const dist = Math.hypot(dx, dy) || 1;
    const cx = (pts[0].x + pts[1].x) / 2;
    const cy = (pts[0].y + pts[1].y) / 2;

    const factor = dist / pinch.startDist;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinch.startScale * factor));
    const k = newScale / pinch.startScale;

    state.scale = newScale;
    state.offsetX = cx - k * (pinch.startCenterX - pinch.startOffsetX);
    state.offsetY = cy - k * (pinch.startCenterY - pinch.startOffsetY);
    render();
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.target !== canvas) return;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size >= 2) {
      cancelCurrentStroke();
      if (pointers.size === 2) startPinch();
      e.preventDefault();
      return;
    }

    const isPan = state.spaceDown || e.button === 1 || e.button === 2;
    if (isPan) {
      state.panning = true;
      state.panStart = { x: e.clientX, y: e.clientY, ox: state.offsetX, oy: state.offsetY };
      canvas.classList.add("panning-active");
      activePointerId = e.pointerId;
      e.preventDefault();
      return;
    }
    if (e.button !== 0 && e.pointerType === "mouse") return;

    const world = screenToWorld(e.clientX, e.clientY);
    state.drawing = true;
    activePointerId = e.pointerId;
    state.current = {
      points: [world],
      color: state.color,
      size: state.size,
    };
    render();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch) {
      updatePinch();
      return;
    }
    if (e.pointerId !== activePointerId) return;

    if (state.panning) {
      state.offsetX = state.panStart.ox + (e.clientX - state.panStart.x);
      state.offsetY = state.panStart.oy + (e.clientY - state.panStart.y);
      render();
      return;
    }
    if (!state.drawing) return;
    const world = screenToWorld(e.clientX, e.clientY);
    const pts = state.current.points;
    const last = pts[pts.length - 1];
    const dx = world.x - last.x;
    const dy = world.y - last.y;
    if (dx * dx + dy * dy > 0.25 / (state.scale * state.scale)) {
      pts.push(world);
      render();
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch {}

    if (pinch && pointers.size < 2) {
      pinch = null;
      activePointerId = null;
      return;
    }
    if (e.pointerId !== activePointerId) return;

    if (state.panning) {
      state.panning = false;
      canvas.classList.remove("panning-active");
    }
    if (state.drawing) {
      state.drawing = false;
      if (state.current && state.current.points.length > 0) {
        state.items.push(state.current);
      }
      state.current = null;
      render();
    }
    activePointerId = null;
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const delta = -e.deltaY;
      const factor = Math.exp(delta * 0.0015);
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale * factor));
      const k = newScale / state.scale;
      state.offsetX = e.clientX - k * (e.clientX - state.offsetX);
      state.offsetY = e.clientY - k * (e.clientY - state.offsetY);
      state.scale = newScale;
      render();
    },
    { passive: false }
  );

  window.addEventListener("keydown", (e) => {
    if (e.key === " " && !state.spaceDown) {
      state.spaceDown = true;
      canvas.classList.add("panning");
      e.preventDefault();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
      return;
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === " ") {
      state.spaceDown = false;
      canvas.classList.remove("panning");
    }
  });

  document.querySelectorAll(".swatch").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setColor(btn.dataset.color);
      toggleColorPopover(false);
    })
  );
  const colorTrigger = document.getElementById("color-trigger");
  if (colorTrigger) {
    colorTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleColorPopover();
    });
  }
  document.addEventListener("pointerdown", (e) => {
    const pop = document.getElementById("color-popover");
    const trigger = document.getElementById("color-trigger");
    if (!pop || pop.hasAttribute("hidden")) return;
    if (pop.contains(e.target)) return;
    if (trigger && trigger.contains(e.target)) return;
    toggleColorPopover(false);
  });

  document.getElementById("size").addEventListener("input", (e) => {
    state.size = parseInt(e.target.value, 10);
  });
  document.getElementById("undo").addEventListener("click", undo);
  document.getElementById("export").addEventListener("click", exportPNG);

  window.addEventListener("resize", () => {
    resize();
    const pop = document.getElementById("color-popover");
    if (pop && !pop.hasAttribute("hidden")) positionPopover();
  });
  resize();
})();
