const base = document.documentElement.dataset.bfBase;
const { renderMarkdown, renderInlineMarkdown, isVisible, escapeHtml } = await import(base + '/app/render.mjs');
const noStream = new URLSearchParams(location.search).has('nostream');
const token = base.split('/').pop();
const STORE = 'brainstormform:' + token;
const THEME_KEY = 'brainstormform:theme';
const $ = (sel, root = document) => root.querySelector(sel);
const mainEl = $('#main');

const state = {
  spec: null, revision: 0, status: 'open', pages: [], page: 0, dir: 'fwd',
  byId: {}, previews: {}, answers: {}, other: {}, skipped: {}, notes: {},
  submitted: false, review: false, startedAt: Date.now(), advanceTimer: null,
};

const cssEscape = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&'));
const qEl = (id) => mainEl.querySelector('[data-qid="' + cssEscape(id) + '"]');
const allQuestions = (spec) => spec.categories.flatMap((c) => c.questions);
const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const isVisibleQ = (q) => isVisible(q, state.answers);

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function buildPages(spec) {
  const size = Math.max(1, (spec.settings && spec.settings.pageSize) || 5);
  const pages = [];
  for (const cat of spec.categories) {
    for (let i = 0; i < cat.questions.length; i += size) {
      pages.push({ cat, questions: cat.questions.slice(i, i + size), first: i === 0 });
    }
  }
  return pages;
}

function visibleOnPage(i) {
  return state.pages[i].questions.filter(isVisibleQ);
}

function visibleKey() {
  return visibleOnPage(state.page).map((q) => q.id).join('|');
}

function clampPage() {
  if (!state.pages.length) return;
  if (visibleOnPage(state.page).length) return;
  for (let i = state.page; i < state.pages.length; i++) if (visibleOnPage(i).length) { state.page = i; return; }
  for (let i = state.page; i >= 0; i--) if (visibleOnPage(i).length) { state.page = i; return; }
}

function pageExists(i) {
  return i >= 0 && i < state.pages.length && visibleOnPage(i).length > 0;
}
function nextPage() {
  for (let i = state.page + 1; i < state.pages.length; i++) if (visibleOnPage(i).length) return i;
  return -1;
}
function prevPage() {
  for (let i = state.page - 1; i >= 0; i--) if (visibleOnPage(i).length) return i;
  return -1;
}

