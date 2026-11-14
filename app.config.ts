import type { ExpoConfig } from 'expo/config';

/**
 * The app version comes from the release tag (APP_VERSION=1.2.3 in CI).
 * versionCode = major * 10000 + minor * 100 + patch, so it always grows with the version.
 */
const version = (process.env.APP_VERSION ?? '0.0.1').replace(/^v/, '');

function toVersionCode(semver: string): number {
  const [major = 0, minor = 0, patch = 0] = semver
    .split('-')[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  return major * 10000 + minor * 100 + patch;
}

const config: ExpoConfig = {
  name: 'LNBook',
  slug: 'lnbook',
  scheme: 'lnbook',
  version,
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  platforms: ['android'],
  android: {
    // Never change this identifier: Android would treat the app as a different one.
    package: 'com.redcodesnoo.lnbook',
    versionCode: toVersionCode(version),
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // "Open with": EPUB and TXT files from a file manager or another app.
    intentFilters: [
      {
        action: 'VIEW',
        category: ['DEFAULT', 'BROWSABLE'],
        data: [
          { scheme: 'content', mimeType: 'application/epub+zip' },
          { scheme: 'content', mimeType: 'text/plain' },
          { scheme: 'file', mimeType: 'application/epub+zip' },
          { scheme: 'file', mimeType: 'text/plain' },
        ],
      },
      // "Share to": files sent by another app.
      {
        action: 'SEND',
        category: ['DEFAULT'],
        data: [{ mimeType: 'application/epub+zip' }, { mimeType: 'text/plain' }],
      },
      {
        action: 'SEND_MULTIPLE',
        category: ['DEFAULT'],
        data: [{ mimeType: 'application/epub+zip' }, { mimeType: 'text/plain' }],
      },
    ],
  },
  plugins: [
    'expo-sqlite',
    'expo-localization',
    'expo-document-picker',
    [
      'expo-image-picker',
      { photosPermission: false, cameraPermission: false, microphonePermission: false },
    ],
    [
      'expo-font',
      {
        fonts: [
          'node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf',
          'node_modules/@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf',
          'node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf',
          'node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf',
        ],
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 160,
        resizeMode: 'contain',
        backgroundColor: '#FAFAFC',
        dark: { backgroundColor: '#121316' },
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: 26,
          buildArchs: ['arm64-v8a', 'armeabi-v7a'],
        },
      },
    ],
    './plugins/withReleaseSigning',
    './plugins/withReaderFonts',
  ],
};

export default config;
