import { escape, slugify, uniqueSlug } from './text.js';

const blank = /^[ \t]*$/;
const fence = /^\x60{3}([A-Za-z0-9_+-]*)[ \t]*$/;
const heading = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const rule = /^(?:---|\*\*\*)[ \t]*$/;
const closingFence = /^\x60{3}[ \t]*$/;
const bullet = /^[-*] (.*)$/;
const ordered = /^(\d{1,9})\. (.*)$/;
const continuation = /^ {2,}\S/;
const inlineMarker = /[\\\x60*[]/g;
const escapable = '\\\x60*_[]()#+-.!>';
const trim = (line) => line.replace(/^[ \t]+|[ \t]+$/g, '');

function closingMark(text, start, marker) {
  for (let i = start; i < text.length; i++) {
    if (text[i] === '\\' && text[i + 1] && escapable.includes(text[i + 1])) {
      i++;
    } else if (text[i] === marker[0]) {
      if (marker === '*' && text[i + 1] === '*') i++;
      else if (marker.length === 1 || text[i + 1] === '*') return i;
    }
  }
  return -1;
}

function inline(text, link) {
  let result = '';
  let position = 0;
  while (position < text.length) {
    inlineMarker.lastIndex = position;
    const match = inlineMarker.exec(text);
    if (match === null) return result + escape(text.slice(position));
    const i = match.index;
    result += escape(text.slice(position, i));
    const marker = match[0];
    position = i + 1;
    if (marker === '\\' && text[position] && escapable.includes(text[position])) {
      result += escape(text[position++]);
    } else if (marker === '\x60') {
      const end = text.indexOf(marker, position);
      if (end > position) {
        result += `<code>${escape(text.slice(position, end))}</code>`;
        position = end + 1;
      } else result += marker;
    } else if (marker === '*') {
      const strong = text[position] === '*';
      const delimiter = strong ? '**' : '*';
      if (strong) position++;
      const end = closingMark(text, position, delimiter);
      if (end > position) {
        const tag = strong ? 'strong' : 'em';
        result += `<${tag}>${inline(text.slice(position, end), link)}</${tag}>`;
        position = end + delimiter.length;
      } else result += delimiter;
    } else if (marker === '[') {
      const labelEnd = closingMark(text, position, ']');
      const addressEnd = text[labelEnd + 1] === '(' && labelEnd >= 0
        ? text.indexOf(')', labelEnd + 2) : -1;
      const address = addressEnd >= 0 ? text.slice(labelEnd + 2, addressEnd) : '';
      if (address && !/\s/.test(address)) {
        result += `<a href="${escape(link(address))}">${inline(text.slice(position, labelEnd), link)}</a>`;
        position = addressEnd + 1;
      } else result += marker;
    } else result += marker;
  }
  return result;
}

export function markdown(body, link) {
  const lines = body.split('\n');
  const usedIds = new Set();
  const toc = [];
  let content = '';
  let excerpt;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i++];
    if (blank.test(line)) continue;

    const code = line[0] === '\x60' && fence.exec(line);
    if (code) {
      const language = code[1] ? ` class="language-${code[1]}"` : '';
      content += `<pre><code${language}>`;
      while (i < lines.length && !closingFence.test(lines[i])) content += escape(lines[i++]) + '\n';
      content += '</code></pre>\n';
      i++;
      continue;
    }
    const header = line[0] === '#' && heading.exec(line);
    if (header && header[2]) {
      const level = header[1].length;
      const id = uniqueSlug(slugify(header[2]), usedIds);
      const html = inline(header[2], link);
      content += `<h${level} id="${id}">${html}</h${level}>\n`;
      if (level === 2 || level === 3) toc.push({ level, id, html });
      continue;
    }
    if (rule.test(line)) {
      content += '<hr>\n';
      continue;
    }
    if (line[0] === '>') {
      const quote = [];
      let next = line;
      do {
        const value = trim(next.slice(next[1] === ' ' ? 2 : 1));
        if (value) quote.push(value);
        next = lines[i++];
      } while (next?.[0] === '>');
      i--;
      content += '<blockquote>\n';
      if (quote.length) content += `<p>${inline(quote.join('\n'), link)}</p>\n`;
      content += '</blockquote>\n';
      continue;
    }
    const item = bullet.exec(line);
    const count = item ? null : ordered.exec(line);
    if (item || count) {
      const tag = count ? 'ol' : 'ul';
      const start = count && +count[1] !== 1 ? ` start="${+count[1]}"` : '';
      const matcher = count ? ordered : bullet;
      const field = count ? 2 : 1;
      let label = trim((count || item)[field]);
      content += `<${tag}${start}>\n`;
      while (i < lines.length) {
        const next = lines[i];
        const entry = matcher.exec(next);
        if (entry) {
          content += `<li>${inline(label, link)}</li>\n`;
          label = trim(entry[field]);
        } else if (continuation.test(next)) {
          label += '\n' + trim(next);
        } else break;
        i++;
      }
      content += `<li>${inline(label, link)}</li>\n</${tag}>\n`;
      continue;
    }

    let paragraph = trim(line);
    while (i < lines.length) {
      const next = lines[i];
      if (blank.test(next) || (next[0] === '\x60' && fence.test(next)) ||
        (next[0] === '#' && heading.exec(next)?.[2]) || rule.test(next)) break;
      paragraph += '\n' + trim(next);
      i++;
    }
    const html = inline(paragraph, link);
    excerpt ??= html;
    content += `<p>${html}</p>\n`;
  }
  return { content, excerpt: excerpt ?? '', toc };
}
