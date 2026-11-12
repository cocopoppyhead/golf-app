// Golf Coach — native shell.
// The whole app is the web app (GitHub Pages) running in a WebView, so every push to main
// updates the installed app with no store release. Native code only adds what browsers can't:
//   • Bluetooth for the Bushnell laser (works on iPhone too, unlike the web version)
//   • the Bushnell loop in the background: phone in the pocket, lock on, a notification shows
//     distance · plays-like · club with ✓ / Other; the read reaches the web app when it resumes
//   • sharing the exported swing video
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Linking, PermissionsAndroid, Platform, Share, StyleSheet, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { BleManager } from 'react-native-ble-plx';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { pickForImport } from './pickfiles';

const WEB_URL = 'https://cocopoppyhead.github.io/golf-app/?app=native';
const LASER_CHAR = '3dd92622-b3cc-458b-9093-0e842dd41bcd';
const LASER_NAME = /PRO ?X3|BUSHNELL/i;
const BG = '#0b1120';

const ble = new BleManager();

// Tells the web app it's inside the native shell (see src/native.js in the web app).
const BOOT = `window.GolfNative = { platform: '${Platform.OS}', version: 2, caps: ['files.pick'] }; true;`;

// The WebView's file chooser (swing video, scorecard photo) only offers the camera once the app
// holds the camera permission, and on some phones shows nothing at all without it. Ask up front.
async function androidMediaPermissions() {
  if (Platform.OS !== 'android') return;
  const P = PermissionsAndroid.PERMISSIONS;
  const want = [P.CAMERA];
  if (Platform.Version >= 33) want.push(P.READ_MEDIA_IMAGES, P.READ_MEDIA_VIDEO);
  else want.push(P.READ_EXTERNAL_STORAGE);
  try { await PermissionsAndroid.requestMultiple(want.filter(Boolean)); } catch {}
}

async function androidBlePermissions() {
  if (Platform.OS !== 'android') return true;
  const P = PermissionsAndroid.PERMISSIONS;
  const want = Platform.Version >= 31 ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT] : [P.ACCESS_FINE_LOCATION];
  const res = await PermissionsAndroid.requestMultiple(want);
  return want.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED);
}

