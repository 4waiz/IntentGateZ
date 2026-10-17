/**
 * Hooks for the scripted demo-video recorder (submission/video/record.mjs). Inert unless the URL
 * carries ?capture (exposes store actions and the camera on window) or ?cinema (city only, no UI).
 */
const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;

export const CAPTURE = !!params?.has("capture");
export const CINEMA = !!params?.has("cinema");

export function exposeForCapture(name: string, value: unknown): void {
  if (CAPTURE) (window as unknown as Record<string, unknown>)[name] = value;
}
