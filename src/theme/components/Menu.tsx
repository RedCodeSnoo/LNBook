import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../ThemeProvider';
import { RADIUS, SPACING } from '../typography';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { IconButton } from './IconButton';

export interface MenuItem {
  label: string;
  icon?: IconName;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Overflow menu (three dots) opening a list of actions at the top right. */
export function Menu({
  items,
  icon = 'dots-vertical',
  label,
}: {
  items: MenuItem[];
  icon?: IconName;
  label: string;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  return (
    <>
      <IconButton icon={icon} label={label} onPress={() => setOpen(true)} />
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View
            style={[
              styles.menu,
              { backgroundColor: colors.surface, borderColor: colors.border, top: insets.top + 8 },
            ]}
          >
            <ScrollView>
              {items.map((item) => (
                <Pressable
                  key={item.label}
                  accessibilityRole="menuitem"
                  accessibilityState={{ disabled: Boolean(item.disabled) }}
                  disabled={item.disabled}
                  android_ripple={{ color: colors.ripple }}
                  style={[styles.item, item.disabled && styles.disabled]}
                  onPress={() => {
                    setOpen(false);
                    item.onPress();
                  }}
                >
                  {item.icon ? (
                    <Icon
                      name={item.icon}
                      size={20}
                      color={item.danger ? colors.error : colors.textSecondary}
                    />
                  ) : null}
                  <AppText color={item.danger ? colors.error : undefined}>{item.label}</AppText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  menu: {
    position: 'absolute',
    right: 8,
    minWidth: 220,
    maxWidth: 320,
    maxHeight: '80%',
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: SPACING.xs,
    elevation: 6,
  },
  item: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  disabled: { opacity: 0.45 },
});
