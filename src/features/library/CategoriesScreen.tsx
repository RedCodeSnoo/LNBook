import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { getDb } from '../../db/client';
import { invalidate, useQuery } from '../../db/invalidation';
import type { Category } from '../../db/schema';
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
  createCategory,
  deleteCategory,
  listCategories,
  renameCategory,
  reorderCategories,
} from './libraryRepository';

type Prompt =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'rename'; category: Category }
  | { kind: 'delete'; category: Category };

export function CategoriesScreen({ navigation }: RootScreenProps<'categories'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const categories = useQuery(() => listCategories(getDb()), ['categories']);
  const [prompt, setPrompt] = useState<Prompt>({ kind: 'none' });
  const [name, setName] = useState('');

  const close = () => {
    setPrompt({ kind: 'none' });
    setName('');
  };
  const changed = () => invalidate('categories', 'library');

  const move = (index: number, offset: number) => {
    const ids = categories.map((category) => category.id);
    const target = index + offset;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorderCategories(getDb(), ids);
    changed();
  };

  const save = () => {
    if (prompt.kind === 'create') {
      createCategory(getDb(), name);
    } else if (prompt.kind === 'rename') {
      renameCategory(getDb(), prompt.category.id, name);
    }
    changed();
    close();
  };

  return (
    <Screen bottom>
      <AppBar title={t('categories.title')} onBack={navigation.goBack} />
      {categories.length === 0 ? (
        <EmptyState
          icon="label-outline"
          title={t('categories.emptyTitle')}
          message={t('categories.emptyMessage')}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {categories.map((category, index) => (
            <View key={category.id} style={[styles.row, { backgroundColor: colors.surface }]}>
              <AppText variant="subtitle" style={styles.name} numberOfLines={2}>
                {category.name}
              </AppText>
              <IconButton
                icon="arrow-up"
                label={t('categories.moveUp', { name: category.name })}
                disabled={index === 0}
                onPress={() => move(index, -1)}
              />
              <IconButton
                icon="arrow-down"
                label={t('categories.moveDown', { name: category.name })}
                disabled={index === categories.length - 1}
                onPress={() => move(index, 1)}
              />
              <IconButton
                icon="pencil-outline"
                label={t('categories.rename', { name: category.name })}
                onPress={() => {
                  setName(category.name);
                  setPrompt({ kind: 'rename', category });
                }}
              />
              <IconButton
                icon="delete-outline"
                label={t('categories.delete', { name: category.name })}
                onPress={() => setPrompt({ kind: 'delete', category })}
              />
            </View>
          ))}
        </ScrollView>
      )}
      <Fab icon="plus" label={t('categories.add')} onPress={() => setPrompt({ kind: 'create' })} />

      <Dialog
        visible={prompt.kind === 'create' || prompt.kind === 'rename'}
        title={prompt.kind === 'rename' ? t('categories.renameTitle') : t('categories.add')}
        onClose={close}
        actions={[
          { label: t('common.cancel'), onPress: close },
          { label: t('common.save'), disabled: name.trim() === '', onPress: save },
        ]}
      >
        <TextField
          autoFocus
          value={name}
          onChangeText={setName}
          placeholder={t('categories.namePlaceholder')}
          onSubmitEditing={() => name.trim() !== '' && save()}
        />
      </Dialog>
      <ConfirmDialog
        visible={prompt.kind === 'delete'}
        title={t('categories.deleteTitle')}
        message={t('categories.deleteMessage')}
        confirmLabel={t('common.delete')}
        danger
        onClose={close}
        onConfirm={() => {
          if (prompt.kind === 'delete') {
            deleteCategory(getDb(), prompt.category.id);
            changed();
          }
          close();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: SPACING.lg, gap: SPACING.sm, paddingBottom: 96 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADIUS.md,
    paddingLeft: SPACING.lg,
    minHeight: 56,
  },
  name: { flex: 1 },
});
