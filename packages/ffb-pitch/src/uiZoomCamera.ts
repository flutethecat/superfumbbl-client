/**
 * Settings reflow (Sol r3): UI zoom is the webview's page zoom, which makes every CSS px bigger (devicePixelRatio
 * rises by the same factor). The pitch camera's scale is in CSS px, so a camera the coach zoomed in would grow with
 * the interface. These helpers keep the camera's PHYSICAL scale and the world point at the view centre across a UI
 * zoom change: the CSS scale is multiplied by fromZoom / toZoom. (An untouched camera at the fit simply refits.)
 */
export interface CameraView { scale: number; x: number; y: number }
export interface WorldPoint { x: number; y: number }

/** The world point under the centre of a `screenW` x `screenH` (CSS px) view. */
export function viewCenterWorld(view: CameraView, screenW: number, screenH: number): WorldPoint {
  return { x: (screenW / 2 - view.x) / view.scale, y: (screenH / 2 - view.y) / view.scale };
}

/** The camera that shows `center` at the middle of the new view with the same physical scale after a UI zoom change. */
export function compensateUiZoom(center: WorldPoint, cssScale: number, fromZoom: number, toZoom: number, screenW: number, screenH: number): CameraView {
  const scale = cssScale * (fromZoom / toZoom);
  return { scale, x: screenW / 2 - center.x * scale, y: screenH / 2 - center.y * scale };
}

/** Sol r4: a camera transform recorded on the OLD screen (a cinematic's saved camera, a focus tween's start, a kick
 *  follow's saved pan), moved to the new screen with the same physical scale and the same world point at its centre. */
export function rebaseCameraTransform(t: CameraView, oldScreen: { w: number; h: number }, newScreen: { w: number; h: number }, fromZoom: number, toZoom: number): CameraView {
  return compensateUiZoom(viewCenterWorld(t, oldScreen.w, oldScreen.h), t.scale, fromZoom, toZoom, newScreen.w, newScreen.h);
}
