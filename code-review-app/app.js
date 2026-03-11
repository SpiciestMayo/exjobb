/* ════════════════════════════════════════════════════════
   AI Code Review – app.js
   Pure browser-side JS; calls Google Gemini directly via
   the Google AI Studio REST API (no backend required).
   ════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── State ──────────────────────────────────────────── */
  let diffText        = '';
  let reviewData      = null;
  let parsedDiffFiles = [];
  let commentStatuses = {};
  let repoFiles       = {}; // { 'filename.js': 'full source string' }

  /* ── DOM refs ───────────────────────────────────────── */
  const uploadArea   = document.getElementById('upload-area');
  const fileInput    = document.getElementById('file-input');
  const fileInfo     = document.getElementById('file-info');
  const fileName     = document.getElementById('file-name');
  const removeBtn    = document.getElementById('remove-file');
  const runBtn       = document.getElementById('run-btn');
  const apiKeyInput  = document.getElementById('api-key');
  const toggleKey    = document.getElementById('toggle-key');
  const modelSelect  = document.getElementById('model');

  const diffEmpty    = document.getElementById('diff-empty');
  const diffViewer   = document.getElementById('diff-viewer');
  const reviewEmpty  = document.getElementById('review-empty');
  const reviewLoading= document.getElementById('review-loading');
  const reviewResults= document.getElementById('review-results');
  const discussionEmpty = document.getElementById('discussion-empty');
  const discussionContent = document.getElementById('discussion-content');
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
      reviewData = null;
      commentStatuses = {};
      fileName.textContent = file.name;
      fileInfo.style.display = 'block';
      resetAnalysisViews();
      renderDiff(diffText, { preserveTab: true });
      updateRunBtn();
    };
    reader.readAsText(file);
  }

  function clearFile () {
    diffText        = '';
    reviewData      = null;
    parsedDiffFiles = [];
    commentStatuses = {};
    repoFiles       = {};
    fileInput.value    = '';
    srcFileInput.value = '';
    fileInfo.style.display    = 'none';
    diffViewer.style.display  = 'none';
    diffEmpty.style.display   = 'flex';
    srcFileList.style.display = 'none';
    srcFileList.innerHTML     = '';
    resetAnalysisViews();
    runBtn.disabled = true;
  }

  /* ── Diff renderer ──────────────────────────────────── */
  function renderDiff (raw, options = {}) {
    diffViewer.innerHTML = '';
    parsedDiffFiles = parseDiff(raw);

    if (parsedDiffFiles.length === 0) {
      // Plain text fallback
      const pre = document.createElement('pre');
      pre.style.cssText = 'font-size:12px;color:var(--text-muted);white-space:pre-wrap;';
      pre.textContent = raw;
      diffViewer.appendChild(pre);
    } else if (reviewData) {
      diffViewer.appendChild(buildAnnotatedDiffLayout(parsedDiffFiles, getVisibleIssues(reviewData.issues || []), {
        kind: 'issue',
        title: 'Concrete Issues',
        emptyMessage: 'No concrete issues were found.'
      }));
    } else {
      parsedDiffFiles.forEach(file => diffViewer.appendChild(buildFileBlock(file)));
    }

    diffEmpty.style.display = 'none';
    diffViewer.style.display = 'block';

    if (!options.preserveTab) {
      activateTab('diff');
    }
  }

  function rerenderAnalysisViews () {
    if (!reviewData) return;

    const activeTab = document.querySelector('.tab.active')?.dataset.tab || 'review';
    renderDiff(diffText, { preserveTab: true });
    renderDiscussion(reviewData);
    renderReview(reviewData);
    renderSummary(reviewData);
    activateTab(activeTab);
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
        current = { header: line, hunks: [], status: 'modified', oldFile: '', newFile: '' };
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

  function buildAnnotatedDiffLayout (files, items, options) {
    const layout = document.createElement('div');
    layout.className = 'annotated-diff-layout';

    const placements = resolveAnnotationPlacements(files, items, options.kind);
    const annotationGroups = groupAnnotationPlacements(placements);
    const anchorMap = new Map();
    const viewer = document.createElement('div');
    viewer.className = 'diff-viewer annotated-diff-viewer';

    files.forEach(file => viewer.appendChild(buildAnnotatedFileBlock(file, {
      annotationGroups,
      anchorMap,
      kind: options.kind
    })));

    const nav = buildAnnotationNavigator(placements, anchorMap, viewer, options);

    layout.appendChild(nav);
    layout.appendChild(viewer);
    return layout;
  }

  function buildAnnotatedFileBlock (file, options = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'diff-file';

    const header = document.createElement('div');
    header.className = 'diff-file-header';

    const filePath = getDiffFilePath(file);
    const cleanLabel = filePath || file.header || 'Unknown file';
    const statusTag = file.status === 'added' ? '<span class="tag-added">+ Added</span>'
                    : file.status === 'deleted' ? '<span class="tag-deleted">- Deleted</span>'
                    : '<span class="tag-modified">~ Modified</span>';
    const annotationGroup = options.annotationGroups?.get(filePath);
    const annotationCount = annotationGroup?.total || 0;
    const countTag = annotationCount
      ? `<span class="annotation-file-badge annotation-file-badge-${options.kind || 'issue'}">${annotationCount} ${annotationCount === 1 ? (options.kind === 'discussion' ? 'question' : 'issue') : (options.kind === 'discussion' ? 'questions' : 'issues')}</span>`
      : '';

    header.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>${escHtml(cleanLabel)} ${statusTag} ${countTag}`;
    wrapper.appendChild(header);

    if (annotationGroup?.file.length) {
      annotationGroup.file.forEach(annotation => {
        const card = buildDiffAnnotationCard(annotation, options.kind);
        options.anchorMap?.set(annotation.id, card);
        wrapper.appendChild(card);
      });
    }

    for (const hunk of file.hunks) {
      const hunkHeader = document.createElement('div');
      hunkHeader.className = 'diff-hunk-header';
      hunkHeader.textContent = hunk.header;
      wrapper.appendChild(hunkHeader);

      for (const ln of hunk.lines) {
        const row = document.createElement('div');
        row.className = 'diff-line ' + ln.type;
        const rowAnnotations = annotationGroup ? getLineAnnotationsForRow(annotationGroup.lines, ln) : [];

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

        if (rowAnnotations.length) {
          row.classList.add(options.kind === 'discussion' ? 'has-discussion' : 'has-issue');
          const marker = document.createElement('span');
          marker.className = `diff-line-marker diff-line-marker-${options.kind || 'issue'}`;
          marker.textContent = rowAnnotations.length;
          row.appendChild(marker);
        }

        wrapper.appendChild(row);

        if (rowAnnotations.length) {
          rowAnnotations.forEach(annotation => {
            const card = buildDiffAnnotationCard(annotation, options.kind);
            options.anchorMap?.set(annotation.id, card);
            wrapper.appendChild(card);
          });
        }
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

    const model = modelSelect.value;

    // Reset UI
    reviewResults.style.display = 'none';
    reviewEmpty.style.display   = 'none';
    reviewLoading.style.display = 'flex';
    discussionContent.style.display = 'none';
    discussionEmpty.style.display = 'none';
    summaryContent.style.display= 'none';
    summaryEmpty.style.display  = 'none';
    activateTab('review');
    runBtn.disabled = true;
    runBtn.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div> Analysing…`;

    try {
      const response = await callGemini(apiKey, model, diffText, repoFiles);
      const parsed   = normalizeReviewData(parseGeminiResponse(response));
      commentStatuses = {};
      reviewData     = parsed;
      renderDiff(diffText, { preserveTab: true });
      renderDiscussion(parsed);
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
  // The model is selected in the UI.
  // Temperature is intentionally left at the model default (1.0) as recommended
  // by the Gemini 3 developer guide — setting it lower can degrade performance.
  async function callGemini (apiKey, model, diff, fullFiles = {}) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const truncated = diff.length > 30000 ? diff.slice(0, 30000) + '\n\n[... diff truncated for length ...]' : diff;

    const prompt = buildPrompt(truncated, fullFiles);

    const body = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        maxOutputTokens: 16384 // 8192
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

  function buildPrompt (diff, fullFiles = {}) {
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


${contextNote}${fileSection}
Analyse the diff carefully and respond with a JSON object ONLY (no markdown fences, no extra text) in this exact structure:

{
  "verdict": "APPROVE" | "REQUEST_CHANGES" | "REJECT",
  "summary": "A one-sentence overall assessment of the PR.",
  "summary_bullets": [
    "3-5 bullets that summarise the most important code changes. Use **double asterisks** to highlight the most important words or phrases."
  ],
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
      "line": <number or null>,
      "side": "new" | "old",
      "description": "Concrete, directly actionable issue only. Prefix with [Limited context] if you cannot fully assess due to missing surrounding code.",
      "suggestion": "Concrete suggestion or corrected code (optional)"
    }
  ],
  "discussion_questions": [
    {
      "question": "Question to raise during the human code review",
      "file": "path/to/file.ext or empty string",
      "line": <number or null>,
      "side": "new" | "old",
      "context": "Why this question is worth discussing later"
    }
  ],
  "positives": ["Positive aspects of the PR"]
}

Count actual lines added (+) and removed (-) from the diff for stats.
Structure the review as a standard review:
- "summary_bullets" must describe the actual changes in the PR, not generic quality statements.
- "issues" must only contain simple, concrete, directly actionable findings such as poor naming, race conditions, missing validation, incorrect conditions, broken edge cases, or similar clear defects.
- Every item in "issues" must point to the most relevant changed line in the diff using "file", "line", and "side". Use "side": "new" for added/context lines and "side": "old" for removed lines.
- "discussion_questions" must contain less certain, broader, or more architectural concerns that should be discussed by humans later. Each item must be phrased as a question.
- Every item in "discussion_questions" must point to the most relevant changed line in the diff using "file", "line", and "side".
- Do not duplicate the same concern in both "issues" and "discussion_questions".
- If there are no concrete issues or no discussion questions, return an empty array for that field.
- If no issues exist at a severity level, set that count to 0.

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
        summary_bullets: ['The response could not be converted into the standard review format.'],
        stats: { files_changed: 0, lines_added: 0, lines_removed: 0, critical: 0, high: 0, medium: 0, low: 0, info: 1 },
        issues: [{ severity: 'info', title: 'Raw Gemini Response', file: '', line: null, side: 'new', description: text, suggestion: '' }],
        discussion_questions: [],
        positives: []
      };
    }
  }

  /* ── Render review ──────────────────────────────────── */
  function renderReview (data) {
    reviewLoading.style.display = 'none';
    reviewResults.innerHTML = '';

    const filtered = getVisibleIssues(data.issues || []);
    const questions = getVisibleDiscussionQuestions(data.discussion_questions || []);

    const hasCtx = Object.keys(repoFiles).length > 0;
    const banner = document.createElement('div');
    banner.className = hasCtx ? 'ctx-banner ctx-banner-full' : 'ctx-banner ctx-banner-partial';
    banner.textContent = hasCtx
      ? `✓ Full source context used (${Object.keys(repoFiles).length} file${Object.keys(repoFiles).length !== 1 ? 's' : ''}) — analysis covers complete files.`
      : '⚠ Diff-only context — issues marked [Limited context] may need manual verification. Upload source files for a deeper review.';
    banner.textContent = hasCtx
      ? `Full source context used (${Object.keys(repoFiles).length} file${Object.keys(repoFiles).length !== 1 ? 's' : ''}) - analysis covers complete files.`
      : 'Diff-only context - issues marked [Limited context] may need manual verification. Upload source files for a deeper review.';
    reviewResults.appendChild(banner);

    reviewResults.appendChild(buildStandardReviewCard(data));

    const issuesTitle = document.createElement('p');
    issuesTitle.className = 'review-section-title';
    issuesTitle.textContent = `Concrete Issues (${filtered.length})`;
    reviewResults.appendChild(issuesTitle);

    if (filtered.length === 0) {
      reviewResults.appendChild(buildEmptySectionCard('No concrete issues were found.'));
    } else {
      for (const issue of filtered) {
        reviewResults.appendChild(buildIssueCard(issue));
      }
    }

    const questionsTitle = document.createElement('p');
    questionsTitle.className = 'review-section-title';
    questionsTitle.textContent = `Discussion Questions (${questions.length})`;
    reviewResults.appendChild(questionsTitle);

    if (questions.length === 0) {
      reviewResults.appendChild(buildEmptySectionCard('No discussion questions were raised for the human review.'));
    } else {
      questions.forEach((question, index) => {
        reviewResults.appendChild(buildDiscussionQuestionCard(question, index));
      });
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

  function renderDiscussion (data) {
    discussionEmpty.style.display = 'none';
    discussionContent.innerHTML = '';
    const visibleQuestions = getVisibleDiscussionQuestions(data.discussion_questions || []);

    if (parsedDiffFiles.length === 0 && diffText) {
      parsedDiffFiles = parseDiff(diffText);
    }

    if (parsedDiffFiles.length === 0) {
      const pre = document.createElement('pre');
      pre.style.cssText = 'font-size:12px;color:var(--text-muted);white-space:pre-wrap;';
      pre.textContent = diffText;
      discussionContent.appendChild(pre);
    } else {
      discussionContent.appendChild(buildAnnotatedDiffLayout(parsedDiffFiles, visibleQuestions, {
        kind: 'discussion',
        title: 'Discussion Questions',
        emptyMessage: 'No discussion questions were raised for the human review.'
      }));
    }

    discussionContent.style.display = 'block';
  }

  function buildIssueCard (issue) {
    const card = document.createElement('div');
    card.className = 'review-issue';

    const sev = (issue.severity || 'info').toLowerCase();
    const desc = renderInlineMarkup(issue.description || '').replace(
      /\[Limited context\]/g,
      '<span class="limited-ctx-tag">[Limited context]</span>'
    );
    card.innerHTML = `
      <div class="review-issue-header">
        <span class="severity-badge severity-${sev}">${sev}</span>
        <div style="flex:1;min-width:0;">
          <div class="issue-title">${escHtml(issue.title || 'Issue')}</div>
          ${formatLocation(issue) ? `<div class="issue-file">${escHtml(formatLocation(issue))}</div>` : ''}
        </div>
      </div>
      <div class="review-issue-body">
        <p>${desc}</p>
        ${issue.suggestion ? `<p class="review-section-title" style="margin-top:10px;">Suggestion</p><pre>${escHtml(issue.suggestion)}</pre>` : ''}
      </div>`;
    card.querySelector('.review-issue-body')?.appendChild(buildCommentActionBar(issue));
    return card;
  }

  function buildStandardReviewCard (data) {
    const verdict = (data.verdict || 'REQUEST_CHANGES').toUpperCase();
    const verdictClass = verdict === 'APPROVE' ? 'verdict-approve' : verdict === 'REJECT' ? 'verdict-reject' : 'verdict-changes';
    const verdictIcon = verdict === 'APPROVE' ? 'OK' : verdict === 'REJECT' ? 'X' : '!';

    const card = document.createElement('div');
    card.className = 'review-block';
    card.innerHTML = `
      <div class="review-block-header">
        <div>
          <p class="review-kicker">Standard Review</p>
          <h3 class="review-block-title">Summary of Changes</h3>
        </div>
        <span class="verdict-badge ${verdictClass}">${verdictIcon} ${verdict.replace('_', ' ')}</span>
      </div>
      ${data.summary ? `<p class="review-block-copy">${renderInlineMarkup(data.summary)}</p>` : ''}
      ${renderSummaryBulletsHtml(data.summary_bullets)}
    `;
    return card;
  }

  function buildDiscussionQuestionCard (item, index) {
    const card = document.createElement('div');
    card.className = 'discussion-question';
    card.innerHTML = `
      <div class="discussion-question-header">
        <span class="discussion-index">Q${index + 1}</span>
        <div style="flex:1;min-width:0;">
          <div class="discussion-title">${renderInlineMarkup(item.question || 'Discussion question')}</div>
          ${formatLocation(item) ? `<div class="issue-file">${escHtml(formatLocation(item))}</div>` : ''}
        </div>
      </div>
      <div class="discussion-body">
        ${item.context ? `<p>${renderInlineMarkup(item.context)}</p>` : ''}
      </div>
    `;
    card.querySelector('.discussion-body')?.appendChild(buildCommentActionBar(item));
    return card;
  }

  function buildEmptySectionCard (text) {
    const empty = document.createElement('div');
    empty.className = 'section-empty';
    empty.textContent = text;
    return empty;
  }

  /* ── Render summary ─────────────────────────────────── */
  function renderSummary (data) {
    summaryEmpty.style.display = 'none';
    summaryContent.innerHTML = '';

    const stats = data.stats || {};
    const verdict = (data.verdict || 'REQUEST_CHANGES').toUpperCase();
    const verdictClass = verdict === 'APPROVE' ? 'verdict-approve' : verdict === 'REJECT' ? 'verdict-reject' : 'verdict-changes';
    const lowAndInfoCount = (stats.low ?? 0) + (stats.info ?? 0);
    const discussionCount = getVisibleDiscussionQuestions(data.discussion_questions || []).length;
    const verdictIcon = verdict === 'APPROVE' ? '✓' : verdict === 'REJECT' ? '✕' : '~';

    summaryContent.innerHTML = `
      <div class="summary-overview">
        <h3>
          <span class="verdict-badge ${verdictClass}">${verdictIcon} ${verdict.replace('_', ' ')}</span>
        </h3>
        ${data.summary ? `<p>${renderInlineMarkup(data.summary)}</p>` : ''}
      </div>

      <p class="review-section-title">Change Summary</p>
      <div class="summary-overview">
        ${renderSummaryBulletsHtml(data.summary_bullets)}
      </div>

      <p class="review-section-title">Review Breakdown</p>
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
          <div class="stat-value">${lowAndInfoCount}</div>
          <div class="stat-label">Low / Info</div>
        </div>
        <div class="stat-card stat-questions">
          <div class="stat-value">${discussionCount}</div>
          <div class="stat-label">Discussion Questions</div>
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
    discussionContent.style.display = 'none';
    discussionEmpty.style.display = 'flex';
    summaryContent.style.display = 'none';
    summaryEmpty.style.display = 'flex';
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
  function resetAnalysisViews () {
    reviewLoading.style.display = 'none';
    reviewResults.style.display = 'none';
    reviewResults.innerHTML = '';
    reviewEmpty.style.display = 'flex';
    discussionContent.style.display = 'none';
    discussionContent.innerHTML = '';
    discussionEmpty.style.display = 'flex';
    summaryContent.style.display = 'none';
    summaryContent.innerHTML = '';
    summaryEmpty.style.display = 'flex';
  }

  function buildAnnotationNavigator (placements, anchorMap, viewer, options) {
    const panel = document.createElement('aside');
    panel.className = 'annotation-nav';

    const placed = placements.filter(item => anchorMap.has(item.id));
    const unplaced = placements.filter(item => !anchorMap.has(item.id));

    panel.innerHTML = `
      <div class="annotation-nav-header">
        <p class="annotation-nav-kicker">${escHtml(options.title)}</p>
        <h3>${placed.length}</h3>
        <p>${placed.length ? 'Click an item to jump to the matching hunk and line.' : escHtml(options.emptyMessage)}</p>
      </div>
    `;

    if (placed.length > 0) {
      const list = document.createElement('div');
      list.className = 'annotation-nav-list';

      placed.forEach(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `annotation-nav-item annotation-nav-item-${options.kind}`;
        button.innerHTML = `
          ${options.kind === 'issue' ? `<span class="severity-badge severity-${escHtml(item.severity || 'info')}">${escHtml(item.severity || 'info')}</span>` : `<span class="discussion-index">Q${item.navIndex}</span>`}
          <span class="annotation-nav-copy">
            <strong>${renderInlineMarkup(options.kind === 'issue' ? (item.title || 'Issue') : (item.question || 'Discussion question'))}</strong>
            <span>${escHtml(formatLocation(item) || 'Unplaced')}</span>
          </span>
        `;
        button.addEventListener('click', () => focusAnnotationTarget(anchorMap.get(item.id), viewer, button));
        list.appendChild(button);
      });

      panel.appendChild(list);
    }

    if (unplaced.length > 0) {
      const unplacedTitle = document.createElement('p');
      unplacedTitle.className = 'annotation-nav-subtitle';
      unplacedTitle.textContent = 'Unplaced';
      panel.appendChild(unplacedTitle);

      const unplacedList = document.createElement('div');
      unplacedList.className = 'annotation-nav-unplaced';

      unplaced.forEach(item => {
        const row = document.createElement('div');
        row.className = 'annotation-nav-unplaced-item';
        row.innerHTML = `
          <strong>${renderInlineMarkup(options.kind === 'issue' ? (item.title || 'Issue') : (item.question || 'Discussion question'))}</strong>
          <span>${escHtml(formatLocation(item) || 'No matching line found in the diff')}</span>
        `;
        unplacedList.appendChild(row);
      });

      panel.appendChild(unplacedList);
    }

    return panel;
  }

  function focusAnnotationTarget (target, viewer, button) {
    if (!target) return;

    viewer.querySelectorAll('.annotation-current').forEach(node => node.classList.remove('annotation-current'));
    button.closest('.annotation-nav')?.querySelectorAll('.annotation-nav-item').forEach(node => node.classList.remove('active'));

    target.classList.add('annotation-current');
    button.classList.add('active');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });

    window.clearTimeout(focusAnnotationTarget.timerId);
    focusAnnotationTarget.timerId = window.setTimeout(() => {
      target.classList.remove('annotation-current');
    }, 1800);
  }

  function buildDiffAnnotationCard (annotation, kind) {
    const card = document.createElement('div');
    card.id = annotation.id;
    card.className = `diff-annotation diff-annotation-${kind}`;

    if (kind === 'discussion') {
      card.innerHTML = `
        <div class="diff-annotation-header">
          <span class="discussion-index">Q${annotation.navIndex}</span>
          <div class="diff-annotation-title">${renderInlineMarkup(annotation.question || 'Discussion question')}</div>
        </div>
        ${annotation.context ? `<p class="diff-annotation-copy">${renderInlineMarkup(annotation.context)}</p>` : ''}
      `;
      card.appendChild(buildCommentActionBar(annotation));
      return card;
    }

    const sev = escHtml(annotation.severity || 'info');
    const desc = renderInlineMarkup(annotation.description || '').replace(
      /\[Limited context\]/g,
      '<span class="limited-ctx-tag">[Limited context]</span>'
    );
    card.innerHTML = `
      <div class="diff-annotation-header">
        <span class="severity-badge severity-${sev}">${sev}</span>
        <div class="diff-annotation-title">${escHtml(annotation.title || 'Issue')}</div>
      </div>
      <p class="diff-annotation-copy">${desc}</p>
      ${annotation.suggestion ? `<pre>${escHtml(annotation.suggestion)}</pre>` : ''}
    `;
    card.appendChild(buildCommentActionBar(annotation));
    return card;
  }

  function buildCommentActionBar (item) {
    const actions = document.createElement('div');
    actions.className = 'comment-actions';

    const ignoredButton = document.createElement('button');
    ignoredButton.type = 'button';
    ignoredButton.className = 'comment-action-btn comment-action-btn-ignored';
    ignoredButton.textContent = 'Ignored';
    ignoredButton.addEventListener('click', () => setCommentStatus(item.id, 'ignored'));

    const fixedButton = document.createElement('button');
    fixedButton.type = 'button';
    fixedButton.className = 'comment-action-btn comment-action-btn-fixed';
    fixedButton.textContent = 'Fixed';
    fixedButton.addEventListener('click', () => setCommentStatus(item.id, 'fixed'));

    actions.appendChild(ignoredButton);
    actions.appendChild(fixedButton);
    return actions;
  }

  function setCommentStatus (commentId, status) {
    if (!commentId) return;
    commentStatuses[commentId] = status;
    rerenderAnalysisViews();
  }

  function resolveAnnotationPlacements (files, items, kind) {
    const lineCatalog = buildDiffLineCatalog(files);

    return items.map((item, index) => {
      const resolvedFile = resolveDiffFilePath(item.file, files);
      const line = normalizeLineNumber(item.line);
      const side = normalizeDiffSide(item.side);
      const targetType = resolvedFile && line && lineCatalog.get(resolvedFile)?.[side]?.has(line)
        ? 'line'
        : resolvedFile
          ? 'file'
          : 'unplaced';

      return {
        ...item,
        file: item.file || '',
        resolvedFile,
        line,
        side,
        kind,
        navIndex: index + 1,
        id: item.id || `${kind}-anchor-${index + 1}`,
        targetType
      };
    });
  }

  function groupAnnotationPlacements (placements) {
    const groups = new Map();

    placements.forEach(item => {
      if (!item.resolvedFile) return;

      if (!groups.has(item.resolvedFile)) {
        groups.set(item.resolvedFile, { total: 0, file: [], lines: new Map() });
      }

      const group = groups.get(item.resolvedFile);
      group.total += 1;

      if (item.targetType === 'line') {
        const key = `${item.side}:${item.line}`;
        if (!group.lines.has(key)) group.lines.set(key, []);
        group.lines.get(key).push(item);
      } else {
        group.file.push(item);
      }
    });

    return groups;
  }

  function getLineAnnotationsForRow (lineMap, line) {
    const matches = [];
    const seen = new Set();
    const keys = [];

    if (line.old !== '' && line.old !== null && line.old !== undefined) keys.push(`old:${line.old}`);
    if (line.new !== '' && line.new !== null && line.new !== undefined) keys.push(`new:${line.new}`);

    keys.forEach(key => {
      (lineMap.get(key) || []).forEach(item => {
        if (seen.has(item.id)) return;
        seen.add(item.id);
        matches.push(item);
      });
    });

    return matches;
  }

  function buildDiffLineCatalog (files) {
    const catalog = new Map();

    files.forEach(file => {
      const filePath = getDiffFilePath(file);
      const entry = { old: new Set(), new: new Set() };

      file.hunks.forEach(hunk => {
        hunk.lines.forEach(line => {
          if (line.old !== '') entry.old.add(Number(line.old));
          if (line.new !== '') entry.new.add(Number(line.new));
        });
      });

      catalog.set(filePath, entry);
    });

    return catalog;
  }

  function getDiffFilePath (file) {
    const preferred = file.newFile && file.newFile !== '/dev/null' ? file.newFile : file.oldFile;
    return normalizePath(preferred || '');
  }

  function resolveDiffFilePath (rawPath, files) {
    const normalized = normalizePath(rawPath || '');
    if (!normalized) return '';

    const exact = files.find(file => getDiffFilePath(file) === normalized);
    if (exact) return getDiffFilePath(exact);

    const suffixMatches = files.filter(file => {
      const candidate = getDiffFilePath(file);
      return candidate.endsWith('/' + normalized) || normalized.endsWith('/' + candidate) || getBaseName(candidate) === getBaseName(normalized);
    });

    return suffixMatches.length === 1 ? getDiffFilePath(suffixMatches[0]) : '';
  }

  function normalizePath (value) {
    return String(value || '')
      .replace(/\\/g, '/')
      .replace(/^(?:a|b)\//, '')
      .replace(/^\.\//, '')
      .trim();
  }

  function getBaseName (value) {
    const normalized = normalizePath(value);
    const parts = normalized.split('/');
    return parts[parts.length - 1] || normalized;
  }

  function normalizeLineNumber (value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function normalizeDiffSide (value) {
    return String(value || 'new').toLowerCase() === 'old' ? 'old' : 'new';
  }

  function formatLocation (item) {
    const file = normalizePath(item.resolvedFile || item.file || '');
    if (!file) return '';
    if (!item.line) return file;
    return `${file}:${item.line}${item.side === 'old' ? ' (old)' : ''}`;
  }

  function normalizeReviewData (data) {
    const review = data && typeof data === 'object' ? data : {};
    const summaryBullets = Array.isArray(review.summary_bullets)
      ? review.summary_bullets.map(item => String(item || '').trim()).filter(Boolean)
      : [];
    const issues = Array.isArray(review.issues)
      ? review.issues.map((item, index) => ({
        id: item?.id || `issue-${index + 1}`,
        severity: String(item?.severity || 'info').toLowerCase(),
        title: item?.title || 'Issue',
        file: item?.file || '',
        line: normalizeLineNumber(item?.line),
        side: normalizeDiffSide(item?.side),
        description: item?.description || '',
        suggestion: item?.suggestion || ''
      }))
      : [];
    const discussionQuestions = Array.isArray(review.discussion_questions)
      ? review.discussion_questions.map((item, index) => normalizeDiscussionQuestion(item, index)).filter(item => item.question)
      : [];

    return {
      verdict: review.verdict || 'REQUEST_CHANGES',
      summary: review.summary || '',
      summary_bullets: summaryBullets.length ? summaryBullets : (review.summary ? [review.summary] : []),
      stats: review.stats || {},
      issues,
      discussion_questions: discussionQuestions,
      positives: Array.isArray(review.positives) ? review.positives : []
    };
  }

  function normalizeDiscussionQuestion (item, index = 0) {
    if (typeof item === 'string') {
      return { id: `discussion-${index + 1}`, question: item, file: '', line: null, side: 'new', context: '' };
    }

    return {
      id: item?.id || `discussion-${index + 1}`,
      question: item?.question || '',
      file: item?.file || '',
      line: normalizeLineNumber(item?.line),
      side: normalizeDiffSide(item?.side),
      context: item?.context || ''
    };
  }

  function getVisibleIssues (issues) {
    const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return [...issues]
      .filter(item => !isCommentHidden(item))
      .sort((a, b) => (order[a.severity] ?? 5) - (order[b.severity] ?? 5));
  }

  function getVisibleDiscussionQuestions (questions) {
    return (questions || []).filter(item => !isCommentHidden(item));
  }

  function isCommentHidden (item) {
    return Boolean(item?.id && commentStatuses[item.id]);
  }

  function renderSummaryBulletsHtml (bullets) {
    if (!Array.isArray(bullets) || bullets.length === 0) {
      return '<div class="section-empty">No change summary was generated.</div>';
    }

    return `
      <ul class="summary-bullets">
        ${bullets.map(bullet => `<li>${renderInlineMarkup(bullet)}</li>`).join('')}
      </ul>
    `;
  }

  function renderInlineMarkup (str) {
    return escHtml(str || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

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
