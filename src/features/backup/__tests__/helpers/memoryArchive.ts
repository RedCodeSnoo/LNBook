/**
 * Archive engine for the tests, with the same layout and the same checksums as the native
 * one (manifest first, checksums.json last). Zips are kept in memory by URI.
 */
import { createHash } from 'crypto';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

import type { MemoryFileStore } from '../../../../services/fileStore';
import type { ArchiveEngine, ArchiveListing } from '../../backupFile';

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

export class MemoryArchive implements ArchiveEngine {
  /** Makes the next read report a damaged entry (a checksum that does not match). */
  damageNextRead = false;

  /** `zips` can be shared by two phones: a file written by one is read by the other. */
  constructor(
    private readonly files: MemoryFileStore,
    readonly zips = new Map<string, Uint8Array>(),
  ) {}

  async write(output: string, entries: { name: string; path: string }[]) {
    const zip: Zippable = {};
    const sums: Record<string, { size: number; sha256: string }> = {};
    const missing: string[] = [];
    for (const entry of entries) {
      if (!this.files.isFile(entry.path)) {
        missing.push(entry.name);
        continue;
      }
      const data = this.files.readBytes(entry.path);
      zip[entry.name] = [data, { level: 0 }];
      sums[entry.name] = { size: data.length, sha256: sha256(data) };
    }
    zip['checksums.json'] = strToU8(JSON.stringify({ algorithm: 'SHA-256', files: sums }));
    const bytes = zipSync(zip);
    this.zips.set(output, bytes);
    return { size: bytes.length, missing };
  }

  async read(input: string, extractTo: string | null): Promise<ArchiveListing> {
    const data = this.zips.get(input);
    if (!data) {
      throw Object.assign(new Error(`java.io.FileNotFoundException: ${input}`), {
        code: 'ERR_BACKUP_NOT_FOUND',
      });
    }
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(data);
    } catch {
      // Like ZipInputStream: something that is not a zip has no entry.
      entries = {};
    }
    const listing: ArchiveListing = {
      entries: [],
      manifest: null,
      checksums: null,
      skipped: [],
      bytes: data.length,
    };
    for (const [name, content] of Object.entries(entries)) {
      if (name.endsWith('/')) {
        continue;
      }
      let sum = sha256(content);
      if (this.damageNextRead && name.startsWith('files/')) {
        sum = '0'.repeat(64);
        this.damageNextRead = false;
      }
      listing.entries.push({ name, size: content.length, sha256: sum });
      if (name === 'manifest.json') {
        listing.manifest = strFromU8(content);
      } else if (name === 'checksums.json') {
        listing.checksums = strFromU8(content);
      }
      if (extractTo !== null) {
        if (name.split('/').some((part) => part === '..' || part === '.') || name.startsWith('/')) {
          listing.skipped.push(name);
        } else {
          this.files.writeBytes(`${extractTo}/${name}`, content);
        }
      }
    }
    return listing;
  }
}
