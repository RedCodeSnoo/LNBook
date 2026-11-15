import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { getDb } from '../../db/client';
import { useQuery } from '../../db/invalidation';
import { AppBar, Chip, IconButton, Screen } from '../../theme/components';
import { SPACING } from '../../theme/typography';
import { QuoteList } from './QuoteList';
import { listQuoteNovels } from './quotesRepository';

/** Plus → Quotes: the quotes of every novel, filtered by novel and by folder. */
export function QuotesScreen({ navigation }: RootScreenProps<'quotes'>) {
  const { t } = useTranslation();
  const novels = useQuery(() => listQuoteNovels(getDb()), ['quotes', 'library']);
  const [chosen, setChosen] = useState<number | null>(null);
  // A novel that lost its last quote falls back to "every novel".
  const novelId = chosen !== null && novels.some((novel) => novel.id === chosen) ? chosen : null;

  return (
    <Screen bottom>
      <AppBar
        title={t('more.quotes')}
        onBack={navigation.goBack}
        actions={
          <IconButton
            icon="folder-cog-outline"
            label={t('quotes.manageFolders')}
            onPress={() => navigation.navigate('quoteFolders')}
          />
        }
      />
      {/* Always shown, even without any quote: folders can be prepared in advance. */}
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {novels.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            keyboardShouldPersistTaps="handled"
          >
            <Chip
              label={t('quotes.allNovels')}
              selected={novelId === null}
              onPress={() => setChosen(null)}
            />
            {novels.map((novel) => (
              <Chip
                key={novel.id}
                label={`${novel.title} ${novel.count}`}
                selected={novelId === novel.id}
                onPress={() => setChosen(novel.id)}
              />
            ))}
          </ScrollView>
        ) : null}
        <QuoteList key={novelId ?? 'all'} novelId={novelId ?? undefined} showNovel />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: SPACING.xxl },
  chips: { gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
});
