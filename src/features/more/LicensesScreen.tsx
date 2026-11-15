import { FlashList } from '@shopify/flash-list';
import { Linking, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { AppBar, AppText, ListItem, Screen } from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import packages from './licenses.json';

const PLUGINS_URL = 'https://github.com/LNReader/lnreader-plugins';

/** About → Open source licences: the source plugins of LNReader and the packages used. */
export function LicensesScreen({ navigation }: RootScreenProps<'licenses'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Screen bottom>
      <AppBar title={t('about.licenses')} onBack={navigation.goBack} />
      <FlashList
        data={packages}
        keyExtractor={(item) => item.name}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={[styles.card, { backgroundColor: colors.surfaceVariant }]}>
              <AppText variant="bodyStrong">{t('about.pluginsTitle')}</AppText>
              <AppText secondary>{t('about.pluginsLicense')}</AppText>
            </View>
            <ListItem
              icon="github"
              title="LNReader/lnreader-plugins"
              subtitle="MIT"
              onPress={() => void Linking.openURL(PLUGINS_URL)}
            />
            <AppText variant="label" secondary style={styles.count}>
              {t('about.packages', { count: packages.length })}
            </AppText>
          </View>
        }
        renderItem={({ item }) => (
          <ListItem
            title={item.name}
            subtitle={`${item.version} · ${item.license}`}
            onPress={() => void Linking.openURL(`https://www.npmjs.com/package/${item.name}`)}
          />
        )}
        contentContainerStyle={styles.list}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: SPACING.xxl },
  header: { gap: SPACING.xs },
  card: {
    margin: SPACING.lg,
    marginBottom: 0,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    gap: 4,
  },
  count: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md },
});
