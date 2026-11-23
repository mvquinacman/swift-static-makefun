import { escape } from './text.js';

const pathPattern = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const tagStart = /\{[{%]/g;
const whitespace = /^[ \t]*$/;

function accessor(path) {
  if (!pathPattern.test(path)) throw `${JSON.stringify(path)} is not a path`;
  const [first, ...children] = path.split('.');
  return (root, frame) => {
    let value;
    while (frame !== null && first !== 'loop' && first !== frame.name) frame = frame.parent;
    if (frame !== null) value = first === 'loop' ? frame.loop : frame.value;
    else if (Object.hasOwn(root, first)) value = root[first];
    for (const child of children) {
      if (value === null || typeof value !== 'object' || !Object.hasOwn(value, child)) return undefined;
      value = value[child];
    }
    return value;
  };
}

function asText(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return Array.isArray(value) ? value.map(asText).join(', ') : '';
}

function isTrue(value) {
  if (Array.isArray(value)) return value.length !== 0;
  return Boolean(value) || Number.isNaN(value);
}

function scan(source) {
  const tokens = [];
  let offset = 0;
  tagStart.lastIndex = 0;
  for (let match; (match = tagStart.exec(source)) !== null;) {
    const open = match.index;
    const statement = match[0] === '{%';
    const opening = !statement && source[open + 2] === '{' ? '{{{' : match[0];
    const close = statement ? '%}' : opening.length === 3 ? '}}}' : '}}';
    const end = source.indexOf(close, open + opening.length);
    if (end === -1) throw `a ${opening} is not closed`;
    const tag = source.slice(open + opening.length, end).trim();
    let textEnd = open;
    let next = end + close.length;
    if (statement) {
      const lineStart = source.lastIndexOf('\n', open - 1) + 1;
      const lineEnd = source.indexOf('\n', next);
      if (whitespace.test(source.slice(lineStart, open)) &&
        whitespace.test(source.slice(next, lineEnd === -1 ? source.length : lineEnd))) {
        textEnd = lineStart;
        next = lineEnd === -1 ? source.length : lineEnd + 1;
      }
    }
    if (textEnd > offset) tokens.push(source.slice(offset, textEnd));
    if (statement) tokens.push({ tag });
    else {
      const read = accessor(tag);
      tokens.push(opening.length === 3
        ? (root, frame) => asText(read(root, frame))
        : (root, frame) => escape(asText(read(root, frame))));
    }
    offset = next;
    tagStart.lastIndex = offset;
  }
  if (offset < source.length) tokens.push(source.slice(offset));
  return tokens;
}

function render(parts, root, frame, includes, depth) {
  let result = '';
  for (const part of parts) {
    result += typeof part === 'string' ? part : part(root, frame, includes, depth);
  }
  return result;
}

export function compile(source) {
  const parts = [];
  const stack = [];
  let body = parts;
  for (const token of scan(source)) {
    if (typeof token !== 'object') {
      body.push(token);
      continue;
    }
    const { tag } = token;
    const loop = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/.exec(tag);
    const condition = loop ? null : /^if (not )?(\S+)$/.exec(tag);
    const include = loop || condition ? null : /^include "([a-z0-9-]+)"$/.exec(tag);
    if (loop) {
      const [, name, path] = loop;
      const read = accessor(path);
      const actions = [];
      body.push((root, parent, includes, depth) => {
        const items = read(root, parent);
        if (!Array.isArray(items) || !items.length) return '';
        const length = items.length;
        const loop = { index: 0, first: false, last: false, length };
        const frame = { name, value: undefined, loop, parent };
        let result = '';
        for (let i = 0; i < length; i++) {
          frame.value = items[i];
          loop.index = i + 1;
          loop.first = i === 0;
          loop.last = i === length - 1;
          result += render(actions, root, frame, includes, depth);
        }
        return result;
      });
      stack.push({ kind: 'for', parent: body });
      body = actions;
    } else if (condition) {
      const [, negated, path] = condition;
      const read = accessor(path);
      const yes = [];
      const no = [];
      body.push((root, frame, includes, depth) => {
        const branch = isTrue(read(root, frame)) !== Boolean(negated) ? yes : no;
        return render(branch, root, frame, includes, depth);
      });
      stack.push({ kind: 'if', parent: body, alternative: no, hasElse: false });
      body = yes;
    } else if (include) {
      const name = include[1];
      body.push((root, frame, includes, depth) => {
        const template = includes.get(name);
        return template && depth < 8 ? template(root, frame, includes, depth + 1) : '';
      });
    } else if (tag === 'else') {
      const frame = stack.at(-1);
      if (frame?.kind !== 'if' || frame.hasElse) throw 'an else outside an if';
      frame.hasElse = true;
      body = frame.alternative;
    } else if (tag === 'endif' || tag === 'endfor') {
      const kind = tag.slice(3);
      const open = stack.pop();
      if (open?.kind !== kind) throw `an ${tag} with no open ${kind}`;
      body = open.parent;
    } else {
      throw `{% ${tag} %} is not a tag`;
    }
  }
  if (stack.length) throw `a ${stack.at(-1).kind} is not closed`;
  return (root, frame, includes, depth) => render(parts, root, frame, includes, depth);
}
