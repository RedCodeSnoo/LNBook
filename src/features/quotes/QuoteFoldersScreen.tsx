import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { getDb } from '../../db/client';
import { invalidate, useQuery } from '../../db/invalidation';
import type { QuoteFolder } from '../../db/schema';
import {
  AppBar,
  AppText,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Fab,
  IconButton,
  Screen,
  TextField,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import {
  createFolder,
  deleteFolder,
  FOLDER_COLORS,
  listFolders,
  reorderFolders,
  updateFolder,
} from './quotesRepository';

type Prompt =
  | { kind: 'none' }
  | { kind: 'edit'; folder: QuoteFolder | null }
  | { kind: 'delete'; folder: QuoteFolder };

/** Quote folders, shared by every novel: create, rename, colour, reorder, delete. */
export function QuoteFoldersScreen({ navigation }: RootScreenProps<'quoteFolders'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const folders = useQuery(() => listFolders(getDb()), ['quotes']);
  const [prompt, setPrompt] = useState<Prompt>({ kind: 'none' });
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(FOLDER_COLORS[0]);

  const close = () => setPrompt({ kind: 'none' });
  const changed = () => invalidate('quotes');

  const edit = (folder: QuoteFolder | null) => {
    setName(folder?.name ?? '');
    setColor(folder?.color ?? FOLDER_COLORS[folders.length % FOLDER_COLORS.length]);
    setPrompt({ kind: 'edit', folder });
  };

  const move = (index: number, offset: number) => {
    const ids = folders.map((folder) => folder.id);
    const target = index + offset;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorderFolders(getDb(), ids);
    changed();
  };

  const save = () => {
    if (prompt.kind !== 'edit' || name.trim() === '') {
      return;
    }
    if (prompt.folder) {
      updateFolder(getDb(), prompt.folder.id, { name, color });
    } else {
      createFolder(getDb(), name, color);
    }
    changed();
    close();
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
                onPress={() => edit(folder)}
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
      <Fab icon="plus" label={t('quotes.addFolder')} onPress={() => edit(null)} />

      <Dialog
        visible={prompt.kind === 'edit'}
        title={
          prompt.kind === 'edit' && prompt.folder ? t('quotes.editFolder') : t('quotes.addFolder')
        }
        onClose={close}
        actions={[
          { label: t('common.cancel'), onPress: close },
          { label: t('common.save'), disabled: name.trim() === '', onPress: save },
        ]}
      >
        <View style={styles.form}>
          <TextField
            autoFocus
            value={name}
            onChangeText={setName}
            placeholder={t('quotes.newFolder')}
            accessibilityLabel={t('quotes.newFolder')}
            onSubmitEditing={save}
          />
          <View style={styles.colors}>
            {FOLDER_COLORS.map((option, index) => (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityLabel={t('quotes.colorNumber', { number: index + 1 })}
                accessibilityState={{ selected: color === option }}
                onPress={() => setColor(option)}
                hitSlop={4}
                style={[
                  styles.color,
                  { backgroundColor: option, borderColor: colors.text },
                  color === option && styles.colorSelected,
                ]}
              />
            ))}
          </View>
        </View>
      </Dialog>
      <ConfirmDialog
        visible={prompt.kind === 'delete'}
        title={t('quotes.deleteFolderTitle')}
        message={t('quotes.deleteFolderMessage')}
        confirmLabel={t('common.delete')}
        danger
        onClose={close}
        onConfirm={() => {
          if (prompt.kind === 'delete') {
            deleteFolder(getDb(), prompt.folder.id);
            changed();
          }
          close();
        }}
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
  form: { gap: SPACING.md },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md },
  color: { width: 32, height: 32, borderRadius: RADIUS.pill, borderWidth: 0 },
  colorSelected: { borderWidth: 3 },
});
