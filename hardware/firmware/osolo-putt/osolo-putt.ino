// osolo putt sensor, firmware v0 — Seeed XIAO nRF52840 Sense in the grip-end pod.
//
// What it does: watches the LSM6DS3 IMU for a putting stroke (back, reversal, through) that ends in an
// impact, and broadcasts one BLE advertisement per putt with the tempo, the face rotation through the
// downswing and the impact strength. No connection, no pairing: the phone scans and reads the packet.
// A heartbeat advertisement every second carries the last event and the battery, so a missed packet
// can be picked up late (the phone de-duplicates by sequence number).
//
// Axes: the board lies flat on the grip end, so the board's Z axis is the shaft axis (face rotation =
// gyro Z) and the stroke is a rotation about an axis in the board's X–Y plane. Which in-plane axis
// depends on how the pod was twisted on, so the stroke axis is learnt from the first 100 ms of each
// stroke rather than assumed.
//
// Practice mode: the advertisement is connectable. When the app (or a coach's tablet) connects, every
// putt is also sent as a JSON line over the Nordic UART service, live, and 'r' / 's' over the same link
// start and stop a 52 Hz raw stream (ms, gx, gy, gz, ax, ay, az, hp). Nothing to switch on the pod: a
// connection is practice, no connection is play. The USB serial port does the same when plugged in.
//
// Build: arduino-cli compile --fqbn Seeeduino:nrf52:xiaonRF52840Sense (library: Seeed Arduino LSM6DS3).
// Flash: double-tap the reset button, drag the .uf2 onto the XIAO-SENSE drive.
#include <bluefruit.h>
#include <LSM6DS3.h>
#include <Wire.h>

// ---- tuning ----
static const uint16_t ODR_HZ = 208;            // IMU sample rate while awake
static const float    STROKE_START_DPS = 25.f; // in-plane angular rate that begins a stroke
static const float    STROKE_MIN_PEAK_DPS = 40.f; // backswing must reach this
static const float    IMPACT_G = 1.8f;         // high-passed |accel| spike that counts as a hit (g)
static const uint32_t BACK_MIN_MS = 200, BACK_MAX_MS = 2500;
static const uint32_t DOWN_MIN_MS = 120, DOWN_MAX_MS = 1200;
static const uint32_t IMPACT_WINDOW_MS = 700;  // impact must follow the reversal within this
static const uint32_t DEBOUNCE_MS = 1500;      // one putt per this
static const uint32_t IDLE_AFTER_MS = 60000;   // no motion for this long → deep sleep until the IMU wakes us
static const uint16_t ADV_FAST_MS = 20, ADV_SLOW_MS = 1000, ADV_FAST_SEC = 3;

// ---- state ----
LSM6DS3 imu(I2C_MODE, 0x6A);
BLEUart bleuart;                   // practice link
bool linked = false;
enum Phase { IDLE, BACK, DOWN };
Phase phase = IDLE;
float ux = 1, uy = 0;              // learnt stroke axis (unit vector in the X–Y plane)
float axisAccX = 0, axisAccY = 0; int axisN = 0;
uint32_t tStart = 0, tRev = 0, lastEvent = 0, lastMotion = 0;
float peakBack = 0, faceRot = 0, peakImpact = 0, lpMag = 1.0f;
bool rawStream = false, sleepy = false; uint8_t rawDiv = 0;
uint8_t seq = 0;

struct __attribute__((packed)) Event {
  uint8_t magic0, magic1;  // 'o','p'
  uint8_t ver;             // 0
  uint8_t seq;             // wraps
  uint8_t flags;           // bit0 fresh (set during the fast burst), bit2 a practice link is open
  uint8_t backTenths;      // backswing ms / 10 (0–255 → 0–2.55 s)
  uint8_t downTenths;      // downswing ms / 10
  int16_t faceDeciDeg;     // face rotation top→impact, ×10, + = closing (clockwise about shaft, right-hander opens/closes sign to be calibrated)
  uint8_t impactDeciG;     // peak high-passed accel ×10
  uint8_t battPct;         // 0–100
} ev = { 'o', 'p', 0, 0, 0, 0, 0, 0, 0, 100 };

// ---- battery ----
uint8_t batteryPct() {
  digitalWrite(VBAT_ENABLE, LOW);
  delayMicroseconds(50);
  analogReference(AR_INTERNAL_3_0); analogReadResolution(12);
  uint32_t raw = 0; for (int i = 0; i < 8; i++) raw += analogRead(PIN_VBAT); raw /= 8;
  digitalWrite(VBAT_ENABLE, HIGH);
  float v = raw * (3.0f / 4096.0f) * (1510.0f / 510.0f); // 1 M / 510 k divider
  float pct = (v - 3.5f) / (4.15f - 3.5f) * 100.f;
  return (uint8_t)constrain(pct, 0.f, 100.f);
}

