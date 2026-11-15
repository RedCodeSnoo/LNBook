import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import { scrollerIndex, type ScrollerLabel } from './chapterList';

const THUMB_HEIGHT = 52;
const THUMB_TOUCH_WIDTH = 40;
/** Below this number of rows, the list is short enough to scroll by hand. */
export const FAST_SCROLL_MIN_ROWS = 40;
const HIDE_AFTER_MS = 1800;

export interface FastScrollerHandle {
  /** To call from the `onScroll` of the list: moves the handle with the list. */
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

/**
 * Handle on the right edge of a long list: dragging it jumps anywhere in the list, with a
 * bubble telling the chapter (and volume) reached. It shows while the list moves.
 */
export const FastScroller = forwardRef<
  FastScrollerHandle,
  {
    count: number;
    label: (index: number) => ScrollerLabel | null;
    /** `fraction` is 0 at the top, 1 at the bottom. */
    onJump: (index: number, fraction: number) => void;
  }
>(function FastScroller({ count, label, onJump }, ref) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [trackHeight, setTrackHeight] = useState(0);
  const [bubble, setBubble] = useState<ScrollerLabel | null>(null);
  const [dragging, setDragging] = useState(false);
  const [shown, setShown] = useState(false);

  const top = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const state = useRef({ top: 0, start: 0, index: -1, dragging: false, track: 0 });
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ count, label, onJump });
  useEffect(() => {
    latest.current = { count, label, onJump };
  }, [count, label, onJump]);

  const range = () => Math.max(1, state.current.track - THUMB_HEIGHT);

  const show = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
    }
    setShown(true);
    Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }).start();
    hideTimer.current = setTimeout(() => {
      if (state.current.dragging) {
        return;
      }
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() =>
        setShown(false),
      );
    }, HIDE_AFTER_MS);
  };

  const place = (value: number) => {
    state.current.top = Math.min(range(), Math.max(0, value));
    top.setValue(state.current.top);
  };

  const jumpTo = (fraction: number) => {
    const { count: rows, label: describe, onJump: jump } = latest.current;
    const index = scrollerIndex(fraction, rows);
    if (index !== state.current.index) {
      state.current.index = index;
      setBubble(describe(index));
      jump(index, fraction);
    }
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // The list must not take the gesture back while the handle is dragged.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        state.current.dragging = true;
        state.current.start = state.current.top;
        state.current.index = -1;
        setDragging(true);
        show();
      },
      onPanResponderMove: (_, gesture) => {
        place(state.current.start + gesture.dy);
        jumpTo(state.current.top / range());
      },
      onPanResponderRelease: () => {
        state.current.dragging = false;
        setDragging(false);
        setBubble(null);
        show();
      },
      onPanResponderTerminate: () => {
        state.current.dragging = false;
        setDragging(false);
        setBubble(null);
        show();
      },
    }),
  ).current;

  useImperativeHandle(ref, () => ({
    onScroll: (event) => {
      if (state.current.dragging) {
        return;
      }
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const scrollable = contentSize.height - layoutMeasurement.height;
      if (scrollable <= 0) {
        return;
      }
      place((contentOffset.y / scrollable) * range());
      show();
    },
  }));

  useEffect(
    () => () => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }
    },
    [],
  );

  if (count < FAST_SCROLL_MIN_ROWS) {
    return null;
  }

  const onLayout = (event: LayoutChangeEvent) => {
    state.current.track = event.nativeEvent.layout.height;
    setTrackHeight(event.nativeEvent.layout.height);
  };

  const step = (direction: 1 | -1) => {
    const fraction = Math.min(1, Math.max(0, state.current.top / range() + direction * 0.1));
    place(fraction * range());
    state.current.index = -1;
    jumpTo(fraction);
    setBubble(null);
    show();
  };

  return (
    <View style={styles.track} pointerEvents="box-none" onLayout={onLayout}>
      {trackHeight > 0 ? (
        <Animated.View
          style={[styles.thumbArea, { opacity, transform: [{ translateY: top }] }]}
          pointerEvents={shown || dragging ? 'auto' : 'none'}
        >
          {bubble ? (
            <View style={[styles.bubble, { backgroundColor: colors.primary }]} pointerEvents="none">
              {bubble.number !== null ? (
                <AppText variant="subtitle" color={colors.onPrimary} numberOfLines={1}>
                  {t('novel.scrollerChapter', { number: bubble.number })}
                </AppText>
              ) : null}
              {bubble.volume ? (
                <AppText variant="caption" color={colors.onPrimary} numberOfLines={1}>
                  {bubble.volume}
                </AppText>
              ) : null}
            </View>
          ) : null}
          <View
            {...responder.panHandlers}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={t('novel.fastScroll')}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(event) =>
              step(event.nativeEvent.actionName === 'increment' ? 1 : -1)
            }
            hitSlop={{ left: 12 }}
            style={styles.touch}
          >
            <View
              style={[
                styles.thumb,
                { backgroundColor: dragging ? colors.primary : colors.textSecondary },
              ]}
            />
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  track: {
    position: 'absolute',
    top: SPACING.sm,
    bottom: SPACING.sm,
    right: 0,
    width: THUMB_TOUCH_WIDTH,
  },
  thumbArea: {
    position: 'absolute',
    top: 0,
    right: 0,
    height: THUMB_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
  },
  touch: {
    width: THUMB_TOUCH_WIDTH,
    height: THUMB_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: { width: 6, height: THUMB_HEIGHT - 8, borderRadius: RADIUS.pill },
  bubble: {
    position: 'absolute',
    right: THUMB_TOUCH_WIDTH + SPACING.xs,
    minWidth: 120,
    maxWidth: 240,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.lg,
    alignItems: 'flex-end',
  },
});
