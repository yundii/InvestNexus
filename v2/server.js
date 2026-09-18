import http from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {seed,command,portfolio,securities} from './domain/platform.js';
const root=fileURLToPath(new URL('.',import.meta.url));mkdirSync(root+'data',{recursive:true});const path=root+'data/platform.json';let state;try{state=JSON.parse(readFileSync(path));}catch(e){if(e.code!=='ENOENT')throw e;state=seed();}
const save=s=>{writeFileSync(path+'.tmp',JSON.stringify(s,null,2));renameSync(path+'.tmp',path);};save(state);
const listeners=new Set();
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(url.pathname==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write(': connected\n\n');listeners.add(res);req.on('close',()=>listeners.delete(res));return;}
 if(url.pathname==='/api/state'&&req.method==='GET')return json(200,{...state,portfolio:portfolio(state),securities});
 if(url.pathname==='/api/command'&&req.method==='POST'){try{let body='';for await(const chunk of req){body+=chunk; if(body.length>16000)throw new Error('Request too large');}const {action,data={},actor}=JSON.parse(body);const next=structuredClone(state);const result=command(next,action,data,actor);save(next);state=next;for(const client of listeners)client.write('data: updated\n\n');return json(200,{result});}catch(e){return json(400,{error:e.message});}}
 const files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};const file=files[url.pathname];if(!file)return json(404,{error:'Not found'});res.writeHead(200,{'Content-Type':file[1]});res.end(readFileSync(root+'public/'+file[0]));
}).listen(Number(process.env.PORT??4100),'127.0.0.1',()=>console.log('InvestNexus MVP: http://localhost:'+ (process.env.PORT??4100)));
