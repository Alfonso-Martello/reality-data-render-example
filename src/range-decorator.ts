/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { AxisAlignedBox3d, ColorDef, LinePixels } from "@itwin/core-common";
import { DecorateContext, GraphicType, IModelApp, ViewportDecorator } from "@itwin/core-frontend";
import { Range3d } from "@itwin/core-geometry";


export class RangeDecoration implements ViewportDecorator {
  public static _decorator?: RangeDecoration;
  protected _removeDecorationListener?: () => void;
  protected _extents: AxisAlignedBox3d;

  public constructor(range: Range3d) {
    RangeDecoration._decorator = this;
    this._extents = range;
    this.updateDecorationListener(true);
  }

  protected stop(): void { this.updateDecorationListener(false); }

  protected updateDecorationListener(add: boolean): void {
    if (this._removeDecorationListener) {
      if (!add) {
        this._removeDecorationListener();
        this._removeDecorationListener = undefined;
      }
    } else if (add) {
      if (!this._removeDecorationListener)
        this._removeDecorationListener = IModelApp.viewManager.addDecorator(this);
    }
  }

  public static get isActive(): boolean {
    return undefined !== RangeDecoration._decorator;
  }

  public updateExtents(newExtents: Range3d) {
    this._extents = newExtents;
  }

  /** This will allow the render system to cache and reuse the decorations created by this decorator's decorate() method. */
  public readonly useCachedDecorations = true;

  public decorate(context: DecorateContext): void {
    const vp = context.viewport;
    if (!vp.view.isSpatialView())
      return;

    const builderAccVis = context.createGraphicBuilder(GraphicType.WorldDecoration);
    const builderAccHid = context.createGraphicBuilder(GraphicType.WorldOverlay);
    const colorAccVis = ColorDef.white.adjustedForContrast(context.viewport.view.backgroundColor);
    const colorAccHid = colorAccVis.withAlpha(100);

    builderAccVis.setSymbology(colorAccVis, ColorDef.black, 3);
    builderAccHid.setSymbology(colorAccHid, ColorDef.black, 1, LinePixels.Code2);

    builderAccVis.addRangeBox(this._extents);
    builderAccHid.addRangeBox(this._extents);

    context.addDecorationFromBuilder(builderAccVis);
    context.addDecorationFromBuilder(builderAccHid);
  }

  public static getOrCreate(range: Range3d): RangeDecoration {
    return RangeDecoration._decorator?? new RangeDecoration(range);
  }

  public static dispose() {
    // The FireEmitters collectively own the textures and will dispose of them when no longer required.
    const dec = RangeDecoration._decorator;
    dec?.stop();
    RangeDecoration._decorator = undefined;
    if (!dec)
      return;

    IModelApp.viewManager.dropDecorator(dec);
  }
}