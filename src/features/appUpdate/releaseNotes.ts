/** Minimal reading of the Markdown changelog of a release. */
export interface NoteLine {
  kind: 'heading' | 'bullet' | 'text';
  text: string;
}

/** Inline marks (bold, italic, code, links) are reduced to their text. */
function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(^|\s)[*_]([^*_\s][^*_]*)[*_](?=\s|$)/g, '$1$2')
    .trim();
}

export function parseReleaseNotes(notes: string): NoteLine[] {
  const lines: NoteLine[] = [];
  for (const raw of notes.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || /^(-{3,}|\*{3,})$/.test(line)) {
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (heading) {
      lines.push({ kind: 'heading', text: plain(heading[1]) });
    } else if (bullet) {
      lines.push({ kind: 'bullet', text: plain(bullet[1]) });
    } else {
      lines.push({ kind: 'text', text: plain(line) });
    }
  }
  return lines;
}
