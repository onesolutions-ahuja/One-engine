import { startSystemServer } from './server.js';
startSystemServer().catch((error: unknown) => {
  console.error('SQL system runtime failed startup:', error);
  process.exitCode = 1;
});
