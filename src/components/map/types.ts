import type { StyleProp, ViewStyle } from 'react-native';

import type { LngLat, MapCommand, MapEvent, Projection } from '../../map/bridge';

export interface FarmMapHandle {
  send(cmd: MapCommand): void;
}

export interface FarmMapProps {
  initial: { center: LngLat; zoom: number; projection: Projection };
  onEvent?: (event: MapEvent) => void;
  style?: StyleProp<ViewStyle>;
}
