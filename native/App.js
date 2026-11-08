// Golf Coach — native shell.
// The whole app is the web app (GitHub Pages) running in a WebView, so every push to main
// updates the installed app with no store release. Native code only adds what browsers can't:
//   • Bluetooth for the Bushnell laser (works on iPhone too, unlike the web version)
//   • sharing the exported swing video
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, PermissionsAndroid, Platform, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { BleManager } from 'react-native-ble-plx';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

const WEB_URL = 'https://cocopoppyhead.github.io/golf-app/?app=native';
const LASER_CHAR = '3dd92622-b3cc-458b-9093-0e842dd41bcd';
const LASER_NAME = /PRO ?X3|BUSHNELL/i;
const BG = '#0b1120';

const ble = new BleManager();

// Tells the web app it's inside the native shell (see src/native.js in the web app).
const BOOT = `window.GolfNative = { platform: '${Platform.OS}', version: 1 }; true;`;

async function androidBlePermissions() {
  if (Platform.OS !== 'android') return true;
  const P = PermissionsAndroid.PERMISSIONS;
  const want = Platform.Version >= 31 ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT] : [P.ACCESS_FINE_LOCATION];
  const res = await PermissionsAndroid.requestMultiple(want);
  return want.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED);
}

export default function App() {
  return <SafeAreaProvider><Shell /></SafeAreaProvider>;
}

