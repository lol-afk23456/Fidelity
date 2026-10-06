import express, { type ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z, ZodError } from 'zod';
import { resolve } from 'node:path';
import { type DB, one } from './db.js';
import { AppError, baseUrl } from './domain.js';
import { requireOrigin, login } from './auth.js';
import { privateRoutes } from './routes.js';
import { publicRoutes, appleRoutes, iconPng } from './public-routes.js';
import { publicLogoHandler } from './branding.js';
import { WalletError } from './wallet/index.js';
export function createApp(db:DB){const app=express();app.disable('x-powered-by');if(process.env.TRUST_PROXY==='1')app.set('trust proxy',1);app.use(helmet({contentSecurityPolicy:process.env.NODE_ENV==='production'?{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:','https:'],connectSrc:["'self'"],frameAncestors:["'none'"],objectSrc:["'none'"]}}:false,strictTransportSecurity:process.env.NODE_ENV==='production'?undefined:false}));app.use(express.json({limit:'768kb'}));app.use(cookieParser());app.use('/api',(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
app.get('/api/health',(_req,res)=>{one(db,'SELECT 1');res.json({ok:true,demo:one(db,"SELECT value FROM metadata WHERE key='demo'")?.value==='true'});});
app.get('/api/branding/:programId.png',publicLogoHandler(db));
app.get('/api/wallet/icon.png',(_req,res)=>res.set('Content-Type','image/png').send(iconPng()));
app.use('/api/wallet/apple',appleRoutes(db));app.use('/api/public',publicRoutes(db));
app.use('/api',requireOrigin);
app.post('/api/auth/login',rateLimit({windowMs:15*60000,limit:15,skipSuccessfulRequests:true,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Troppi tentativi. Riprova tra 15 minuti.',code:'RATE_LIMITED'}}),(req,res)=>{const input=z.object({email:z.email().max(254),password:z.string().min(1).max(128)}).parse(req.body);res.json(login(db,input.email,input.password,req,res));});
app.use('/api',privateRoutes(db));app.use('/api',(_req,_res,next)=>next(new AppError(404,'Risorsa non trovata','NOT_FOUND')));
app.use(express.static(resolve('dist/client'),{index:false}));app.get('/{*path}',(_req,res,next)=>res.sendFile(resolve('dist/client/index.html'),error=>error?next(new AppError(404,'Interfaccia non compilata. Avvia il server Vite oppure esegui npm run build.')):undefined));
const errors:ErrorRequestHandler=(error,_req,res,_next)=>{if(error instanceof ZodError){res.status(400).json({error:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '),code:'VALIDATION_ERROR'});return;}if(error instanceof AppError){res.status(error.status).json({error:error.message,code:error.code});return;}if(error instanceof WalletError){res.status(error.statusCode).json({error:error.message,code:error.code});return;}if(String(error?.message).includes('UNIQUE constraint failed')){res.status(409).json({error:'Questo record esiste già. Verifica i dati inseriti.',code:'DUPLICATE'});return;}if(error?.type==='entity.parse.failed'||error?.type==='entity.too.large'){res.status(400).json({error:'Richiesta non valida',code:'INVALID_BODY'});return;}console.error('API internal error:',error?.name||'Error');res.status(500).json({error:'Si è verificato un errore. Riprova.',code:'INTERNAL_ERROR'});};app.use(errors);return app;}
export function validateRuntime(){if(process.env.NODE_ENV==='production'){let valid=false;try{const u=new URL(process.env.PUBLIC_BASE_URL||'');valid=u.protocol==='https:'&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash&&u.hostname!=='localhost'&&u.hostname!=='127.0.0.1';}catch{}if(!valid)throw new Error('PUBLIC_BASE_URL deve essere una origine HTTPS pubblica senza percorso, query o credenziali.');}}
