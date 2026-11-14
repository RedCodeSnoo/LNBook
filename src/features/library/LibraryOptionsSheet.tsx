import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  AppText,
  BottomSheet,
  CheckItem,
  Chip,
  IconButton,
  ListItem,
  SectionHeader,
  SegmentedTabs,
  Icon,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { SPACING } from '../../theme/typography';
import type { LibraryDisplay } from '../settings/settings';
import { setSetting, useSetting } from '../settings/settingsStore';
import { languageInfo } from '../translation/languages';
import { LIBRARY_SORTS, type LibraryFilters, type LibrarySort } from './libraryView';

const TOGGLES = ['unread', 'downloaded', 'inProgress', 'completed', 'translated'] as const;

export function LibraryOptionsSheet({
  visible,
  onClose,
  filters,
  onFiltersChange,
  sources,
  languages,
}: {
  visible: boolean;
  onClose: () => void;
  filters: LibraryFilters;
  onFiltersChange: (filters: LibraryFilters) => void;
  /** Sources present in the library: key ('file' or plugin id) and display name. */
  sources: { key: string; name: string }[];
  languages: string[];
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const sort = useSetting('librarySort') as LibrarySort;
  const ascending = useSetting('librarySortAscending');
  const display = useSetting('libraryDisplay');
  const columns = useSetting('libraryColumns');

  const toggleIn = (list: string[], value: string) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('library.options')}>
      <SectionHeader title={t('library.display')} />
      <SegmentedTabs<LibraryDisplay>
        value={display}
        onChange={(value) => setSetting('libraryDisplay', value)}
        options={[
          { value: 'grid', label: t('library.displayGrid') },
          { value: 'compact', label: t('library.displayCompact') },
          { value: 'list', label: t('library.displayList') },
        ]}
      />
      {display !== 'list' ? (
        <View style={styles.columns}>
          <AppText style={styles.columnsLabel}>{t('library.columns')}</AppText>
          <IconButton
            icon="minus"
            label={t('library.fewerColumns')}
            disabled={columns <= 2}
            onPress={() => setSetting('libraryColumns', Math.max(2, columns - 1))}
          />
          <AppText variant="subtitle">{columns}</AppText>
          <IconButton
            icon="plus"
            label={t('library.moreColumns')}
            disabled={columns >= 5}
            onPress={() => setSetting('libraryColumns', Math.min(5, columns + 1))}
          />
        </View>
      ) : null}

      <SectionHeader title={t('library.sort')} />
      {LIBRARY_SORTS.map((option) => (
        <ListItem
          key={option}
          title={t(`library.sortBy.${option}`)}
          selected={sort === option}
          right={
            sort === option ? (
              <Icon name={ascending ? 'arrow-up' : 'arrow-down'} color={colors.primary} />
            ) : undefined
          }
          onPress={() => {
            if (sort === option) {
              setSetting('librarySortAscending', !ascending);
            } else {
              setSetting('librarySort', option);
              setSetting('librarySortAscending', option === 'title');
            }
          }}
        />
      ))}

      <SectionHeader title={t('library.filters')} />
      {TOGGLES.map((key) => (
        <CheckItem
          key={key}
          title={t(`library.filterBy.${key}`)}
          checked={filters[key]}
          onPress={() => onFiltersChange({ ...filters, [key]: !filters[key] })}
        />
      ))}
      {sources.length > 1 ? (
        <>
          <SectionHeader title={t('library.filterBy.source')} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            {sources.map((source) => (
              <Chip
                key={source.key}
                label={source.name}
                selected={filters.sources.includes(source.key)}
                onPress={() =>
                  onFiltersChange({ ...filters, sources: toggleIn(filters.sources, source.key) })
                }
              />
            ))}
          </ScrollView>
        </>
      ) : null}
      {languages.length > 1 ? (
        <>
          <SectionHeader title={t('library.filterBy.language')} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            {languages.map((code) => {
              const info = languageInfo(code);
              return (
                <Chip
                  key={code}
                  label={info ? `${info.flag} ${info.name}` : code}
                  selected={filters.languages.includes(code)}
                  onPress={() =>
                    onFiltersChange({ ...filters, languages: toggleIn(filters.languages, code) })
                  }
                />
              );
            })}
          </ScrollView>
        </>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  columns: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.lg },
  columnsLabel: { flex: 1 },
  chips: { gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
});
