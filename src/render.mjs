// Pure helpers shared by the browser and Node. No DOM, no dependencies.

export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

const SAFE_URL = /^(https?:|mailto:)/i;
const SAFE_IMAGE_SRC = /^(https?:|data:image\/|\/(?!\/))/i;

export function renderInlineMarkdown(value) {
  let text = escapeHtml(value);
  const stash = [];
  const keep = (html) => {
    stash.push(html);
    return '\u0000' + (stash.length - 1) + '\u0000';
  };

  text = text.replace(/`([^`]+)`/g, (_, code) => keep('<code>' + code + '</code>'));
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt, src) => {
    if (!SAFE_IMAGE_SRC.test(src)) return alt;
    return keep(
      '<a class="md-img" href="' + src + '" target="_blank" rel="noopener noreferrer">' +
        '<img src="' + src + '" alt="' + alt + '" loading="lazy" onerror="this.style.opacity=.15">' +
        '</a>',
    );
  });
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
    if (!SAFE_URL.test(url)) return label;
    return keep('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>');
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  text = text.replace(/(^|[^_\w])_([^_]+)_/g, '$1<em>$2</em>');
  text = text.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
  return text;
}

export function renderMarkdown(value) {
  const lines = String(value == null ? '' : value).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push('<p>' + paragraph.join('<br>') + '</p>');
      paragraph = [];
    }
  };
  const closeList = () => {
    if (list) {
      out.push('</' + list + '>');
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(6, heading[1].length) + 1;
      out.push('<h' + level + '>' + renderInlineMarkdown(heading[2]) + '</h' + level + '>');
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      if (list !== 'ul') {
        closeList();
        out.push('<ul>');
        list = 'ul';
      }
      out.push('<li>' + renderInlineMarkdown(bullet[1]) + '</li>');
      continue;
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered) {
      flushParagraph();
      if (list !== 'ol') {
        closeList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push('<li>' + renderInlineMarkdown(numbered[1]) + '</li>');
      continue;
    }
    paragraph.push(renderInlineMarkdown(line));
  }
  flushParagraph();
  closeList();
  return out.join('');
}

export function asArray(value) {
  return Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];
}

export function evaluateShowIf(showIf, answers) {
  if (!showIf) return true;
  const value = answers ? answers[showIf.question] : undefined;
  const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
  switch (showIf.op) {
    case 'answered':
      return showIf.value ? !empty : empty;
    case 'equals':
      return Array.isArray(value) ? value.includes(showIf.value) : value === showIf.value;
    case 'not_equals':
      return Array.isArray(value) ? !value.includes(showIf.value) : value !== showIf.value;
    case 'in':
      return asArray(showIf.value).some((candidate) =>
        Array.isArray(value) ? value.includes(candidate) : value === candidate,
      );
    case 'contains':
      return Array.isArray(value) && value.includes(showIf.value);
    default:
      return true;
  }
}

export function isVisible(question, answers) {
  return evaluateShowIf(question && question.showIf, answers);
}

export function allQuestions(spec) {
  return spec.categories.flatMap((category) => category.questions);
}

function unwrap(entry) {
  return entry && typeof entry === 'object' && !Array.isArray(entry) && 'type' in entry && 'value' in entry
    ? entry.value
    : entry;
}

export function compactAnswers(record) {
  const source = record || {};
  const answers = {};
  for (const [id, entry] of Object.entries(source.answers || {})) {
    const value = unwrap(entry);
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    answers[id] = value;
  }
  for (const [id, text] of Object.entries(source.other || {})) {
    if (!String(text || '').trim()) continue;
    answers[id] = answers[id] === undefined ? text : String(answers[id]) + ' — ' + text;
  }
  const out = { answers };
  const notes = source.notes && Object.keys(source.notes).length ? source.notes : undefined;
  if (notes) out.notes = notes;
  return out;
}

function renderValue(value) {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) return '_skipped_';
  if (Array.isArray(value)) return '- ' + value.join('\n- ');
  if (typeof value === 'object') return Object.entries(value).map(([k, v]) => '- ' + k + ': ' + v).join('\n');
  return String(value);
}

export function summaryMarkdown(spec, record) {
  const source = record || {};
  const answers = source.answers || {};
  const notes = source.notes || {};
  const lines = ['# ' + (spec.title || 'Brainstorm'), '', '_Submitted ' + new Date().toLocaleString() + '_', ''];
  for (const category of spec.categories) {
    const visible = category.questions.filter((q) => {
      const value = unwrap(answers[q.id]);
      const hidden = source.hidden && source.hidden.includes(q.id);
      return !hidden && (value !== undefined || notes[q.id]);
    });
    if (!visible.length) continue;
    lines.push('## ' + category.title, '');
    for (const q of visible) {
      lines.push('**' + (q.label || q.id) + '**');
      lines.push(renderValue(unwrap(answers[q.id])));
      if (notes[q.id]) lines.push('_Note: ' + notes[q.id] + '_');
      lines.push('');
    }
  }
  return lines.join('\n');
}

export function formatAnswers(spec, record, format = 'full') {
  if (format === 'md' || format === 'markdown') return summaryMarkdown(spec, record);
  if (format === 'json' || format === 'compact') return compactAnswers(record);
  return record;
}

// `answers` is always the full current set: `since` must never make a read look
// like earlier answers disappeared. It only narrows the `changed` id list.
export function progressRecord({ sessionId, status, revision, url, progress, final, since }) {
  const p = progress || {};
  const progressRevision = p.revision || 0;
  const changed = Array.isArray(p.changed) ? p.changed : [];
  const upToDate = Number.isFinite(since) && since >= progressRevision;
  return {
    sessionId,
    status,
    revision,
    progressRevision,
    changed: upToDate ? [] : changed,
    url,
    answered: Object.keys(p.answers || {}).length,
    answers: (final && final.answers) || p.answers || {},
    other: p.other || {},
    notes: (final && final.notes) || p.notes || {},
    skipped: p.skipped || [],
  };
}
