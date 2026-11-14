import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../ThemeProvider';
import { RADIUS, SPACING } from '../typography';
import { AppText } from './AppText';
import { Button } from './Button';

export interface DialogAction {
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Centered modal dialog. Back button and a tap outside close it. */
export function Dialog({
  visible,
  title,
  message,
  children,
  actions,
  onClose,
}: {
  visible: boolean;
  title: string;
  message?: string;
  children?: ReactNode;
  actions?: DialogAction[];
  onClose: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Pressable
          style={[styles.backdrop, { backgroundColor: colors.overlay }]}
          onPress={onClose}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <Pressable
            style={[styles.card, { backgroundColor: colors.surface }]}
            onPress={() => undefined}
            accessibilityViewIsModal
          >
            <AppText variant="title" accessibilityRole="header">
              {title}
            </AppText>
            {message ? <AppText secondary>{message}</AppText> : null}
            {children ? (
              <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
                {children}
              </ScrollView>
            ) : null}
            {actions && actions.length > 0 ? (
              <View style={styles.actions}>
                {actions.map((action) => (
                  <Button
                    key={action.label}
                    label={action.label}
                    variant="text"
                    compact
                    danger={action.danger}
                    disabled={action.disabled}
                    onPress={action.onPress}
                  />
                ))}
              </View>
            ) : null}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Yes / no confirmation. */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      visible={visible}
      title={title}
      message={message}
      onClose={onClose}
      actions={[
        { label: t('common.cancel'), onPress: onClose },
        { label: confirmLabel ?? t('common.confirm'), onPress: onConfirm, danger },
      ]}
    >
      {children}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
    gap: SPACING.md,
  },
  content: { flexGrow: 0 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: SPACING.xs },
});
