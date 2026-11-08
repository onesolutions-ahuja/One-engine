#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
if(process.argv[2]!=='browser-e2e')throw new Error('Use npm run test:backend/frontend/scripts');
if(!process.env.METADRIVE_SQL_TEST_DATABASE_URL)throw new Error('Browser E2E requires METADRIVE_SQL_TEST_DATABASE_URL');
const child=spawnSync(process.execPath,['apps/server/scripts/builder-browser-smoke.mjs'],{stdio:'inherit',env:process.env});
if(child.error)throw child.error;
process.exit(child.status??1);
