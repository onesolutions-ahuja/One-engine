import {cpSync,mkdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=new URL('./',import.meta.url);
const input=fileURLToPath(new URL('../src/system-support/migrations/',root));
const output=fileURLToPath(new URL('../dist-system/system-support/migrations/',root));
mkdirSync(output,{recursive:true});
cpSync(input,output,{recursive:true,force:true});
// Include independently owned connector scripts when running the compiled server.
const connectors=fileURLToPath(new URL('../../connectors/',root));
const outputConnectors=fileURLToPath(new URL('../dist-system/connector-scripts/',root));
// The connector bundle is optional in deployments that contain only the core
// applications. Keep the runtime's explicit missing-script error for any
// connector that is actually requested, rather than failing the entire build.
if(existsSync(connectors)){
  mkdirSync(outputConnectors,{recursive:true});
  cpSync(connectors,outputConnectors,{recursive:true,force:true});
}

// Package the standard-library Docker Mailserver IMAP/SMTP worker with releases.
const mailWorker=fileURLToPath(new URL('./mail-protocol.py',root));
const mailOutput=fileURLToPath(new URL('../dist-system/scripts/mail-protocol.py',root));
mkdirSync(fileURLToPath(new URL('../dist-system/scripts/',root)),{recursive:true});
cpSync(mailWorker,mailOutput,{force:true});
