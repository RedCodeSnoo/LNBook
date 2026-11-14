import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './navigation';

/** Lets code outside React (notifications, services) navigate. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Opens a chapter, optionally at a precise place: the single route for every deep link. */
export function openReader(chapterId: number, anchor?: string): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate('reader', { chapterId, anchor });
  }
}
