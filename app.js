(() => {
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const textInput = document.getElementById("text-input");

  const state = {
    tool: "pen",
    color: "#111111",
    size: 3,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    items: [],
    redoStack: [],
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

  function drawItem(c, item) {
    if (item.type === "stroke") {
      c.strokeStyle = item.color;
      c.lineWidth = item.size;
      c.lineCap = "round";
      c.lineJoin = "round";
      c.globalCompositeOperation =
        item.mode === "erase" ? "destination-out" : "source-over";
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
      c.globalCompositeOperation = "source-over";
    } else if (item.type === "text") {
      c.fillStyle = item.color;
      c.font = `${item.size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      c.textBaseline = "top";
      c.fillText(item.text, item.x, item.y);
    }
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    applyView();
    for (const item of state.items) drawItem(ctx, item);
    if (state.current) drawItem(ctx, state.current);
  }

  function pushItem(item) {
    state.items.push(item);
    state.redoStack.length = 0;
  }

  function undo() {
    if (state.items.length === 0) return;
    state.redoStack.push(state.items.pop());
    render();
  }

  function redo() {
    if (state.redoStack.length === 0) return;
    state.items.push(state.redoStack.pop());
    render();
  }

  function clearBoard() {
    if (state.items.length === 0) return;
    if (!confirm("Clear the whole board?")) return;
    state.items = [];
    state.redoStack = [];
    render();
  }

  function resetView() {
    state.scale = 1;
    state.offsetX = 0;
    state.offsetY = 0;
    render();
  }

  function buildExportCanvas() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const measureCanvas = document.createElement("canvas");
    const mctx = measureCanvas.getContext("2d");
    for (const item of state.items) {
      if (item.type === "stroke") {
        const pad = item.size / 2;
        for (const p of item.points) {
          if (p.x - pad < minX) minX = p.x - pad;
          if (p.y - pad < minY) minY = p.y - pad;
          if (p.x + pad > maxX) maxX = p.x + pad;
          if (p.y + pad > maxY) maxY = p.y + pad;
        }
      } else if (item.type === "text") {
        mctx.font = `${item.size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        const w = mctx.measureText(item.text).width;
        const h = item.size * 1.2;
        if (item.x < minX) minX = item.x;
        if (item.y < minY) minY = item.y;
        if (item.x + w > maxX) maxX = item.x + w;
        if (item.y + h > maxY) maxY = item.y + h;
      }
    }
    const margin = 20;
    minX -= margin; minY -= margin; maxX += margin; maxY += margin;
    const w = Math.max(1, Math.ceil(maxX - minX));
    const h = Math.max(1, Math.ceil(maxY - minY));
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const octx = out.getContext("2d");
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, w, h);
    octx.translate(-minX, -minY);
    for (const item of state.items) drawItem(octx, item);
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

    if (out.toBlob) {
      out.toBlob(finish, "image/png");
    } else {
      finish(null);
    }
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

  function setTool(tool) {
    state.tool = tool;
    document.querySelectorAll(".tool").forEach((b) =>
      b.classList.toggle("active", b.dataset.tool === tool)
    );
    canvas.classList.remove("tool-text", "tool-eraser");
    if (tool === "text") canvas.classList.add("tool-text");
    if (tool === "eraser") canvas.classList.add("tool-eraser");
    commitPendingText();
  }

  function setColor(color) {
    state.color = color;
    document.querySelectorAll(".swatch").forEach((b) =>
      b.classList.toggle("active", b.dataset.color === color)
    );
    const indicator = document.getElementById("color-indicator");
    if (indicator) indicator.style.background = color;
  }

  function toggleColorPopover(force) {
    const pop = document.getElementById("color-popover");
    const trigger = document.getElementById("color-trigger");
    if (!pop || !trigger) return;
    const open = typeof force === "boolean" ? force : pop.hasAttribute("hidden");
    if (open) {
      pop.removeAttribute("hidden");
      trigger.setAttribute("aria-expanded", "true");
    } else {
      pop.setAttribute("hidden", "");
      trigger.setAttribute("aria-expanded", "false");
    }
  }

  function commitPendingText() {
    if (textInput.style.display !== "block") return;
    const value = textInput.value.trim();
    if (value) {
      const worldX = parseFloat(textInput.dataset.worldX);
      const worldY = parseFloat(textInput.dataset.worldY);
      const fontSize = parseFloat(textInput.dataset.fontSize);
      pushItem({
        type: "text",
        text: value,
        x: worldX,
        y: worldY,
        size: fontSize,
        color: textInput.dataset.color,
      });
    }
    textInput.style.display = "none";
    textInput.value = "";
    render();
  }

  function openTextInput(screenX, screenY) {
    commitPendingText();
    const world = screenToWorld(screenX, screenY);
    const fontSize = Math.max(12, state.size * 5);
    textInput.dataset.worldX = world.x;
    textInput.dataset.worldY = world.y;
    textInput.dataset.fontSize = fontSize;
    textInput.dataset.color = state.color;
    textInput.style.left = screenX + "px";
    textInput.style.top = screenY + "px";
    textInput.style.fontSize = fontSize * state.scale + "px";
    textInput.style.color = state.color;
    textInput.style.display = "block";
    textInput.value = "";
    setTimeout(() => textInput.focus(), 0);
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

    if (state.tool === "text") {
      openTextInput(e.clientX, e.clientY);
      return;
    }

    const world = screenToWorld(e.clientX, e.clientY);
    state.drawing = true;
    activePointerId = e.pointerId;
    state.current = {
      type: "stroke",
      points: [world],
      color: state.color,
      size: state.tool === "eraser" ? state.size * 4 : state.size,
      mode: state.tool === "eraser" ? "erase" : "draw",
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
        pushItem(state.current);
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
    if (document.activeElement === textInput) {
      if (e.key === "Enter") { e.preventDefault(); commitPendingText(); }
      else if (e.key === "Escape") {
        textInput.style.display = "none";
        textInput.value = "";
      }
      return;
    }
    if (e.key === " " && !state.spaceDown) {
      state.spaceDown = true;
      canvas.classList.add("panning");
      e.preventDefault();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault(); redo(); return;
    }
    if (e.key === "p" || e.key === "P") setTool("pen");
    else if (e.key === "t" || e.key === "T") setTool("text");
    else if (e.key === "e" || e.key === "E") setTool("eraser");
    else if (e.key === "0") resetView();
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === " ") {
      state.spaceDown = false;
      canvas.classList.remove("panning");
    }
  });

  textInput.addEventListener("blur", () => commitPendingText());

  document.querySelectorAll(".tool").forEach((btn) =>
    btn.addEventListener("click", () => setTool(btn.dataset.tool))
  );
  document.querySelectorAll(".swatch").forEach((btn) =>
    btn.addEventListener("click", () => {
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
  document.addEventListener("click", (e) => {
    const pop = document.getElementById("color-popover");
    if (!pop || pop.hasAttribute("hidden")) return;
    if (!pop.contains(e.target) && e.target.id !== "color-trigger") {
      toggleColorPopover(false);
    }
  });
  document.getElementById("size").addEventListener("input", (e) => {
    state.size = parseInt(e.target.value, 10);
  });
  document.getElementById("undo").addEventListener("click", undo);
  document.getElementById("redo").addEventListener("click", redo);
  document.getElementById("clear").addEventListener("click", clearBoard);
  document.getElementById("reset-view").addEventListener("click", resetView);
  document.getElementById("export").addEventListener("click", exportPNG);

  window.addEventListener("resize", resize);
  resize();
})();
