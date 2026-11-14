import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { getDb } from '../../db/client';
import { invalidate, useQuery } from '../../db/invalidation';
import {
  AppText,
  BottomSheet,
  Button,
  CheckItem,
  IconButton,
  SectionHeader,
  TextField,
  showToast,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import type { Anchor } from '../reader/readerHtml';
import {
  createFolder,
  createQuote,
  deleteQuote,
  listFolders,
  setQuoteFolders,
  updateQuoteNote,
  type QuoteView,
} from './quotesRepository';

export interface QuoteDraft {
  novelId: number;
  chapterId: number;
  text: string;
  anchor: Anchor;
  lang: string | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** A passage just selected in the reader. */
  draft?: QuoteDraft | null;
  /** An existing quote to edit. */
  quote?: QuoteView | null;
}

/** Sheet to save a selected passage as a quote, or to edit the folders and note of one. */
export function QuoteEditorSheet(props: Props) {
  const { t } = useTranslation();
  const target = props.quote ?? props.draft;
  return (
    <BottomSheet
      visible={props.visible && Boolean(target)}
      onClose={props.onClose}
      title={props.quote ? t('quotes.editTitle') : t('quotes.newTitle')}
    >
      {props.visible && target ? (
        <Editor key={props.quote ? `q${props.quote.id}` : 'draft'} {...props} />
      ) : null}
    </BottomSheet>
  );
}

function Editor({ onClose, draft, quote }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const folders = useQuery(() => listFolders(getDb()), ['quotes']);
  const [selected, setSelected] = useState<ReadonlySet<number>>(
    () => new Set(quote?.folders.map((folder) => folder.id) ?? []),
  );
  const [note, setNote] = useState(quote?.note ?? '');
  const [folderName, setFolderName] = useState('');
  const text = quote?.text ?? draft?.text ?? '';

  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });

  const addFolder = () => {
    const name = folderName.trim();
    if (name === '') {
      return;
    }
    const existing = folders.find((folder) => folder.name.toLowerCase() === name.toLowerCase());
    const folder = existing ?? createFolder(getDb(), name);
    setSelected((current) => new Set(current).add(folder.id));
    setFolderName('');
    invalidate('quotes');
  };

  const save = () => {
    const db = getDb();
    if (quote) {
      updateQuoteNote(db, quote.id, note);
      setQuoteFolders(db, quote.id, [...selected]);
    } else if (draft) {
      createQuote(db, { ...draft, note, folderIds: [...selected] });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(t('quotes.saved'));
    }
    invalidate('quotes');
    onClose();
  };

  const remove = () => {
    if (quote) {
      deleteQuote(getDb(), quote.id);
      invalidate('quotes');
      showToast(t('quotes.deleted'));
    }
    onClose();
  };

  return (
    <View>
      <View style={[styles.preview, { backgroundColor: colors.surfaceVariant }]}>
        <AppText numberOfLines={6}>{text}</AppText>
      </View>

      <SectionHeader title={t('quotes.folders')} />
      {folders.length === 0 ? (
        <AppText variant="label" secondary style={styles.hint}>
          {t('quotes.noFolderHint')}
        </AppText>
      ) : null}
      {folders.map((folder) => (
        <CheckItem
          key={folder.id}
          title={folder.name}
          checked={selected.has(folder.id)}
          onPress={() => toggle(folder.id)}
        />
      ))}
      <View style={styles.newFolder}>
        <View style={styles.flex}>
          <TextField
            value={folderName}
            onChangeText={setFolderName}
            placeholder={t('quotes.newFolder')}
            accessibilityLabel={t('quotes.newFolder')}
            returnKeyType="done"
            onSubmitEditing={addFolder}
          />
        </View>
        <IconButton
          icon="folder-plus-outline"
          label={t('quotes.addFolder')}
          disabled={folderName.trim() === ''}
          onPress={addFolder}
        />
      </View>

      <View style={styles.note}>
        <TextField
          label={t('quotes.note')}
          value={note}
          onChangeText={setNote}
          placeholder={t('quotes.notePlaceholder')}
          multiline
        />
      </View>

      <View style={styles.actions}>
        {quote ? (
          <Button label={t('common.delete')} variant="text" danger onPress={remove} />
        ) : (
          <Button label={t('common.cancel')} variant="text" onPress={onClose} />
        )}
        <Button label={t('common.save')} icon="check" onPress={save} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  preview: { marginHorizontal: SPACING.lg, padding: SPACING.md, borderRadius: RADIUS.md },
  hint: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  newFolder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingLeft: SPACING.lg,
    paddingRight: SPACING.xs,
    paddingTop: SPACING.xs,
  },
  note: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
  },
});
