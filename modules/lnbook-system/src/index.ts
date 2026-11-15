import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

export interface IncomingFile {
  /** file:// URI of a private copy of the file, or null when it could not be read. */
  uri: string | null;
  name: string;
  error: string | null;
}

export interface DownloadedUpdate {
  /** Absolute path of the downloaded file, in the cache of the app. */
  path: string;
  /** SHA-256 of the file, lower case hexadecimal. */
  sha256: string;
  size: number;
}

interface LnbookSystemModule {
  setVolumeKeysEnabled(enabled: boolean): void;
  isMusicActive(): boolean;
  takeIncomingFiles(): Promise<IncomingFile[]>;
  startDownloadService(channelName: string, title: string, text: string): boolean;
  updateDownloadService(title: string, text: string, progress: number, max: number): void;
  stopDownloadService(): void;
  addListener(
    event: 'onVolumeKey',
    listener: (event: { direction: 'up' | 'down' }) => void,
  ): EventSubscription;
  addListener(event: 'onIncomingFiles', listener: () => void): EventSubscription;
  delay(ms: number): Promise<void>;
  downloadUpdate(url: string, name: string): Promise<DownloadedUpdate>;
  canInstallUpdates(): boolean;
  openInstallSettings(): void;
  installUpdate(path: string): void;
  addListener(
    event: 'onUpdateDownloadProgress',
    listener: (event: { received: number; total: number }) => void,
  ): EventSubscription;
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

/**
 * Shows the download notification and keeps the app alive while the queue runs.
 * Returns false when Android refused to start the service.
 */
export function startDownloadService(channelName: string, title: string, text: string): boolean {
  return native.startDownloadService(channelName, title, text);
}

export function updateDownloadService(
  title: string,
  text: string,
  progress: number,
  max: number,
): void {
  native.updateDownloadService(title, text, progress, max);
}

export function stopDownloadService(): void {
  native.stopDownloadService();
}

/** Downloads a new version of the app; the checksum is computed while it arrives. */
export function downloadUpdate(
  url: string,
  name: string,
  onProgress: (received: number, total: number) => void,
): Promise<DownloadedUpdate> {
  const subscription = native.addListener('onUpdateDownloadProgress', (event) =>
    onProgress(event.received, event.total),
  );
  return native.downloadUpdate(url, name).finally(() => subscription.remove());
}

/** True when Android lets this app install packages ("Install unknown apps"). */
export function canInstallUpdates(): boolean {
  return native.canInstallUpdates();
}

export function openInstallSettings(): void {
  native.openInstallSettings();
}

/** Opens the Android installer on a file returned by `downloadUpdate`. */
export function installUpdate(path: string): void {
  native.installUpdate(path);
}

/**
 * Waits like `setTimeout`, but also while the app is in the background: Android suspends
 * JavaScript timers there, which would freeze downloads with the screen off.
 */
export function backgroundDelay(ms: number): Promise<void> {
  return native.delay(ms);
}

export {
  nativeTts,
  type TtsEngineInfo,
  type TtsLoadOptions,
  type TtsPlaybackState,
  type TtsVoice,
} from './tts';

export { nativeTranslate } from './translate';
