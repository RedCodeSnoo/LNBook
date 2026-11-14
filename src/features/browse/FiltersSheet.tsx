import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  FilterTypes,
  type FilterValue,
  type FilterValues,
  type PluginFilters,
} from '../../plugins/types';
import {
  AppText,
  BottomSheet,
  Button,
  CheckItem,
  Chip,
  SectionHeader,
  SwitchItem,
  TextField,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { SPACING } from '../../theme/typography';

/** Values sent to the plugin: the default value of every filter. */
export function defaultFilterValues(filters: PluginFilters | undefined): FilterValues {
  return Object.fromEntries(
    Object.entries(filters ?? {}).map(([key, filter]) => [
      key,
      { type: filter.type, value: filter.value },
    ]),
  );
}

type Excludable = { include?: string[]; exclude?: string[] };

/** Filters of a source, generated from the `filters` declared by its plugin. */
export function FiltersSheet({
  visible,
  onClose,
  filters,
  values,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  filters: PluginFilters;
  values: FilterValues;
  onApply: (values: FilterValues) => void;
}) {
  const { t } = useTranslation();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('sources.filters')}>
      {visible ? (
        <FiltersForm filters={filters} values={values} onApply={onApply} onClose={onClose} />
      ) : null}
    </BottomSheet>
  );
}

function FiltersForm({
  filters,
  values,
  onApply,
  onClose,
}: {
  filters: PluginFilters;
  values: FilterValues;
  onApply: (values: FilterValues) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [draft, setDraft] = useState<FilterValues>(values);

  const set = (key: string, value: FilterValue) =>
    setDraft((current) => ({ ...current, [key]: { type: filters[key].type, value } }));

  return (
    <View>
      {Object.entries(filters).map(([key, filter]) => {
        const value = draft[key]?.value ?? filter.value;
        switch (filter.type) {
          case FilterTypes.TextInput:
            return (
              <View key={key} style={styles.field}>
                <TextField
                  label={filter.label}
                  value={String(value ?? '')}
                  onChangeText={(text) => set(key, text)}
                />
              </View>
            );
          case FilterTypes.Switch:
            return (
              <SwitchItem
                key={key}
                title={filter.label}
                value={Boolean(value)}
                onValueChange={(next) => set(key, next)}
              />
            );
          case FilterTypes.Picker:
            return (
              <View key={key}>
                <SectionHeader title={filter.label} />
                <View style={styles.chips}>
                  {filter.options.map((option) => (
                    <Chip
                      key={option.value}
                      label={option.label}
                      selected={value === option.value}
                      onPress={() => set(key, option.value)}
                    />
                  ))}
                </View>
              </View>
            );
          case FilterTypes.CheckboxGroup: {
            const selected = Array.isArray(value) ? value : [];
            return (
              <View key={key}>
                <SectionHeader title={filter.label} />
                {filter.options.map((option) => (
                  <CheckItem
                    key={option.value}
                    title={option.label}
                    checked={selected.includes(option.value)}
                    onPress={() =>
                      set(
                        key,
                        selected.includes(option.value)
                          ? selected.filter((item) => item !== option.value)
                          : [...selected, option.value],
                      )
                    }
                  />
                ))}
              </View>
            );
          }
          case FilterTypes.ExcludableCheckboxGroup: {
            const current = (value ?? {}) as Excludable;
            const include = current.include ?? [];
            const exclude = current.exclude ?? [];
            // Each tap goes: not used → included → excluded → not used.
            const cycle = (option: string) => {
              if (include.includes(option)) {
                set(key, {
                  include: include.filter((item) => item !== option),
                  exclude: [...exclude, option],
                });
              } else if (exclude.includes(option)) {
                set(key, { include, exclude: exclude.filter((item) => item !== option) });
              } else {
                set(key, { include: [...include, option], exclude });
              }
            };
            return (
              <View key={key}>
                <SectionHeader title={filter.label} />
                <AppText variant="caption" secondary style={styles.hint}>
                  {t('sources.excludableHint')}
                </AppText>
                <View style={styles.chips}>
                  {filter.options.map((option) => {
                    const excluded = exclude.includes(option.value);
                    return (
                      <Chip
                        key={option.value}
                        icon={
                          excluded ? 'close' : include.includes(option.value) ? 'check' : undefined
                        }
                        label={option.label}
                        selected={include.includes(option.value) || excluded}
                        onPress={() => cycle(option.value)}
                      />
                    );
                  })}
                </View>
              </View>
            );
          }
          default:
            return null;
        }
      })}
      <View style={[styles.actions, { borderTopColor: colors.border }]}>
        <Button
          label={t('sources.resetFilters')}
          variant="text"
          onPress={() => setDraft(defaultFilterValues(filters))}
        />
        <Button
          label={t('sources.applyFilters')}
          icon="check"
          onPress={() => {
            onApply(draft);
            onClose();
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, paddingHorizontal: SPACING.lg },
  hint: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.sm,
    padding: SPACING.lg,
    marginTop: SPACING.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
