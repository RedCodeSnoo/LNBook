import { useEffect, useState } from 'react';
import { Animated, type DimensionValue, type ViewStyle } from 'react-native';

import { useTheme } from '../ThemeProvider';
import { RADIUS } from '../typography';

/** Pulsing placeholder shown while content loads (preferred over spinners). */
export function Skeleton({
  width = '100%',
  height = 16,
  radius = RADIUS.sm,
  style,
}: {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  const [opacity] = useState(() => new Animated.Value(0.5));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: radius, backgroundColor: colors.skeleton, opacity },
        style,
      ]}
    />
  );
}