// ---- advertising ----
void advertise(bool fresh) {
  ev.flags = (fresh ? 1 : 0) | (linked ? 4 : 0);
  if (linked) return;              // in practice mode the event has gone over the link
  Bluefruit.Advertising.stop();
  Bluefruit.Advertising.clearData();
  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAG_LE_GENERAL_DISC_MODE | BLE_GAP_ADV_FLAG_BR_EDR_NOT_SUPPORTED);
  uint8_t mfr[2 + sizeof(Event)];
  mfr[0] = 0xFF; mfr[1] = 0xFF; // company id 0xFFFF = development / unregistered
  memcpy(mfr + 2, &ev, sizeof(Event));
  Bluefruit.Advertising.addManufacturerData(mfr, sizeof(mfr));
  Bluefruit.Advertising.setType(BLE_GAP_ADV_TYPE_CONNECTABLE_SCANNABLE_UNDIRECTED);
  Bluefruit.Advertising.setIntervalMS(fresh ? ADV_FAST_MS : ADV_SLOW_MS, ADV_SLOW_MS);
  Bluefruit.Advertising.setFastTimeout(fresh ? ADV_FAST_SEC : 0);
  Bluefruit.Advertising.start(0);
}

// ---- IMU modes ----
// Deep sleep (v1): the IMU watches for motion on its own at 12.5 Hz in low-power mode (~10 µA) and
// pulses INT1 when the putter moves; the nRF52 waits on that pin with the radio off. Nothing polls.
SemaphoreHandle_t wakeSem;
void onImuWake() { BaseType_t hp = pdFALSE; xSemaphoreGiveFromISR(wakeSem, &hp); portYIELD_FROM_ISR(hp); }

void imuAwake() {
  imu.writeRegister(LSM6DS3_ACC_GYRO_MD1_CFG, 0x00);   // stop routing wake-up to INT1
  imu.settings.accelSampleRate = ODR_HZ; imu.settings.gyroSampleRate = ODR_HZ;
  imu.settings.accelRange = 16; imu.settings.gyroRange = 1000;
  imu.settings.accelBandWidth = 100; imu.settings.gyroBandWidth = 100;
  imu.settings.accelFifoEnabled = 0; imu.settings.gyroFifoEnabled = 0; imu.settings.tempEnabled = 0;
  imu.begin();
  sleepy = false;
}
void imuDrowsy() {
  imu.writeRegister(LSM6DS3_ACC_GYRO_CTRL2_G, 0x00);       // gyro off
  imu.writeRegister(LSM6DS3_ACC_GYRO_CTRL1_XL, 0x10);      // accel 12.5 Hz, ±2 g
  imu.writeRegister(LSM6DS3_ACC_GYRO_CTRL6_C, 0x10);       // accel high-performance off → low-power mode
  imu.writeRegister(LSM6DS3_ACC_GYRO_WAKE_UP_DUR, 0x00);
  imu.writeRegister(LSM6DS3_ACC_GYRO_WAKE_UP_THS, 0x03);   // 3 × 2 g/64 ≈ 0.09 g of change wakes it
  imu.writeRegister(LSM6DS3_ACC_GYRO_TAP_CFG1, 0x90);      // interrupts on, slope filter, pulsed (not latched)
  imu.writeRegister(LSM6DS3_ACC_GYRO_MD1_CFG, 0x20);       // wake-up → INT1
  sleepy = true;
}

void setup() {
  pinMode(LED_GREEN, OUTPUT); digitalWrite(LED_GREEN, !LED_STATE_ON);
  pinMode(LED_RED, OUTPUT); digitalWrite(LED_RED, !LED_STATE_ON);
  pinMode(LED_BLUE, OUTPUT); digitalWrite(LED_BLUE, !LED_STATE_ON);
  pinMode(VBAT_ENABLE, OUTPUT); digitalWrite(VBAT_ENABLE, HIGH);
  pinMode(PIN_CHARGING_CURRENT, OUTPUT); digitalWrite(PIN_CHARGING_CURRENT, HIGH); // 50 mA charge: 0.5C for the 100 mAh cell (100 mA would be 1C, the cell's limit)
  pinMode(PIN_LSM6DS3TR_C_POWER, OUTPUT); digitalWrite(PIN_LSM6DS3TR_C_POWER, HIGH);
  delay(50);
  Serial.begin(115200);
  wakeSem = xSemaphoreCreateBinary();
  pinMode(PIN_LSM6DS3TR_C_INT1, INPUT_PULLDOWN);
  attachInterrupt(digitalPinToInterrupt(PIN_LSM6DS3TR_C_INT1), onImuWake, RISING);
  imuAwake();
  Bluefruit.begin(1, 0);           // one central may connect (practice mode)
  Bluefruit.setTxPower(0);
  Bluefruit.setName("osolo");
  Bluefruit.autoConnLed(false);
  Bluefruit.Periph.setConnectCallback([](uint16_t) { linked = true; digitalWrite(LED_BLUE, LED_STATE_ON); });
  Bluefruit.Periph.setDisconnectCallback([](uint16_t, uint8_t) { linked = false; rawStream = false; digitalWrite(LED_BLUE, !LED_STATE_ON); advertise(false); });
  bleuart.begin();
  bleuart.setRxCallback([](uint16_t) { while (bleuart.available()) { char c = bleuart.read(); if (c == 'r') rawStream = true; if (c == 's') rawStream = false; } });
  Bluefruit.ScanResponse.addName();
  Bluefruit.ScanResponse.addService(bleuart);
  Bluefruit.Advertising.restartOnDisconnect(false);
  ev.battPct = batteryPct();
  advertise(false);
  lastMotion = millis();
}

