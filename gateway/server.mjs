import {readFileSync} from 'node:fs';
import {createGateway} from './egress.mjs';
const token=process.env.FRESH402_GATEWAY_TOKEN_FILE?readFileSync(process.env.FRESH402_GATEWAY_TOKEN_FILE,'utf8').trim():process.env.FRESH402_GATEWAY_TOKEN;
const server=await createGateway({token,port:Number(process.env.PORT??8080),host:process.env.GATEWAY_LISTEN_HOST??'127.0.0.1',maxActive:Number(process.env.GATEWAY_MAX_ACTIVE??4)});
console.log('Authenticated HTTPS-read gateway started. Target URLs, credentials and page contents are not logged.');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
