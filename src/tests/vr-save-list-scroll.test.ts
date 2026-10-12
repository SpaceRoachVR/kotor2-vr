import { afterEach, describe, expect, jest, test } from '@jest/globals';
jest.mock('@/GameState', () => ({ GameState: { loadingModule: false } }));
jest.mock('@/gui', () => ({ GameMenu: class {} }));
jest.mock('@/loaders', () => ({ TextureLoader: {} }));
jest.mock('@/module', () => ({ Module: class {} }));
jest.mock('@/engine/SaveGame', () => ({ SaveGame: class {} }));
jest.mock('@/game/kotor/gui/GUISaveGameItem', () => ({ GUISaveGameItem: class {} }));
jest.mock('@/game/tsl/gui/GUISaveGameItem', () => ({ GUISaveGameItem: class {} }));
jest.mock('@/game/kotor/KOTOR', () => jest.requireActual('@/game/kotor/menu/MenuSaveLoad'));
import { GameState } from '@/GameState';
import { MenuSaveLoad } from '@/game/kotor/menu/MenuSaveLoad';
import { MenuSaveLoad as TSLMenuSaveLoad } from '@/game/tsl/menu/MenuSaveLoad';
import { MenuSaveLoadMode } from '@/enums/gui/MenuSaveLoadMode';

describe('VR load-game list scrolling', () => {
  const wasLoading = GameState.loadingModule;
  afterEach(() => { GameState.loadingModule = wasLoading; });

  function fixture() {
    GameState.loadingModule = false;
    return {
      bVisible: true,
      mode: MenuSaveLoadMode.LOADGAME,
      LB_GAMES: { isVisible: () => true, maxScroll: 500, scrollUp: jest.fn(), scrollDown: jest.fn() },
    };
  }

  test('both game variants scroll in the requested direction without navigating selection', () => {
    for (const prototype of [MenuSaveLoad.prototype, TSLMenuSaveLoad.prototype]) {
      const menu = fixture();
      prototype.scrollVRList.call(menu as unknown as MenuSaveLoad, 'down');
      prototype.scrollVRList.call(menu as unknown as MenuSaveLoad, 'up');
      expect(menu.LB_GAMES.scrollDown).toHaveBeenCalledTimes(1);
      expect(menu.LB_GAMES.scrollUp).toHaveBeenCalledTimes(1);
    }
  });

  test('refuses scrolling when hidden, saving, loading, or lacking a scrollable list', () => {
    const menu = fixture();
    const run = () => MenuSaveLoad.prototype.scrollVRList.call(menu as unknown as MenuSaveLoad, 'down');
    menu.bVisible = false; run();
    menu.bVisible = true; menu.mode = MenuSaveLoadMode.SAVEGAME; run();
    menu.mode = MenuSaveLoadMode.LOADGAME; GameState.loadingModule = true; run();
    GameState.loadingModule = false; menu.LB_GAMES.isVisible = () => false; run();
    menu.LB_GAMES.isVisible = () => true;
    for (const maxScroll of [0, -1, NaN, Infinity]) { menu.LB_GAMES.maxScroll = maxScroll; run(); }
    expect(menu.LB_GAMES.scrollDown).not.toHaveBeenCalled();
    (menu as unknown as { LB_GAMES: undefined }).LB_GAMES = undefined; run();
  });
});