function Shell() {
  // iOS WebView reports safe areas to CSS itself; Android edge-to-edge doesn't, so pad natively.
  const insets = useSafeAreaInsets();
  const pad = Platform.OS === 'android' ? { paddingTop: insets.top, paddingBottom: insets.bottom } : null;
  const web = useRef(null);
  const device = useRef(null);
  const sub = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const canGoBack = useRef(false);

  const send = useCallback((msg) => {
    web.current?.injectJavaScript(`window.__golfNativeEvent && window.__golfNativeEvent(${JSON.stringify(msg)}); true;`);
  }, []);

  // Android back button goes back inside the app first
  useEffect(() => {
    const h = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack.current) { web.current?.goBack(); return true; }
      return false;
    });
    return () => h.remove();
  }, []);

  useEffect(() => () => { subs.current.forEach((x) => x.remove()); sub.current?.remove(); ble.stopDeviceScan(); }, []);

  const subs = useRef([]);
  const stopSubs = () => { subs.current.forEach((x) => { try { x.remove(); } catch {} }); subs.current = []; sub.current?.remove(); };

  const ready = async () => {
    if (!(await androidBlePermissions())) throw new Error('Bluetooth permission was not granted.');
    const state = await ble.state();
    if (state !== 'PoweredOn') throw new Error('Turn on Bluetooth on your phone.');
  };

  // List nearby named Bluetooth devices so you can pick a rangefinder that isn't a Bushnell.
  const laserScan = useCallback(async () => {
    try {
      await ready();
      const seen = new Map();
      send({ type: 'laser.status', text: 'Scanning… fire the rangefinder once to wake it.' });
      ble.startDeviceScan(null, null, (err, d) => {
        if (err) { send({ type: 'laser.error', text: err.message }); ble.stopDeviceScan(); return; }
        const name = d?.name || d?.localName;
        if (!name) return;
        seen.set(d.id, { id: d.id, name, rssi: d.rssi });
        send({ type: 'laser.found', devices: [...seen.values()].sort((x, y) => (y.rssi || -999) - (x.rssi || -999)) });
      });
      setTimeout(() => { ble.stopDeviceScan(); send({ type: 'laser.scanDone' }); }, 15000);
    } catch (e) { send({ type: 'laser.error', text: e?.message || String(e) }); }
  }, [send]);

  // id: connect to a picked device; otherwise look for a Bushnell by name.
  // Bushnell: listen on its known distance characteristic. Anything else: listen on every
  // notify/indicate characteristic and forward packets tagged with their UUID so the web app can learn them.
  const laserConnect = useCallback(async ({ id } = {}) => {
    const log = (text) => send({ type: 'laser.log', text });
    try {
      await ready();
      ble.stopDeviceScan();
      let found;
      if (id) found = { id, connect: () => ble.connectToDevice(id) };
      else {
        send({ type: 'laser.status', text: 'Looking for your Bushnell… fire the laser once to wake it.' });
        found = await new Promise((resolve, reject) => {
          const t = setTimeout(() => { ble.stopDeviceScan(); reject(new Error('No Bushnell found. Turn on Bluetooth in the laser menu, close the Bushnell app, and try again.')); }, 20000);
          ble.startDeviceScan(null, null, (err, d) => {
            if (err) { clearTimeout(t); ble.stopDeviceScan(); reject(err); return; }
            const name = d?.name || d?.localName || '';
            if (name && LASER_NAME.test(name)) { clearTimeout(t); ble.stopDeviceScan(); resolve(d); }
          });
        });
      }
      log(`device ${found.name || found.localName || ''} (${found.id})`);
      send({ type: 'laser.status', text: 'Connecting…' });
      const d = await found.connect();
      await d.discoverAllServicesAndCharacteristics();
      device.current = d;
      d.onDisconnected(() => { device.current = null; stopSubs(); send({ type: 'laser.disconnected' }); });
      const name = d.name || d.localName || found.name || 'Rangefinder';
      const services = await d.services();
      log(`services: ${services.map((s) => s.uuid).join(', ')}`);
      const all = [];
      for (const s of services) {
        const chars = await s.characteristics();
        log(`  ${s.uuid}: ${chars.map((c) => c.uuid + (c.isNotifiable ? ' N' : '') + (c.isIndicatable ? ' I' : '') + (c.isReadable ? ' R' : '')).join(', ')}`);
        all.push(...chars);
      }
      const bush = all.find((x) => x.uuid.toLowerCase() === LASER_CHAR);
      const listen = bush ? [bush] : all.filter((c) => c.isNotifiable || c.isIndicatable);
      for (const c of listen) {
        subs.current.push(c.monitor((err, ch) => {
          if (err) { log(`monitor error ${c.uuid}: ${err.message}`); return; }
          if (ch?.value) send({ type: 'laser.packet', b64: ch.value, char: c.uuid.toLowerCase() });
        }));
      }
      if (!listen.length) { send({ type: 'laser.error', text: 'Connected, but this device sends nothing the app can listen to. Copy the log and send it to Claude.' }); return; }
      send({ type: 'laser.connected', name, known: !!bush, chars: listen.map((c) => c.uuid.toLowerCase()) });
    } catch (e) {
      send({ type: 'laser.error', text: e?.message || String(e) });
    }
  }, [send]);

  const laserDisconnect = useCallback(async () => {
    stopSubs();
    try { await device.current?.cancelConnection(); } catch {}
    device.current = null;
    send({ type: 'laser.disconnected' });
  }, [send]);

  const shareFile = useCallback(async ({ name, mime, b64 }) => {
    try {
      const f = new File(Paths.cache, name);
      if (f.exists) f.delete();
      f.create();
      f.write(b64, { encoding: 'base64' });
      await Sharing.shareAsync(f.uri, { mimeType: mime, dialogTitle: 'Share swing video' });
      send({ type: 'share.done' });
    } catch (e) { send({ type: 'share.error', text: e?.message || String(e) }); }
  }, [send]);

  const onMessage = useCallback((e) => {
    let msg; try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.type === 'laser.connect') laserConnect(msg);
    else if (msg.type === 'laser.scan') laserScan();
    else if (msg.type === 'laser.disconnect') laserDisconnect();
    else if (msg.type === 'share.file') shareFile(msg);
  }, [laserConnect, laserScan, laserDisconnect, shareFile]);

  return (
    <View style={[styles.root, pad]}>
      <StatusBar style="light" />
      {error ? (
        <View style={styles.center}>
          <Text style={styles.title}>Can't reach the app</Text>
          <Text style={styles.sub}>Check your connection. After the first load it works offline.</Text>
          <Text style={styles.retry} onPress={() => { setError(null); web.current?.reload(); }}>Try again</Text>
        </View>
      ) : null}
      <WebView
        ref={web}
        source={{ uri: WEB_URL }}
        style={[styles.web, error && { display: 'none' }]}
        injectedJavaScriptBeforeContentLoaded={BOOT}
        onMessage={onMessage}
        onLoadEnd={() => setLoaded(true)}
        onError={() => setError(true)}
        onNavigationStateChange={(n) => { canGoBack.current = n.canGoBack; }}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        allowsBackForwardNavigationGestures
        setSupportMultipleWindows={false}
        overScrollMode="never"
        bounces={false}
        cacheEnabled
        webviewDebuggingEnabled={__DEV__}
        backgroundColor={BG}
      />
      {!loaded && !error ? <View style={[styles.center, StyleSheet.absoluteFill]}><ActivityIndicator color="#3ddc84" size="large" /></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  web: { flex: 1, backgroundColor: BG },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: BG, padding: 24 },
  title: { color: '#eef2fb', fontSize: 20, fontWeight: '800', marginBottom: 8 },
  sub: { color: '#8b97b3', fontSize: 15, textAlign: 'center' },
  retry: { color: '#3ddc84', fontSize: 16, fontWeight: '700', marginTop: 18 },
});
