// FlyDrones ESP32 bridge: Wi-Fi UDP -> MSP_SET_RAW_RC -> Betaflight / INAV flight controller
//
// Laptop (fly brain)  --UDP "FD1,seq,arm,thr,yaw,pitch,roll"-->  ESP32  --UART MSP-->  FC
//
// Wiring (3.3 V logic):
//   ESP32 GPIO17 (TX2) -> FC UART RX  (a spare UART with "MSP" enabled in Ports tab)
//   ESP32 GPIO16 (RX2) <- FC UART TX
//   GND <-> GND. Power the ESP32 from the FC 5 V pad or a separate BEC.
//
// Betaflight setup (Configurator):
//   Ports:        enable MSP on the UART you wired
//   Receiver:     Receiver mode = "MSP RX input"
//   Modes:        ARM on AUX1 (range 1700-2100), ANGLE mode always on for first tests
//   Failsafe:     Stage 2 = "Land" (or "Drop" on a test stand), guard time 0.5 s
//
// SAFETY: test with PROPELLERS OFF first. If no valid packet arrives for
// 300 ms this bridge stops sending RC frames, so the FC's own RX-loss failsafe
// takes over. That is the only failsafe you can trust - configure it.
//
// Board: any ESP32 dev board / M5Stack Atom. Arduino core for ESP32 >= 2.0.

#include <WiFi.h>
#include <WiFiUdp.h>

// ---------------------------------------------------------------- settings
const char* AP_SSID = "FlyDrones-Bridge";
const char* AP_PASS = "change-me-please";   // 8+ chars. Change it!
const uint16_t UDP_PORT = 8888;           // commands in
const uint16_t TELEMETRY_PORT = 8889;     // telemetry out (to the last sender)
const uint32_t FC_BAUD = 115200;
const int FC_RX_PIN = 16;
const int FC_TX_PIN = 17;
const uint32_t PACKET_TIMEOUT_MS = 300;
const uint32_t RC_PERIOD_MS = 20;         // 50 Hz

const int HOVER_PWM = 1500;   // calibrate! throttle that roughly hovers in ANGLE mode
const int THR_RANGE = 150;    // +-throttle authority around hover
const int STICK_RANGE = 200;  // +-roll/pitch/yaw authority

// ---------------------------------------------------------------- state
WiFiUDP udp;
HardwareSerial FC(2);
uint32_t lastPacketMs = 0;
uint32_t lastRcMs = 0;
long lastSeq = -1;
bool armed = false;
int thr = 0, yaw = 0, pitch = 0, roll = 0;  // -1000..1000
IPAddress lastSender;

uint8_t mspChecksum(uint8_t size, uint8_t cmd, const uint8_t* payload) {
  uint8_t c = size ^ cmd;
  for (int i = 0; i < size; i++) c ^= payload[i];
  return c;
}

void sendMsp(uint8_t cmd, const uint8_t* payload, uint8_t size) {
  FC.write('$'); FC.write('M'); FC.write('<');
  FC.write(size); FC.write(cmd);
  FC.write(payload, size);
  FC.write(mspChecksum(size, cmd, payload));
}

int clampPwm(int v) { return v < 1000 ? 1000 : (v > 2000 ? 2000 : v); }

void sendRc() {
  // AETR + AUX: roll, pitch, throttle, yaw, aux1(arm), aux2..aux4
  uint16_t ch[8];
  ch[0] = clampPwm(1500 + roll * STICK_RANGE / 1000);
  ch[1] = clampPwm(1500 + pitch * STICK_RANGE / 1000);
  ch[2] = armed ? clampPwm(HOVER_PWM + thr * THR_RANGE / 1000) : 1000;
  ch[3] = clampPwm(1500 + yaw * STICK_RANGE / 1000);
  ch[4] = armed ? 1800 : 1000;
  ch[5] = 1000; ch[6] = 1000; ch[7] = 1000;
  uint8_t payload[16];
  for (int i = 0; i < 8; i++) {
    payload[2 * i] = ch[i] & 0xFF;
    payload[2 * i + 1] = (ch[i] >> 8) & 0xFF;
  }
  sendMsp(200 /* MSP_SET_RAW_RC */, payload, 16);
}

bool parsePacket(char* s) {
  // FD1,<seq>,<arm>,<thr>,<yaw>,<pitch>,<roll>
  if (strncmp(s, "FD1,", 4) != 0) return false;
  long v[6];
  char* p = s + 4;
  for (int i = 0; i < 6; i++) {
    char* end;
    v[i] = strtol(p, &end, 10);
    if (end == p) return false;
    p = (*end == ',') ? end + 1 : end;
  }
  if (v[0] <= lastSeq && lastSeq - v[0] < 1000) return false;  // stale / out of order
  lastSeq = v[0];
  armed = v[1] != 0;
  thr = constrain(v[2], -1000, 1000);
  yaw = constrain(v[3], -1000, 1000);
  pitch = constrain(v[4], -1000, 1000);
  roll = constrain(v[5], -1000, 1000);
  return true;
}

void setup() {
  Serial.begin(115200);
  FC.begin(FC_BAUD, SERIAL_8N1, FC_RX_PIN, FC_TX_PIN);
  WiFi.softAP(AP_SSID, AP_PASS);
  udp.begin(UDP_PORT);
  Serial.printf("FlyDrones bridge up. SSID %s, IP %s, UDP %u\n", AP_SSID, WiFi.softAPIP().toString().c_str(), UDP_PORT);
}

void loop() {
  int len = udp.parsePacket();
  if (len > 0 && len < 128) {
    char buf[128];
    int n = udp.read(buf, sizeof(buf) - 1);
    buf[n] = 0;
    if (parsePacket(buf)) {
      lastPacketMs = millis();
      lastSender = udp.remoteIP();
    }
  }

  uint32_t now = millis();
  bool fresh = (now - lastPacketMs) < PACKET_TIMEOUT_MS && lastSeq >= 0;
  if (fresh && now - lastRcMs >= RC_PERIOD_MS) {
    lastRcMs = now;
    sendRc();
  }
  // not fresh: send nothing -> FC detects RX loss -> FC failsafe

  static uint32_t lastTel = 0;
  if (fresh && now - lastTel > 100) {  // minimal telemetry: link alive (altitude needs a baro/rangefinder query)
    lastTel = now;
    udp.beginPacket(lastSender, TELEMETRY_PORT);
    udp.printf("FT1,%d,%d,%d\n", -1, 0, 0);
    udp.endPacket();
  }
}