function questionHtml(q) {
  const val = state.answers[q.id];
  let body = '';

  if (q.type === 'single' || q.type === 'multi') {
    const arr = Array.isArray(val) ? val : [];
    const type = q.type === 'single' ? 'radio' : 'checkbox';
    let opts = q.options.map((o) => {
      const checked = q.type === 'single' ? val === o.value : arr.includes(o.value);
      return '<label class="opt' + (checked ? ' sel' : '') + '">' +
        '<input type="' + type + '" name="qf_' + escapeHtml(q.id) + '" value="' + escapeHtml(o.value) + '"' + (checked ? ' checked' : '') + '>' +
        '<span class="opt-main"><span class="opt-label">' + escapeHtml(o.label) + '</span>' +
        (o.description ? '<span class="opt-desc">' + escapeHtml(o.description) + '</span>' : '') +
        '</span></label>';
    }).join('');
    if (q.allowOther) {
      const on = q.type === 'single' ? val === '__other__' : arr.includes('__other__');
      opts += '<label class="opt' + (on ? ' sel' : '') + '"><input type="' + type + '" name="qf_' + escapeHtml(q.id) + '" value="__other__"' + (on ? ' checked' : '') + '>' +
        '<span class="opt-main"><span class="opt-label">Other…</span></span></label>';
      body = '<div class="opts">' + opts + '</div>' +
        '<input class="text-input other-input" type="text" data-other="' + escapeHtml(q.id) + '" placeholder="Your answer" value="' + escapeHtml(state.other[q.id] || '') + '"' + (on ? '' : ' hidden') + '>';
    } else {
      body = '<div class="opts">' + opts + '</div>';
    }
  } else if (q.type === 'visual') {
    const arr = Array.isArray(val) ? val : [];
    const type = q.multiple ? 'checkbox' : 'radio';
    body = '<div class="vgrid">' + q.options.map((o) => {
      const checked = q.multiple ? arr.includes(o.value) : val === o.value;
      return '<label class="vcard' + (checked ? ' sel' : '') + '">' +
        '<input type="' + type + '" name="qf_' + escapeHtml(q.id) + '" value="' + escapeHtml(o.value) + '"' + (checked ? ' checked' : '') + '>' +
        '<img src="' + escapeHtml(o.image) + '" alt="' + escapeHtml(o.label) + '" loading="lazy" onerror="this.style.opacity=.15">' +
        '<span class="vbody"><span class="vlabel">' + escapeHtml(o.label) + '</span>' +
        (o.description ? '<span class="vdesc">' + escapeHtml(o.description) + '</span>' : '') + '</span></label>';
    }).join('') + '</div>';
  } else if (q.type === 'text') {
    body = '<input class="text-input" type="text" data-field="' + escapeHtml(q.id) + '" placeholder="' + escapeHtml(q.placeholder || '') + '" value="' + escapeHtml(val == null ? '' : val) + '">';
  } else if (q.type === 'textarea') {
    const text = val == null ? '' : String(val);
    body = '<div class="ta-wrap"><textarea class="ta" rows="4" data-field="' + escapeHtml(q.id) + '" placeholder="' + escapeHtml(q.placeholder || '') + '">' + escapeHtml(text) + '</textarea><span class="count">' + text.length + '</span></div>';
  } else if (q.type === 'number') {
    body = '<input class="text-input num" type="number" data-field="' + escapeHtml(q.id) + '" min="' + q.min + '" max="' + q.max + '" step="' + q.step + '" value="' + escapeHtml(val == null ? '' : val) + '" placeholder="' + escapeHtml(q.placeholder || '') + '">';
  } else if (q.type === 'scale') {
    let segs = '';
    for (let v = q.min; v <= q.max; v += q.step) {
      segs += '<button type="button" class="seg' + (val === v ? ' sel' : '') + '" data-seg="' + escapeHtml(q.id) + '" data-value="' + v + '">' + v + '</button>';
    }
    const labels = Array.isArray(q.scaleLabels) && q.scaleLabels.length
      ? '<div class="scale-labels"><span>' + escapeHtml(q.scaleLabels[0]) + '</span><span>' + escapeHtml(q.scaleLabels[q.scaleLabels.length - 1]) + '</span></div>' : '';
    if (state.spec.settings.scaleStyle === 'slider') {
      body = '<input type="range" class="range" data-range="' + escapeHtml(q.id) + '" min="' + q.min + '" max="' + q.max + '" step="' + q.step + '" value="' + (val == null ? q.min : val) + '" aria-label="' + escapeHtml(q.label) + '">' + labels;
    } else {
      body = '<div class="segs">' + segs + '</div>' + labels;
    }
  } else if (q.type === 'boolean') {
    body = '<div class="segs">' +
      '<button type="button" class="seg' + (val === true ? ' sel' : '') + '" data-seg="' + escapeHtml(q.id) + '" data-value="true">Yes</button>' +
      '<button type="button" class="seg' + (val === false ? ' sel' : '') + '" data-seg="' + escapeHtml(q.id) + '" data-value="false">No</button></div>';
  } else if (q.type === 'matrix') {
    const chosen = state.answers[q.id] && typeof state.answers[q.id] === 'object' ? state.answers[q.id] : {};
    body = '<div class="mx"><table><thead><tr><th></th>' +
      q.columns.map((c) => '<th>' + escapeHtml(c.label) + '</th>').join('') + '</tr></thead><tbody>' +
      q.rows.map((r) => '<tr><th scope="row">' + escapeHtml(r.label) + '</th>' +
        q.columns.map((c) => '<td><label class="mx-cell"><input type="radio" name="qf_' + escapeHtml(q.id) + '_' + escapeHtml(r.value) +
          '" data-matrix="' + escapeHtml(q.id) + '" data-row="' + escapeHtml(r.value) + '" value="' + escapeHtml(c.value) + '"' +
          (chosen[r.value] === c.value ? ' checked' : '') + '></label></td>').join('') + '</tr>').join('') +
      '</tbody></table></div>';
  } else if (q.type === 'rank') {
    const order = Array.isArray(val) && val.length ? val : q.options.map((o) => o.value);
    body = '<ol class="rank">' + order.map((v, i) => {
      const o = q.options.find((x) => x.value === v) || { label: v };
      return '<li class="rank-item"><span class="rank-n">' + (i + 1) + '</span><span class="rank-l">' + escapeHtml(o.label) + '</span>' +
        '<button type="button" class="rm" data-rank="' + escapeHtml(q.id) + '" data-move="up" data-i="' + i + '" aria-label="Move up">↑</button>' +
        '<button type="button" class="rm" data-rank="' + escapeHtml(q.id) + '" data-move="down" data-i="' + i + '" aria-label="Move down">↓</button></li>';
    }).join('') + '</ol>';
  } else if (q.type === 'file') {
    const files = Array.isArray(val) ? val : [];
    const chips = files.map((f, i) => {
      const preview = state.previews[f.path];
      const thumb = preview ? '<img src="' + preview + '" alt="">' : '<span class="ficon">📎</span>';
      return '<div class="file">' + thumb + '<span class="fmeta"><span class="fname">' + escapeHtml(f.name) + '</span><span class="fsize">' + fmtSize(f.size) + '</span></span>' +
        '<button type="button" class="rm" data-remove="' + escapeHtml(q.id) + '" data-index="' + i + '" aria-label="Remove">✕</button></div>';
    }).join('');
    body = '<div class="drop" data-drop="' + escapeHtml(q.id) + '">Drag &amp; drop or click to choose ' + (q.multiple ? 'files' : 'a file') + '</div>' +
      '<input type="file" data-file="' + escapeHtml(q.id) + '" accept="' + escapeHtml(q.accept) + '"' + (q.multiple ? ' multiple' : '') + ' hidden>' +
      (chips ? '<div class="files">' + chips + '</div>' : '');
  }

  const skipped = state.skipped[q.id] && !isEmpty(val);
  const skipBtn = q.required ? '' : '<button type="button" class="skip' + (state.skipped[q.id] ? ' on' : '') + '" data-skip="' + escapeHtml(q.id) + '">' + (state.skipped[q.id] ? 'Skipped' : 'Skip') + '</button>';
  const note = state.notes[q.id] || '';
  const noteBlock = '<div class="note-wrap"><button type="button" class="note-toggle' + (note ? ' on' : '') + '" data-note="' + escapeHtml(q.id) + '">' + (note ? 'Note' : 'Add a note') + '</button>' +
    '<textarea class="ta note" rows="2" data-note-field="' + escapeHtml(q.id) + '" placeholder="Nothing fits? Add context for this answer…"' + (note ? '' : ' hidden') + '>' + escapeHtml(note) + '</textarea></div>';

  return '<div class="q' + (skipped ? ' skipped' : '') + '" data-qid="' + escapeHtml(q.id) + '" data-type="' + q.type + '" role="group" aria-labelledby="lbl_' + escapeHtml(q.id) + '">' +
    '<div class="qlabel" id="lbl_' + escapeHtml(q.id) + '">' + renderInlineMarkdown(q.label) + (q.required ? '<span class="req" aria-hidden="true">*</span>' : '') + '</div>' +
    (q.intro ? '<div class="md">' + renderMarkdown(q.intro) + '</div>' : '') +
    (q.content ? '<div class="content md">' + renderMarkdown(q.content) + '</div>' : '') +
    body +
    noteBlock +
    '<div class="q-foot"><span></span>' + skipBtn + '</div>' +
    '<p class="err" hidden></p>' +
    '</div>';
}

