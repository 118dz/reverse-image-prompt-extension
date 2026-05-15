(function initReverseImagePromptContent() {
  if (window.__riptContentLoaded) return;
  window.__riptContentLoaded = true;

  let host = null;
  let shadow = null;
  let lastPoint = { x: 120, y: 120 };
  let lastImageRect = null;
  let visualProgress = 0;
  let progressTimer = null;
  let progressStartTime = 0;
  let dragState = null;

  document.addEventListener("contextmenu", (event) => {
    if (event.target instanceof HTMLImageElement) {
      const rect = event.target.getBoundingClientRect();
      lastPoint = clampPoint({
        x: event.clientX,
        y: event.clientY
      });
      lastImageRect = {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      };
    }
  }, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "RIPT_PING") {
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === "RIPT_GET_LAST_CONTEXT_POINT") {
      sendResponse({
        point: getPreferredPanelPoint(),
        imageRect: lastImageRect
      });
      return true;
    }

    if (message?.point) {
      lastPoint = clampPoint(message.point);
    }

    if (message?.type === "RIPT_SHOW_LOADING" || message?.type === "RIPT_SHOW_PROGRESS") {
      showProgress({
        point: lastPoint,
        percent: message.percent || 12,
        label: message.label || "正在反推提示词"
      });
    }

    if (message?.type === "RIPT_SHOW_SETTINGS_REQUIRED") {
      showSettingsRequired(lastPoint);
    }

    if (message?.type === "RIPT_SHOW_RESULT") {
      showResult(message.result, lastPoint);
    }

    if (message?.type === "RIPT_SHOW_ERROR") {
      showError(message.message || "处理失败，请稍后重试。", lastPoint);
    }

    return false;
  });

  function ensureShadow() {
    if (host && shadow) return shadow;

    host = document.createElement("div");
    host.id = "ript-shadow-host";
    host.style.all = "initial";
    host.style.position = "fixed";
    host.style.left = "0";
    host.style.top = "0";
    host.style.width = "0";
    host.style.height = "0";
    host.style.zIndex = "2147483647";
    (document.body || document.documentElement).appendChild(host);

    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = getShadowStyles();
    shadow.appendChild(style);

    return shadow;
  }

  function showProgress({ point, percent, label }) {
    const root = ensureShadow();
    let panel = root.querySelector(".ript-panel");

    if (!panel || !root.querySelector(".ript-progress-fill")) {
      visualProgress = 0;
      root.querySelector(".ript-panel")?.remove();
      panel = createShell(point, `
        <section class="ript-card ript-card--loading">
          <div class="ript-head ript-drag-handle">
            <div class="ript-title-row">
              <h2>正在分析图片</h2>
              <span data-ript-progress-number>0%</span>
            </div>
            <button class="ript-close" type="button" aria-label="关闭">×</button>
          </div>
          <div class="ript-progress-track" aria-label="处理进度">
            <span class="ript-progress-fill" style="width: 0%"></span>
          </div>
          <p class="ript-progress-label" data-ript-progress-label>${escapeHtml(label)}</p>
        </section>
      `);
      root.appendChild(panel);
      startVisualProgress(root);
    }

    updateProgressLabel(root, label);
    if (percent >= 90) {
      visualProgress = Math.max(visualProgress, 90);
      renderProgress(root, visualProgress);
    }
    bindClose(root);
    bindDrag(root);
  }

  function showSettingsRequired(point) {
    const root = ensureShadow();
    stopVisualProgress();
    root.querySelector(".ript-panel")?.remove();
    root.appendChild(createShell(point, `
      <section class="ript-card ript-card--compact">
        <div class="ript-head ript-drag-handle">
          <h2>需要先绑定 API</h2>
          <button class="ript-close" type="button" aria-label="关闭">×</button>
        </div>
        <p class="ript-muted">请点击浏览器右上角扩展图标，在扩展弹窗里填写 API URL、API Key 和模型名称。API Key 不会进入网页环境。</p>
      </section>
    `));
    bindClose(root);
    bindDrag(root);
  }

  function showError(message, point) {
    const root = ensureShadow();
    stopVisualProgress();
    root.querySelector(".ript-panel")?.remove();
    root.appendChild(createShell(point, `
      <section class="ript-card ript-card--compact">
        <div class="ript-head ript-drag-handle">
          <h2>处理失败</h2>
          <button class="ript-close" type="button" aria-label="关闭">×</button>
        </div>
        <p class="ript-error">${escapeHtml(message)}</p>
      </section>
    `));
    bindClose(root);
    bindDrag(root);
  }

  function showResult(result, point) {
    const root = ensureShadow();
    root.querySelector(".ript-panel")?.remove();

    const promptText = String(result?.prompt || result?.raw || "").trim();

    const panel = createShell(point, `
      <section class="ript-card ript-result-card">
        <div class="ript-head ript-drag-handle">
          <header class="ript-result-header">
            <h2>风格提示词</h2>
            <p>只保留可迁移的画面韵味</p>
          </header>
          <button class="ript-close" type="button" aria-label="关闭">×</button>
        </div>
        <textarea class="ript-result-text" data-ript-active-text spellcheck="false">${escapeHtml(promptText)}</textarea>
        <footer class="ript-result-footer">
          <button class="ript-copy-main" type="button" data-ript-copy-prompt>复制风格提示词</button>
        </footer>
      </section>
    `);

    root.appendChild(panel);
    bindClose(root);
    bindResultControls(root);
    bindDrag(root);
  }

  function createShell(point, html) {
    const wrapper = document.createElement("div");
    wrapper.className = "ript-panel";
    const position = getPanelPosition(point);
    wrapper.style.left = `${position.left}px`;
    wrapper.style.top = `${position.top}px`;
    wrapper.innerHTML = html;
    return wrapper;
  }

  function bindClose(root) {
    root.querySelector(".ript-close")?.addEventListener("click", () => {
      dismissPanel(root);
    });
  }

  function dismissPanel(root) {
    stopVisualProgress();
    dragState = null;

    const panel = root.querySelector(".ript-panel");
    if (!panel) return;

    panel.classList.add("is-closing");
    window.setTimeout(() => {
      panel.remove();
    }, 150);
  }

  function bindDrag(root) {
    const panel = root.querySelector(".ript-panel");
    const handle = root.querySelector(".ript-drag-handle");
    if (!panel || !handle) return;

    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button, input, textarea")) return;
      dragState = {
        startX: event.clientX,
        startY: event.clientY,
        left: parseFloat(panel.style.left || "0"),
        top: parseFloat(panel.style.top || "0")
      };
      handle.setPointerCapture(event.pointerId);
      handle.classList.add("is-dragging");
    });

    handle.addEventListener("pointermove", (event) => {
      if (!dragState) return;
      const dx = event.clientX - dragState.startX;
      const dy = event.clientY - dragState.startY;
      const nextLeft = dragState.left + dx;
      const nextTop = dragState.top + dy;
      panel.style.left = `${clampToViewport(nextLeft, panel.offsetWidth)}px`;
      panel.style.top = `${clampToViewportTop(nextTop, panel.offsetHeight)}px`;
    });

    const stopDrag = () => {
      dragState = null;
      handle.classList.remove("is-dragging");
    };

    handle.addEventListener("pointerup", stopDrag);
    handle.addEventListener("pointercancel", stopDrag);
  }

  function bindResultControls(root) {
    const textarea = root.querySelector("[data-ript-active-text]");

    bindCopyButton({
      root,
      textarea,
      selector: "[data-ript-copy-prompt]",
      getValue: () => textarea.value,
      idleLabel: "复制风格提示词",
      doneLabel: "✓ 已复制"
    });
  }

  function bindCopyButton({ root, textarea, selector, getValue, idleLabel, doneLabel }) {
    root.querySelector(selector)?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await copyText(getValue(), textarea);
        showToast(root, "已复制到剪贴板");
        button.textContent = doneLabel;
        window.setTimeout(() => {
          button.textContent = idleLabel;
          button.disabled = false;
        }, 1500);
      } catch {
        textarea.focus();
        textarea.select();
        showToast(root, "请手动复制", true);
        button.textContent = "请手动复制";
        window.setTimeout(() => {
          button.textContent = idleLabel;
          button.disabled = false;
        }, 2200);
      }
    });
  }

  function showToast(root, message, isError = false) {
    const existing = root.querySelector(".ript-toast");
    existing?.remove();

    const toast = document.createElement("div");
    toast.className = "ript-toast";
    toast.dataset.state = isError ? "error" : "ok";
    toast.textContent = message;
    root.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add("is-hiding");
      window.setTimeout(() => toast.remove(), 180);
    }, 1400);
  }

  function startVisualProgress(root) {
    stopVisualProgress();
    progressStartTime = Date.now();
    progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - progressStartTime;
      const elapsedSeconds = Math.round(elapsed / 1000);
      if (visualProgress >= 90) {
        visualProgress = 90;
        enterWaitingProgress(root, elapsedSeconds);
        updateProgressLabel(
          root,
          elapsedSeconds >= 50
            ? `已等待 ${elapsedSeconds} 秒，超过预期；新版插件会自动中断，请确认扩展页已点“重新加载”。`
            : `AI 正在提炼风格提示词，请稍候，已等待 ${elapsedSeconds} 秒`
        );
        return;
      }

      const step = getProgressStep(visualProgress, elapsed);
      visualProgress = Math.min(90, visualProgress + step);
      renderProgress(root, visualProgress);
    }, 120);
  }

  function getProgressStep(progress, elapsed) {
    if (progress < 48) return 2.4;
    if (progress < 78) return 1.25;
    if (progress < 90) return 0.42;
    return 0;
  }

  function stopVisualProgress() {
    if (progressTimer) {
      window.clearInterval(progressTimer);
      progressTimer = null;
    }
  }

  function renderProgress(root, value) {
    const percent = Math.round(value);
    const fill = root.querySelector(".ript-progress-fill");
    const number = root.querySelector("[data-ript-progress-number]");
    if (fill) fill.style.width = `${percent}%`;
    if (number) number.textContent = `${percent}%`;
  }

  function updateProgressLabel(root, label) {
    const labelEl = root.querySelector("[data-ript-progress-label]");
    if (labelEl) labelEl.textContent = label;
  }

  function enterWaitingProgress(root, elapsedSeconds) {
    const fill = root.querySelector(".ript-progress-fill");
    const number = root.querySelector("[data-ript-progress-number]");
    if (fill) {
      fill.style.width = "100%";
      fill.classList.add("is-waiting");
    }
    if (number) number.textContent = elapsedSeconds ? `${elapsedSeconds}s` : "生成中";
  }

  function getPanelPosition(point) {
    const width = Math.min(520, window.innerWidth - 24);
    const estimatedHeight = 620;
    return {
      left: Math.max(12, Math.round((window.innerWidth - width) / 2)),
      top: Math.max(12, Math.round((window.innerHeight - estimatedHeight) / 2))
    };
  }

  function clampToViewport(left, width) {
    return Math.max(12, Math.min(left, window.innerWidth - width - 12));
  }

  function clampToViewportTop(top, height) {
    return Math.max(12, Math.min(top, window.innerHeight - height - 12));
  }

  function clampPoint(point) {
    return {
      x: Number.isFinite(point.x) ? Math.max(0, Math.min(point.x, window.innerWidth)) : 120,
      y: Number.isFinite(point.y) ? Math.max(0, Math.min(point.y, window.innerHeight)) : 120
    };
  }

  function getPreferredPanelPoint() {
    if (lastImageRect) {
      return clampPoint({
        x: lastImageRect.left + lastImageRect.width / 2,
        y: lastImageRect.top + lastImageRect.height / 2
      });
    }
    return clampPoint(lastPoint);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function copyText(value, sourceTextarea) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      if (sourceTextarea) {
        sourceTextarea.focus();
        sourceTextarea.select();
        if (document.execCommand("copy")) return;
      }

      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      document.documentElement.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const ok = document.execCommand("copy");
      textarea.remove();
      if (!ok) {
        throw new Error("复制失败");
      }
    }
  }

  function getShadowStyles() {
    return `
      :host {
        all: initial;
      }

      .ript-panel,
      .ript-panel * {
        box-sizing: border-box;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        scrollbar-width: thin;
        scrollbar-color: rgba(124, 255, 58, 0.55) rgba(255, 255, 255, 0.08);
      }

      .ript-panel *::-webkit-scrollbar {
        width: 10px;
        height: 10px;
      }

      .ript-panel *::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.06);
        border-radius: 999px;
      }

      .ript-panel *::-webkit-scrollbar-thumb {
        background: rgba(124, 255, 58, 0.45);
        border: 2px solid rgba(15, 23, 42, 0.35);
        border-radius: 999px;
      }

      .ript-panel *::-webkit-scrollbar-thumb:hover {
        background: rgba(124, 255, 58, 0.68);
      }

      .ript-panel *::-webkit-scrollbar-corner {
        background: transparent;
      }

      .ript-panel {
        position: fixed;
        z-index: 2147483647;
        width: min(520px, calc(100vw - 24px));
        color: #f8fafc;
        transform-origin: top center;
        animation: ript-panel-in 180ms cubic-bezier(0.2, 0.85, 0.2, 1) both;
      }

      .ript-panel.is-closing {
        pointer-events: none;
        animation: ript-panel-out 150ms ease both;
      }

      @keyframes ript-panel-in {
        from {
          opacity: 0;
          transform: translateY(8px) scale(0.985);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      @keyframes ript-panel-out {
        from {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
        to {
          opacity: 0;
          transform: translateY(6px) scale(0.985);
        }
      }

      .ript-panel:has(.ript-card--loading) {
        width: min(360px, calc(100vw - 24px));
      }

      .ript-card {
        position: relative;
        max-height: min(720px, calc(100vh - 24px));
        overflow: auto;
        padding: 22px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 28px;
        background: rgba(17, 24, 39, 0.86);
        box-shadow: 0 22px 54px rgba(0, 0, 0, 0.32);
        backdrop-filter: blur(36px) saturate(1.28);
        -webkit-backdrop-filter: blur(36px) saturate(1.28);
      }

      .ript-card--compact {
        min-height: 122px;
      }

      .ript-card--loading {
        min-height: 118px;
        padding: 18px;
      }

      .ript-card--binding {
        min-height: 368px;
      }

      .ript-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 14px;
        cursor: grab;
        margin-bottom: 14px;
        touch-action: none;
      }

      .ript-head.is-dragging {
        cursor: grabbing;
      }

      .ript-panel:has(.ript-head.is-dragging) .ript-card {
        transform: scale(0.992);
      }

      .ript-title-row {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }

      .ript-card h2 {
        margin: 0;
        color: #f8fafc;
        font-size: 18px;
        line-height: 1.3;
        font-weight: 700;
      }

      .ript-close {
        width: 30px;
        height: 30px;
        flex: 0 0 30px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 18px;
        color: #e5e7eb;
        background: rgba(31, 41, 55, 0.82);
        cursor: pointer;
        font-size: 20px;
        line-height: 26px;
        transition: background 140ms ease, border-color 140ms ease, transform 140ms ease;
      }

      .ript-close:hover {
        background: rgba(75, 85, 99, 0.9);
        transform: scale(1.04);
      }

      .ript-muted {
        margin: 0 36px 18px 0;
        color: #cbd5e1;
        font-size: 13px;
        line-height: 1.55;
      }

      .ript-input-field {
        display: block;
        margin-top: 13px;
      }

      .ript-input-field span {
        display: block;
        margin-bottom: 7px;
        color: #e5e7eb;
        font-size: 12px;
        font-weight: 600;
      }

      .ript-input-field input {
        display: block;
        width: 100%;
        min-height: 42px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 999px;
        padding: 0 12px;
        color: #f8fafc;
        background: rgba(15, 23, 42, 0.78);
        outline: none;
        font-size: 13px;
        transition: border-color 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
      }

      .ript-input-field input:focus,
      .ript-result-text:focus {
        border-color: #7cff3a;
        box-shadow: 0 0 0 3px rgba(124, 255, 58, 0.12);
      }

      .ript-input-field input:disabled,
      .ript-result-text:disabled {
        cursor: wait;
        opacity: 0.64;
      }

      .ript-status {
        min-height: 18px;
        margin: 10px 0 0;
        color: #7cff3a;
        font-size: 12px;
        line-height: 1.5;
      }

      .ript-status[data-state="error"] {
        color: #fecaca;
      }

      .ript-primary,
      .ript-copy-main {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 40px;
        border: 1px solid #7cff3a;
        border-radius: 999px;
        color: #07110a;
        background: #7cff3a;
        cursor: pointer;
        font-size: 13px;
        font-weight: 700;
        transition: background 140ms ease, border-color 140ms ease, color 140ms ease, opacity 140ms ease, transform 140ms ease;
      }

      .ript-primary {
        width: 100%;
        margin-top: 12px;
      }

      .ript-primary:hover,
      .ript-copy-main:hover {
        background: #9aff66;
        transform: translateY(-1px);
      }

      .ript-primary:disabled {
        cursor: wait;
        opacity: 0.72;
        transform: none;
      }

      .ript-primary.is-loading::before {
        content: "";
        width: 13px;
        height: 13px;
        border: 2px solid currentColor;
        border-right-color: transparent;
        border-radius: 999px;
        animation: ript-spin 760ms linear infinite;
      }

      @keyframes ript-spin {
        to { transform: rotate(360deg); }
      }

      .ript-progress-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding-right: 42px;
      }

      .ript-progress-head h2 {
        margin-bottom: 12px;
      }

      .ript-progress-head span {
        margin-bottom: 12px;
        color: #cbd5e1;
        font-size: 13px;
        font-weight: 700;
      }

      .ript-progress-track {
        position: relative;
        height: 10px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.16);
      }

      .ript-progress-fill {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: #7cff3a;
        transition: width 260ms ease;
      }

      .ript-progress-fill.is-waiting {
        width: 100% !important;
        background: linear-gradient(90deg, rgba(124, 255, 58, 0.28), #7cff3a, rgba(124, 255, 58, 0.28));
        background-size: 180% 100%;
        animation: ript-waiting 1.15s linear infinite;
      }

      @keyframes ript-waiting {
        from { background-position: 180% 0; }
        to { background-position: -180% 0; }
      }

      .ript-progress-label,
      .ript-error {
        margin: 12px 0 0;
        font-size: 13px;
        line-height: 1.55;
      }

      .ript-progress-label {
        color: #cbd5e1;
      }

      .ript-error {
        color: #fecaca;
      }

      .ript-result-card {
        display: flex;
        flex-direction: column;
        padding: 22px 22px 0;
        overflow: hidden;
      }

      .ript-result-header {
        display: block;
        width: 100%;
        padding: 0;
      }

      .ript-result-header h2 {
        margin: 0;
      }

      .ript-result-header p {
        margin: 6px 0 0;
        color: #cbd5e1;
        font-size: 12px;
        text-align: left;
      }

      .ript-result-text {
        display: block;
        width: calc(100% - 40px);
        min-height: 260px;
        margin: 20px;
        resize: vertical;
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 18px;
        padding: 14px;
        color: #f8fafc;
        background: rgba(15, 23, 42, 0.72);
        outline: none;
        font-size: 14px;
        line-height: 1.65;
        transition: border-color 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
      }

      .ript-result-footer {
        position: sticky;
        bottom: 0;
        z-index: 1;
        display: block;
        margin: 0 -22px;
        padding: 12px 42px 20px;
        background: linear-gradient(180deg, rgba(17, 24, 39, 0), rgba(17, 24, 39, 0.94) 34%, rgba(17, 24, 39, 0.99));
        backdrop-filter: blur(22px) saturate(1.2);
        -webkit-backdrop-filter: blur(22px) saturate(1.2);
      }

      .ript-copy-main {
        width: 100%;
        min-height: 42px;
      }

      .ript-toast {
        position: fixed;
        left: 50%;
        bottom: 24px;
        z-index: 2147483647;
        padding: 9px 13px;
        border: 1px solid rgba(124, 255, 58, 0.45);
        border-radius: 999px;
        color: #ecfccb;
        background: rgba(15, 23, 42, 0.92);
        box-shadow: 0 14px 32px rgba(0, 0, 0, 0.28);
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        transform: translateX(-50%);
        animation: ript-toast-in 180ms ease both;
      }

      .ript-toast[data-state="error"] {
        border-color: rgba(252, 165, 165, 0.5);
        color: #fecaca;
      }

      .ript-toast.is-hiding {
        animation: ript-toast-out 180ms ease both;
      }

      @keyframes ript-toast-in {
        from {
          opacity: 0;
          transform: translate(-50%, 8px);
        }
        to {
          opacity: 1;
          transform: translate(-50%, 0);
        }
      }

      @keyframes ript-toast-out {
        from {
          opacity: 1;
          transform: translate(-50%, 0);
        }
        to {
          opacity: 0;
          transform: translate(-50%, 8px);
        }
      }

      @media (max-width: 520px) {
        .ript-copy-main {
          min-height: 42px;
        }
      }
    `;
  }
})();