// ---- background shot notifications ----
Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });
const decodePacket = (b64) => { // 5 little-endian float32: raw yards, slope %, heading °, plays-as yards, incline
  try {
    const bin = atob(b64); if (bin.length < 20) return null;
    const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const dv = new DataView(u.buffer); const f = (i) => dv.getFloat32(i * 4, true);
    const r = { raw: f(0), slope: f(1), heading: f(2), playsAs: f(3) };
    return Number.isFinite(r.raw) && r.raw > 0 && r.raw < 2000 ? r : null;
  } catch { return null; }
};
// clubs come from the web app (loop.config): [{ club, carry, swing }] in yards, plus the day's carry factor
const pickClub = (cfg, plays) => {
  const opts = (cfg?.clubs || []).filter((c) => c.carry > 0);
  if (!opts.length) return null;
  opts.sort((a, b) => Math.abs(a.carry - plays) - Math.abs(b.carry - plays) || (a.swing === 'full' ? -1 : 1));
  return opts[0];
};
const fmtUnit = (cfg, yards) => (cfg?.metric ? `${Math.round(yards * 0.9144)} m` : `${Math.round(yards)} y`);
async function notifyShot(cfg, r, id) {
  try {
    const slope = Number.isFinite(r.playsAs) && r.playsAs > 0 && Math.abs(r.playsAs - r.raw) > 0.4 ? r.playsAs : r.raw;
    const plays = Math.round(slope / (cfg?.factor || 1));
    const club = pickClub(cfg, plays);
    const clubTxt = club ? `${club.club}${club.swing && club.swing !== 'full' ? ` ${club.swing}` : ''}` : '';
    await Notifications.setNotificationCategoryAsync('shot', [
      { identifier: 'ok', buttonTitle: club ? `✓ ${clubTxt}` : '✓ Log it', options: { opensAppToForeground: false } },
      { identifier: 'other', buttonTitle: 'Other club', options: { opensAppToForeground: true } },
    ]);
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('shots', { name: 'Rangefinder shots', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 80], sound: null });
    await Notifications.scheduleNotificationAsync({
      content: { title: `${fmtUnit(cfg, r.raw)}${plays !== Math.round(r.raw) ? ` · plays ${fmtUnit(cfg, plays)}` : ''}`, body: club ? `${clubTxt} · tap ✓ or pick another` : 'Add carries in Bag for a club suggestion', categoryIdentifier: 'shot', data: { id }, sound: false, ...(Platform.OS === 'android' ? { channelId: 'shots' } : {}) },
      trigger: null,
    });
  } catch {}
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

  // The loop while backgrounded: packets queue up (with any ✓ from the notification) and flush when the app comes back.
  const appActive = useRef(AppState.currentState === 'active');
  const loopCfg = useRef(null);
  const queue = useRef([]);
  const flush = useCallback(() => { const q = queue.current; queue.current = []; q.forEach((m) => send(m)); }, [send]);
  useEffect(() => {
    const h = AppState.addEventListener('change', (st) => { appActive.current = st === 'active'; if (st === 'active') { Notifications.dismissAllNotificationsAsync().catch(() => {}); setTimeout(flush, 300); } });
    const r = Notifications.addNotificationResponseReceivedListener((resp) => {
      const id = resp.notification.request.content.data?.id; const action = resp.actionIdentifier;
      const m = queue.current.find((x) => x.id === id);
      if (m && action === 'ok') m.accepted = true;
      if (m && action === 'other') m.other = true;
    });
    return () => { h.remove(); r.remove(); };
  }, [flush]);
  const deliverPacket = useCallback((msg) => {
    if (appActive.current) return send(msg);
    const r = msg.char === LASER_CHAR ? decodePacket(msg.b64) : null;
    msg.id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`; msg.t = Date.now();
    queue.current.push(msg); if (queue.current.length > 20) queue.current.shift();
    if (r) notifyShot(loopCfg.current, r, msg.id);
  }, [send]);

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
  const connecting = useRef(false);
  const lastId = useRef(null);
  const laserConnect = useCallback(async ({ id } = {}, attempt = 1) => {
    const log = (text) => send({ type: 'laser.log', text });
    // one connection attempt at a time (a double tap used to start two and they cancelled each other)
    if (connecting.current && attempt === 1) { log('already connecting, ignored'); return; }
    connecting.current = true;
    let settingUp = true;
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
      lastId.current = found.id;
      log(`device ${found.name || found.localName || ''} (${found.id})${attempt > 1 ? ` · attempt ${attempt}` : ''}`);
      send({ type: 'laser.status', text: attempt > 1 ? 'Connecting again…' : 'Connecting…' });
      // a stale link from an earlier try (or the Bushnell app) blocks a new one: drop it first
      if (await ble.isDeviceConnected(found.id).catch(() => false)) { log('dropping an old connection'); await ble.cancelDeviceConnection(found.id).catch(() => {}); await new Promise((r) => setTimeout(r, 600)); }
      const d = await ble.connectToDevice(found.id, { timeout: 12000, ...(Platform.OS === 'android' ? { requestMTU: 185 } : {}) });
      log('connected, reading services…');
      d.onDisconnected((err) => {
        device.current = null; stopSubs();
        if (settingUp) return; // handled by the retry below
        log(`disconnected${err ? `: ${err.message}` : ''}`);
        send({ type: 'laser.disconnected' });
      });
      await d.discoverAllServicesAndCharacteristics();
      device.current = d;
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
          if (err) {
            log(`monitor error ${c.uuid}: ${err.message}`);
            // the Pro X3 needs the phone paired (bonded) before it will send distances
            if (/notify change failed|auth|encrypt|bond|insufficient/i.test(err.message || '')) send({ type: 'laser.error', text: 'The laser needs pairing first. In the laser menu set Bluetooth to PAIR: a 6-digit code shows in the eyepiece. Connect again and type that code when your phone asks. (Tap ⓘ in the Rangefinder card for the steps.)' });
            return;
          }
          if (ch?.value) deliverPacket({ type: 'laser.packet', b64: ch.value, char: c.uuid.toLowerCase() });
        }));
      }
      if (!listen.length) { send({ type: 'laser.error', text: 'Connected, but this device sends nothing the app can listen to. Copy the log and send it to Claude.' }); return; }
      settingUp = false;
      connecting.current = false;
      send({ type: 'laser.connected', name, known: !!bush, chars: listen.map((c) => c.uuid.toLowerCase()) });
    } catch (e) {
      const msg = e?.message || String(e);
      log(`error: ${msg}`);
      // Android's first GATT connect often drops: wait and try again up to twice
      if (attempt < 3 && /disconnected|cancel|133|timed out|gatt/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 1200));
        return laserConnect({ id: id || lastId.current }, attempt + 1);
      }
      connecting.current = false;
      send({ type: 'laser.error', text: msg });
    }
  }, [send, deliverPacket]);

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
    else if (msg.type === 'location.permission') {
      // the web app's geolocation needs the app-level permission on Android (iOS asks by itself)
      (async () => {
        let granted = true;
        if (Platform.OS === 'android') {
          const P = PermissionsAndroid.PERMISSIONS;
          const res = await PermissionsAndroid.requestMultiple([P.ACCESS_FINE_LOCATION, P.ACCESS_COARSE_LOCATION]).catch(() => ({}));
          granted = Object.values(res).some((v) => v === PermissionsAndroid.RESULTS.GRANTED);
        }
        send({ type: 'location.permission', granted });
      })();
    }
    else if (msg.type === 'laser.disconnect') laserDisconnect();
    else if (msg.type === 'loop.config') { loopCfg.current = msg; Notifications.requestPermissionsAsync().catch(() => {}); }
    else if (msg.type === 'share.file') shareFile(msg);
    else if (msg.type === 'share.text') Share.share({ message: msg.text || '' }).catch(() => {});
    else if (msg.type === 'files.pick') {
      // Garmin export: golf scorecards (and an osolo export, or zips nested in the export) out of whatever was picked
      const want = (n) => /\.fit$/i.test(n) || /Golf-CLUB(_TYPES)?\.json$/i.test(n) || /osolo-garmin.*\.json$/i.test(n) || /\.zip$/i.test(n);
      pickForImport(want).then((r) => send({ type: 'files.picked', id: msg.id, ...r })).catch((e) => send({ type: 'files.picked', id: msg.id, error: e?.message || String(e), files: [] }));
    }
    else if (msg.type === 'open.url' && /^https?:\/\//.test(msg.url || '')) Linking.openURL(msg.url).catch(() => {});
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
        onLoadEnd={() => { setLoaded(true); androidMediaPermissions(); }}
        onError={() => setError(true)}
        onNavigationStateChange={(n) => { canGoBack.current = n.canGoBack; }}
        javaScriptEnabled
        geolocationEnabled
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
