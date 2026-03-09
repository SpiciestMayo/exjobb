/* ════════════════════════════════════════════════════════
   AI Code Review – app.js
   Pure browser-side JS; calls Google Gemini directly via
   the Google AI Studio REST API (no backend required).
   ════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── State ──────────────────────────────────────────── */
  let diffText   = '';
  let reviewData = null;
  let repoFiles  = {}; // { 'filename.js': 'full source string' }

  /* ── DOM refs ───────────────────────────────────────── */
  const uploadArea   = document.getElementById('upload-area');
  const fileInput    = document.getElementById('file-input');
  const fileInfo     = document.getElementById('file-info');
  const fileName     = document.getElementById('file-name');
  const removeBtn    = document.getElementById('remove-file');
  const runBtn       = document.getElementById('run-btn');
  const apiKeyInput  = document.getElementById('api-key');
  const toggleKey    = document.getElementById('toggle-key');
  const focusSelect  = document.getElementById('review-focus');
  const severitySelect = document.getElementById('severity');

  const diffEmpty    = document.getElementById('diff-empty');
  const diffViewer   = document.getElementById('diff-viewer');
  const reviewEmpty  = document.getElementById('review-empty');
  const reviewLoading= document.getElementById('review-loading');
  const reviewResults= document.getElementById('review-results');
  const summaryEmpty = document.getElementById('summary-empty');
  const summaryContent= document.getElementById('summary-content');

  const srcUploadArea  = document.getElementById('src-upload-area');
  const srcFileInput   = document.getElementById('src-file-input');
  const srcFileList    = document.getElementById('src-file-list');
  const openInfoModal  = document.getElementById('open-info-modal');
  const closeInfoModal = document.getElementById('close-info-modal');
  const infoModal      = document.getElementById('info-modal');

  /* ── Tabs ───────────────────────────────────────────── */
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  /* ── API key toggle ─────────────────────────────────── */
  toggleKey.addEventListener('click', () => {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
  });

  /* ── Drag & drop ────────────────────────────────────── */
  uploadArea.addEventListener('click', () => fileInput.click());
  uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
  uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  removeBtn.addEventListener('click', e => {
    e.stopPropagation();
    clearFile();
  });

  /* ── Info modal ─────────────────────────────────────── */
  openInfoModal.addEventListener('click', () => { infoModal.style.display = 'flex'; });
  closeInfoModal.addEventListener('click', () => { infoModal.style.display = 'none'; });
  infoModal.addEventListener('click', e => { if (e.target === infoModal) infoModal.style.display = 'none'; });

  /* ── Source file upload ──────────────────────────────── */
  srcUploadArea.addEventListener('click', () => srcFileInput.click());
  srcUploadArea.addEventListener('dragover', e => { e.preventDefault(); srcUploadArea.classList.add('drag-over'); });
  srcUploadArea.addEventListener('dragleave', () => srcUploadArea.classList.remove('drag-over'));
  srcUploadArea.addEventListener('drop', e => {
    e.preventDefault();
    srcUploadArea.classList.remove('drag-over');
    handleSrcFiles(e.dataTransfer.files);
  });
  srcFileInput.addEventListener('change', () => {
    if (srcFileInput.files.length) handleSrcFiles(srcFileInput.files);
  });

  function handleSrcFiles (fileList) {
    const textExts = /\.(js|ts|jsx|tsx|py|java|cs|cpp|c|h|go|rb|php|swift|kt|rs|html|css|scss|json|yaml|yml|xml|md|sh|bash|sql|vue|svelte|dart|ex|exs|lua|r|scala|tf|toml|ini|conf)$/i;
    const reads = [];
    for (const file of fileList) {
      if (!textExts.test(file.name) && !file.type.startsWith('text/')) continue;
      if (file.size > 200 * 1024) continue; // skip files > 200 KB
      reads.push(new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = ev => { repoFiles[file.name] = ev.target.result; resolve(); };
        reader.readAsText(file);
      }));
    }
    Promise.all(reads).then(() => renderSrcFileList());
  }

  function renderSrcFileList () {
    const keys = Object.keys(repoFiles);
    if (keys.length === 0) { srcFileList.style.display = 'none'; return; }
    srcFileList.style.display = 'block';
    srcFileList.innerHTML = keys.map(name => `
      <div class="src-file-item">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span>${escHtml(name)}</span>
        <button class="btn-icon src-remove" data-name="${escHtml(name)}" title="Remove">✕</button>
      </div>`).join('');
    srcFileList.querySelectorAll('.src-remove').forEach(btn => {
      btn.addEventListener('click', () => { delete repoFiles[btn.dataset.name]; renderSrcFileList(); });
    });
  }

  /* ── Run button ─────────────────────────────────────── */
  runBtn.addEventListener('click', runAnalysis);

  /* Enable run button when file + API key are present */
  apiKeyInput.addEventListener('input', updateRunBtn);

  function updateRunBtn () {
    runBtn.disabled = !(diffText && apiKeyInput.value.trim());
  }

  /* ── File handling ──────────────────────────────────── */
  function handleFile (file) {
    const reader = new FileReader();
    reader.onload = e => {
      diffText = e.target.result;
      fileName.textContent = file.name;
      fileInfo.style.display = 'block';
      renderDiff(diffText);
      updateRunBtn();
    };
    reader.readAsText(file);
  }

  function clearFile () {
    diffText  = '';
    repoFiles = {};
    fileInput.value    = '';
    srcFileInput.value = '';
    fileInfo.style.display    = 'none';
    diffViewer.style.display  = 'none';
    diffEmpty.style.display   = 'flex';
    srcFileList.style.display = 'none';
    srcFileList.innerHTML     = '';
    runBtn.disabled = true;
  }

  /* ── Diff renderer ──────────────────────────────────── */
  function renderDiff (raw) {
    diffViewer.innerHTML = '';
    const files = parseDiff(raw);

    if (files.length === 0) {
      // Plain text fallback
      const pre = document.createElement('pre');
      pre.style.cssText = 'font-size:12px;color:var(--text-muted);white-space:pre-wrap;';
      pre.textContent = raw;
      diffViewer.appendChild(pre);
    } else {
      files.forEach(file => diffViewer.appendChild(buildFileBlock(file)));
    }

    diffEmpty.style.display = 'none';
    diffViewer.style.display = 'block';

    // Switch to diff tab
    activateTab('diff');
  }

  function parseDiff (raw) {
    const lines  = raw.split('\n');
    const files  = [];
    let current  = null;
    let hunk     = null;
    let oldLine  = 0, newLine = 0;

    for (const line of lines) {
      if (line.startsWith('diff --git') || line.startsWith('--- ') && !current) {
        // start new file
        if (current) files.push(current);
        current = { header: line, hunks: [], status: 'modified' };
        hunk = null;
      } else if (line.startsWith('new file')) {
        if (current) current.status = 'added';
      } else if (line.startsWith('deleted file')) {
        if (current) current.status = 'deleted';
      } else if (line.startsWith('--- ')) {
        if (current) current.oldFile = line.slice(4);
      } else if (line.startsWith('+++ ')) {
        if (current) current.newFile = line.slice(4);
      } else if (line.startsWith('@@')) {
        const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
        if (m) { oldLine = parseInt(m[1]); newLine = parseInt(m[2]); }
        hunk = { header: line, lines: [] };
        if (current) current.hunks.push(hunk);
      } else if (current && hunk) {
        if (line.startsWith('+')) {
          hunk.lines.push({ type: 'added', old: '', new: newLine++, text: line.slice(1) });
        } else if (line.startsWith('-')) {
          hunk.lines.push({ type: 'removed', old: oldLine++, new: '', text: line.slice(1) });
        } else if (line.startsWith(' ') || line === '') {
          hunk.lines.push({ type: 'context', old: oldLine++, new: newLine++, text: line.slice(1) });
        }
      } else if (!current && (line.startsWith('--- ') || line.startsWith('+++ '))) {
        // simple diff without git header
        current = { header: line, hunks: [], status: 'modified', oldFile: '', newFile: '' };
      }
    }
    if (current) files.push(current);
    return files;
  }

  function buildFileBlock (file) {
    const wrapper = document.createElement('div');
    wrapper.className = 'diff-file';

    const header = document.createElement('div');
    header.className = 'diff-file-header';

    const label = file.newFile || file.oldFile || file.header || 'Unknown file';
    const cleanLabel = label.replace(/^[ab]\//, '');
    const statusTag = file.status === 'added' ? '<span class="tag-added">+ Added</span>'
                    : file.status === 'deleted' ? '<span class="tag-deleted">− Deleted</span>'
                    : '<span class="tag-modified">~ Modified</span>';

    header.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>${escHtml(cleanLabel)} ${statusTag}`;
    wrapper.appendChild(header);

    for (const hunk of file.hunks) {
      const hunkHeader = document.createElement('div');
      hunkHeader.className = 'diff-hunk-header';
      hunkHeader.textContent = hunk.header;
      wrapper.appendChild(hunkHeader);

      for (const ln of hunk.lines) {
        const row = document.createElement('div');
        row.className = 'diff-line ' + ln.type;

        const numOld = document.createElement('span');
        numOld.className = 'diff-line-num';
        numOld.textContent = ln.old;

        const numNew = document.createElement('span');
        numNew.className = 'diff-line-num';
        numNew.textContent = ln.new;

        const prefix = ln.type === 'added' ? '+' : ln.type === 'removed' ? '-' : ' ';
        const code = document.createElement('span');
        code.className = 'diff-line-code';
        code.textContent = prefix + ln.text;

        row.appendChild(numOld);
        row.appendChild(numNew);
        row.appendChild(code);
        wrapper.appendChild(row);
      }
    }

    if (file.hunks.length === 0) {
      const pre = document.createElement('pre');
      pre.style.cssText = 'padding:10px 14px;font-size:12px;color:var(--text-muted);white-space:pre-wrap;';
      pre.textContent = file.header;
      wrapper.appendChild(pre);
    }

    return wrapper;
  }

  /* ── Analysis ───────────────────────────────────────── */
  async function runAnalysis () {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey || !diffText) return;

    const focus    = focusSelect.options[focusSelect.selectedIndex].text;
    const severity = severitySelect.value;

    // Reset UI
    reviewResults.style.display = 'none';
    reviewEmpty.style.display   = 'none';
    reviewLoading.style.display = 'flex';
    summaryContent.style.display= 'none';
    summaryEmpty.style.display  = 'none';
    activateTab('review');
    runBtn.disabled = true;
    runBtn.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div> Analysing…`;

    try {
      const response = await callGemini(apiKey, focus, severity, diffText, repoFiles);
      const parsed   = parseGeminiResponse(response);
      reviewData     = parsed;
      renderReview(parsed);
      renderSummary(parsed);
    } catch (err) {
      showReviewError(err.message || 'Unknown error from Gemini API');
    } finally {
      runBtn.disabled = false;
      runBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> RUN ANALYSIS`;
      updateRunBtn();
    }
  }

  /* ── Gemini API call ────────────────────────────────── */
  // Model is hardcoded to gemini-3-flash-preview per Google AI Studio docs.
  // Temperature is intentionally left at the model default (1.0) as recommended
  // by the Gemini 3 developer guide — setting it lower can degrade performance.
  const GEMINI_MODEL = 'gemini-3-flash-preview';

  async function callGemini (apiKey, focus, severity, diff, fullFiles = {}) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const truncated = diff.length > 30000 ? diff.slice(0, 30000) + '\n\n[... diff truncated for length ...]' : diff;

    const prompt = buildPrompt(focus, severity, truncated, fullFiles);

    const body = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        maxOutputTokens: 8192
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = errBody?.error?.message || `HTTP ${res.status} ${res.statusText}`;
      throw new Error(msg);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned an empty response.');
    return text;
  }

  function buildPrompt (focus, severity, diff, fullFiles = {}) {
    const fileNames  = Object.keys(fullFiles);
    const hasContext = fileNames.length > 0;

    let fileSection = '';
    if (hasContext) {
      fileSection = '\n\nFULL SOURCE FILES (uploaded by user — use these for complete context):\n';
      fileSection += fileNames.map(name => {
        const src = fullFiles[name];
        const truncSrc = src.length > 10000 ? src.slice(0, 10000) + '\n[... truncated ...]' : src;
        return `\n### ${name}\n\`\`\`\n${truncSrc}\n\`\`\``;
      }).join('\n');
      fileSection += '\n';
    }

    const contextNote = hasContext
      ? `You have been given both the diff AND the full source of ${fileNames.length} file(s). Use the full files for complete context when identifying issues.`
      : `You only have the diff — you cannot see surrounding code outside the changed hunks. Where your assessment is limited by missing context, prefix that issue's description with [Limited context].`;

    return `You are an expert senior software engineer performing a thorough code review of a GitHub Pull Request.

REVIEW FOCUS: ${focus}
SEVERITY FILTER: ${severity === 'all' ? 'Report all issues' : severity === 'medium' ? 'Report Medium, High and Critical issues only' : 'Report High and Critical issues only'}

${contextNote}${fileSection}
Analyse the diff carefully and respond with a JSON object ONLY (no markdown fences, no extra text) in this exact structure:

{
  "verdict": "APPROVE" | "REQUEST_CHANGES" | "REJECT",
  "summary": "A concise 2-4 sentence overall assessment of the PR.",
  "stats": {
    "files_changed": <number>,
    "lines_added": <number>,
    "lines_removed": <number>,
    "critical": <number>,
    "high": <number>,
    "medium": <number>,
    "low": <number>,
    "info": <number>
  },
  "issues": [
    {
      "severity": "critical" | "high" | "medium" | "low" | "info",
      "title": "Short title of the issue",
      "file": "path/to/file.ext or empty string",
      "description": "Detailed description. Prefix with [Limited context] if you cannot fully assess due to missing surrounding code.",
      "suggestion": "Concrete suggestion or corrected code (optional)"
    }
  ],
  "positives": ["Positive aspects of the PR"]
}

Count actual lines added (+) and removed (-) from the diff for stats.
Be specific and actionable. If no issues exist at a severity level, set that count to 0.

DIFF:
${diff}`;
  }

  /* ── Parse Gemini response ──────────────────────────── */
  function parseGeminiResponse (text) {
    // Strip possible markdown code fences
    let clean = text.trim();
    clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      return JSON.parse(clean);
    } catch {
      // Fallback: wrap raw text as an info issue
      return {
        verdict: 'REQUEST_CHANGES',
        summary: 'The AI returned a response that could not be parsed as structured JSON. The raw response is shown below.',
        stats: { files_changed: 0, lines_added: 0, lines_removed: 0, critical: 0, high: 0, medium: 0, low: 0, info: 1 },
        issues: [{ severity: 'info', title: 'Raw Gemini Response', file: '', description: text, suggestion: '' }],
        positives: []
      };
    }
  }

  /* ── Render review ──────────────────────────────────── */
  function renderReview (data) {
    reviewLoading.style.display = 'none';
    reviewResults.innerHTML = '';

    if (!data.issues || data.issues.length === 0) {
      reviewResults.innerHTML = `
        <div class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <p style="color:var(--green);font-weight:600;">No issues found!</p>
          <p style="color:var(--text-muted);">Gemini found no problems matching your criteria.</p>
        </div>`;
      reviewResults.style.display = 'flex';
      return;
    }

    const filterSev = severitySelect.value;
    const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    const sorted = [...data.issues].sort((a, b) => (order[a.severity] ?? 5) - (order[b.severity] ?? 5));

    const filtered = filterSev === 'all' ? sorted
      : filterSev === 'medium' ? sorted.filter(i => ['critical','high','medium'].includes(i.severity))
      : sorted.filter(i => ['critical','high'].includes(i.severity));

    const hasCtx = Object.keys(repoFiles).length > 0;
    const banner = document.createElement('div');
    banner.className = hasCtx ? 'ctx-banner ctx-banner-full' : 'ctx-banner ctx-banner-partial';
    banner.textContent = hasCtx
      ? `✓ Full source context used (${Object.keys(repoFiles).length} file${Object.keys(repoFiles).length !== 1 ? 's' : ''}) — analysis covers complete files.`
      : '⚠ Diff-only context — issues marked [Limited context] may need manual verification. Upload source files for a deeper review.';
    reviewResults.appendChild(banner);

    const title = document.createElement('p');
    title.className = 'review-section-title';
    title.textContent = `${filtered.length} issue${filtered.length !== 1 ? 's' : ''} found`;
    reviewResults.appendChild(title);

    for (const issue of filtered) {
      reviewResults.appendChild(buildIssueCard(issue));
    }

    if (data.positives && data.positives.length > 0) {
      const posTitle = document.createElement('p');
      posTitle.className = 'review-section-title';
      posTitle.style.marginTop = '24px';
      posTitle.textContent = 'Positive Aspects';
      reviewResults.appendChild(posTitle);

      const posCard = document.createElement('div');
      posCard.style.cssText = 'background:var(--bg-card2);border:1px solid var(--border);border-radius:var(--radius);padding:14px;';
      posCard.innerHTML = '<ul style="list-style:none;display:flex;flex-direction:column;gap:6px;">' +
        data.positives.map(p => `<li style="display:flex;gap:8px;align-items:flex-start;font-size:13px;color:var(--text-muted);"><span style="color:var(--green);margin-top:1px;">✓</span>${escHtml(p)}</li>`).join('') +
        '</ul>';
      reviewResults.appendChild(posCard);
    }

    reviewResults.style.display = 'block';
  }

  function buildIssueCard (issue) {
    const card = document.createElement('div');
    card.className = 'review-issue';

    const sev = (issue.severity || 'info').toLowerCase();
    const desc = escHtml(issue.description || '').replace(
      /\[Limited context\]/g,
      '<span class="limited-ctx-tag">[Limited context]</span>'
    );
    card.innerHTML = `
      <div class="review-issue-header">
        <span class="severity-badge severity-${sev}">${sev}</span>
        <div style="flex:1;min-width:0;">
          <div class="issue-title">${escHtml(issue.title || 'Issue')}</div>
          ${issue.file ? `<div class="issue-file">${escHtml(issue.file)}</div>` : ''}
        </div>
      </div>
      <div class="review-issue-body">
        <p>${desc}</p>
        ${issue.suggestion ? `<p class="review-section-title" style="margin-top:10px;">Suggestion</p><pre>${escHtml(issue.suggestion)}</pre>` : ''}
      </div>`;
    return card;
  }

  /* ── Render summary ─────────────────────────────────── */
  function renderSummary (data) {
    summaryEmpty.style.display = 'none';
    summaryContent.innerHTML = '';

    const stats = data.stats || {};
    const verdict = (data.verdict || 'REQUEST_CHANGES').toUpperCase();
    const verdictClass = verdict === 'APPROVE' ? 'verdict-approve' : verdict === 'REJECT' ? 'verdict-reject' : 'verdict-changes';
    const verdictIcon = verdict === 'APPROVE' ? '✓' : verdict === 'REJECT' ? '✕' : '~';

    summaryContent.innerHTML = `
      <div class="summary-overview">
        <h3>
          <span class="verdict-badge ${verdictClass}">${verdictIcon} ${verdict.replace('_', ' ')}</span>
        </h3>
        <p>${escHtml(data.summary || '')}</p>
      </div>

      <p class="review-section-title">Issue Breakdown</p>
      <div class="summary-grid">
        <div class="stat-card stat-critical">
          <div class="stat-value">${stats.critical ?? 0}</div>
          <div class="stat-label">Critical</div>
        </div>
        <div class="stat-card stat-high">
          <div class="stat-value">${stats.high ?? 0}</div>
          <div class="stat-label">High</div>
        </div>
        <div class="stat-card stat-medium">
          <div class="stat-value">${stats.medium ?? 0}</div>
          <div class="stat-label">Medium</div>
        </div>
        <div class="stat-card stat-low">
          <div class="stat-value">${stats.low ?? 0}</div>
          <div class="stat-label">Low / Info</div>
        </div>
      </div>

      <p class="review-section-title">Diff Stats</p>
      <div class="summary-overview" style="display:flex;gap:24px;flex-wrap:wrap;">
        <div style="text-align:center;">
          <div style="font-size:22px;font-weight:700;color:var(--text);">${stats.files_changed ?? '—'}</div>
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;">Files Changed</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:22px;font-weight:700;color:var(--green);">+${stats.lines_added ?? 0}</div>
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;">Lines Added</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:22px;font-weight:700;color:var(--red);">-${stats.lines_removed ?? 0}</div>
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;">Lines Removed</div>
        </div>
      </div>
    `;

    summaryContent.style.display = 'block';
  }

  /* ── Error display ──────────────────────────────────── */
  function showReviewError (msg) {
    reviewLoading.style.display = 'none';
    reviewResults.innerHTML = `
      <div class="error-banner">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;margin-top:1px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <div>
          <strong>API Error</strong><br/>
          ${escHtml(msg)}<br/>
          <span style="font-size:12px;opacity:.8;">Check your API key, model selection, and ensure the Gemini API is enabled in Google AI Studio.</span>
        </div>
      </div>`;
    reviewResults.style.display = 'block';
  }

  /* ── Helpers ────────────────────────────────────────── */
  function escHtml (str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function activateTab (name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + name));
  }

})();
