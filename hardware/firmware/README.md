# osolo putt sensor firmware

`osolo-putt/osolo-putt.ino` runs on the Seeed XIAO nRF52840 Sense in the grip-end pod. It detects a
putting stroke that ends in an impact and broadcasts one BLE advertisement per putt (manufacturer data,
company id 0xFFFF, payload `op` + version, sequence, flags, backswing and downswing in 10 ms units, face
rotation ×10 °, impact ×10 g, battery %). No connection or pairing; the phone scans. A heartbeat every
second repeats the last event with the battery so a missed packet is picked up late.

Practice mode: the advertisement is connectable; connect (the app, or any BLE terminal such as nRF Connect) and
every putt arrives as a JSON line over the Nordic UART service, live; send `r` / `s` over the same link for a 52 Hz
raw stream. No switch on the pod: connected = practice, not connected = play (advertisements only).

Flash: double-tap the reset button next to the USB-C (the board shows up as a drive called XIAO-SENSE),
drag `osolo-putt/osolo-putt-v0.uf2` onto it. It reboots into the firmware; the green LED blinks on a putt.

Tune: plug in, open a serial monitor at 115200, send `r` for a raw stream (ms, gx, gy, gz, ax, ay, az,
high-passed |a|), `s` to stop. Each detected putt prints a JSON line. Thresholds are at the top of the sketch.

Build (Linux/macOS):

    arduino-cli config add board_manager.additional_urls https://files.seeedstudio.com/arduino/package_seeeduino_boards_index.json
    arduino-cli core install Seeeduino:nrf52 && arduino-cli lib install "Seeed Arduino LSM6DS3"
    pip install adafruit-nrfutil
    arduino-cli compile --fqbn Seeeduino:nrf52:xiaonRF52840Sense --export-binaries osolo-putt
    python3 hex2uf2.py osolo-putt/build/Seeeduino.nrf52.xiaonRF52840Sense/osolo-putt.ino.hex osolo-putt/osolo-putt-v0.uf2
