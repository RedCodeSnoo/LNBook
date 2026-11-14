import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet, IconButton, RadioItem, showToast } from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import type { SleepTimer } from './ttsController';
import {
  setSleepTimer,
  stepParagraph,
  stepSentence,
  stopReadingAloud,
  toggleReadingAloud,
  useTts,
} from './ttsService';

const MINUTES = [15, 30, 45, 60];
const CHAPTERS = [1, 2, 3, 5];

/** Controls of the voice, shown in the reader while a chapter is read aloud. */
export function TtsBar({ bottom }: { bottom: number }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const status = useTts((state) => state.status);
  const sleep = useTts((state) => state.sleep);
  const [timerOpen, setTimerOpen] = useState(false);

  const choose = (timer: SleepTimer, message: string) => {
    setSleepTimer(timer);
    setTimerOpen(false);
    showToast(message);
  };
  const busy = status === 'loading';

  return (
    <>
      <View
        style={[
          styles.bar,
          { bottom, backgroundColor: colors.surface, borderColor: colors.border },
        ]}
        accessibilityRole="toolbar"
        accessibilityLabel={t('tts.controls')}
      >
        <IconButton
          icon="skip-backward"
          label={t('tts.previousParagraph')}
          disabled={busy}
          onPress={() => stepParagraph(-1)}
        />
        <IconButton
          icon="rewind"
          label={t('tts.previousSentence')}
          disabled={busy}
          onPress={() => stepSentence(-1)}
        />
        <IconButton
          icon={status === 'playing' ? 'pause-circle' : 'play-circle'}
          label={status === 'playing' ? t('tts.pause') : t('tts.play')}
          size={40}
          color={colors.primary}
          disabled={busy}
          onPress={toggleReadingAloud}
        />
        <IconButton
          icon="fast-forward"
          label={t('tts.nextSentence')}
          disabled={busy}
          onPress={() => stepSentence(1)}
        />
        <IconButton
          icon="skip-forward"
          label={t('tts.nextParagraph')}
          disabled={busy}
          onPress={() => stepParagraph(1)}
        />
        <IconButton
          icon={sleep.kind === 'none' ? 'timer-outline' : 'timer'}
          label={t('tts.sleepTimer')}
          color={sleep.kind === 'none' ? undefined : colors.primary}
          onPress={() => setTimerOpen(true)}
        />
        <IconButton icon="close" label={t('tts.stop')} onPress={stopReadingAloud} />
      </View>

      <BottomSheet
        visible={timerOpen}
        title={t('tts.sleepTimer')}
        onClose={() => setTimerOpen(false)}
      >
        <RadioItem
          title={t('tts.sleepOff')}
          checked={sleep.kind === 'none'}
          onPress={() => choose({ kind: 'none' }, t('tts.sleepCancelled'))}
        />
        {MINUTES.map((minutes) => (
          <RadioItem
            key={`m${minutes}`}
            title={t('tts.sleepMinutes', { count: minutes })}
            checked={false}
            onPress={() =>
              choose(
                { kind: 'time', endsAt: Date.now() + minutes * 60_000 },
                t('tts.sleepSetMinutes', { count: minutes }),
              )
            }
          />
        ))}
        {CHAPTERS.map((count) => (
          <RadioItem
            key={`c${count}`}
            title={count === 1 ? t('tts.sleepEndOfChapter') : t('tts.sleepChapters', { count })}
            checked={sleep.kind === 'chapters' && sleep.left === count}
            onPress={() =>
              choose(
                { kind: 'chapters', left: count },
                count === 1 ? t('tts.sleepEndOfChapter') : t('tts.sleepChapters', { count }),
              )
            }
          />
        ))}
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.xl,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 6,
  },
});
