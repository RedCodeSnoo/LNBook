import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

export interface TtsEngineInfo {
  name: string;
  label: string;
  isDefault: boolean;
}

export interface TtsVoice {
  id: string;
  /** Language tag of the voice ("fr-FR"). */
  locale: string;
  /** Android quality level (100 to 500). */
  quality: number;
  /** The voice needs the network to speak. */
  network: boolean;
  installed: boolean;
}

export type TtsPlaybackState = 'stopped' | 'playing' | 'paused';

export interface TtsLoadOptions {
  /** Engine package name; empty or null = the default engine of the phone. */
  engine: string | null;
  sentences: string[];
  /** For each sentence, true when it ends a paragraph (a longer pause follows). */
  endsBlock: boolean[];
  start: number;
  autoplay: boolean;
  /** Novel title and chapter title, shown in the notification and on the lock screen. */
  title: string;
  subtitle: string;
  /** Absolute path of the cover image, when it is on the phone. */
  coverPath: string | null;
  hasNext: boolean;
  hasPrevious: boolean;
  /** Texts of the notification: channel, play, pause, next, previous, stop. */
  labels: Record<string, string>;
}

interface TtsEvents {
  onTtsState: { state: TtsPlaybackState; index: number };
  onTtsSentence: { index: number };
  onTtsFinished: Record<string, never>;
  onTtsCommand: { command: 'next' | 'previous' };
  onTtsSleep: Record<string, never>;
  onTtsError: { reason: string };
}

interface LnbookTtsModule {
  getEngines(): Promise<TtsEngineInfo[]>;
  getVoices(engine: string | null): Promise<TtsVoice[]>;
  configure(
    rate: number,
    pitch: number,
    pauseMs: number,
    voice: string | null,
    language: string | null,
  ): void;
  load(options: TtsLoadOptions): Promise<boolean>;
  play(): void;
  pause(): void;
  stop(): void;
  seekTo(index: number): void;
  setSleepTimer(ms: number): void;
  getSleepRemaining(): number;
  getState(): { state: TtsPlaybackState; index: number };
  speakSample(
    engine: string | null,
    text: string,
    voice: string | null,
    language: string | null,
    rate: number,
    pitch: number,
  ): void;
  openVoiceSettings(): boolean;
  installVoices(): boolean;
  addListener<K extends keyof TtsEvents>(
    event: K,
    listener: (event: TtsEvents[K]) => void,
  ): EventSubscription;
}

/** Voice of the app: Android speech engine, playback service and media controls. */
export const nativeTts = requireNativeModule<LnbookTtsModule>('LnbookTts');
