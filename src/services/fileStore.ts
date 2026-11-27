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
  /** True for a file, false for a directory or a missing path. */
  isFile(path: string): boolean;
  /**
   * Moves a file or a directory with its content. The destination must not exist; its
   * parent folders are created.
   */
  move(from: string, to: string): void;
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

/** In-memory implementation, used by the tests. Folders can exist empty, as on a phone. */
export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, Uint8Array>();
  /** Folders created explicitly (they stay when their files are deleted). */
  readonly directories = new Set<string>();

  private addParents(path: string): void {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i += 1) {
      this.directories.add(parts.slice(0, i).join('/'));
    }
  }

  /** Creates an empty folder (and its parents). */
  mkdir(path: string): void {
    this.addParents(`${path}/x`);
  }

  writeText(path: string, content: string): void {
    this.writeBytes(path, new TextEncoder().encode(content));
  }

  writeBytes(path: string, content: Uint8Array): void {
    if (this.isDirectory(path)) {
      throw new Error(`Is a directory: ${path}`);
    }
    this.addParents(path);
    this.files.set(path, content);
  }

  readText(path: string): string {
    return new TextDecoder().decode(this.readBytes(path));
  }

  readBytes(path: string): Uint8Array {
    if (this.isDirectory(path)) {
      throw new Error(`Is a directory: ${path}`);
    }
    const content = this.files.get(path);
    if (!content) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  private isDirectory(path: string): boolean {
    if (this.directories.has(path)) {
      return true;
    }
    const prefix = `${path}/`;
    return [...this.files.keys()].some((key) => key.startsWith(prefix));
  }

  exists(path: string): boolean {
    return this.files.has(path) || this.isDirectory(path);
  }

  isFile(path: string): boolean {
    return this.files.has(path);
  }

  move(from: string, to: string): void {
    if (!this.exists(from)) {
      throw new Error(`File not found: ${from}`);
    }
    if (this.exists(to)) {
      throw new Error(`Destination already exists: ${to}`);
    }
    const prefix = `${from}/`;
    const rename = (key: string) => (key === from ? to : `${to}/${key.slice(prefix.length)}`);
    for (const key of [...this.files.keys()]) {
      if (key === from || key.startsWith(prefix)) {
        const content = this.files.get(key) as Uint8Array;
        this.files.delete(key);
        this.addParents(rename(key));
        this.files.set(rename(key), content);
      }
    }
    for (const directory of [...this.directories]) {
      if (directory === from || directory.startsWith(prefix)) {
        this.directories.delete(directory);
        this.mkdir(rename(directory));
      }
    }
    this.addParents(to);
  }

  delete(path: string): void {
    const prefix = `${path}/`;
    for (const key of [...this.files.keys()]) {
      if (key === path || key.startsWith(prefix)) {
        this.files.delete(key);
      }
    }
    for (const directory of [...this.directories]) {
      if (directory === path || directory.startsWith(prefix)) {
        this.directories.delete(directory);
      }
    }
  }

  list(path: string): string[] {
    const prefix = `${path}/`;
    const names = new Set<string>();
    for (const key of [...this.files.keys(), ...this.directories]) {
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
