/** Path helpers for files inside an EPUB archive (always "/" separated). */

export function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function extension(path: string): string {
  const name = basename(path);
  const index = name.lastIndexOf('.');
  return index === -1 ? '' : name.slice(index + 1).toLowerCase();
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Splits "chapter.xhtml#part2" into its path and fragment. */
export function splitHref(href: string): { path: string; fragment: string | null } {
  const index = href.indexOf('#');
  if (index === -1) {
    return { path: href, fragment: null };
  }
  return { path: href.slice(0, index), fragment: safeDecode(href.slice(index + 1)) || null };
}

/** Resolves an href relative to the directory of the file that contains it. */
export function resolvePath(baseDir: string, href: string): string {
  const { path } = splitHref(href);
  const decoded = safeDecode(path.split('?')[0]);
  const parts = decoded.startsWith('/') ? [] : baseDir.split('/').filter(Boolean);
  for (const part of decoded.split('/')) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}
