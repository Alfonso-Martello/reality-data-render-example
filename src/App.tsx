/*---------------------------------------------------------------------------------------------
 * Copyright (c) Bentley Systems, Incorporated. All rights reserved.
 * See LICENSE.md in the project root for license terms and full copyright notice.
 *--------------------------------------------------------------------------------------------*/

import "./App.scss";

import type { ScreenViewport } from "@itwin/core-frontend";
import { BlankConnection, IModelApp} from "@itwin/core-frontend";
import { FillCentered } from "@itwin/core-react";
import { ProgressLinear } from "@itwin/itwinui-react";
import {
  Viewer,
} from "@itwin/web-viewer-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { Auth } from "./Auth";
import { history } from "./history";
import { Cartographic } from "@itwin/core-common";
import { Range3d } from "@itwin/core-geometry";
import { RealityDataAccessClient } from "@itwin/reality-data-client";
import { RealityDataManager, RealityDataProps } from "./reality-data-manager";
import { UiFramework } from "@itwin/appui-react";
import { DebugWidgetProvider } from "./DebugWidget";
import { FrontendDevTools } from "@itwin/frontend-devtools";

const App: React.FC = () => {
  const [accessToken, setAccessToken] = React.useState<string>();
  const [realityDataId, setRealityDataId] = useState(process.env.IMJS_REALITY_DATA_ID);
  const [iTwinId, setITwinId] = useState(process.env.IMJS_ITWIN_ID);
  const [appLoaded, setAppLoaded] = useState<boolean>(false);

  const authClient = Auth.getClient();

  const login = useCallback(async () => {
    try {
      await authClient.signInSilent();
    } catch {
      await authClient.signIn();
    }
    setAccessToken(await authClient.getAccessToken());
  }, [authClient]);

  useEffect(() => {
    void login();
  }, [login]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has("iTwinId")) {
      setITwinId(urlParams.get("iTwinId") as string);
    }
    if (urlParams.has("realityDataId")) {
      setRealityDataId(urlParams.get("realityDataId") as string);
    }
  }, []);

  useEffect(() => {
    let url = `viewer?iTwinId=${iTwinId}`;

    if (realityDataId) {
      url = `${url}&realityDataId=${realityDataId}`;
    }
    history.push(url);
  }, [iTwinId, realityDataId]);

  const rdaClient = useMemo(() => {
    return new RealityDataAccessClient({
      baseUrl: `https://api.bentley.com/reality-management/reality-data`,
      authorizationClient: authClient
    });
  }, [authClient]);

  const getRealityDataManager =useCallback(() => {
    if (iTwinId && realityDataId) {
      return new RealityDataManager(iTwinId, realityDataId, rdaClient);
    }
  }, [iTwinId, realityDataId, rdaClient])

    // Load the reality data and overwrite the blank connection
    useEffect(() => {
      const initialize = async () => {
        // Only attempt render after the app has finished loading
        if (appLoaded) {
          const rdManager = await getRealityDataManager();
          if (iTwinId && realityDataId && (await authClient.getAccessToken()) && rdManager) {
            const rdProps: RealityDataProps = await rdManager.getRealityDataProps(await authClient.getAccessToken());
            // Only render if the reality data is geo-located
            if (
              rdProps.geoLocation &&
              rdProps.geoLocation.location &&
              rdProps.geoLocation.extents &&
              rdProps.realityData
            ) {
              const blankConnection = rdManager.getBlankConnection(rdProps);
              const iModelConnection = BlankConnection.create(blankConnection);
              const viewState = rdManager.getRealityDataViewState(rdProps, iModelConnection);
              // Replace the blank connection of the Viewer with another updated to match the reality model
              UiFramework.setIModelConnection(iModelConnection);
              if (viewState) {
                // Apply the reality data's view state to every viewport
                for (const viewport of IModelApp.viewManager) {
                  await rdManager.applyRealityDataViewState(viewState, viewport, rdProps);
                }
              }
            }
          }
        }
      };
      void initialize();
    }, [authClient, iTwinId, realityDataId, getRealityDataManager, appLoaded]);

  // Make sure the Viewer is loaded before manipulating
  const onIModelAppInit = async () => {
    // Init dev tools
    await FrontendDevTools.initialize();
    // Listen for the screen viewport to open for the first time
    IModelApp.viewManager.onViewOpen.addOnce((vp: ScreenViewport) => {
      // Listen for the viewport and viewstate to synchronize for the first time
      vp.onViewChanged.addOnce(() => {
        setAppLoaded(true);
      });
    });
  };

  return (
    <div className="viewer-container">
      {!accessToken && (
        <FillCentered>
          <div className="signin-content">
            <ProgressLinear indeterminate={true} labels={["Signing in..."]} />
          </div>
        </FillCentered>
      )}
      <Viewer
        iTwinId={iTwinId ?? ""}
        authClient={authClient}
        // Default location to Exton campus, we will be overwriting location and extents anyways
        location={Cartographic.fromDegrees({ longitude: -75.686694, latitude: 40.065757, height: 0 })}
        extents={new Range3d(-1000, -1000, -100, 1000, 1000, 100)}
        onIModelAppInit={onIModelAppInit}
        realityDataAccess={rdaClient}
        uiProviders={[
          new DebugWidgetProvider()
        ]}
        enablePerformanceMonitors={true} // see description in the README (https://www.npmjs.com/package/@itwin/web-viewer-react)
      />
    </div>
  );
};

export default App;
