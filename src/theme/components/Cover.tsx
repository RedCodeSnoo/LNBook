import { Image } from 'expo-image';
import { StyleSheet, View, type DimensionValue } from 'react-native';

import { deviceFiles } from '../../services/deviceFileStore';
import { useTheme } from '../ThemeProvider';
import { FONTS, RADIUS } from '../typography';
import { AppText } from './AppText';

const DEFAULT_COVER_COLORS = [
  ['#3F4A9A', '#E3E5FF'],
  ['#0B5F5B', '#D3F1EE'],
  ['#7A3510', '#FFE3D3'],
  ['#57309A', '#EEE1FF'],
  ['#84203F', '#FFDDE7'],
  ['#1F5522', '#DDF2DE'],
  ['#134B8C', '#DCEBFF'],
  ['#5C4300', '#FFEBC2'],
] as const;

function hash(value: string): number {
  let result = 0;
  for (let i = 0; i < value.length; i += 1) {
    result = (result * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(result);
}

/** Resolves a stored cover path (relative file path or remote URL) to an image URI. */
export function coverUri(path: string | null | undefined): string | null {
  if (!path) {
    return null;
  }
  return /^(https?:|file:|content:|data:)/.test(path) ? path : deviceFiles.uri(path);
}

/**
 * Book cover with a 2:3 ratio and a light shadow. Without image, a cover is generated
 * from the title (colour picked from the title, so it stays the same over time).
 */
export function Cover({
  path,
  title,
  width = '100%',
  radius = RADIUS.sm,
  shadow = true,
}: {
  path: string | null | undefined;
  title: string;
  width?: DimensionValue;
  radius?: number;
  shadow?: boolean;
}) {
  const { colors } = useTheme();
  const uri = coverUri(path);
  const [background, foreground] = DEFAULT_COVER_COLORS[hash(title) % DEFAULT_COVER_COLORS.length];

  return (
    <View
      style={[
        styles.frame,
        { width, borderRadius: radius, backgroundColor: colors.surfaceVariant },
        shadow && styles.shadow,
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={[styles.image, { borderRadius: radius }]}
          contentFit="cover"
          transition={150}
          recyclingKey={uri}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.generated, { backgroundColor: background, borderRadius: radius }]}>
          <View style={[styles.rule, { backgroundColor: foreground }]} />
          <AppText
            numberOfLines={5}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            color={foreground}
            style={styles.generatedTitle}
          >
            {title}
          </AppText>
          <View style={[styles.rule, { backgroundColor: foreground }]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { aspectRatio: 2 / 3 },
  shadow: { elevation: 3 },
  image: { width: '100%', height: '100%' },
  generated: {
    flex: 1,
    padding: '10%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  generatedTitle: { fontFamily: FONTS.semiBold, textAlign: 'center', fontSize: 14, lineHeight: 18 },
  rule: { width: '40%', height: 2, borderRadius: 1, opacity: 0.6 },
});
