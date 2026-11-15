/** Reading aloud wired to the device: native player, settings, database and interface. */
import { create } from 'zustand';

import { nativeTts, type TtsVoice } from '../../../modules/lnbook-system';
import { getDb } from '../../db/client';
import { invalidate } from '../../db/invalidation';
import i18n, { deviceLanguages } from '../../i18n';
import { getSource } from '../../plugins/pluginHost';
import { deviceFiles } from '../../services/deviceFileStore';
import { getSetting, useSettingsStore } from '../settings/settingsStore';
import { readDisplayedChapter } from '../translation/translationRepository';
import {
  IDLE_SNAPSHOT,
  TtsController,
  type SleepTimer,
  type StartFrom,
  type TtsSnapshot,
} from './ttsController';
import { chosenVoice, defaultLocale } from './voices';

export const useTts = create<TtsSnapshot>(() => IDLE_SNAPSHOT);

let voices: TtsVoice[] = [];
let voicesEngine: string | null = null;

/** Voices of the chosen engine (asked once, then kept). */
export async function loadVoices(force = false): Promise<TtsVoice[]> {
  const engine = getSetting('ttsEngine');
  if (force || voicesEngine !== engine) {
    try {
      voices = await nativeTts.getVoices(engine || null);
      voicesEngine = engine;
    } catch {
      voices = [];
    }
  }
  return voices;
}

const controller = new TtsController({
  db: getDb,
  files: deviceFiles,
  native: nativeTts,
  getPlugin: getSource,
  displayedHtml: (novel, chapter) => {
    const displayed = readDisplayedChapter(getDb(), deviceFiles, novel, chapter);
    return displayed?.lang ? displayed.html : null;
  },
  settings: () => ({
    engine: getSetting('ttsEngine'),
    rate: getSetting('ttsRate'),
    pitch: getSetting('ttsPitch'),
    pauseMs: getSetting('ttsPauseMs'),
    autoNext: getSetting('ttsAutoNext'),
    voiceFor: (language) => ({
      voice: chosenVoice(voices, getSetting('ttsVoices'), language),
      locale: defaultLocale(language, deviceLanguages()),
    }),
    readThreshold: getSetting('reader').readThreshold,
    incognito: getSetting('incognito'),
  }),
  labels: () => ({
    channel: i18n.t('tts.channel'),
    play: i18n.t('tts.play'),
    pause: i18n.t('tts.pause'),
    next: i18n.t('reader.nextChapter'),
    previous: i18n.t('reader.previousChapter'),
    stop: i18n.t('tts.stop'),
  }),
  absolutePath: (path) => decodeURIComponent(deviceFiles.uri(path).replace(/^file:\/\//, '')),
  now: () => Date.now(),
  onChange: (snapshot) => useTts.setState(snapshot, true),
  onDataChanged: () => invalidate('chapters', 'novel', 'library', 'history', 'stats'),
});

nativeTts.addListener('onTtsState', (event) => controller.onNativeState(event.state, event.index));
nativeTts.addListener('onTtsSentence', (event) => controller.onNativeSentence(event.index));
nativeTts.addListener('onTtsFinished', () => controller.onNativeFinished());
nativeTts.addListener('onTtsCommand', (event) => controller.onNativeCommand(event.command));
nativeTts.addListener('onTtsSleep', () => controller.onNativeSleep());
nativeTts.addListener('onTtsError', () => controller.onNativeError());

// Voice settings changed while reading are applied to the sentence being said.
useSettingsStore.subscribe((state, previous) => {
  const now = state.settings;
  const before = previous.settings;
  if (
    now.ttsRate !== before.ttsRate ||
    now.ttsPitch !== before.ttsPitch ||
    now.ttsPauseMs !== before.ttsPauseMs ||
    now.ttsVoices !== before.ttsVoices
  ) {
    controller.settingsChanged();
  }
});

/** Starts reading a chapter aloud. */
export async function startReadingAloud(chapterId: number, from?: StartFrom): Promise<boolean> {
  await loadVoices();
  return controller.start(chapterId, from);
}

export const toggleReadingAloud = () => controller.toggle();
export const stopReadingAloud = () => controller.stop();
export const stepSentence = (direction: 1 | -1) => controller.stepSentence(direction);
export const stepParagraph = (direction: 1 | -1) => controller.stepParagraph(direction);
export const readAloudFromPlace = (b: number, o: number) => controller.seekToPlace(b, o);
export const setSleepTimer = (timer: SleepTimer) => controller.setSleepTimer(timer);

/** Says a sample with a voice (settings screen). */
export function speakSample(text: string, voice: string | null, language: string): void {
  nativeTts.speakSample(
    getSetting('ttsEngine') || null,
    text,
    voice,
    defaultLocale(language, deviceLanguages()),
    getSetting('ttsRate'),
    getSetting('ttsPitch'),
  );
}

export const listEngines = () => nativeTts.getEngines();
/** Opens the Android screen that installs more voices; falls back to the speech settings. */
export const openVoiceInstaller = () => nativeTts.installVoices() || nativeTts.openVoiceSettings();
export const openSystemVoiceSettings = () => nativeTts.openVoiceSettings();
