/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/

import { BentleyError, JsonUtils } from "@itwin/core-bentley";
import {
  Cartographic,
  ContextRealityModelProps,
  EcefLocation,
  EcefLocationProps,
  RealityDataFormat,
  RealityDataProvider,
  RealityDataSourceKey
} from "@itwin/core-common";
import {
  BlankConnectionProps,
  FitViewTool,
  IModelApp,
  IModelConnection,
  RealityModelTileUtils,
  ScreenViewport,
  SpatialViewState
} from "@itwin/core-frontend";
import { Matrix3d, Range3d, StandardViewIndex, Transform, Vector3d, YawPitchRollAngles } from "@itwin/core-geometry";
import {
  ALong,
  CRSManager,
  Downloader,
  DownloaderXhr,
  OPCReader,
  OnlineEngine,
  OrbitGtBounds,
  PageCachedFile,
  PointCloudReader,
  UrlFS
} from "@itwin/core-orbitgt";
import { toaster } from "@itwin/itwinui-react";
import { ITwinRealityData, RealityDataAccessClient } from "@itwin/reality-data-client";

interface GeoLocation {
  location?: Cartographic | EcefLocationProps;
  extents?: Range3d;
}

export interface RealityDataProps {
  realityData?: ContextRealityModelProps;
  geoLocation?: GeoLocation;
}

export class RealityDataManager {
  public constructor(
    private _iTwinId: string,
    private _realityDataId: string,
    private _rdaClient: RealityDataAccessClient
  ) {}

  /**
   * Query the reality data, calculate the location of the reality model, and convert the reality data into a format that the viewer can display
   * @param accessToken
   * @returns A RealityDataProps object
   */
  public async getRealityDataProps(accessToken: string): Promise<RealityDataProps> {
    // Get reality data
    const realityData = await this.fetchRealityData(accessToken);
    if (!realityData) {
      return {};
    }
    // Convert ITwinRealityData to ContextRealityModelProps so the reality data can be attached to the viewport
    const name = realityData.displayName ? realityData.displayName : realityData.id;
    const realityDataSourceKey: RealityDataSourceKey = {
      provider: RealityDataProvider.ContextShare,
      format: realityData.type === "OPC" ? RealityDataFormat.OPC : RealityDataFormat.ThreeDTile,
      id: realityData.id
    };
    const visualizationProps = {
      rdSourceKey: realityDataSourceKey,
      tilesetUrl: (await realityData.getBlobUrl(accessToken, "", false)).toString(),
      name,
      description: realityData.description,
      realityDataId: realityData.id
    };
    // Get geo-location info by parsing root document
    const geoLocation = await this.getRealityDataGeoLocation(accessToken, realityData);
    return {
      realityData: visualizationProps,
      geoLocation
    };
  }

  /**
   * Fetch reality data and handle any errors
   * @param accessToken
   * @returns ITwinRealityData or undefined if an error occurs
   */
  private async fetchRealityData(accessToken: string): Promise<ITwinRealityData | undefined> {
    // Get reality data
    let realityData = undefined;
    try {
      realityData = await this._rdaClient.getRealityData(accessToken, this._iTwinId, this._realityDataId);
    } catch (error) {
      if (error && typeof error === "object" && Object.hasOwn(error, "errorNumber")) {
        const bentleyError = error as BentleyError;
        if (bentleyError.errorNumber === 401) {
          toaster.negative("Unauthorized", {
            type: "persisting"
          });
        }
        if (bentleyError.errorNumber === 404) {
          toaster.negative("NotFound", {
            type: "persisting"
          });
        }
        if (bentleyError.errorNumber === 422) {
          toaster.negative("SomethingWentWrong", {
            type: "persisting"
          });
        }
      } else {
        toaster.negative("SomethingWentWrongUnexpected", {
          type: "persisting"
        });
      }
      return undefined;
    }
    return realityData;
  }

