import React from "react";
import { KotORModal } from "@/apps/game/components/modal/modal";
import { useApp } from "@/apps/game/context/AppContext";
import { ApplicationEnvironment } from "@/apps/game/KotOR";
import GrantAccessModalContent from "@/apps/common/components/grantAccess/GrantAccessModalContent";
import * as KotOR from "@/apps/game/KotOR";

export const ModalGrantAccess = () => {
  const appContext = useApp();
  const [appState] = appContext.appState;
  const [gameKey] = appContext.gameKey;

  const onCancel = (e: React.MouseEvent<HTMLButtonElement>) => {
    KotOR.EventManager.FireEvent('grant-access.cancel');
    console.log("File System: access denied");
    alert("You must grant access to your local game directory to continue.");
    window.close();
  }
  
  const showBrowserDirectoryPicker = async () => {
    let handle: FileSystemDirectoryHandle;
    try{
      handle = await window.showDirectoryPicker({
        mode: "readwrite"
      });
    }catch(e: any){
      // Dismissing the picker rejects with AbortError. Without this catch it
      // escapes as an unhandled rejection and trips the dev-server overlay.
      if(e?.name != 'AbortError'){
        console.error(e);
      }
      return;
    }
    if(!handle) return;

    if (!(await appState.validateDirectoryHandle(handle))) {
      return;
    }

    KotOR.EventManager.FireEvent('grant-access.grant');
    return handle;
  }

  const showElectronDirectoryPicker = async () => {
    try{
      const directory = await(window as any).electron.locate_game_directory(appState.appProfile);
      if(directory){
        appState.attachDirectoryPath(directory);
        return directory;
      }
    }catch(e){
      appState.attachDirectoryPath('');
      console.error(e);
      alert("Unable to access your local game directory. Please try again.");
    }
    return;
  }

  const onOk = async (e: React.MouseEvent<HTMLButtonElement>) => {
    console.log("File System: access granted");

    // Electron
    if(appState.env == ApplicationEnvironment.ELECTRON){
      await showElectronDirectoryPicker();
      return;
    }

    // Browser
    if(appState.env == ApplicationEnvironment.BROWSER){
      const handle = await showBrowserDirectoryPicker();
      if(!handle){
        console.log("File System: access denied");
        alert("Unable to access your local game directory. Please try again.");
        return;
      }
      appState.attachDirectoryHandle(handle);
    }
  }

  return (
    <KotORModal 
      title="Grant Access" 
      show={true} 
      className="forge-style-modal grant-access-modal"
      onCancel={onCancel} 
      onOk={onOk} 
      cancelText="QUIT" 
      okText="GRANT ACCESS"
    >
      <GrantAccessModalContent gameKey={gameKey} />
    </KotORModal>
  );
};
