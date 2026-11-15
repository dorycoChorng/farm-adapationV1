import { createElement, forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { type MapCommand, parseMapEvent } from '../../map/bridge';
import { MAP_HTML } from '../../map/generated/mapHtml';
import { buildMapConfig } from './mapConfig';
import type { FarmMapHandle, FarmMapProps } from './types';

/** Web build: the same map page in an iframe, bridged with postMessage. */
export const FarmMap = forwardRef<FarmMapHandle, FarmMapProps>(function FarmMap({ initial, onEvent, style }, ref) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const ready = useRef(false);
  const queue = useRef<MapCommand[]>([]);
  const initialRef = useRef(initial);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const deliver = useCallback((cmd: MapCommand) => {
    frame.current?.contentWindow?.postMessage({ __farmMapCommand: true, data: cmd }, '*');
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      send(cmd) {
        if (ready.current) deliver(cmd);
        else queue.current.push(cmd);
      },
    }),
    [deliver],
  );

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== frame.current?.contentWindow || !e.data?.__farmMap) return;
      const event = parseMapEvent(e.data.data);
      if (!event) return;
      if (event.type === 'ready') {
        deliver({ type: 'init', config: buildMapConfig(initialRef.current) });
        ready.current = true;
        queue.current.splice(0).forEach(deliver);
      }
      onEventRef.current?.(event);
    }
    window.addEventListener('message', onMessage);

    // The page posts 'ready' once, as soon as its scripts run. If the iframe's scripts run before this listener
    // exists (seen in iOS in-app browsers such as TikTok's), that message is lost and the map is never initialised — leaving a blank dark screen.
    // Keep asking until the page answers; it only re-reports 'ready' while it has no map.
    let tries = 0;
    const poll = setInterval(() => {
      if (ready.current || ++tries > 40) clearInterval(poll);
      else deliver({ type: 'ping' });
    }, 250);

    return () => {
      clearInterval(poll);
      window.removeEventListener('message', onMessage);
    };
  }, [deliver]);

  return (
    <View style={[styles.container, style]}>
      {createElement('iframe', {
        ref: frame,
        srcDoc: MAP_HTML,
        title: 'map',
        // Also ask as soon as the page has loaded, in case its 'ready' came before our listener.
        onLoad: () => {
          if (!ready.current) deliver({ type: 'ping' });
        },
        style: { border: 0, width: '100%', height: '100%' },
      })}
    </View>
  );
});

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: '#04121c' } });
