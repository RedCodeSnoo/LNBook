/** Device side of the reader settings: brightness, screen, orientation, volume buttons. */
import { useIsFocused } from '@react-navigation/native';
import * as Brightness from 'expo-brightness';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as NavigationBar from 'expo-navigation-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect, useRef } from 'react';

import { addVolumeKeyListener, setVolumeKeysEnabled } from '../../../modules/lnbook-system';
import type { ReaderSettings } from './readerSettings';

const KEEP_AWAKE_TAG = 'reader';

/** These features are comfort only: a failure must never break reading. */
const quiet = (promise: Promise<unknown>) => void promise.catch(() => undefined);

export function useReaderDevice(
  settings: ReaderSettings,
  options: {
    /** The bars are shown: the system bars come back with them. */
    barsVisible: boolean;
    /** False while a panel is open or the voice is reading: the buttons keep their role. */
    volumeKeysAllowed: boolean;
    onVolumeKey: (direction: 'up' | 'down') => void;
  },
): void {
  const focused = useIsFocused();
  const { brightness, keepScreenOn, orientation, hideStatusBar, volumeKeys } = settings;

  useEffect(() => {
    if (!focused || brightness === null) {
      return undefined;
    }
    quiet(Brightness.setBrightnessAsync(Math.max(0.01, Math.min(1, brightness))));
    return () => quiet(Brightness.restoreSystemBrightnessAsync());
  }, [focused, brightness]);

  useEffect(() => {
    if (!focused || !keepScreenOn) {
      return undefined;
    }
    quiet(activateKeepAwakeAsync(KEEP_AWAKE_TAG));
    return () => quiet(deactivateKeepAwake(KEEP_AWAKE_TAG));
  }, [focused, keepScreenOn]);

  useEffect(() => {
    if (!focused || orientation === 'auto') {
      return undefined;
    }
    quiet(
      ScreenOrientation.lockAsync(
        orientation === 'portrait'
          ? ScreenOrientation.OrientationLock.PORTRAIT_UP
          : ScreenOrientation.OrientationLock.LANDSCAPE,
      ),
    );
    return () => quiet(ScreenOrientation.unlockAsync());
  }, [focused, orientation]);

  const immersive = focused && hideStatusBar && !options.barsVisible;
  useEffect(() => {
    if (!immersive) {
      return undefined;
    }
    quiet(NavigationBar.setVisibilityAsync('hidden'));
    return () => quiet(NavigationBar.setVisibilityAsync('visible'));
  }, [immersive]);

  const onVolumeKey = useRef(options.onVolumeKey);
  useEffect(() => {
    onVolumeKey.current = options.onVolumeKey;
  });
  const volumeActive = focused && volumeKeys && options.volumeKeysAllowed;
  useEffect(() => {
    if (!volumeActive) {
      return undefined;
    }
    setVolumeKeysEnabled(true);
    const subscription = addVolumeKeyListener((direction) => onVolumeKey.current(direction));
    return () => {
      subscription.remove();
      setVolumeKeysEnabled(false);
    };
  }, [volumeActive]);
}
