# Golf Coach — native app (Expo)

A thin Expo shell around the web app (https://cocopoppyhead.github.io/golf-app/).
The web app does everything; the shell adds:

- **Bluetooth for the Bushnell laser** (react-native-ble-plx) — works on iPhone too
- **Sharing exported swing videos** (expo-sharing)
- Camera / photo library permissions for recording swings and scorecard photos

Because the shell loads the live site, every push to `main` updates the installed app.
No store release is needed unless native code (this folder) changes.

## Build

BLE needs a development build (not Expo Go).

```bash
cd native
npm install
npx eas-cli@latest init                                   # link to your Expo account (writes projectId)
npx eas-cli@latest build -p android --profile preview     # APK to share with friends
npx eas-cli@latest build -p ios --profile production      # App Store / TestFlight build
npx eas-cli@latest submit -p ios                          # send to TestFlight
npx eas-cli@latest build --profile development --platform all   # dev client for testing
```

Bundle ID / package: `com.cocopoppyhead.golfcoach`. Change it in `app.json` before the first store build if you use a different prefix.

## Laser bridge

`App.js` scans for a device named like `PRO X3` / `Bushnell`, connects, finds characteristic
`3dd92622-b3cc-458b-9093-0e842dd41bcd` and forwards each packet (base64) to the web app
(`src/native.js` → `src/laser.js`), which decodes it. The Bag tab's diagnostics log shows every
service and characteristic found, so if Conor's Pro X3 differs from the X3+, the log says where.
