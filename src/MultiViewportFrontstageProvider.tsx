/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/

import React from "react";
import {
  BasicNavigationWidget,
  ContentGroup,
  FrontstageProvider,
  IModelViewportControl,
  UiFramework
} from "@itwin/appui-react";
import { ViewStateProp } from "@itwin/imodel-components-react";

/**
 *  See https://www.itwinjs.org/sandboxes/iTwinPlatform/Multiple%20Viewports
 *  for relevant sample.
 */

export class MultiViewportFrontstage extends FrontstageProvider {
  // constants
  public id = "MultiViewportFrontstage";
  public static MAIN_CONTENT_ID = "MultiViewportFrontstage";
  public static DEFAULT_NAVIGATION_WIDGET_KEY = "DefaultNavigationWidget";
  public static DEFAULT_MANIPULATION_WIDGET_KEY = "DefaultNavigationWidget";
  // Content group for all layouts
  private _contentGroup: ContentGroup;

  constructor(viewState?: ViewStateProp) {
    super();
    const connection = UiFramework.getIModelConnection();

    // Create the content group.
    this._contentGroup = new ContentGroup({
      id: "MultiViewportContentGroup",
      layout: {
        id: "TwoHalvesHorizontal",
        verticalSplit: { id: "TwoHalvesHorizontalSplit", percentage: 0.50, left: 0, right: 1 },
      },
      contents: [
        {
          id: "MultiViewport1",
          classId: IModelViewportControl,
          applicationData: {
            viewState,
            iModelConnection: connection,
          },
        },
        {
          id: "MultiViewport2",
          classId: IModelViewportControl,
          applicationData: {
            viewState,
            iModelConnection: connection,
          },
        },
      ],
    });
  }

  /** Define the Frontstage properties */
  public frontstageConfig() {
    return {
      id: MultiViewportFrontstage.MAIN_CONTENT_ID,
      version: 1,
      contentGroup: this._contentGroup,

      viewNavigation: {
        content: <BasicNavigationWidget />,
        id: MultiViewportFrontstage.DEFAULT_NAVIGATION_WIDGET_KEY,
      },

      bottomPanel: {},
    };
  }
}
