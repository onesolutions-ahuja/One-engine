// The sign-in refresh of a published app page also brings that app's runtime metadata
// (POST /auth/refresh?app=<APP>). Held here once, for the app shell's first draw.
import { readAppRuntimeMetadata, type AppRuntimeMetadata } from './appRuntimeMetadata';

let boot: unknown;
export function rememberBootAppRuntime(value: unknown): void { boot = value; }
/** The refresh's answer for this app, used once; later opens ask the server. */
export function takeBootAppRuntime(appId: string): AppRuntimeMetadata | undefined {
  const value = readAppRuntimeMetadata(boot, appId);
  if (value) boot = undefined;
  return value;
}
