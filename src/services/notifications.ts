/** Local notifications: permission, channels, and what a tap opens. */
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';

import { navigationRef } from '../app/navigationRef';

export const UPDATES_CHANNEL = 'updates';
export const APP_UPDATE_CHANNEL = 'app-update';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Asks for the notification permission when it was never decided. */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) {
      return true;
    }
    if (!current.canAskAgain) {
      return false;
    }
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

export async function notifyNewChapters(
  channelName: string,
  title: string,
  body: string,
  novelId: number,
): Promise<void> {
  try {
    await Notifications.setNotificationChannelAsync(UPDATES_CHANNEL, {
      name: channelName,
      importance: AndroidImportance.DEFAULT,
    });
    await Notifications.scheduleNotificationAsync({
      identifier: `novel-${novelId}`,
      content: { title, body, data: { novelId } },
      trigger: { channelId: UPDATES_CHANNEL },
    });
  } catch {
    // Notifications are a comfort: never fail the check because of them.
  }
}

/** "Version X available": a tap opens the Updates tab. */
export async function notifyAppUpdate(
  channelName: string,
  title: string,
  body: string,
): Promise<void> {
  try {
    await Notifications.setNotificationChannelAsync(APP_UPDATE_CHANNEL, {
      name: channelName,
      importance: AndroidImportance.DEFAULT,
    });
    await Notifications.scheduleNotificationAsync({
      identifier: 'app-update',
      content: { title, body, data: { screen: 'updates' } },
      trigger: { channelId: APP_UPDATE_CHANNEL },
    });
  } catch {
    // Not allowed or not available: the card in the Updates tab is enough.
  }
}

function open(data: unknown): void {
  if (!navigationRef.isReady()) {
    return;
  }
  const { novelId, screen } = (data ?? {}) as { novelId?: unknown; screen?: unknown };
  if (typeof novelId === 'number') {
    navigationRef.navigate('novel', { novelId });
  } else if (screen === 'updates') {
    navigationRef.navigate('tabs', { screen: 'updates' });
  }
}

/** Opens the novel of a tapped notification (also when the tap started the app). */
export function watchNotificationTaps(): () => void {
  try {
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      // The navigation container needs a moment to be ready at launch.
      setTimeout(() => open(last.notification.request.content.data), 600);
      Notifications.clearLastNotificationResponse();
    }
  } catch {
    // Not available: nothing to open.
  }
  const subscription = Notifications.addNotificationResponseReceivedListener((response) =>
    open(response.notification.request.content.data),
  );
  return () => subscription.remove();
}
