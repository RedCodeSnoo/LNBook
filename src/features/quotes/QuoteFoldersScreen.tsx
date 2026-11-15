import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { getDb } from '../../db/client';
import { invalidate, useQuery } from '../../db/invalidation';
import { AppBar, AppText, EmptyState, Fab, IconButton, Screen } from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { SPACING } from '../../theme/typography';
import { FolderDialogs, type FolderPrompt } from './FolderDialogs';
import { listFolders, reorderFolders } from './quotesRepository';

/** Quote folders, shared by every novel: create, rename, colour, reorder, delete. */
export function QuoteFoldersScreen({ navigation }: RootScreenProps<'quoteFolders'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const folders = useQuery(() => listFolders(getDb()), ['quotes']);
  const [prompt, setPrompt] = useState<FolderPrompt>({ kind: 'none' });
  const changed = () => invalidate('quotes');

  const move = (index: number, offset: number) => {
    const ids = folders.map((folder) => folder.id);
    const target = index + offset;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorderFolders(getDb(), ids);
    changed();
  };

  return (
    <Screen bottom>
      <AppBar title={t('quotes.foldersTitle')} onBack={navigation.goBack} />
      {folders.length === 0 ? (
        <EmptyState
          icon="folder-outline"
          title={t('quotes.foldersEmptyTitle')}
          message={t('quotes.foldersEmptyMessage')}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {folders.map((folder, index) => (
            <View key={folder.id} style={[styles.row, { backgroundColor: colors.surface }]}>
              <View style={[styles.dot, { backgroundColor: folder.color }]} />
              <AppText variant="subtitle" style={styles.name} numberOfLines={2}>
                {folder.name}
              </AppText>
              <IconButton
                icon="arrow-up"
                label={t('categories.moveUp', { name: folder.name })}
                disabled={index === 0}
                onPress={() => move(index, -1)}
              />
              <IconButton
                icon="arrow-down"
                label={t('categories.moveDown', { name: folder.name })}
                disabled={index === folders.length - 1}
                onPress={() => move(index, 1)}
              />
              <IconButton
                icon="pencil-outline"
                label={t('categories.rename', { name: folder.name })}
                onPress={() => setPrompt({ kind: 'edit', folder })}
              />
              <IconButton
                icon="delete-outline"
                label={t('categories.delete', { name: folder.name })}
                onPress={() => setPrompt({ kind: 'delete', folder })}
              />
            </View>
          ))}
        </ScrollView>
      )}
      <Fab
        icon="plus"
        label={t('quotes.addFolder')}
        onPress={() => setPrompt({ kind: 'edit', folder: null })}
      />

      <FolderDialogs
        prompt={prompt}
        folderCount={folders.length}
        onClose={() => setPrompt({ kind: 'none' })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 96 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingLeft: SPACING.lg,
    paddingRight: SPACING.xs,
    gap: SPACING.xs,
  },
  dot: { width: 14, height: 14, borderRadius: 7, marginRight: SPACING.sm },
  name: { flex: 1 },
});
