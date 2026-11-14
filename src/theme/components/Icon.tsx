import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import type { ThemeColor } from '../palette';

import { useTheme } from '../ThemeProvider';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function Icon({
  name,
  size = 24,
  color,
}: {
  name: IconName;
  size?: number;
  color?: ThemeColor;
}) {
  const theme = useTheme();
  return <MaterialCommunityIcons name={name} size={size} color={color ?? theme.colors.text} />;
}
