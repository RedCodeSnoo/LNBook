import { useCallback, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import type { RootScreenProps } from '../../app/navigation';
import { useBackHandler } from '../../app/useBackHandler';
import { WEBVIEW_LOCAL_STORAGE, WEBVIEW_SESSION_STORAGE } from '../../plugins/libs/storage';
import { getUserAgent, pluginDeps } from '../../plugins/pluginHost';
import { AppText, IconButton, Screen } from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { SPACING } from '../../theme/typography';

// The type parameter of WebView defaults to `undefined`, which TypeScript cannot use.
type NoExtraProps = Record<never, never>;

/** Sends the web storage of the page to the app (plugins can read it through @libs/storage). */
const CAPTURE_STORAGE = `
(function () {
  try {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      localStorage: Object.assign({}, window.localStorage),
      sessionStorage: Object.assign({}, window.sessionStorage)
    }));
  } catch (e) {}
})();
true;`;

/**
 * Web view of a site. It shares its cookies with the plugin requests: passing a Cloudflare
 * check here unlocks the source.
 */
export function WebViewScreen({ navigation, route }: RootScreenProps<'webview'>) {
  const { url, pluginId } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const webView = useRef<WebView<NoExtraProps>>(null);
  const [state, setState] = useState({ title: route.params.title ?? '', url, canGoBack: false });
  const [progress, setProgress] = useState(0);

  const goBackInPage = useCallback(() => webView.current?.goBack(), []);
  useBackHandler(state.canGoBack, goBackInPage);

  const onMessage = (event: WebViewMessageEvent) => {
    if (!pluginId) {
      return;
    }
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        localStorage?: object;
        sessionStorage?: object;
      };
      const store = pluginDeps().environment.store;
      store.set(pluginId + WEBVIEW_LOCAL_STORAGE, JSON.stringify(data.localStorage ?? {}));
      store.set(pluginId + WEBVIEW_SESSION_STORAGE, JSON.stringify(data.sessionStorage ?? {}));
    } catch {
      // Not a storage message.
    }
  };

  return (
    <Screen bottom>
      <View style={styles.bar}>
        <IconButton icon="close" label={t('common.close')} onPress={navigation.goBack} />
        <View style={styles.titles}>
          <AppText variant="subtitle" numberOfLines={1}>
            {state.title || t('sources.webView')}
          </AppText>
          <AppText variant="caption" secondary numberOfLines={1}>
            {state.url}
          </AppText>
        </View>
        <IconButton
          icon="arrow-left"
          label={t('sources.webBack')}
          disabled={!state.canGoBack}
          onPress={goBackInPage}
        />
        <IconButton
          icon="refresh"
          label={t('sources.webReload')}
          onPress={() => webView.current?.reload()}
        />
        <IconButton
          icon="open-in-new"
          label={t('sources.openBrowser')}
          onPress={() => void Linking.openURL(state.url).catch(() => undefined)}
        />
      </View>
      <View style={[styles.progressTrack, { backgroundColor: colors.surfaceVariant }]}>
        {progress < 1 ? (
          <View
            style={[
              styles.progress,
              { width: `${Math.round(progress * 100)}%`, backgroundColor: colors.primary },
            ]}
          />
        ) : null}
      </View>
      <WebView<NoExtraProps>
        ref={webView}
        source={{ uri: url }}
        userAgent={getUserAgent()}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        onLoadProgress={(event) => setProgress(event.nativeEvent.progress)}
        onNavigationStateChange={(navigationState) =>
          setState({
            title: navigationState.title,
            url: navigationState.url,
            canGoBack: navigationState.canGoBack,
          })
        }
        onLoadEnd={() => {
          if (pluginId) {
            webView.current?.injectJavaScript(CAPTURE_STORAGE);
          }
        }}
        onMessage={onMessage}
        style={styles.web}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.xs },
  titles: { flex: 1, paddingHorizontal: SPACING.xs },
  progressTrack: { height: 2 },
  progress: { height: 2 },
  web: { flex: 1 },
});
