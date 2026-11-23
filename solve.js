import { frontMatter } from './frontmatter.js';
import { markdown } from './markdown.js';
import { compile } from './template.js';
import { compare, dateLong, slugify, uniqueSlug } from './text.js';

function relativePath(directory, target) {
  const components = directory.slice();
  for (const component of target.split('/')) {
    if (!component || component === '.') continue;
    if (component !== '..') components.push(component);
    else if (components.length) components.pop();
    else return undefined;
  }
  return components.join('/');
}

function readFiles(files, templates, base, report) {
  const pages = [];
  const posts = [];
  const statics = [];
  const knownPaths = new Map();
  const usedByDirectory = new Map([['', new Set(['posts', 'tags', 'page'])]]);
  for (const { path, content } of files.slice().sort((a, b) => compare(a.path, b.path))) {
    if (!path.endsWith('.md')) {
      statics.push({ path, content });
      knownPaths.set(path, base + '/' + path);
      continue;
    }
    const parsed = frontMatter(content.includes('\r') ? content.replace(/\r\n?/g, '\n') : content);
    const post = path.startsWith('posts/');
    const layout = parsed.data?.layout ?? (post ? 'post' : 'page');
    let refusal = parsed.error;
    if (!refusal) {
      if (path.startsWith('tags/')) refusal = "tags/ is the generator's own";
      else if (path.startsWith('page/')) refusal = "page/ is the generator's own";
      else if (post && !parsed.data.date) refusal = 'a post needs a date';
      else if (!templates.has(layout)) refusal = `layout "${layout}" is no template that parses`;
    }
    if (refusal) {
      report.push(`refused ${path}: ${refusal}`);
      continue;
    }
    if (parsed.data.draft) {
      report.push(`draft ${path}`);
      continue;
    }
    const directory = path.slice(0, Math.max(0, path.lastIndexOf('/')));
    const parent = post ? 'posts' : directory;
    let used = usedByDirectory.get(parent);
    if (!used) usedByDirectory.set(parent, used = new Set());
    const slug = uniqueSlug(parsed.data.slug ?? slugify(parsed.data.title), used);
    const permalink = parent ? parent + '/' + slug : slug;
    const url = `${base}/${permalink}/`;
    knownPaths.set(path, url);
    const page = { post, path, directory, layout, permalink, slug, url, ...parsed };
    pages.push(page);
    if (post) posts.push(page);
  }
  posts.sort((a, b) => compare(b.data.date, a.data.date) || compare(a.slug, b.slug));
  return { pages, posts, statics, knownPaths };
}

function linkResolver(page, knownPaths, brokenLinks) {
  const directory = page.directory ? page.directory.split('/') : [];
  const cached = new Map();
  return (address) => {
    if (address[0] === '/' || address[0] === '#' || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(address)) return address;
    if (cached.has(address)) return cached.get(address);
    const hash = address.indexOf('#');
    const target = hash === -1 ? address : address.slice(0, hash);
    const path = relativePath(directory, target);
    let url = knownPaths.get(path);
    if (url === undefined) {
      brokenLinks.add(`broken-link ${page.path} -> ${address}`);
      url = address;
    } else if (hash !== -1) url += address.slice(hash);
    cached.set(address, url);
    return url;
  };
}

function linkCard(page) {
  if (!page) return null;
  const { title, url, date, date_long } = page.card;
  return { title, url, date, date_long };
}

function makeCard(page, rendered, tags) {
  return {
    title: page.data.title,
    url: page.url,
    date: page.data.date ?? '',
    date_long: dateLong(page.data.date),
    summary: page.data.summary ?? '',
    excerpt: rendered.excerpt,
    reading_minutes: Math.max(1, Math.ceil((page.body.match(/\S+/g)?.length ?? 0) / 200)),
    tags,
  };
}

