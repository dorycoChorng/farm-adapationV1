import { type ComponentType, forwardRef, type Ref, useCallback, useImperativeHandle, useRef } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { WebView as RawWebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';

import { type MapCommand, type MapEvent, parseMapEvent } from '../../map/bridge';
import { MAP_HTML } from '../../map/generated/mapHtml';
import { buildMapConfig } from './mapConfig';
import type { FarmMapHandle, FarmMapProps } from './types';

// A fixed https base URL gives the page a real origin so tile servers' CORS rules apply normally.
const BASE_URL = 'https://farm-adaptation.app/';

// react-native-webview's class typings collapse to `never` props under React 19 types; re-type the parts we use.
interface WebViewHandle {
  injectJavaScript(script: string): void;
  reload(): void;
}
const WebView = RawWebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebViewHandle> }>;

export const FarmMap = forwardRef<FarmMapHandle, FarmMapProps>(function FarmMap({ initial, onEvent, style }, ref) {
  const webview = useRef<WebViewHandle>(null);
  const ready = useRef(false);
  const queue = useRef<MapCommand[]>([]);

  const deliver = useCallback((cmd: MapCommand) => {
    webview.current?.injectJavaScript(`window.farmMap && window.farmMap.receive(${JSON.stringify(cmd)}); true;`);
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

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      const event: MapEvent | null = parseMapEvent(e.nativeEvent.data);
      if (!event) return;
      if (event.type === 'ready') {
        deliver({ type: 'init', config: buildMapConfig(initial) });
        ready.current = true;
        queue.current.splice(0).forEach(deliver);
      }
      onEvent?.(event);
    },
    // `initial` is only read once, when the page first reports ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deliver, onEvent],
  );

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webview}
        source={{ html: MAP_HTML, baseUrl: BASE_URL }}
        originWhitelist={['*']}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled={false}
        setSupportMultipleWindows={false}
        geolocationEnabled={false}
        style={styles.webview}
        onShouldStartLoadWithRequest={(req) => {
          // Attribution links open in the browser instead of replacing the map.
          if (req.url.startsWith('http') && !req.url.startsWith(BASE_URL)) {
            void Linking.openURL(req.url);
            return false;
          }
          return true;
        }}
        onContentProcessDidTerminate={() => webview.current?.reload()}
        onRenderProcessGone={() => webview.current?.reload()}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#04121c' },
  webview: { flex: 1, backgroundColor: '#04121c' },
});
