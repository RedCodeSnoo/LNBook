/** Small pieces shared by the source screens: icon, error panel, result grid cell. */
import { Image } from 'expo-image';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { navigationRef } from '../../app/navigationRef';
import type { PluginError } from '../../plugins/pluginErrors';
import type { NovelItem } from '../../plugins/types';
import { AppText, Button, Cover, EmptyState, Icon } from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';

export function SourceIcon({ uri, size = 40 }: { uri: string | null | undefined; size?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.icon, { width: size, height: size, backgroundColor: colors.surfaceVariant }]}
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size }} contentFit="cover" />
      ) : (
        <Icon name="earth" size={size * 0.6} color={colors.textSecondary} />
      )}
    </View>
  );
}

const ERROR_KEYS = {
  timeout: 'sources.errorTimeout',
  cloudflare: 'sources.errorCloudflare',
  network: 'sources.errorNetwork',
  notInstalled: 'sources.errorNotInstalled',
  plugin: 'sources.errorPlugin',
} as const;

export function sourceErrorMessage(error: PluginError, t: (key: string) => string): string {
  return t(ERROR_KEYS[error.kind]);
}

/** Readable error with "Retry" and "Open in web view" (to pass a Cloudflare check). */
export function SourceErrorView({
  error,
  onRetry,
  webUrl,
  pluginId,
  compact,
}: {
  error: PluginError;
  onRetry: () => void;
  /** Page to open in the web view; defaults to the page that failed. */
  webUrl?: string;
  pluginId?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const url = error.url ?? webUrl;
  const openWeb = () => {
    if (url && navigationRef.isReady()) {
      navigationRef.navigate('webview', { url, pluginId });
    }
  };
  const buttons = (
    <>
      <Button label={t('sources.retry')} icon="refresh" variant="tonal" onPress={onRetry} />
      {url ? (
        <Button
          label={t('sources.openWebView')}
          icon="web"
          variant={error.kind === 'cloudflare' ? 'filled' : 'text'}
          onPress={openWeb}
        />
      ) : null}
    </>
  );
  if (compact) {
    return (
      <View style={styles.compact}>
        <AppText variant="label" color={colors.error}>
          {sourceErrorMessage(error, t)}
        </AppText>
        <View style={styles.compactButtons}>{buttons}</View>
      </View>
    );
  }
  return (
    <EmptyState
      icon={error.kind === 'cloudflare' ? 'shield-alert-outline' : 'cloud-alert-outline'}
      title={sourceErrorMessage(error, t)}
      message={error.kind === 'plugin' ? error.message.slice(0, 200) : undefined}
    >
      {buttons}
    </EmptyState>
  );
}

function ResultCardBase({
  item,
  inLibrary,
  width,
  onPress,
}: {
  item: NovelItem;
  inLibrary: boolean;
  width: number;
  onPress: (item: NovelItem) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Pressable
      testID="source-result"
      accessibilityRole="button"
      accessibilityLabel={inLibrary ? `${item.name}, ${t('novel.inLibrary')}` : item.name}
      onPress={() => onPress(item)}
      android_ripple={{ color: colors.ripple }}
      style={[styles.card, { width }]}
    >
      <View style={inLibrary ? styles.dimmed : undefined}>
        <Cover path={item.cover} title={item.name} />
      </View>
      {inLibrary ? (
        <View style={[styles.badge, { backgroundColor: colors.primary }]}>
          <Icon name="heart" size={12} color={colors.onPrimary} />
        </View>
      ) : null}
      <AppText variant="label" numberOfLines={2}>
        {item.name}
      </AppText>
    </Pressable>
  );
}

export const ResultCard = memo(ResultCardBase);

const styles = StyleSheet.create({
  icon: {
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: { padding: SPACING.lg, gap: SPACING.sm },
  compactButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  card: { padding: SPACING.xs, gap: SPACING.xs },
  dimmed: { opacity: 0.55 },
  badge: {
    position: 'absolute',
    top: SPACING.sm,
    left: SPACING.sm,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
