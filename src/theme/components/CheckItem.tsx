import { useTheme } from '../ThemeProvider';
import { Icon } from './Icon';
import { ListItem, type ListItemProps } from './ListItem';

/** Row with a check box, for multiple choice lists. */
export function CheckItem({
  checked,
  ...rest
}: Omit<ListItemProps, 'right' | 'selected'> & { checked: boolean }) {
  const { colors } = useTheme();
  return (
    <ListItem
      {...rest}
      right={
        <Icon
          name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
          color={checked ? colors.primary : colors.textSecondary}
        />
      }
    />
  );
}