export function run(input) {
  const report = [];
  const brokenLinks = new Set();
  const templates = new Map();
  for (const name of Object.keys(input.templates).sort()) {
    try {
      templates.set(name, compile(input.templates[name]));
    } catch (reason) {
      if (typeof reason !== 'string') throw reason;
      report.push(`template "${name}": ${reason}`);
    }
  }

  const { site } = input;
  const base = site.base_url.replace(/\/+$/, '');
  const { pages, posts, statics, knownPaths } = readFiles(input.files, templates, base, report);
  const byTag = new Map();
  const tagSlugs = new Map();
  for (const page of posts) {
    page.tags = [];
    for (const name of page.data.tags ?? []) {
      let slug = tagSlugs.get(name);
      if (slug === undefined) tagSlugs.set(name, slug = slugify(name));
      let tag = byTag.get(slug);
      if (!tag) {
        tag = { value: { name, slug, url: `${base}/tags/${slug}/` }, posts: [] };
        byTag.set(slug, tag);
      }
      if (tag.posts.at(-1) !== page) {
        tag.posts.push(page);
        page.tags.push(tag.value);
      }
    }
  }
  const orderedTags = [...byTag.values()].sort((a, b) =>
    b.posts.length - a.posts.length || compare(a.value.slug, b.value.slug));

  for (const page of pages) {
    const rendered = markdown(page.body, linkResolver(page, knownPaths, brokenLinks));
    if (!page.post) {
      const tags = new Map();
      for (const name of page.data.tags ?? []) {
        let slug = tagSlugs.get(name);
        if (slug === undefined) tagSlugs.set(name, slug = slugify(name));
        if (!tags.has(slug)) tags.set(slug, byTag.get(slug)?.value ?? { name, slug, url: '' });
      }
      page.tags = [...tags.values()];
    }
    page.rendered = rendered;
    page.card = makeCard(page, rendered, page.tags);
  }
  for (let i = 0; i < posts.length; i++) {
    posts[i].newer = linkCard(posts[i - 1]);
    posts[i].older = linkCard(posts[i + 1]);
  }

  const postCards = posts.map((post) => post.card);
  const variables = {
    site: { title: site.title, base_url: base },
    tags: orderedTags.map((tag) => ({ ...tag.value, count: tag.posts.length })),
    recent: postCards.slice(0, site.recent),
  };
  const output = {};
  const render = (name, path, local) => {
    const template = templates.get(name);
    if (template) output[path] = template({ ...variables, ...local }, null, templates, 0);
  };
  for (const page of pages) {
    const { content, toc } = page.rendered;
    render(page.layout, page.permalink + '/index.html', {
      page: {
        ...page.card, slug: page.slug, content, toc,
        newer: page.newer ?? null, older: page.older ?? null, is_post: page.post,
      },
    });
  }

  const total = Math.max(1, Math.ceil(posts.length / site.per_page));
  const indexPath = (number) => number === 1 ? '' : `page/${number}/`;
  const indexUrl = (number) => base + '/' + indexPath(number);
  if (templates.has('index')) {
    for (let number = 1; number <= total; number++) {
      render('index', indexPath(number) + 'index.html', {
        posts: postCards.slice((number - 1) * site.per_page, number * site.per_page),
        pager: {
          number, total, url: indexUrl(number),
          newer_url: number === 1 ? '' : indexUrl(number - 1),
          older_url: number === total ? '' : indexUrl(number + 1),
        },
      });
    }
  }
  for (const { value, posts } of orderedTags) {
    render('tag', `tags/${value.slug}/index.html`, {
      tag: { ...value, count: posts.length, posts: posts.map((post) => post.card) },
    });
  }
  render('tags', 'tags/index.html');
  for (const { path, content } of statics) {
    if (Object.hasOwn(output, path)) report.push(`shadowed ${path}: a built page has its path`);
    else output[path] = content;
  }
  for (const link of brokenLinks) report.push(link);
  report.sort();
  report.push(`built ${pages.length - posts.length} pages, ${posts.length} posts, ${orderedTags.length} tags and ${statics.length} static files`);
  return Object.assign(output, { 'build-report.txt': report.join('\n') + '\n' });
}
