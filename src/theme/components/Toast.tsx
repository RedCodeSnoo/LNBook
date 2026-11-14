import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { useTheme } from '../ThemeProvider';
import { RADIUS, SPACING } from '../typography';
import { AppText } from './AppText';

interface ToastState {
  id: number;
  message: string | null;
  actionLabel?: string;
  onAction?: () => void;
  duration: number;
}

const useToast = create<ToastState>(() => ({ id: 0, message: null, duration: 3000 }));

/** Shows a short message at the bottom of the screen, with an optional action (Undo). */
export function showToast(
  message: string,
  options: { actionLabel?: string; onAction?: () => void; duration?: number } = {},
): void {
  useToast.setState((state) => ({
    id: state.id + 1,
    message,
    actionLabel: options.actionLabel,
    onAction: options.onAction,
    duration: options.duration ?? 3000,
  }));
}

export function hideToast(): void {
  useToast.setState({ message: null });
}

/** Mounted once at the root of the app. */
export function ToastHost() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();

  useEffect(() => {
    if (toast.message === null) {
      return;
    }
    const timer = setTimeout(hideToast, toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.message, toast.duration]);

  if (toast.message === null) {
    return null;
  }
  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom: insets.bottom + 72 }]}>
      <View
        accessibilityLiveRegion="polite"
        style={[styles.toast, { backgroundColor: colors.text }]}
      >
        <AppText color={colors.background} style={styles.message}>
          {toast.message}
        </AppText>
        {toast.actionLabel ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              toast.onAction?.();
              hideToast();
            }}
          >
            <AppText variant="bodyStrong" color={colors.background}>
              {toast.actionLabel}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
    maxWidth: 520,
    minHeight: 48,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    elevation: 6,
  },
  message: { flexShrink: 1 },
});
