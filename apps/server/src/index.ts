// SQL-only server entrypoint. All runtime state is loaded through system-files.
export { createSystemServer, startSystemServer } from './system-support/server.js';
import { startSystemServer } from './system-support/server.js';
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startSystemServer().catch((error: unknown) => {
    console.error('MetaDrive SQL startup failed:', error);
    process.exitCode = 1;
  });
}
