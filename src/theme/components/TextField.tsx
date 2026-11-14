import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { useTheme, useUiScale } from '../ThemeProvider';
import { FONTS, RADIUS, SPACING } from '../typography';
import { AppText } from './AppText';

export function TextField({ label, style, ...rest }: TextInputProps & { label?: string }) {
  const { colors } = useTheme();
  const scale = useUiScale();
  return (
    <View style={styles.container}>
      {label ? (
        <AppText variant="label" secondary>
          {label}
        </AppText>
      ) : null}
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textDisabled}
        selectionColor={colors.primary}
        cursorColor={colors.primary}
        {...rest}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.surfaceVariant,
            fontSize: 15 * scale,
          },
          rest.multiline && styles.multiline,
          style,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: SPACING.xs },
  input: {
    minHeight: 48,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontFamily: FONTS.regular,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
});
