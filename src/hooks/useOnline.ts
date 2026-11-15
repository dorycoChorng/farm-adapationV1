import { useNetworkState } from 'expo-network';

/**
 * True/false when the OS reports connectivity, null while unknown.
 * `isInternetReachable` is preferred because Wi-Fi without internet is common in the field.
 */
export function useOnline(): boolean | null {
  const state = useNetworkState();
  if (state.isInternetReachable != null) return state.isInternetReachable;
  if (state.isConnected != null) return state.isConnected;
  return null;
}