  /**
   * Query and read the reality data's root document to get geo-location of the reality model
   * @param accessToken
   * @param realityData The ITwinRealityData object returned from the reality management client
   * @returns A GeoLocation object (location and extents) or undefined if an error occurs
   */
  private async getRealityDataGeoLocation(
    accessToken: string,
    realityData: ITwinRealityData
  ): Promise<GeoLocation | undefined> {
    const name = realityData.displayName ? realityData.displayName : realityData.id;
    const rootDocName = realityData.rootDocument ? realityData.rootDocument : `${name}.json`;
    const rootDocUrl = (await realityData.getBlobUrl(accessToken, rootDocName)).toString();
    if (realityData.type && realityData.type.toUpperCase() === "OPC") {
      return await this.realityModelFromOPC(rootDocUrl);
    } else if (
      realityData.type &&
      (realityData.type.toUpperCase() === "CESIUM3DTILES" ||
        realityData.type.toUpperCase() === "PNTS" ||
        realityData.type.toUpperCase() === "REALITYMESH3DTILES" ||
        realityData.type.toUpperCase() === "TERRAIN3DTILES")
    ) {
      // Query root document
      const rootDocResponse = await fetch(rootDocUrl, {
        method: "GET"
      });
      if (!rootDocResponse.ok) {
        toaster.negative("RootDocumentError", {
          type: "persisting"
        });
        return undefined;
      }
      const rootDoc = await rootDocResponse.json();
      return await this.parseRootDocument(rootDoc);
    } else {
      // Only 5 types of reality data are currently supported for visualization in the Viewer
      toaster.negative("NotSupported", {
        type: "persisting"
      });
      return undefined;
    }
  }

  /**
   * Create a blank connection with the location and extents of the reality model
   * @param realityDataProps
   * @returns BlankConnectionProps set to the location and extents of the reality model
   */
  public getBlankConnection(realityDataProps: RealityDataProps) {
    const blankConnectionProps: BlankConnectionProps = {
      // Give this connection an appropriate name
      name: realityDataProps.realityData?.name !== undefined ? realityDataProps.realityData?.name : "Reality Data",
      // Center the connection near the center of the reality model
      location:
        realityDataProps.geoLocation && realityDataProps.geoLocation.location
          ? realityDataProps.geoLocation.location
          : Cartographic.fromDegrees({ longitude: 0, latitude: 0, height: 0 }),
      // The volume of interest, in meters, centered around `location`
      extents:
        realityDataProps.geoLocation && realityDataProps.geoLocation.extents
          ? realityDataProps.geoLocation.extents
          : Range3d.createNull(),
      iTwinId: this._iTwinId
    };
    return blankConnectionProps;
  }

  /**
   * Create a new SpatialViewState based on the reality data and attach the reality model to the viewState
   * @param realityDataProps
   * @param connection
   * @returns A new SpatialViewState with the reality model attached
   */
  public getRealityDataViewState(realityDataProps: RealityDataProps, connection: IModelConnection) {
    // This should be the extents of the reality data
    const extents = connection.projectExtents;
    // An initial rotation for the view state
    const rotation = Matrix3d.createStandardWorldToView(StandardViewIndex.Iso);

    const realityDataViewState = SpatialViewState.createBlank(
      connection,
      extents.low,
      extents.high.minus(extents.low),
      rotation
    );
    if (realityDataProps && realityDataProps.realityData) {
      realityDataViewState.displayStyle.attachRealityModel(realityDataProps.realityData);
    }
    return realityDataViewState;
  }

  /**
   * Apply a view state to a viewport and setup an initial view with the camera
   * @param viewState The SpatialViewState created based on the reality data
   * @param viewport Any existing ScreenViewport
   * @param rdProps The reality data props used to setup the camera's view
   */
  public async applyRealityDataViewState(
    viewState: SpatialViewState,
    viewport: ScreenViewport,
    rdProps: RealityDataProps
  ) {
    // Apply the view state to the viewport
    viewport.changeView(viewState);
    // Turn camera on for debugging purposes
    if (viewport && !viewport.isCameraOn && viewState.isCameraValid) {
      viewport.turnCameraOn();
    }
    // Do a fit view - quick way to show no-rendering behavior
    await IModelApp.tools.run(FitViewTool.toolId, viewport, true, false);
    // LookAtVolume - causes no-rendering behavior on smaller screen sizes (as the screen/viewer size shrinks, the view seems to zoom out). Try reducing the browser to half its usual size.
    // viewState.lookAtVolume(rdProps.geoLocation!.extents!)
    // Work-around for rendering issue, keep the eyepoint within the bounds of the reality data's extents
    // const upVector = new Vector3d(0.0, 0.0, 1.0);
    // const eyePoint = { x: rdProps.geoLocation!.extents!.xHigh, y: rdProps.geoLocation!.extents!.yHigh, z: rdProps.geoLocation!.extents!.zHigh };
    // viewState.lookAt({ eyePoint, targetPoint: rdProps.geoLocation!.extents!.center, upVector });
  }

