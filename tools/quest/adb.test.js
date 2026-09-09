/**
 * node --test tools/quest/adb.test.js
 *
 * Device selection is the part of the Quest loop that fails silently, and it
 * cannot be exercised without hardware — so the parsing and the refusal rules
 * are tested against captured `adb devices -l` output instead.
 */
const test = require('node:test');
const assert = require('node:assert');

const { parseDeviceList, selectQuest, looksLikeQuest } = require('./adb');

// Real output from this machine, with a phone attached and no headset.
const PHONE_ONLY = `List of devices attached
5A030DLCQ006TY         device product:mustang model:Pixel_10_Pro_XL device:mustang transport_id:1
`;

const PHONE_AND_QUEST = `List of devices attached
5A030DLCQ006TY         device product:mustang model:Pixel_10_Pro_XL device:mustang transport_id:1
1WMHH000X00000         device product:hollywood model:Quest_3 device:eureka transport_id:2
`;

const UNAUTHORIZED = `List of devices attached
1WMHH000X00000         unauthorized usb:1-3
`;

test('parses the model and device fields out of adb devices -l', () => {
  const [phone] = parseDeviceList(PHONE_ONLY);
  assert.equal(phone.serial, '5A030DLCQ006TY');
  assert.equal(phone.state, 'device');
  assert.equal(phone.model, 'Pixel_10_Pro_XL');
  assert.equal(phone.device, 'mustang');
});

test('a phone is not a headset', () => {
  assert.equal(looksLikeQuest({ model: 'Pixel_10_Pro_XL', device: 'mustang' }), false);
});

test('matches a headset on its codename as well as its model', () => {
  assert.ok(looksLikeQuest({ model: 'Quest_3', device: 'eureka' }));
  assert.ok(looksLikeQuest({ model: '', device: 'hollywood' }));
});

test('picks the headset when a phone is attached alongside it', () => {
  const chosen = selectQuest(parseDeviceList(PHONE_AND_QUEST));
  assert.equal(chosen.serial, '1WMHH000X00000');
});

test('refuses rather than falling back to the phone', () => {
  assert.throws(
    () => selectQuest(parseDeviceList(PHONE_ONLY)),
    /No Quest among the attached devices.*Pixel_10_Pro_XL/s
  );
});

test('names the authorization prompt when the headset has not accepted it', () => {
  assert.throws(() => selectQuest(parseDeviceList(UNAUTHORIZED)), /unauthorized/i);
});

test('an explicit serial wins, and a missing one is an error', () => {
  const devices = parseDeviceList(PHONE_AND_QUEST);
  assert.equal(selectQuest(devices, '5A030DLCQ006TY').model, 'Pixel_10_Pro_XL');
  assert.throws(() => selectQuest(devices, 'nope'), /No device with serial nope/);
});