static inline void emit(uint32_t now) {
  uint32_t back = tRev - tStart, down = now - tRev;
  ev.seq = ++seq;
  ev.backTenths = (uint8_t)min<uint32_t>(back / 10, 255);
  ev.downTenths = (uint8_t)min<uint32_t>(down / 10, 255);
  ev.faceDeciDeg = (int16_t)constrain(faceRot * 10.f, -3000.f, 3000.f);
  ev.impactDeciG = (uint8_t)min(peakImpact * 10.f, 255.f);
  ev.battPct = batteryPct();
  advertise(true);
  lastEvent = now;
  digitalWrite(LED_GREEN, LED_STATE_ON);
  char line[112];
  snprintf(line, sizeof line, "{\"putt\":%u,\"back_ms\":%lu,\"down_ms\":%lu,\"face_deg\":%.1f,\"impact_g\":%.2f,\"batt\":%u}\n", seq, (unsigned long)back, (unsigned long)down, (double)faceRot, (double)peakImpact, ev.battPct);
  if (Serial) Serial.print(line);
  if (linked) bleuart.print(line);
}

void loop() {
  if (Serial && Serial.available()) { char c = Serial.read(); if (c == 'r') rawStream = true; if (c == 's') rawStream = false; }
  uint32_t now = millis();
  if (linked) lastMotion = now; // never doze while a practice session is connected
  if (sleepy) {
    // asleep: radio off, CPU parked in the RTOS idle (System ON, ~µA) until the IMU's INT1 fires
    Bluefruit.Advertising.stop();
    xSemaphoreTake(wakeSem, 0);                      // drop any stale wake
    xSemaphoreTake(wakeSem, portMAX_DELAY);
    imuAwake(); lastMotion = lastEvent = millis(); lpMag = 1.0f; phase = IDLE;
    ev.battPct = batteryPct(); advertise(false);
    return;
  }
  float gx = imu.readFloatGyroX(), gy = imu.readFloatGyroY(), gz = imu.readFloatGyroZ();
  float ax = imu.readFloatAccelX(), ay = imu.readFloatAccelY(), az = imu.readFloatAccelZ();
  float mag = sqrtf(ax * ax + ay * ay + az * az);
  lpMag += 0.08f * (mag - lpMag);
  float hp = fabsf(mag - lpMag);                 // the impact shows up here as a short spike
  float inplane = sqrtf(gx * gx + gy * gy);
  if (inplane > STROKE_START_DPS || hp > 0.3f) lastMotion = now;
  if (rawStream && (++rawDiv & 3) == 0) {
    char raw[96];
    snprintf(raw, sizeof raw, "%lu,%.1f,%.1f,%.1f,%.3f,%.3f,%.3f,%.3f\n", (unsigned long)now, (double)gx, (double)gy, (double)gz, (double)ax, (double)ay, (double)az, (double)hp);
    if (Serial) Serial.print(raw);
    if (linked) bleuart.print(raw);
  }

  switch (phase) {
    case IDLE:
      if (inplane > STROKE_START_DPS && now - lastEvent > DEBOUNCE_MS) {
        phase = BACK; tStart = now; peakBack = 0; axisAccX = axisAccY = 0; axisN = 0;
      }
      break;
    case BACK: {
      if (axisN < (int)(ODR_HZ / 10)) { axisAccX += gx; axisAccY += gy; axisN++; float n = sqrtf(axisAccX * axisAccX + axisAccY * axisAccY); if (n > 1) { ux = axisAccX / n; uy = axisAccY / n; } }
      float w = gx * ux + gy * uy;                 // signed rate about the learnt axis: + = going back
      if (w > peakBack) peakBack = w;
      if (now - tStart > BACK_MAX_MS) { phase = IDLE; break; }
      if (peakBack >= STROKE_MIN_PEAK_DPS && w < -STROKE_START_DPS * 0.5f && now - tStart >= BACK_MIN_MS) { phase = DOWN; tRev = now; faceRot = 0; peakImpact = 0; }
      break;
    }
    case DOWN: {
      faceRot += gz / (float)ODR_HZ;                 // degrees of rotation about the shaft since the top
      if (hp > peakImpact) peakImpact = hp;
      uint32_t dt = now - tRev;
      if (peakImpact >= IMPACT_G && dt >= DOWN_MIN_MS) { emit(now); phase = IDLE; break; }
      if (dt > IMPACT_WINDOW_MS || dt > DOWN_MAX_MS) { phase = IDLE; break; }   // a practice stroke: no ball
      break;
    }
  }
  if (now - lastEvent > 150) digitalWrite(LED_GREEN, !LED_STATE_ON);
  if (!sleepy && !linked && !Serial && now - lastMotion > IDLE_AFTER_MS) imuDrowsy();
  delay(1000 / ODR_HZ);
}
