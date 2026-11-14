import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../ThemeProvider';
import { RADIUS, SPACING } from '../typography';
import { AppText } from './AppText';

/** Two or three top-level choices shown as a pill selector (e.g. Online / Local). */
export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.container, { backgroundColor: colors.surfaceVariant }]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.option, selected && { backgroundColor: colors.primaryContainer }]}
          >
            <AppText
              variant="label"
              color={selected ? colors.onPrimaryContainer : colors.textSecondary}
            >
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: RADIUS.pill,
    padding: 4,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  option: {
    flex: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.pill,
  },
});
