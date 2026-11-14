import * as Network from 'expo-network';

/** True when requests can be made now; with `wifiOnly`, only on Wi-Fi (or cable). */
export async function isNetworkUsable(wifiOnly: boolean): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    if (state.isConnected === false) {
      return false;
    }
    if (!wifiOnly) {
      return true;
    }
    return (
      state.type === Network.NetworkStateType.WIFI ||
      state.type === Network.NetworkStateType.ETHERNET
    );
  } catch {
    // Unknown state: do not block the user.
    return !wifiOnly;
  }
}
