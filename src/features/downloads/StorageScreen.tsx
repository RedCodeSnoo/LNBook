import { Image } from 'expo-image';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { getDb } from '../../db/client';
import { invalidate, useQuery } from '../../db/invalidation';
import { deviceFiles } from '../../services/deviceFileStore';
import { formatBytes } from '../../services/format';
import {
  AppBar,
  AppText,
  BottomSheet,
  Cover,
  EmptyState,
  ListItem,
  Screen,
  showToast,
} from '../../theme/components';
import { SPACING } from '../../theme/typography';
import { deleteNovelDownloads, listNovelStorage, type NovelStorage } from './storage';

/** Space used by each novel, with removal of the downloaded chapters. */
export function StorageScreen({ navigation }: RootScreenProps<'storage'>) {
  const { t } = useTranslation();
  const novels = useQuery(
    () => listNovelStorage(getDb(), deviceFiles),
    ['downloads', 'chapters', 'library'],
  );
  const [selected, setSelected] = useState<NovelStorage | null>(null);
  const total = novels.reduce((sum, novel) => sum + novel.bytes, 0);

  const remove = (novel: NovelStorage, onlyRead: boolean) => {
    const removed = deleteNovelDownloads(getDb(), deviceFiles, novel.novelId, onlyRead);
    invalidate('downloads', 'chapters', 'library', 'novel', 'chapterContent');
    showToast(t('downloads.removed', { count: removed }));
    setSelected(null);
  };

  return (
    <Screen bottom>
      <AppBar
        title={t('downloads.storage')}
        subtitle={t('downloads.storageTotal', { size: formatBytes(total) })}
        onBack={navigation.goBack}
      />
      <ScrollView contentContainerStyle={styles.list}>
        <ListItem
          icon="image-remove-outline"
          title={t('downloads.clearImageCache')}
          subtitle={t('downloads.clearImageCacheHint')}
          onPress={() => {
            void Image.clearDiskCache().then(() => showToast(t('downloads.imageCacheCleared')));
          }}
        />
        {novels.length === 0 ? (
          <EmptyState icon="harddisk" title={t('downloads.storageEmpty')} />
        ) : (
          novels.map((novel) => (
            <ListItem
              key={novel.novelId}
              title={novel.title}
              subtitle={[
                formatBytes(novel.bytes),
                novel.origin === 'local'
                  ? t('novel.localFile')
                  : t('downloads.downloadedChapters', { count: novel.downloaded }),
              ].join(' · ')}
              onPress={
                novel.origin === 'online' && novel.downloaded > 0
                  ? () => setSelected(novel)
                  : undefined
              }
              right={
                <View style={styles.cover}>
                  <Cover path={novel.coverPath} title={novel.title} shadow={false} />
                </View>
              }
            />
          ))
        )}
        <AppText variant="caption" secondary center style={styles.hint}>
          {t('downloads.storageNote')}
        </AppText>
      </ScrollView>

      <BottomSheet
        visible={selected !== null}
        title={selected?.title}
        onClose={() => setSelected(null)}
      >
        {selected ? (
          <>
            <ListItem
              icon="check-all"
              title={t('downloads.removeRead')}
              subtitle={t('downloads.downloadedChapters', { count: selected.downloadedRead })}
              disabled={selected.downloadedRead === 0}
              onPress={() => remove(selected, true)}
            />
            <ListItem
              icon="trash-can-outline"
              title={t('downloads.removeAll')}
              subtitle={t('downloads.downloadedChapters', { count: selected.downloaded })}
              onPress={() => remove(selected, false)}
            />
          </>
        ) : null}
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: SPACING.xl },
  cover: { width: 36 },
  hint: { padding: SPACING.lg },
});
