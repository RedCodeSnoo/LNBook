import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { getDb } from '../../db/client';
import { invalidate, useQuery } from '../../db/invalidation';
import { AppText, CheckItem, Dialog } from '../../theme/components';
import { listCategories, setNovelCategories } from './libraryRepository';

/** Chooses the categories of one or several novels. */
export function CategoryPickerDialog({
  novelIds,
  initial,
  onClose,
}: {
  novelIds: number[];
  /** Categories checked when the dialog opens. */
  initial: number[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const categories = useQuery(() => listCategories(getDb()), ['categories']);
  const [checked, setChecked] = useState<number[]>(initial);

  const toggle = (id: number) =>
    setChecked((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );

  return (
    <Dialog
      visible
      title={t('library.chooseCategories')}
      onClose={onClose}
      actions={[
        { label: t('common.cancel'), onPress: onClose },
        {
          label: t('common.save'),
          onPress: () => {
            setNovelCategories(getDb(), novelIds, checked);
            invalidate('library', 'novel');
            onClose();
          },
        },
      ]}
    >
      <View>
        {categories.length === 0 ? <AppText secondary>{t('library.noCategories')}</AppText> : null}
        {categories.map((category) => (
          <CheckItem
            key={category.id}
            title={category.name}
            checked={checked.includes(category.id)}
            onPress={() => toggle(category.id)}
          />
        ))}
      </View>
    </Dialog>
  );
}
