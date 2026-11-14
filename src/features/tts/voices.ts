/** Choice of the voice for a language among the voices installed on the phone. */
export interface VoiceInfo {
  id: string;
  locale: string;
  quality: number;
  network: boolean;
  installed: boolean;
}

const short = (tag: string) => tag.toLowerCase().split(/[-_]/)[0];

/** Voices of a language, best first: installed, offline, then by quality. */
export function voicesForLanguage(voices: VoiceInfo[], language: string): VoiceInfo[] {
  const wanted = short(language);
  return voices
    .filter((voice) => short(voice.locale) === wanted)
    .sort(
      (a, b) =>
        Number(b.installed) - Number(a.installed) ||
        Number(a.network) - Number(b.network) ||
        b.quality - a.quality ||
        a.locale.localeCompare(b.locale) ||
        a.id.localeCompare(b.id),
    );
}

/** Languages that have at least one voice, as short codes. */
export function voiceLanguages(voices: VoiceInfo[]): string[] {
  return [...new Set(voices.map((voice) => short(voice.locale)))].sort();
}

/** The remembered voice of a language when it still exists, else none (engine default). */
export function chosenVoice(
  voices: VoiceInfo[],
  remembered: Record<string, string>,
  language: string | null,
): string | null {
  if (!language) {
    return null;
  }
  const id = remembered[short(language)];
  return id && voices.some((voice) => voice.id === id) ? id : null;
}

/** Readable name of a voice: its region and a short form of its identifier. */
export function voiceLabel(voice: VoiceInfo): string {
  const region = voice.locale.split(/[-_]/)[1];
  const name = voice.id
    .replace(/^[a-z]{2,3}[-_][a-z]{2,3}[-_]x[-_]/i, '')
    .replace(/[-_#]+/g, ' ')
    .replace(/\b(local|network)\b/gi, '')
    .trim();
  return [region ? region.toUpperCase() : null, name || voice.id].filter(Boolean).join(' · ');
}

/** Language tag used when no voice was chosen: the first full tag of the language. */
export function defaultLocale(language: string | null, deviceTags: string[]): string | null {
  if (!language) {
    return null;
  }
  const wanted = short(language);
  return deviceTags.find((tag) => short(tag) === wanted) ?? wanted;
}
