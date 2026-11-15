import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { getDb } from '../../db/client';
import { invalidate } from '../../db/invalidation';
import type { QuoteFolder } from '../../db/schema';
import { ConfirmDialog, Dialog, TextField } from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import { createFolder, deleteFolder, FOLDER_COLORS, updateFolder } from './quotesRepository';

export type FolderPrompt =
  | { kind: 'none' }
  /** `folder: null` creates a new folder. */
  | { kind: 'edit'; folder: QuoteFolder | null }
  | { kind: 'delete'; folder: QuoteFolder };

/**
 * Dialogs to create, rename, recolour and delete a quote folder. Usable anywhere folders
 * are shown, with or without quotes.
 */
export function FolderDialogs({
  prompt,
  folderCount,
  onClose,
}: {
  prompt: FolderPrompt;
  /** Number of folders: picks the colour of a new one. */
  folderCount: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  // The form is filled each time a dialog opens (state reset by the key below).
  const editing = prompt.kind === 'edit' ? prompt.folder : null;
  const [form, setForm] = useState<{ key: string; name: string; color: string } | null>(null);
  const formKey = prompt.kind === 'edit' ? `edit-${editing?.id ?? 'new'}` : 'none';
  const name = form?.key === formKey ? form.name : (editing?.name ?? '');
  const color =
    form?.key === formKey
      ? form.color
      : (editing?.color ?? FOLDER_COLORS[folderCount % FOLDER_COLORS.length]);
  const change = (next: { name?: string; color?: string }) =>
    setForm({ key: formKey, name: next.name ?? name, color: next.color ?? color });

  const close = () => {
    setForm(null);
    onClose();
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
    invalidate('quotes');
    close();
  };

  return (
    <>
      <Dialog
        visible={prompt.kind === 'edit'}
        title={editing ? t('quotes.editFolder') : t('quotes.addFolder')}
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
            onChangeText={(value) => change({ name: value })}
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
                onPress={() => change({ color: option })}
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
            invalidate('quotes');
          }
          close();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  form: { gap: SPACING.md },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md },
  color: { width: 32, height: 32, borderRadius: RADIUS.pill, borderWidth: 0 },
  colorSelected: { borderWidth: 3 },
});
