import * as THREE from 'three';
import { describe, expect, jest, test } from '@jest/globals';
import { getLegacyGUIVRPointerSemanticTargets } from '@/vr/runtime/LegacyGUIVRPointerDiscovery';
import {
  getGUIListBoxVRPointerTargetsAtPointer,
  GUIListBoxVRPointerRow,
  GUIListBoxVRPointerTargetSource,
} from '@/vr/runtime/GUIListBoxVRPointerTargets';

describe('legacy GUI VR list discovery', () => {
  test('discovers a dialogue reply row and routes it through the list selection callback', () => {
    const onSelected = jest.fn();
    const { list, row } = createReplyList(onSelected);

    const targets = getLegacyGUIVRPointerSemanticTargets(() => [{ list }]);

    expect(targets).toHaveLength(1);
    expect(targets[0].name).toBe('LB_REPLIES row 1');
    targets[0].activate();

    expect(row.selected).toBe(true);
    expect(list.selectedItem).toBe(row);
    expect(onSelected).toHaveBeenCalledWith({ replyId: 'peragus-console' }, row, 0);
  });

  test('discovers live scroll arrows and updates the list scroll range', () => {
    const { list, row } = createReplyList(jest.fn());
    list.maxScroll = 10;
    list.scroll = 5;
    list.scrollWrapper = { visible: true };
    list.scrollUp = () => { list.scroll = Math.max(0, list.scroll - 5); list.updateList(); };
    list.scrollDown = () => { list.scroll = Math.min(list.maxScroll, list.scroll + 5); list.updateList(); };

    const upArrow = createArrow(new THREE.Box2(
      new THREE.Vector2(-10, 20),
      new THREE.Vector2(10, 40),
    ));
    const downArrow = createArrow(new THREE.Box2(
      new THREE.Vector2(-10, -40),
      new THREE.Vector2(10, -20),
    ));
    list.scrollbar = { upArrow, downArrow } as never;
    list.pointer.set(0, 30);
    const upTarget = getLegacyGUIVRPointerSemanticTargets(() => [{ list }])
      .find((target) => target.name.endsWith('scroll up'));
    expect(upTarget).toBeDefined();
    upTarget!.activate();
    expect(list.scroll).toBe(0);

    list.pointer.set(0, -30);
    const downTarget = getLegacyGUIVRPointerSemanticTargets(() => [{ list }])
      .find((target) => target.name.endsWith('scroll down'));
    expect(downTarget).toBeDefined();
    downTarget!.activate();
    expect(list.scroll).toBe(5);
    expect(list.updateList).toHaveBeenCalledTimes(2);
  });
});

interface ReplyListHarness extends GUIListBoxVRPointerTargetSource {
  selectedItem?: GUIListBoxVRPointerRow;
  scroll: number;
  maxScroll: number;
  scrollWrapper?: { visible: boolean };
  scrollbar?: {
    upArrow: ReturnType<typeof createArrow>;
    downArrow: ReturnType<typeof createArrow>;
  };
  updateList: ReturnType<typeof jest.fn>;
  pointer: THREE.Vector2;
  getVRPointerTargetsAtPointer(): ReturnType<typeof getGUIListBoxVRPointerTargetsAtPointer>;
}

function createReplyList(onSelected: ReturnType<typeof jest.fn>): {
  readonly list: ReplyListHarness;
  readonly row: GUIListBoxVRPointerRow & { selected: boolean; node: unknown };
} {
  const pointer = new THREE.Vector2(0, 0);
  const row = {
    name: 'Reply 1',
    selected: false,
    node: { replyId: 'peragus-console' },
    disableSelection: false,
    box: new THREE.Box2(new THREE.Vector2(-10, -10), new THREE.Vector2(10, 10)),
    isVisible: () => true,
    isClickable: () => true,
    click: (): void => undefined,
  };
  const list = {
    name: 'LB_REPLIES',
    children: [row],
    pointer,
    scroll: 0,
    maxScroll: 0,
    updateList: jest.fn(),
    isVisible: () => true,
    isClickable: () => true,
    click: () => undefined,
    select: (selectedRow: GUIListBoxVRPointerRow) => {
      row.selected = selectedRow === row;
      list.selectedItem = selectedRow;
      onSelected((selectedRow as typeof row).node, selectedRow, list.children.indexOf(selectedRow as typeof row));
    },
    scrollUp: () => undefined,
    scrollDown: () => undefined,
    getVRPointerTargetsAtPointer: () => getGUIListBoxVRPointerTargetsAtPointer(list, () => list.pointer),
  } as ReplyListHarness;

  return { list, row };
}

function createArrow(box: THREE.Box2): { visible: boolean; userData: { box: THREE.Box2 } } {
  return { visible: true, userData: { box } };
}
