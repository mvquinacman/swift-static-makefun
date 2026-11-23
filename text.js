const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const months = 'January February March April May June July August September October November December'.split(' ');

export const escape = (text) => text.replace(/[&<>"']/g, (character) => entities[character]);
export const compare = (left, right) => left < right ? -1 : Number(left > right);

export function slugify(text) {
  const normalized = /^[\x00-\x7f]*$/.test(text) ? text : text.normalize('NFKD').replace(/\p{M}/gu, '');
  return normalized.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 64).replace(/-$/, '').toLowerCase() || 'untitled';
}

export function uniqueSlug(slug, used) {
  let candidate = slug;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${slug}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

export function dateLong(date) {
  return date ? `${+date.slice(8)} ${months[+date.slice(5, 7) - 1]} ${date.slice(0, 4)}` : '';
}
