/**
 * Locating adb, and picking the right device when more than one is attached.
 *
 * Split out from quest-perf.js because device selection is the part that fails
 * silently. `adb` with two devices attached and no `-s` does not pick one — it
 * errors, and every downstream step then fails for a reason that has nothing to
 * do with the reason it actually failed. This machine really does have a second
 * Android device attached (a Pixel), so that is not a hypothetical.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Quest hardware reports a codename in `ro.product.model` / the `-l` listing
 * rather than the marketing name. Matching on those codenames is more reliable
 * than matching "Quest", which no device actually reports for some builds.
 */
const QUEST_MODEL_PATTERN = /quest|monterey|hollywood|seacliff|eureka|panther/i;

function resolveAdb() {
  const candidates = [
    process.env.KOTOR2VR_ADB,
    process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe'),
    process.env.ANDROID_SDK_ROOT && path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // Last resort: whatever is on PATH. Throws at first use if there is none.
  return 'adb';
}

/** Parses `adb devices -l` into records. Ignores offline/unauthorized entries. */
function parseDeviceList(stdout) {
  return stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('*'))
    .map((line) => {
      const [serial, state, ...rest] = line.split(/\s+/);
      const fields = Object.fromEntries(
        rest.filter((f) => f.includes(':')).map((f) => {
          const index = f.indexOf(':');
          return [f.slice(0, index), f.slice(index + 1)];
        })
      );
      return { serial, state, model: fields.model || '', device: fields.device || '' };
    })
    .filter((entry) => entry.serial && entry.state);
}

function listDevices(adb = resolveAdb()) {
  let stdout;
  try {
    stdout = execFileSync(adb, ['devices', '-l'], { encoding: 'utf8' });
  } catch (error) {
    throw new Error(
      `Could not run adb (${adb}). Set KOTOR2VR_ADB to the adb.exe path, or install ` +
      `platform-tools. Underlying error: ${error.message}`
    );
  }
  return parseDeviceList(stdout);
}

function looksLikeQuest(entry) {
  return QUEST_MODEL_PATTERN.test(`${entry.model} ${entry.device}`);
}

/**
 * Chooses the headset. Never guesses: an explicit `serial` wins, exactly one
 * Quest-looking device wins, and anything else is an error naming what it saw.
 */
function selectQuest(devices, serial = null) {
  if (serial) {
    const match = devices.find((d) => d.serial === serial);
    if (!match) {
      throw new Error(`No device with serial ${serial}. Attached: ${describe(devices)}`);
    }
    if (match.state !== 'device') {
      throw new Error(`Device ${serial} is in state "${match.state}", not "device".`);
    }
    return match;
  }

  const ready = devices.filter((d) => d.state === 'device');
  const unauthorized = devices.filter((d) => d.state === 'unauthorized');
  const quests = ready.filter(looksLikeQuest);

  if (quests.length === 1) return quests[0];
  if (quests.length > 1) {
    throw new Error(`More than one headset attached — pass --serial. Saw: ${describe(quests)}`);
  }
  if (unauthorized.length) {
    throw new Error(
      `A device is attached but unauthorized: ${describe(unauthorized)}. Put the headset on and ` +
      `accept the "Allow USB debugging" prompt.`
    );
  }
  throw new Error(
    devices.length
      ? `No Quest among the attached devices: ${describe(devices)}. Connect the headset over USB, ` +
        `or enable ADB-over-WiFi and run: adb connect <ip>:5555`
      : 'No Android devices attached. Connect the Quest over USB, or run adb connect <ip>:5555.'
  );
}

function describe(devices) {
  if (!devices.length) return '(none)';
  return devices.map((d) => `${d.serial} (${d.model || 'unknown model'}, ${d.state})`).join(', ');
}

module.exports = { resolveAdb, listDevices, parseDeviceList, selectQuest, looksLikeQuest, describe, QUEST_MODEL_PATTERN };
