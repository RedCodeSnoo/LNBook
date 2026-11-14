import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { getDb } from '../../db/client';
import { invalidate, useQuery } from '../../db/invalidation';
import { deviceFiles } from '../../services/deviceFileStore';
import {
  AppBar,
  AppText,
  Button,
  Chip,
  Cover,
  EmptyState,
  Screen,
  TextField,
  showToast,
} from '../../theme/components';
import { SPACING } from '../../theme/typography';
import { LANGUAGES } from '../translation/languages';
import {
  getNovel,
  restoreOriginalCover,
  setCustomCover,
  updateNovelFields,
  type NovelPatch,
} from './novelRepository';

const STATUSES = ['ongoing', 'completed', 'hiatus', 'cancelled', 'unknown'] as const;
const LANGUAGE_CHOICES = ['en', 'fr', 'ja', 'zh', 'ko', 'es', 'de', 'it', 'pt', 'ru'];

export function NovelEditScreen({ navigation, route }: RootScreenProps<'novelEdit'>) {
  const { novelId } = route.params;
  const { t } = useTranslation();
  const novel = useQuery(() => getNovel(getDb(), novelId), ['novel'], [novelId]);

  const [title, setTitle] = useState(novel?.title ?? '');
  const [author, setAuthor] = useState(novel?.author ?? '');
  const [description, setDescription] = useState(novel?.description ?? '');
  const [genres, setGenres] = useState(novel?.genres ?? '');
  const [status, setStatus] = useState(novel?.status ?? '');
  const [language, setLanguage] = useState(novel?.originalLang ?? '');

  if (!novel) {
    return (
      <Screen bottom>
        <AppBar title="" onBack={navigation.goBack} />
        <EmptyState icon="book-off-outline" title={t('novel.notFound')} />
      </Screen>
    );
  }

  const pickCover = async () => {
    // The system picker also offers the crop step (2:3, the ratio of covers).
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [2, 3],
      quality: 0.9,
    });
    if (result.canceled || result.assets.length === 0) {
      return;
    }
    try {
      const asset = result.assets[0];
      const data = await new File(asset.uri).bytes();
      const extension = /\.png$/i.test(asset.uri)
        ? 'png'
        : /\.webp$/i.test(asset.uri)
          ? 'webp'
          : 'jpg';
      setCustomCover(getDb(), deviceFiles, novelId, data, extension);
      invalidate('novel', 'library');
    } catch {
      showToast(t('novel.coverError'));
    }
  };

  const save = () => {
    // Only the fields that changed are saved (and marked as edited).
    const patch: NovelPatch = {};
    if (title.trim() !== novel.title && title.trim() !== '') {
      patch.title = title;
    }
    if (author.trim() !== (novel.author ?? '')) {
      patch.author = author;
    }
    if (description.trim() !== (novel.description ?? '')) {
      patch.description = description;
    }
    if (genres.trim() !== (novel.genres ?? '')) {
      patch.genres = genres;
    }
    if (status !== (novel.status ?? '')) {
      patch.status = status;
    }
    if (language !== (novel.originalLang ?? '')) {
      patch.originalLang = language;
    }
    updateNovelFields(getDb(), novelId, patch);
    invalidate('novel', 'library');
    navigation.goBack();
  };

  const hasCustomCover = novel.coverPath !== novel.originalCoverPath;

  return (
    <Screen bottom>
      <AppBar
        title={t('novel.edit')}
        onBack={navigation.goBack}
        actions={<Button label={t('common.save')} variant="text" compact onPress={save} />}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.coverRow}>
          <View style={styles.cover}>
            <Cover path={novel.coverPath} title={title || novel.title} />
          </View>
          <View style={styles.coverActions}>
            <Button
              label={t('novel.chooseCover')}
              icon="image-outline"
              variant="tonal"
              onPress={() => void pickCover()}
            />
            {hasCustomCover ? (
              <Button
                label={t('novel.restoreCover')}
                icon="restore"
                variant="text"
                onPress={() => {
                  restoreOriginalCover(getDb(), deviceFiles, novelId);
                  invalidate('novel', 'library');
                }}
              />
            ) : null}
          </View>
        </View>

        <TextField label={t('novel.fieldTitle')} value={title} onChangeText={setTitle} />
        <TextField label={t('novel.fieldAuthor')} value={author} onChangeText={setAuthor} />
        <TextField
          label={t('novel.fieldDescription')}
          value={description}
          onChangeText={setDescription}
          multiline
        />
        <TextField
          label={t('novel.fieldGenres')}
          value={genres}
          onChangeText={setGenres}
          placeholder={t('novel.genresPlaceholder')}
        />

        <AppText variant="label" secondary>
          {t('novel.fieldStatus')}
        </AppText>
        <View style={styles.chips}>
          {STATUSES.map((value) => {
            const label = t(`novel.status.${value}`);
            return (
              <Chip
                key={value}
                label={label}
                selected={status === label}
                onPress={() => setStatus(status === label ? '' : label)}
              />
            );
          })}
        </View>

        <AppText variant="label" secondary>
          {t('novel.fieldLanguage')}
        </AppText>
        <View style={styles.chips}>
          {LANGUAGE_CHOICES.map((code) => (
            <Chip
              key={code}
              label={`${LANGUAGES[code].flag} ${LANGUAGES[code].name}`}
              selected={language === code}
              onPress={() => setLanguage(language === code ? '' : code)}
            />
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: SPACING.lg, gap: SPACING.md },
  coverRow: { flexDirection: 'row', gap: SPACING.lg, alignItems: 'center' },
  cover: { width: 110 },
  coverActions: { flex: 1, gap: SPACING.sm, alignItems: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
});