  /**
   * Parse root document for location and extents data.
   * This function comes almost directly from the publicly available
   * reality-capture web-app.
   * @param rootDoc The root document file as a json object. Each type of reality data can have a unique root document layout, so the type is any.
   * @returns
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async parseRootDocument(rootDoc: any): Promise<GeoLocation | undefined> {
    const worldRange = new Range3d();
    let location: Cartographic | EcefLocationProps = Cartographic.createZero();
    if (rootDoc.root === undefined) {
      toaster.negative("RootDocMissingRootProperty", {
        type: "persisting"
      });
      return undefined;
    }
    if (rootDoc.root.boundingVolume.region) {
      const region = JsonUtils.asArray(rootDoc.root.boundingVolume.region);
      if (!region) {
        // error, no valid region
        toaster.negative("RootDocMissingRegionProperty", {
          type: "persisting"
        });
        return undefined;
      }
      const ecefLow = Cartographic.fromRadians({
        longitude: region[0],
        latitude: region[1],
        height: region[4]
      }).toEcef();
      const ecefHigh = Cartographic.fromRadians({
        longitude: region[2],
        latitude: region[3],
        height: region[5]
      }).toEcef();
      const ecefRange = Range3d.create(ecefLow, ecefHigh);
      const cartoCenter = Cartographic.fromRadians({
        longitude: (region[0] + region[2]) / 2.0,
        latitude: (region[1] + region[3]) / 2.0,
        height: (region[4] + region[5]) / 2.0
      });
      location = cartoCenter;
      const ecefLocation = EcefLocation.createFromCartographicOrigin(cartoCenter);
      const ecefToWorld = ecefLocation.getTransform().inverse()!;
      worldRange.extendRange(Range3d.fromJSON(ecefToWorld.multiplyRange(ecefRange)));
    } else {
      const worldToEcefTransform =
        RealityModelTileUtils.transformFromJson(rootDoc.root.transform) ?? Transform.createIdentity();

      const range = RealityModelTileUtils.rangeFromBoundingVolume(rootDoc.root.boundingVolume)!;

      const ecefRange = worldToEcefTransform.multiplyRange(range.range); // range in model -> range in ecef
      const ecefCenter = worldToEcefTransform.multiplyPoint3d(range.range.center); // range center in model -> range center in ecef
      const cartoCenter = Cartographic.fromEcef(ecefCenter); // ecef center to cartographic center
      const isNotNearEarthSurface = cartoCenter && cartoCenter.height < -5000; // 5 km under ground!
      const earthCenterToRangeCenterRayLength = range.range.center.magnitude();

      if (
        worldToEcefTransform.matrix.isIdentity &&
        (earthCenterToRangeCenterRayLength < 1.0e5 || isNotNearEarthSurface)
      ) {
        worldRange.extendRange(Range3d.fromJSON(ecefRange));
        const centerOfEarth: EcefLocationProps = {
          origin: { x: 0.0, y: 0.0, z: 0.0 },
          orientation: { yaw: 0.0, pitch: 0.0, roll: 0.0 }
        };
        location = centerOfEarth;
      } else {
        let ecefLocation: EcefLocation;
        const locationOrientation = YawPitchRollAngles.tryFromTransform(worldToEcefTransform);
        // Fix Bug 445630: [RDV][Regression] Orientation of georeferenced Reality Mesh is wrong.
        // Use json.root.transform only if defined and not identity -> otherwise will use a transform computed from cartographic center.
        if (
          !worldToEcefTransform.matrix.isIdentity &&
          locationOrientation !== undefined &&
          locationOrientation.angles !== undefined
        ) {
          const xVector: Vector3d = Vector3d.createFrom(worldToEcefTransform.matrix.columnX());
          const yVector: Vector3d = Vector3d.createFrom(worldToEcefTransform.matrix.columnY());
          ecefLocation = new EcefLocation({
            origin: locationOrientation.origin,
            xVector,
            yVector,
            orientation: locationOrientation.angles
          });
        } else {
          // For georeferenced Reality Meshes, its origin is translated to model origin (0,0,0).
          // Apply range center to translate it back to its original position.
          const worldCenter = !worldToEcefTransform.matrix.isIdentity ? range.range.center : undefined;
          ecefLocation = EcefLocation.createFromCartographicOrigin(cartoCenter!, worldCenter);
        }
        location = ecefLocation;
        const ecefToWorld = ecefLocation.getTransform().inverse()!;
        worldRange.extendRange(Range3d.fromJSON(ecefToWorld.multiplyRange(ecefRange)));
      }
      return { location, extents: worldRange };
    }
  }

  /**
   * Extract reality data info from an OPC file.
   * This function is taken directly from the publicly available reality-capture repository.
   * @param blobFileURL the BlobSasUrl to the file.
   * @returns
   */
  private async realityModelFromOPC(blobFileURL: string): Promise<GeoLocation | undefined> {
    let worldRange = new Range3d();
    let location: Cartographic | EcefLocationProps;

    if (Downloader.INSTANCE == null) {
      Downloader.INSTANCE = new DownloaderXhr();
    }

    if (CRSManager.ENGINE == null) {
      CRSManager.ENGINE = await OnlineEngine.create();
    }

    const urlFS: UrlFS = new UrlFS();
    // wrap a caching layer (16 MB) around the blob file
    const blobFileSize: ALong = await urlFS.getFileLength(blobFileURL);
    const blobFile: PageCachedFile = new PageCachedFile(urlFS, blobFileURL, blobFileSize, 128 * 1024, 128);
    const fileReader: PointCloudReader = await OPCReader.openFile(blobFile, blobFileURL, true);

    const bounds = fileReader.getFileBounds();
    worldRange = Range3d.createXYZXYZ(
      bounds.getMinX(),
      bounds.getMinY(),
      bounds.getMinZ(),
      bounds.getMaxX(),
      bounds.getMaxY(),
      bounds.getMaxZ()
    );
    const fileCrs = fileReader.getFileCRS();
    if (fileCrs) {
      await CRSManager.ENGINE.prepareForArea(fileCrs, bounds);
      const wgs84ECEFCrs = "4978";
      await CRSManager.ENGINE.prepareForArea(wgs84ECEFCrs, new OrbitGtBounds());

      const ecefBounds = CRSManager.transformBounds(bounds, fileCrs, wgs84ECEFCrs);
      const ecefRange = Range3d.createXYZXYZ(
        ecefBounds.getMinX(),
        ecefBounds.getMinY(),
        ecefBounds.getMinZ(),
        ecefBounds.getMaxX(),
        ecefBounds.getMaxY(),
        ecefBounds.getMaxZ()
      );
      const ecefCenter = ecefRange.localXYZToWorld(0.5, 0.5, 0.5)!;
      const cartoCenter = Cartographic.fromEcef(ecefCenter)!;
      cartoCenter.height = 0;
      const ecefLocation = EcefLocation.createFromCartographicOrigin(cartoCenter);
      location = ecefLocation;
      const ecefToWorld = ecefLocation.getTransform().inverse()!;
      worldRange = ecefToWorld.multiplyRange(ecefRange);
    } else {
      // NoGCS case
      const centerOfEarth: EcefLocationProps = {
        origin: { x: 0.0, y: 0.0, z: 0.0 },
        orientation: { yaw: 0.0, pitch: 0.0, roll: 0.0 }
      };
      location = centerOfEarth;
    }
    return { location, extents: worldRange };
  }
}
