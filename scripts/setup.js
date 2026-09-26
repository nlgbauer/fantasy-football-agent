import { existsSync,readFileSync,writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if(existsSync('.env')){console.log('.env already exists; preserved.');}else{
  const content=readFileSync('.env.example','utf8').replace('ADMIN_TOKEN=','ADMIN_TOKEN='+randomBytes(32).toString('hex')).replace('INGRESS_TOKEN=','INGRESS_TOKEN='+randomBytes(32).toString('hex'));
  writeFileSync('.env',content,{mode:0o600});console.log('Created private .env with separate random tokens. Run npm start and use ADMIN_TOKEN from .env to connect to the review screen.');
}



