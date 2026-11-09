// Android 11+ hides other apps unless declared: the WebView's file chooser needs to see the camera
// apps to offer "Take photo / Record video" for <input type="file" accept="image/*|video/*">.
const { withAndroidManifest } = require('expo/config-plugins');
module.exports = (config) => withAndroidManifest(config, (c) => {
  const m = c.modResults.manifest;
  m.queries = m.queries || [{}];
  const q = m.queries[0];
  q.intent = q.intent || [];
  for (const action of ['android.media.action.IMAGE_CAPTURE', 'android.media.action.VIDEO_CAPTURE']) {
    if (!q.intent.some((i) => i.action?.some((a) => a.$?.['android:name'] === action))) q.intent.push({ action: [{ $: { 'android:name': action } }] });
  }
  return c;
});
