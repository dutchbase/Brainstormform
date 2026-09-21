// Pure helpers shared by the browser and Node. No DOM, no dependencies.

export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

const SAFE_URL = /^(https?:|mailto:)/i;

export function renderInlineMarkdown(value) {
  let text = escapeHtml(value);
  const stash = [];
  const keep = (html) => {
    stash.push(html);
    return '\u0000' + (stash.length - 1) + '\u0000';
  };

  text = text.replace(/`([^`]+)`/g, (_, code) => keep('<code>' + code + '</code>'));
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
