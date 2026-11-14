import { Text, type TextProps } from 'react-native';

import type { ThemeColor } from '../palette';

import { useTheme, useUiScale } from '../ThemeProvider';
import { TEXT_VARIANTS, type TextVariant } from '../typography';

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  color?: ThemeColor;
  secondary?: boolean;
  center?: boolean;
}

/** Text with the app typography. System font scaling stays enabled. */
export function AppText({
  variant = 'body',
  color,
  secondary,
  center,
  style,
  ...rest
}: AppTextProps) {
  const theme = useTheme();
  const scale = useUiScale();
  const base = TEXT_VARIANTS[variant];
  return (
    <Text
      {...rest}
      style={[
        base,
        {
          fontSize: base.fontSize * scale,
          lineHeight: base.lineHeight * scale,
          color: color ?? (secondary ? theme.colors.textSecondary : theme.colors.text),
        },
        center && { textAlign: 'center' },
        style,
      ]}
    />
  );
}
