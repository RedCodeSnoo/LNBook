import { Directory, File, Paths } from 'expo-file-system';

import type { FileStore } from './fileStore';

function parentOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

/** FileStore backed by the private document directory of the app. */
class DeviceFileStore implements FileStore {
  private readonly knownDirectories = new Set<string>();

  private file(path: string): File {
    return new File(Paths.document, path);
  }

  private directory(path: string): Directory {
    return new Directory(Paths.document, path);
  }

  private ensureParent(path: string): void {
    const parent = parentOf(path);
    if (parent === '' || this.knownDirectories.has(parent)) {
      return;
    }
    const directory = this.directory(parent);
    if (!directory.exists) {
      directory.create({ intermediates: true, idempotent: true });
    }
    this.knownDirectories.add(parent);
  }

  private write(path: string, content: string | Uint8Array): void {
    this.ensureParent(path);
    const file = this.file(path);
    if (!file.exists) {
      file.create({ overwrite: true });
    }
    file.write(content);
  }

  writeText(path: string, content: string): void {
    this.write(path, content);
  }

  writeBytes(path: string, content: Uint8Array): void {
    this.write(path, content);
  }

  readText(path: string): string {
    return this.file(path).textSync();
  }

  readBytes(path: string): Uint8Array {
    return this.file(path).bytesSync();
  }

  exists(path: string): boolean {
    return Paths.info(this.uri(path)).exists;
  }

  delete(path: string): void {
    const info = Paths.info(this.uri(path));
    if (!info.exists) {
      return;
    }
    if (info.isDirectory) {
      this.directory(path).delete();
      for (const known of [...this.knownDirectories]) {
        if (known === path || known.startsWith(`${path}/`)) {
          this.knownDirectories.delete(known);
        }
      }
    } else {
      this.file(path).delete();
    }
  }

  list(path: string): string[] {
    const directory = this.directory(path);
    if (!directory.exists) {
      return [];
    }
    return directory.list().map((entry) => entry.name);
  }

  size(path: string): number {
    const info = Paths.info(this.uri(path));
    if (!info.exists) {
      return 0;
    }
    return info.isDirectory ? (this.directory(path).size ?? 0) : this.file(path).size;
  }

  uri(path: string): string {
    return this.file(path).uri;
  }
}

export const deviceFiles: FileStore = new DeviceFileStore();
