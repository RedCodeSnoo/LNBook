import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { getDb } from '../../db/client';
import { AppBar, EmptyState, Screen } from '../../theme/components';
import { getChapter } from '../novel/novelRepository';

/** Temporary screen: the reader arrives with the next development step. */
export function ReaderScreen({ navigation, route }: RootScreenProps<'reader'>) {
  const { t } = useTranslation();
  const chapter = getChapter(getDb(), route.params.chapterId);
  return (
    <Screen bottom>
      <AppBar title={chapter?.title ?? ''} onBack={navigation.goBack} />
      <EmptyState
        icon="book-open-page-variant-outline"
        title={t('common.comingSoon')}
        message={t('common.comingSoonHint')}
      />
    </Screen>
  );
}