function render(scroll) {
  if (state.submitted) return;
  if (state.review) return renderReview();
  clampPage();
  const page = state.pages[state.page];
  const vis = visibleOnPage(state.page);
  const head = page.first
    ? '<div class="page-head" style="animation:rise .3s cubic-bezier(.2,.7,.2,1) both"><h2>' + renderInlineMarkdown(page.cat.title) + '</h2>' +
      (page.cat.intro ? '<div class="md">' + renderMarkdown(page.cat.intro) + '</div>' : '') + '</div>'
    : '';
  mainEl.innerHTML = head + '<div class="page anim" id="pageHost" data-dir="' + state.dir + '">' + vis.map(questionHtml).join('') + '</div>';
  mainEl.classList.remove('anim');
  updateFooter();
  if (scroll !== false) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function refreshQuestion(id) {
  const host = qEl(id);
  if (!host) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = questionHtml(state.byId[id]);
  host.replaceWith(tmp.firstElementChild);
  updateFooter();
}

function updateFooter() {
  if (state.review || state.submitted) return;
  $('#prev').hidden = false;
  $('#skipSection').hidden = false;
  $('#next').hidden = false;
  $('#pager').hidden = false;
  const page = state.pages[state.page];
  $('#sectionLabel').textContent = page ? page.cat.title : '';
  $('#prev').textContent = '← Back';
  const nextIdx = nextPage();
  $('#prev').disabled = prevPage() < 0;
  $('#next').disabled = nextIdx < 0;
  const finishLabel = (state.spec.settings && state.spec.settings.finishLabel) || 'Finish';
  $('#finish').textContent = finishLabel;
  const submitLabel = (state.spec.settings && state.spec.settings.submitLabel) || 'Continue';
  $('#next').textContent = submitLabel + ' →';
  const visiblePages = state.pages.filter((_, i) => visibleOnPage(i).length).length;
  const passed = state.pages.slice(0, state.page + 1).filter((_, i) => visibleOnPage(i).length).length;
  $('#progressBar').style.width = (passed / visiblePages) * 100 + '%';
  const pager = $('#pager');
  if (state.pages.length <= 15) {
    let n = 0;
    pager.innerHTML = state.pages.map((_, i) => {
      if (!visibleOnPage(i).length) return '';
      const dot = '<button type="button" class="pdot' + (i === state.page ? ' cur' : '') + '" data-page="' + i + '" aria-label="Page ' + (++n) + '"></button>';
      return dot;
    }).join('');
  } else {
    pager.innerHTML = '<span class="page-count">Page ' + passed + ' of ' + visiblePages + '</span>';
  }
}

function validateQuestion(q) {
  const v = state.answers[q.id];
  if (!isVisibleQ(q)) return null;
  if (state.skipped[q.id]) return null;
  if (q.required && isEmpty(v)) return 'This question is required.';
  if (!isEmpty(v)) {
    if (q.type === 'number') {
      const n = Number(v);
      if (Number.isNaN(n)) return 'Enter a number.';
      if (n < q.min || n > q.max) return 'Enter a value between ' + q.min + ' and ' + q.max + '.';
    }
    if ((q.type === 'single' || q.type === 'multi') && q.allowOther) {
      const usesOther = Array.isArray(v) ? v.includes('__other__') : v === '__other__';
      if (usesOther && !(state.other[q.id] || '').trim()) return 'Please specify your "Other" answer.';
    }
  }
  if (q.type === 'matrix' && q.required) {
    const val = state.answers[q.id] || {};
    if (q.rows.some((r) => !val[r.value])) return 'Answer every row.';
  }
  return null;
}

function showError(id, msg) {
  const host = qEl(id);
  if (!host) return;
  const err = host.querySelector('.err');
  if (msg) { err.textContent = msg; err.hidden = false; host.classList.add('invalid'); }
  else { err.hidden = true; host.classList.remove('invalid'); }
}

function validateAll() {
  const bad = [];
  for (const q of allQuestions(state.spec)) {
    const msg = validateQuestion(q);
    if (qEl(q.id)) showError(q.id, msg);
    if (msg) bad.push(q);
  }
  return bad;
}

function goToQuestion(id) {
  for (let i = 0; i < state.pages.length; i++) {
    if (state.pages[i].questions.some((q) => q.id === id)) {
      state.page = i; state.dir = 'fwd'; render();
      for (const q of state.pages[i].questions) showError(q.id, validateQuestion(q));
      const el = qEl(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
  }
}

function next() {
  const idx = nextPage();
  if (idx < 0) return finish();
  const bad = validateAll().filter((q) => state.pages[state.page].questions.includes(q));
  if (bad.length) { const el = qEl(bad[0].id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('Please complete the required questions.'); return; }
  state.page = idx; state.dir = 'fwd'; scheduleSave(true); render();
}
function prev() {
  const idx = prevPage();
  if (idx < 0) return;
  state.page = idx; state.dir = 'back'; save(); render();
}

function buildOutput() {
  const out = {};
  for (const q of allQuestions(state.spec)) {
    if (!isVisibleQ(q) || state.skipped[q.id]) continue;
    const v = state.answers[q.id];
    if (isEmpty(v)) continue;
    if (q.type === 'single') out[q.id] = { type: 'single', value: v === '__other__' ? null : v, other: (state.other[q.id] || null) };
    else if (q.type === 'multi') out[q.id] = { type: 'multi', value: (Array.isArray(v) ? v : []).filter((x) => x !== '__other__'), other: (state.other[q.id] || null) };
    else if (q.type === 'visual') out[q.id] = { type: 'visual', value: v };
    else if (q.type === 'number') out[q.id] = { type: 'number', value: Number(v) };
    else if (q.type === 'scale') out[q.id] = { type: 'scale', value: Number(v) };
    else if (q.type === 'boolean') out[q.id] = { type: 'boolean', value: !!v };
    else if (q.type === 'file') out[q.id] = { type: 'file', value: v };
    else if (q.type === 'matrix') { if (v && typeof v === 'object' && Object.keys(v).length) out[q.id] = { type: 'matrix', value: v }; }
    else if (q.type === 'rank') out[q.id] = { type: 'rank', value: v };
    else out[q.id] = { type: q.type, value: v };
  }
  return out;
}

function skippedIds() {
  const out = new Set();
  for (const q of allQuestions(state.spec)) {
    if (!isVisibleQ(q)) continue;
    if (state.skipped[q.id]) out.add(q.id);
    else if (!q.required && isEmpty(state.answers[q.id])) out.add(q.id);
  }
  return [...out];
}
function skippedKeys() {
  return Object.keys(state.skipped).filter((id) => state.skipped[id]);
}
function unansweredIds() {
  return allQuestions(state.spec).filter((q) => isVisibleQ(q) && q.required && isEmpty(state.answers[q.id]) && !state.skipped[q.id]).map((q) => q.id);
}
function hiddenIds() {
  return allQuestions(state.spec).filter((q) => !isVisibleQ(q)).map((q) => q.id);
}
function notesForSubmit() {
  const hidden = new Set(hiddenIds());
  const out = {};
  for (const q of allQuestions(state.spec)) {
    if (hidden.has(q.id)) continue;
    const text = (state.notes[q.id] || '').trim();
    if (text) out[q.id] = text;
  }
  return out;
}

function finish() {
  const bad = validateAll();
  if (bad.length) { goToQuestion(bad[0].id); toast('Please complete the required questions.'); return; }
  state.review = true;
  render();
}
function editAnswers() { state.review = false; render(); }

function renderReview() {
  const foot = $('#foot');
  foot.hidden = false;
  $('#prev').hidden = false;
  $('#next').hidden = true;
  $('#skipSection').hidden = true;
  $('#pager').hidden = true;
  $('#prev').textContent = '← Keep editing';
  $('#finish').textContent = 'Confirm & send';
  const rows = [];
  for (const cat of state.spec.categories) {
    const qs = cat.questions.filter(isVisibleQ);
    if (!qs.length) continue;
    rows.push('<div class="rv-cat">' + renderInlineMarkdown(cat.title) + '</div>');
    for (const q of qs) {
      const v = state.answers[q.id];
      const skipped = state.skipped[q.id] || (!q.required && isEmpty(v));
      let text = '—';
      if (skipped) text = 'Skipped';
      else if (!isEmpty(v)) {
        if (q.type === 'file') text = v.map((f) => f.name).join(', ');
        else if (q.type === 'boolean') text = v ? 'Yes' : 'No';
        else if (q.type === 'matrix') text = Object.entries(v).map(([r, c]) => r + ': ' + c).join(', ');
        else if (q.type === 'rank') text = v.join(' › ');
        else if (Array.isArray(v)) text = v.filter((x) => x !== '__other__').join(', ') + (state.other[q.id] ? ' (+ ' + state.other[q.id] + ')' : '');
        else if (v === '__other__') text = state.other[q.id] || 'Other';
        else text = String(v) + ((q.type === 'single' || q.type === 'multi') && state.other[q.id] ? ' (+ ' + state.other[q.id] + ')' : '');
      }
      const note = (state.notes[q.id] || '').trim();
      rows.push('<div class="rv"><div class="rq">' + renderInlineMarkdown(q.label) + '</div>' +
        '<div class="ra' + (skipped || text === '—' ? ' empty' : '') + '">' + escapeHtml(text) + '</div>' +
        (note ? '<div class="rv-note">Note: ' + escapeHtml(note) + '</div>' : '') + '</div>');
    }
  }
  mainEl.innerHTML = '<div class="review"><h2>Ready to send?</h2><p>Check your answers. Nothing is sent to the agent until you confirm.</p>' + rows.join('') + '</div>';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submit() {
  const btn = $('#finish');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  const payload = {
    answers: buildOutput(),
    notes: notesForSubmit(),
    skipped: skippedIds(),
    unanswered: unansweredIds(),
    hidden: hiddenIds(),
    durationMs: Date.now() - state.startedAt,
  };
  try {
    const res = await fetch(base + '/api/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.submitted = true;
    try { localStorage.removeItem(STORE); } catch { /* ignore */ }
    showDone(payload);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm & send'; }
    toast('Could not submit, please try again.');
  }
}

function summaryMarkdown(payload) {
  const lines = ['# ' + state.spec.title, '', '_Submitted ' + new Date().toLocaleString() + '_', ''];
  for (const cat of state.spec.categories) {
    const qs = cat.questions.filter(isVisibleQ);
    if (!qs.length) continue;
    lines.push('## ' + cat.title, '');
    for (const q of qs) {
      const a = payload.answers[q.id];
      lines.push('**' + q.label + '**');
      if (!a) lines.push('_skipped_');
      else if (a.type === 'file') lines.push(a.value.map((f) => '- ' + f.name + ' (' + f.path + ')').join('\n'));
      else if (Array.isArray(a.value)) lines.push('- ' + a.value.join('\n- ') + (a.other ? ' (other: ' + a.other + ')' : ''));
      else if (a.value && typeof a.value === 'object') lines.push(Object.entries(a.value).map(([k, v]) => '- ' + k + ': ' + v).join('\n'));
      else lines.push(String(a.value) + (a.other ? ' (other: ' + a.other + ')' : ''));
      if (payload.notes && payload.notes[q.id]) lines.push('_Note: ' + payload.notes[q.id] + '_');
      lines.push('');
    }
  }
  return lines.join('\n');
}

function download(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showDone(payload) {
  $('#foot').hidden = true;
  const answered = Object.keys(payload.answers).length;
  mainEl.innerHTML = '<div class="done"><div class="tick">✓</div><h2>Answers sent</h2>' +
    '<p>Your agent has received the answers (' + answered + ' answered). You can close this tab or keep a copy below.</p>' +
    '<div class="row"><button class="btn primary" id="dlJson" type="button">Download JSON</button>' +
    '<button class="btn ghost" id="dlMd" type="button">Download Markdown</button></div></div>';
  $('#dlJson').addEventListener('click', () => download('brainstormform-answers.json', JSON.stringify(payload, null, 2), 'application/json'));
  $('#dlMd').addEventListener('click', () => download('brainstormform-answers.md', summaryMarkdown(payload), 'text/markdown'));
  $('#introBox').hidden = true;
  $('#progressBar').style.width = '100%';
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

let saveTimer = null;
let saving = false;
let saveQueued = false;
function setSaveState(text) { $('#saveState').textContent = text; }

function scheduleSave(immediate) {
  if (state.submitted) return;
  setSaveState('Saving…');
  clearTimeout(saveTimer);
  if (immediate) return save();
  saveTimer = setTimeout(save, 500);
}

async function save() {
  if (state.submitted) return;
  if (saving) { saveQueued = true; return; }
  saving = true;
  try {
    await fetch(base + '/api/progress', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: state.answers, other: state.other, notes: state.notes, skipped: skippedKeys() }),
    });
    setSaveState('Saved');
  } catch {
    setSaveState('Offline');
  } finally {
    saving = false;
    if (saveQueued) { saveQueued = false; save(); }
  }
}

function localSave() {
  try { localStorage.setItem(STORE, JSON.stringify({ answers: state.answers, other: state.other, notes: state.notes, skipped: state.skipped, page: state.page })); } catch { /* ignore */ }
}
function localRestore() {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.answers) Object.assign(state.answers, saved.answers);
    if (saved.other) Object.assign(state.other, saved.other);
    if (saved.notes) Object.assign(state.notes, saved.notes);
    if (saved.skipped) Object.assign(state.skipped, saved.skipped);
    if (Number.isInteger(saved.page)) state.page = saved.page;
  } catch { /* ignore */ }
}

function setTheme(mode, persist = true) {
  document.documentElement.dataset.theme = mode;
  $('#theme').textContent = mode === 'dark' ? '☀' : '☾';
  if (persist) { try { localStorage.setItem(THEME_KEY, mode); } catch { /* ignore */ } }
}
function initTheme(specTheme) {
  let mode;
  try { mode = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
  if (mode !== 'light' && mode !== 'dark') {
    mode = specTheme === 'light' || specTheme === 'dark'
      ? specTheme
      : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  setTheme(mode, false);
}

async function uploadFile(qid, file) {
  try {
    const res = await fetch(base + '/api/upload?name=' + encodeURIComponent(file.name), {
      method: 'POST',
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const info = await res.json();
    if (file.type && file.type.startsWith('image/')) state.previews[info.path] = URL.createObjectURL(file);
    if (!Array.isArray(state.answers[qid])) state.answers[qid] = [];
    state.answers[qid].push(info);
    scheduleSave(true);
    refreshQuestion(qid);
  } catch {
    toast('Upload failed: ' + file.name);
  }
}

async function handleFiles(qid, fileList) {
  const q = state.byId[qid];
  const files = Array.from(fileList || []);
  const room = q.multiple ? Math.max(0, q.maxFiles - (state.answers[qid] || []).length) : 1;
  if (!q.multiple && (state.answers[qid] || []).length) state.answers[qid] = [];
  for (const file of files.slice(0, room)) await uploadFile(qid, file);
  if (files.length > room) toast('Only ' + q.maxFiles + ' file(s) allowed.');
}

function applyAnswerFromChange(host, t) {
  const q = state.byId[host.dataset.qid];
  if (!q) return;
  if (q.type === 'single' || (q.type === 'visual' && !q.multiple)) state.answers[q.id] = t.value;
  else if (q.type === 'multi' || (q.type === 'visual' && q.multiple)) state.answers[q.id] = Array.from(host.querySelectorAll('input:checked')).map((i) => i.value);
  else if (q.type === 'text' || q.type === 'textarea') state.answers[q.id] = t.value;
  else if (q.type === 'number') state.answers[q.id] = t.value === '' ? '' : Number(t.value);
  delete state.skipped[q.id];
  host.querySelectorAll('.opt,.vcard').forEach((lbl) => { const inp = lbl.querySelector('input'); if (inp) lbl.classList.toggle('sel', inp.checked); });
  const other = host.querySelector('.other-input');
  if (other) {
    const v = state.answers[q.id];
    const on = Array.isArray(v) ? v.includes('__other__') : v === '__other__';
    other.hidden = !on;
    if (on) other.focus();
  }
  showError(q.id, null);
}

function onChoiceChange(before) {
  scheduleSave(true);
  if (visibleKey() !== before) render(false);
  maybeAdvance();
}

function maybeAdvance() {
  if (!state.spec.settings.autoAdvance) return;
  clearTimeout(state.advanceTimer);
  state.advanceTimer = setTimeout(() => { if (!state.review && !state.submitted) next(); }, 350);
}

mainEl.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches('input[type=file]')) { handleFiles(t.dataset.file, t.files); t.value = ''; return; }
  const host = t.closest('[data-qid]');
  if (!host) return;
  const before = visibleKey();
  if (t.dataset && t.dataset.matrix !== undefined) {
    const id = t.dataset.matrix;
    const current = state.answers[id] && typeof state.answers[id] === 'object' ? { ...state.answers[id] } : {};
    current[t.dataset.row] = t.value;
    state.answers[id] = current;
    delete state.skipped[id];
    showError(id, null);
    scheduleSave(true);
    return;
  }
  applyAnswerFromChange(host, t);
  onChoiceChange(before);
});

mainEl.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.range !== undefined) {
    const id = t.dataset.range;
    state.answers[id] = Number(t.value);
    delete state.skipped[id];
    scheduleSave();
    return;
  }
  if (t.dataset && t.dataset.other !== undefined) {
    state.other[t.dataset.other] = t.value;
    showError(t.dataset.other, null);
    scheduleSave();
    return;
  }
  if (t.dataset && t.dataset.noteField !== undefined) {
    state.notes[t.dataset.noteField] = t.value;
    const wrap = t.closest('.note-wrap');
    const btn = wrap && wrap.querySelector('.note-toggle');
    if (btn) { const has = t.value.trim().length > 0; btn.classList.toggle('on', has); btn.textContent = has ? 'Note' : 'Add a note'; }
    scheduleSave();
    return;
  }
  if (!t.dataset || !t.dataset.field) return;
  const q = state.byId[t.dataset.field];
  if (!q) return;
  state.answers[q.id] = q.type === 'number' ? (t.value === '' ? '' : Number(t.value)) : t.value;
  delete state.skipped[q.id];
  if (q.type === 'textarea') { const c = t.parentElement.querySelector('.count'); if (c) c.textContent = t.value.length; }
  showError(q.id, null);
  scheduleSave();
});

mainEl.addEventListener('click', (e) => {
  const t = e.target;
  if (t.matches && t.matches('input[type=file]')) return;
  const zone = t.closest('[data-drop]');
  if (zone) { const input = qEl(zone.dataset.drop).querySelector('input[type=file]'); if (input) input.click(); return; }
  const noteBtn = t.closest('[data-note]');
  if (noteBtn) {
    const field = qEl(noteBtn.dataset.note).querySelector('[data-note-field]');
    if (field) { field.hidden = !field.hidden; if (!field.hidden) field.focus(); }
    return;
  }
  const rm = t.closest('[data-remove]');
  if (rm) {
    const id = rm.dataset.remove;
    const list = state.answers[id] || [];
    list.splice(Number(rm.dataset.index), 1);
    state.answers[id] = list;
    scheduleSave(true); refreshQuestion(id); return;
  }
  const skip = t.closest('[data-skip]');
  if (skip) {
    const id = skip.dataset.skip;
    if (state.skipped[id]) {
      delete state.skipped[id];
    } else {
      state.skipped[id] = true;
      state.answers[id] = undefined;
      state.other[id] = '';
    }
    scheduleSave(true); refreshQuestion(id); return;
  }
  const rankBtn = t.closest('[data-rank]');
  if (rankBtn) {
    const id = rankBtn.dataset.rank;
    const q = state.byId[id];
    const order = (Array.isArray(state.answers[id]) && state.answers[id].length ? state.answers[id] : q.options.map((o) => o.value)).slice();
    const i = Number(rankBtn.dataset.i);
    const j = rankBtn.dataset.move === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    state.answers[id] = order;
    delete state.skipped[id];
    scheduleSave(true); refreshQuestion(id);
    return;
  }
  const seg = t.closest('[data-seg]');
  if (seg) {
    const id = seg.dataset.seg;
    const q = state.byId[id];
    const before = visibleKey();
    state.answers[id] = q.type === 'boolean' ? seg.dataset.value === 'true' : Number(seg.dataset.value);
    delete state.skipped[id];
    qEl(id).querySelectorAll('.seg').forEach((s) => s.classList.toggle('sel', s === seg));
    showError(id, null);
    onChoiceChange(before);
  }
});

mainEl.addEventListener('dragover', (e) => { const z = e.target.closest('[data-drop]'); if (!z) return; e.preventDefault(); z.classList.add('over'); });
mainEl.addEventListener('dragleave', (e) => { const z = e.target.closest('[data-drop]'); if (z) z.classList.remove('over'); });
mainEl.addEventListener('drop', (e) => { const z = e.target.closest('[data-drop]'); if (!z) return; e.preventDefault(); z.classList.remove('over'); handleFiles(z.dataset.drop, e.dataTransfer.files); });

$('#pager').addEventListener('click', (e) => {
  const dot = e.target.closest('[data-page]');
  if (!dot) return;
  const target = Number(dot.dataset.page);
  if (target === state.page) return;
  if (target > state.page) {
    const bad = validateAll().filter((q) => state.pages[state.page].questions.includes(q));
    if (bad.length) { toast('Please complete the required questions.'); return; }
  }
  state.dir = target > state.page ? 'fwd' : 'back';
  state.page = target;
  scheduleSave(true); render();
});

$('#prev').addEventListener('click', () => { if (state.review) { editAnswers(); return; } prev(); });
$('#next').addEventListener('click', next);
$('#finish').addEventListener('click', () => { if (state.review) { submit(); return; } finish(); });
$('#theme').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
$('#skipSection').addEventListener('click', () => {
  if (state.review || state.submitted) return;
  for (const q of visibleOnPage(state.page)) {
    if (q.required) continue;
    state.skipped[q.id] = true;
    state.answers[q.id] = undefined;
  }
  scheduleSave(true);
  const idx = nextPage();
  if (idx < 0) { render(); return; }
  state.page = idx; state.dir = 'fwd'; render();
});
$('#helpClose').addEventListener('click', () => { $('#help').hidden = true; });
function toggleHelp() { $('#help').hidden = !$('#help').hidden; }

function activeChoiceQuestion() {
  const focused = document.activeElement && document.activeElement.closest('[data-qid]');
  if (focused) { const q = state.byId[focused.dataset.qid]; if (q && (q.type === 'single' || q.type === 'multi' || q.type === 'visual' || q.type === 'boolean' || q.type === 'scale')) return q; }
  return visibleOnPage(state.page).find((q) => ['single', 'multi', 'visual', 'boolean', 'scale'].includes(q.type) && isEmpty(state.answers[q.id]) && !state.skipped[q.id]);
}

document.addEventListener('keydown', (e) => {
  if (state.submitted) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (e.key === '?') { e.preventDefault(); toggleHelp(); return; }
  if (e.key === 'Escape') { $('#help').hidden = true; return; }
  if (/^[1-9]$/.test(e.key)) {
    const q = activeChoiceQuestion();
    if (!q) return;
    const idx = Number(e.key) - 1;
    const before = visibleKey();
    if (q.type === 'boolean') { if (idx > 1) return; state.answers[q.id] = idx === 0; }
    else if (q.type === 'scale') { const v = q.min + idx * q.step; if (v > q.max) return; state.answers[q.id] = v; }
    else if (q.options && q.options[idx]) {
      const value = q.options[idx].value;
      if (q.type === 'single' || (q.type === 'visual' && !q.multiple)) state.answers[q.id] = value;
      else { const arr = Array.isArray(state.answers[q.id]) ? state.answers[q.id] : []; state.answers[q.id] = arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value]; }
    } else return;
    delete state.skipped[q.id];
    e.preventDefault();
    onChoiceChange(before);
    return;
  }
  if (e.key === 'Enter') { e.preventDefault(); next(); return; }
  if (e.key === 'ArrowLeft') prev();
  else if (e.key === 'ArrowRight') next();
});

