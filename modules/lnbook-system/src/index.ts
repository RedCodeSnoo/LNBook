import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

export interface IncomingFile {
  /** file:// URI of a private copy of the file, or null when it could not be read. */
  uri: string | null;
  name: string;
  error: string | null;
}

interface LnbookSystemModule {
  setVolumeKeysEnabled(enabled: boolean): void;
  isMusicActive(): boolean;
  takeIncomingFiles(): Promise<IncomingFile[]>;
  addListener(
    event: 'onVolumeKey',
    listener: (event: { direction: 'up' | 'down' }) => void,
  ): EventSubscription;
  addListener(event: 'onIncomingFiles', listener: () => void): EventSubscription;
}

const native = requireNativeModule<LnbookSystemModule>('LnbookSystem');

/** Lets the volume buttons turn pages (they keep their role while sound is playing). */
export function setVolumeKeysEnabled(enabled: boolean): void {
  native.setVolumeKeysEnabled(enabled);
}

export function addVolumeKeyListener(
  listener: (direction: 'up' | 'down') => void,
): EventSubscription {
  return native.addListener('onVolumeKey', (event) => listener(event.direction));
}

/** True while any app, including this one, is playing sound. */
export function isMusicActive(): boolean {
  return native.isMusicActive();
}

/** Files received through "Open with" or "Share to" since the last call. */
export function takeIncomingFiles(): Promise<IncomingFile[]> {
  return native.takeIncomingFiles();
}

export function addIncomingFilesListener(listener: () => void): EventSubscription {
  return native.addListener('onIncomingFiles', listener);
}
