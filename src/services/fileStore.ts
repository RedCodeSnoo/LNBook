/**
 * Access to the private storage of the app. Every path is relative to the app document
 * directory ("novels/12/chapters/340.html"): the database never stores absolute paths,
 * so a backup can be restored on another phone.
 */
export interface FileStore {
  writeText(path: string, content: string): void;
  writeBytes(path: string, content: Uint8Array): void;
  readText(path: string): string;
  readBytes(path: string): Uint8Array;
  exists(path: string): boolean;
  /** Deletes a file or a directory with its content. Missing paths are ignored. */
  delete(path: string): void;
  /** Names of the entries of a directory (empty when it does not exist). */
  list(path: string): string[];
  /** Size in bytes of a file, or of everything inside a directory. */
  size(path: string): number;
  /** Absolute file:// URI, for images and the reader web view. */
  uri(path: string): string;
}

export const novelDir = (novelId: number) => `novels/${novelId}`;
export const chapterFile = (novelId: number, chapterId: number) =>
  `novels/${novelId}/chapters/${chapterId}.html`;
export const chapterOriginalFile = (novelId: number, chapterId: number) =>
  `novels/${novelId}/chapters/${chapterId}.original.html`;
export const translationFile = (novelId: number, chapterId: number, lang: string) =>
  `novels/${novelId}/translations/${lang}/${chapterId}.html`;
export const imageFile = (novelId: number, name: string) => `novels/${novelId}/images/${name}`;
export const novelCssFile = (novelId: number) => `novels/${novelId}/original.css`;

/** In-memory implementation, used by the tests. */
export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, Uint8Array>();

  writeText(path: string, content: string): void {
    this.files.set(path, new TextEncoder().encode(content));
  }

  writeBytes(path: string, content: Uint8Array): void {
    this.files.set(path, content);
  }

  readText(path: string): string {
    return new TextDecoder().decode(this.readBytes(path));
  }

  readBytes(path: string): Uint8Array {
    const content = this.files.get(path);
    if (!content) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  exists(path: string): boolean {
    if (this.files.has(path)) {
      return true;
    }
    const prefix = `${path}/`;
    return [...this.files.keys()].some((key) => key.startsWith(prefix));
  }

  delete(path: string): void {
    const prefix = `${path}/`;
    for (const key of [...this.files.keys()]) {
      if (key === path || key.startsWith(prefix)) {
        this.files.delete(key);
      }
    }
  }

  list(path: string): string[] {
    const prefix = `${path}/`;
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        names.add(key.slice(prefix.length).split('/')[0]);
      }
    }
    return [...names];
  }

  size(path: string): number {
    const prefix = `${path}/`;
    let total = 0;
    for (const [key, content] of this.files) {
      if (key === path || key.startsWith(prefix)) {
        total += content.length;
      }
    }
    return total;
  }

  uri(path: string): string {
    return `file:///memory/${path}`;
  }
}
