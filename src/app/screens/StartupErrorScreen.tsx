import { StyleSheet, Text, View } from 'react-native';

import { SchemaTooRecentError } from '../../db/migrations';
import i18n from '../../i18n';

/**
 * Shown when the database cannot be opened. It does not depend on the theme or the
 * settings, since those live in the database.
 */
export function StartupErrorScreen({ error }: { error: unknown }) {
  const message =
    error instanceof SchemaTooRecentError
      ? i18n.t('errors.databaseTooRecent')
      : i18n.t('errors.startupMessage');
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{i18n.t('errors.startupTitle')}</Text>
      <Text style={styles.message}>{message}</Text>
      <Text style={styles.detail} selectable>
        {error instanceof Error ? error.message : String(error)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 32,
    gap: 12,
    backgroundColor: '#121316',
  },
  title: { color: '#ECECF1', fontSize: 22, fontWeight: '600' },
  message: { color: '#ECECF1', fontSize: 15, lineHeight: 22 },
  detail: { color: '#B0B2BD', fontSize: 12 },
});
