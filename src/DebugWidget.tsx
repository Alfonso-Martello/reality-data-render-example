/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/

import { FrontstageReadyEventArgs, StagePanelLocation, StagePanelSection, UiFramework, UiItemsProvider, Widget, WidgetState, useActiveIModelConnection, useActiveViewport } from "@itwin/appui-react";
import { Alert, Button } from "@itwin/itwinui-react";
import { useState } from "react";
import { RangeDecoration } from "./range-decorator";
import { IModelApp } from "@itwin/core-frontend";
import { ToggleSelectedViewFrustumTool } from "@itwin/frontend-devtools";
import { MultiViewportFrontstage } from "./MultiViewportFrontstageProvider";

const DebugWidget = () => {
    const [extentsVisible, setExtentsVisible] = useState<boolean>(false);
    const viewport = useActiveViewport();

    const iModelConnection = useActiveIModelConnection();

    return (
        <div>
            <Alert type="informational">
                Zoom in to render the reality data. Try uncommenting the other view state approaches in the `applyRealityDataViewState` function to modify the behavior. Click the Extents Box button to visualize the reality data extents. Click the Camera Decorator button to visualize the camera in a second viewport. Refresh to reset the app.
            </Alert>
            <Button
                onClick={() => {
                    if (!iModelConnection) return;
                    if (!extentsVisible) {
                        // At this point, the extents of the blank connection are the extents of the reality data
                        RangeDecoration.getOrCreate(iModelConnection.projectExtents);
                        setExtentsVisible(true);
                    } else {
                        RangeDecoration.dispose();
                        setExtentsVisible(false);
                    }
                }}
            >
                Extents Box
            </Button>
            <Button
                onClick={async () => {
                    if (!viewport) return;
                    UiFramework.frontstages.addFrontstageProvider(new MultiViewportFrontstage(viewport.view));
                    UiFramework.frontstages.setActiveFrontstage("MultiViewportFrontstage");
                    UiFramework.frontstages.onFrontstageReadyEvent.addOnce((event: FrontstageReadyEventArgs) => {
                        const { id } = event.frontstageDef;
                        if ( id === "MultiViewportFrontstage") {
                            if (viewport && !viewport.isCameraOn) {
                                viewport.turnCameraOn();
                            }
                            void IModelApp.tools.run(ToggleSelectedViewFrustumTool.toolId);
                        }
                    })
                }}
            >
                Camera Decorator
            </Button>
        </div>
    )
}

export class DebugWidgetProvider implements UiItemsProvider {
    public readonly id: string = "CustomWidgetsProvider";
  
    public provideWidgets(_stageId: string, _stageUsage: string, location: StagePanelLocation, _section?: StagePanelSection): ReadonlyArray<Widget> {
        const widgets: Widget[] = [];
        if (location === StagePanelLocation.Bottom) {
            widgets.push({
                id: "UniqueWidgetIdDebug",
                label: "Debug Widget",
                defaultState: WidgetState.Open,
                content: (
                    <DebugWidget />
                ),
            });
        }
        return widgets;
    };
  }
  