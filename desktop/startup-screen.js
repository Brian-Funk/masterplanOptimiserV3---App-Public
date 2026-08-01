const DEFAULT_HINT = 'This can take a moment while the local backend and web interface start.';

const STEP_DEFINITIONS = [
  { id: 'integrity', label: 'Integrity' },
  { id: 'backend', label: 'Backend' },
  { id: 'interface', label: 'Interface' },
];

const STATE_LABELS = {
  pending: 'Waiting',
  checking: 'Checking',
  complete: 'Complete',
  warning: 'Warning',
  failed: 'Failed',
  skipped: 'Skipped',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normaliseStepState(state) {
  return Object.prototype.hasOwnProperty.call(STATE_LABELS, state)
    ? state
    : 'pending';
}

/**
 * Build the fixed startup checklist with optional state overrides.
 */
function buildStartupSteps(overrides = {}) {
  return STEP_DEFINITIONS.map((step) => {
    const override = overrides[step.id] || {};
    const state = normaliseStepState(override.state);
    return {
      id: step.id,
      label: step.label,
      state,
      detail: override.detail || STATE_LABELS[state],
    };
  });
}

/**
 * Convert an integrity check result into startup-screen copy and state.
 */
function describeIntegrityResult(result) {
  if (!result) {
    return {
      state: 'checking',
      status: 'Checking application integrity...',
      detail: 'Checking application integrity...',
    };
  }

  if (result.dev) {
    return {
      state: 'skipped',
      status: 'Development mode - integrity check skipped',
      detail: 'Development mode - integrity check skipped',
    };
  }

  if (result.valid) {
    return {
      state: 'complete',
      status: 'Integrity verified',
      detail: result.signatureOk ? 'Verified signed resources' : 'Verified bundled resources',
    };
  }

  return {
    state: 'failed',
    status: 'Integrity check failed',
    detail: result.error || 'Modified or missing files detected',
  };
}

function renderStep(step) {
  const state = normaliseStepState(step.state);
  const label = STATE_LABELS[state];
  return `
    <li class="step step-${escapeHtml(state)}">
      <span class="step-dot" aria-hidden="true"></span>
      <span class="step-main">
        <span class="step-label">${escapeHtml(step.label)}</span>
        <span class="step-detail">${escapeHtml(step.detail || label)}</span>
      </span>
      <span class="step-state">${escapeHtml(label)}</span>
    </li>
  `;
}

/**
 * Render the startup loading page as escaped HTML for Electron data URLs.
 */
function renderStartupPageHtml({ status, hint = DEFAULT_HINT, steps = buildStartupSteps() } = {}) {
  const safeStatus = status || 'Starting the desktop application.';
  return `
    <!DOCTYPE html>
    <html>
    <head><style>
      * { box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        background: #0f172a;
        color: #e2e8f0;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        margin: 0;
      }
      .card {
        width: min(560px, calc(100vw - 48px));
        padding: 40px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 12px;
        background: rgba(15, 23, 42, 0.9);
        box-shadow: 0 24px 80px rgba(2, 6, 23, 0.42);
      }
      .spinner {
        width: 34px;
        height: 34px;
        margin: 0 auto 24px;
        border: 3px solid #334155;
        border-top-color: #38bdf8;
        border-radius: 50%;
        animation: spin 0.9s linear infinite;
      }
      h1 {
        text-align: center;
        font-size: 1.5rem;
        margin: 0 0 10px;
        color: #f8fafc;
      }
      p {
        line-height: 1.6;
        color: #94a3b8;
        margin: 0;
        text-align: center;
      }
      .status {
        margin-top: 18px;
        color: #dbeafe;
        font-size: 0.95rem;
      }
      .steps {
        list-style: none;
        padding: 0;
        margin: 28px 0 0;
        display: grid;
        gap: 10px;
      }
      .step {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 12px;
        min-height: 50px;
        padding: 10px 12px;
        border: 1px solid rgba(148, 163, 184, 0.14);
        border-radius: 8px;
        background: rgba(30, 41, 59, 0.45);
      }
      .step-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: #64748b;
        box-shadow: 0 0 0 4px rgba(100, 116, 139, 0.14);
      }
      .step-main {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .step-label {
        color: #f8fafc;
        font-size: 0.9rem;
        font-weight: 650;
      }
      .step-detail {
        color: #94a3b8;
        font-size: 0.78rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .step-state {
        color: #94a3b8;
        font-size: 0.74rem;
        font-weight: 650;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .step-checking .step-dot {
        background: #38bdf8;
        box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.16);
      }
      .step-complete .step-dot {
        background: #22c55e;
        box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.16);
      }
      .step-warning .step-dot {
        background: #f59e0b;
        box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.18);
      }
      .step-failed .step-dot {
        background: #ef4444;
        box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.18);
      }
      .step-skipped .step-dot {
        background: #94a3b8;
        box-shadow: 0 0 0 4px rgba(148, 163, 184, 0.14);
      }
      .hint {
        margin-top: 18px;
        font-size: 0.82rem;
        color: #64748b;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style></head>
    <body><div class="card">
      <div class="spinner"></div>
      <h1>Masterplan Optimiser</h1>
      <p>Starting the desktop application.</p>
      <p class="status">${escapeHtml(safeStatus)}</p>
      <ul class="steps">${steps.map(renderStep).join('')}</ul>
      <p class="hint">${escapeHtml(hint)}</p>
    </div></body></html>
  `;
}

module.exports = {
  buildStartupSteps,
  describeIntegrityResult,
  escapeHtml,
  renderStartupPageHtml,
};
