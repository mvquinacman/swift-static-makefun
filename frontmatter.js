const blank = /^[ \t]*$/;
const field = /^([a-z_]+):(?: (.*))?$/;
const keys = new Set(['title', 'summary', 'date', 'tags', 'draft', 'layout', 'slug']);

function parseString(raw) {
  if (raw[0] === '[') throw 'a bare string opens on [';
  if (raw[0] !== '"') return raw;
  if (raw.length === 1 || raw.at(-1) !== '"') throw 'a quoted string is not closed';

  const inner = raw.slice(1, -1);
  return inner.replace(/\\[\s\S]?|"/g, (token) => {
    if (token === '"') throw 'a quoted string holds a stray quote';
    if (token !== '\\"' && token !== '\\\\') {
      throw 'a quoted string holds an escape other than \\" or \\\\';
    }
    return token[1];
  });
}

function parseValue(key, raw) {
  switch (key) {
    case 'title':
    case 'summary':
      return parseString(raw);
    case 'date': {
      if (/^(?:19[7-9]\d|20\d\d)-\d\d-\d\d$/.test(raw)) {
        const time = Date.parse(raw);
        if (Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === raw) return raw;
      }
      throw 'not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)';
    }
    case 'tags': {
      if (raw[0] !== '[' || raw.at(-1) !== ']') throw 'not a list [a, b]';
      const content = raw.slice(1, -1).trim();
      if (!content) return [];
      const tags = content.split(',').map((tag) => tag.trim());
      if (tags.some((tag) => !tag || /["[\]]/.test(tag))) throw 'an empty tag, or one holding " [ or ]';
      return tags;
    }
    case 'draft':
      if (raw === 'true' || raw === 'false') return raw === 'true';
      throw 'true or false';
    case 'layout':
      if (/^[a-z0-9-]+$/.test(raw)) return raw;
      throw 'not a template name';
    case 'slug':
      if (raw.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw)) return raw;
      throw 'not a slug';
  }
}

export function frontMatter(source) {
  if (source !== '---' && !source.startsWith('---\n')) return { error: 'no front matter' };
  let close = source.indexOf('\n---', 3);
  while (close !== -1 && close + 4 < source.length && source[close + 4] !== '\n') {
    close = source.indexOf('\n---', close + 1);
  }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  if (close > 3) {
    const lines = source.slice(4, close).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line[0] === '#' || blank.test(line)) continue;
      const match = field.exec(line);
      if (!match) return { error: `line ${i + 2} is not "key: value"` };
      const key = match[1];
      if (!keys.has(key)) return { error: `unknown key "${key}"` };
      if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
      const raw = match[2]?.replace(/[ \t]+$/, '');
      if (!raw) return { error: `key "${key}" has no value` };
      try {
        data[key] = parseValue(key, raw);
      } catch (error) {
        return { error: `key "${key}": ${error}` };
      }
    }
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: source.slice(close + 5) };
}
