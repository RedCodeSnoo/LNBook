import { StyleSheet, View } from 'react-native';

import { SPACING } from '../typography';
import { AppText } from './AppText';
import { IconButton } from './IconButton';

/** Numeric setting with minus and plus buttons. */
export function Stepper({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  // Avoid floating point drift (1.6 + 0.1 = 1.7000000000000002).
  const round = (next: number) => Math.round(next * 100) / 100;
  const shown = format ? format(value) : String(value);
  return (
    <View style={styles.row} accessibilityLabel={`${label}, ${shown}`}>
      <AppText style={styles.label}>{label}</AppText>
      <IconButton
        icon="minus"
        label={`${label} −`}
        disabled={value <= min}
        onPress={() => onChange(round(Math.max(min, value - step)))}
      />
      <AppText variant="bodyStrong" style={styles.value} center>
        {shown}
      </AppText>
      <IconButton
        icon="plus"
        label={`${label} +`}
        disabled={value >= max}
        onPress={() => onChange(round(Math.min(max, value + step)))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.lg, minHeight: 48 },
  label: { flex: 1 },
  value: { minWidth: 56 },
});
