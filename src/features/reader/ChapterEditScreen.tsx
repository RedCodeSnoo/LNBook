import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { getDb } from '../../db/client';
import { invalidate } from '../../db/invalidation';
import { deviceFiles } from '../../services/deviceFileStore';
import {
  AppBar,
  AppText,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Screen,
  TextField,
  showToast,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { FONTS, RADIUS, SPACING } from '../../theme/typography';
import { getChapter } from '../novel/novelRepository';
import { editBlocks, extractBlockTexts } from './blocks';
import { readChapterHtml, revertEditedChapter, saveEditedChapter } from './readerRepository';

/** Paragraph by paragraph editor of a chapter (title and content). */
export function ChapterEditScreen({ navigation, route }: RootScreenProps<'chapterEdit'>) {
  const { chapterId } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();

  const [loaded] = useState(() => {
    const chapter = getChapter(getDb(), chapterId);
    const html = chapter ? readChapterHtml(deviceFiles, chapter) : null;
    return { chapter, html, blocks: html === null ? [] : extractBlockTexts(html) };
  });
  const { chapter, html, blocks } = loaded;
  const [title, setTitle] = useState(chapter?.title ?? '');
  // Edits live in a ref: typing must not re-render the whole list.
  const edits = useRef(new Map<number, string>());
  const [changed, setChanged] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);

  const rows = useMemo(() => blocks.map((text, index) => ({ index, text })), [blocks]);

  const done = useCallback(() => {
    invalidate('chapters', 'novel', 'chapterContent');
    navigation.goBack();
  }, [navigation]);

  const save = () => {
    if (!chapter || html === null) {
      return;
    }
    saveEditedChapter(getDb(), deviceFiles, chapter, title, editBlocks(html, edits.current));
    showToast(t('reader.editSaved'));
    done();
  };

  const revert = () => {
    setConfirmRevert(false);
    if (chapter && revertEditedChapter(getDb(), deviceFiles, chapter)) {
      showToast(t('reader.editReverted'));
      done();
    }
  };

  if (!chapter || html === null) {
    return (
      <Screen bottom>
        <AppBar title={t('reader.editChapter')} onBack={navigation.goBack} />
        <EmptyState
          icon="cloud-off-outline"
          title={t('reader.notDownloadedTitle')}
          message={t('reader.notDownloadedMessage')}
        />
      </Screen>
    );
  }

  return (
    <Screen bottom>
      <AppBar
        title={t('reader.editChapter')}
        onBack={navigation.goBack}
        actions={
          <IconButton
            icon="check"
            label={t('common.save')}
            disabled={!changed && title === chapter.title}
            onPress={save}
          />
        }
      />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <FlatList
          data={rows}
          keyExtractor={(row) => String(row.index)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          initialNumToRender={12}
          ListHeaderComponent={
            <View style={styles.header}>
              <TextField label={t('reader.editTitle')} value={title} onChangeText={setTitle} />
              <AppText variant="caption" secondary>
                {t('reader.editHint')}
              </AppText>
              {chapter.isEdited ? (
                <View style={styles.revert}>
                  <Button
                    label={t('reader.revertOriginal')}
                    icon="restore"
                    variant="tonal"
                    onPress={() => setConfirmRevert(true)}
                  />
                </View>
              ) : null}
            </View>
          }
          renderItem={({ item }) =>
            item.text.trim() === '' ? (
              <AppText variant="caption" secondary style={styles.image}>
                {t('reader.editImage')}
              </AppText>
            ) : (
              <TextInput
                multiline
                scrollEnabled={false}
                defaultValue={item.text}
                accessibilityLabel={t('reader.editParagraph', { number: item.index + 1 })}
                onChangeText={(value) => {
                  edits.current.set(item.index, value);
                  if (!changed) {
                    setChanged(true);
                  }
                }}
                selectionColor={colors.primary}
                cursorColor={colors.primary}
                style={[
                  styles.paragraph,
                  { color: colors.text, backgroundColor: colors.surfaceVariant },
                ]}
              />
            )
          }
        />
      </KeyboardAvoidingView>
      <ConfirmDialog
        visible={confirmRevert}
        title={t('reader.revertOriginal')}
        message={t('reader.revertConfirm')}
        danger
        onConfirm={revert}
        onClose={() => setConfirmRevert(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl, gap: SPACING.sm },
  header: { gap: SPACING.sm, paddingBottom: SPACING.sm },
  revert: { alignItems: 'flex-start' },
  image: { paddingVertical: SPACING.xs },
  paragraph: {
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontFamily: FONTS.regular,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
});
