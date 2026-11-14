import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';
import { BackHandler } from 'react-native';

/**
 * While the screen is focused and `active` is true, the Android back button calls
 * `onBack` instead of leaving the screen (used to close panels and selection modes first).
 */
export function useBackHandler(active: boolean, onBack: () => void): void {
  useFocusEffect(
    useCallback(() => {
      if (!active) {
        return undefined;
      }
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        onBack();
        return true;
      });
      return () => subscription.remove();
    }, [active, onBack]),
  );
}