window.addEventListener('beforeunload', () => {
  localSave();
  if (!state.submitted && navigator.sendBeacon) {
    try { navigator.sendBeacon(base + '/api/progress', new Blob([JSON.stringify({ answers: state.answers, other: state.other, notes: state.notes, skipped: skippedKeys() })], { type: 'application/json' })); } catch { /* ignore */ }
  }
});

let newCount = 0;
function openStream() {
  let es;
  try { es = new EventSource(base + '/api/events'); } catch { return; }
  es.addEventListener('hello', (e) => { const d = JSON.parse(e.data); state.revision = d.revision || state.revision; if (d.status === 'submitted') onRemoteSubmit(); });
  es.addEventListener('state', (e) => { const d = JSON.parse(e.data); state.revision = d.revision || state.revision; if (d.status === 'submitted') onRemoteSubmit(); });
  es.addEventListener('appended', (e) => {
    const d = JSON.parse(e.data);
    const before = state.spec ? allQuestions(state.spec).length : 0;
    state.spec = d.spec;
    state.revision = d.revision;
    indexSpec();
    state.pages = buildPages(state.spec);
    const added = allQuestions(state.spec).length - before;
    if (added > 0) toast(added + ' new question' + (added === 1 ? '' : 's') + ' added');
    render();
  });
  es.addEventListener('error', () => { /* EventSource retries automatically */ });
}
function onRemoteSubmit() {
  if (state.submitted) return;
  state.submitted = true;
  $('#foot').hidden = true;
  mainEl.innerHTML = '<div class="done"><div class="tick">✓</div><h2>Answers sent</h2><p>This form was submitted.</p></div>';
}

function indexSpec() {
  state.byId = {};
  for (const cat of state.spec.categories) for (const q of cat.questions) state.byId[q.id] = q;
}

async function boot() {
  initTheme();
  let data;
  try {
    const res = await fetch(base + '/api/questions');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  } catch (err) {
    mainEl.innerHTML = '<div class="fatal">Could not load the questions (' + escapeHtml(err.message) + '). The session may have expired — ask your agent to start a new one.</div>';
    return;
  }
  state.spec = data.spec;
  state.revision = data.revision;
  state.status = data.status;
  initTheme(state.spec.settings && state.spec.settings.theme);
  document.title = state.spec.title || 'Brainstormform';
  $('#title').textContent = state.spec.title || '';
  $('#intro').innerHTML = state.spec.intro ? renderMarkdown(state.spec.intro) : '';
  $('#introBox').hidden = !state.spec.intro;
  $('#foot').hidden = false;
  indexSpec();
  state.pages = buildPages(state.spec);

  for (const q of allQuestions(state.spec)) {
    if (q.default !== undefined && isEmpty(state.answers[q.id])) state.answers[q.id] = q.default;
    if (q.type === 'rank' && isEmpty(state.answers[q.id])) state.answers[q.id] = q.options.map((o) => o.value);
  }

  localRestore();
  try {
    const res = await fetch(base + '/api/progress');
    if (res.ok) {
      const p = await res.json();
      if (p && p.answers) Object.assign(state.answers, p.answers);
      if (p && p.other) Object.assign(state.other, p.other);
      if (p && p.notes) Object.assign(state.notes, p.notes);
      if (p && Array.isArray(p.skipped)) for (const id of p.skipped) state.skipped[id] = true;
    }
  } catch { /* ignore */ }

  if (state.status === 'submitted') { onRemoteSubmit(); return; }
  render();
  if (!noStream) openStream();
}

boot();
