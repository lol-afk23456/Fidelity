import 'dotenv/config';
import { openDb, one, run, id, now, passwordHash } from '../server/db.js';
import { z } from 'zod';
const input=z.object({email:z.email().toLowerCase(),password:z.string().min(12).max(128),name:z.string().min(2).max(120)}).safeParse({email:process.env.FIDELITY_ADMIN_EMAIL,password:process.env.FIDELITY_ADMIN_PASSWORD,name:process.env.FIDELITY_ADMIN_NAME||'Amministratore agenzia'});
if(!input.success){console.error('Imposta FIDELITY_ADMIN_EMAIL e FIDELITY_ADMIN_PASSWORD (almeno 12 caratteri). FIDELITY_ADMIN_NAME è opzionale.');process.exit(1);}
const db=openDb();try{if(one(db,'SELECT id FROM users WHERE email=?',input.data.email))throw new Error('Email già presente: nessuna modifica effettuata.');run(db,'INSERT INTO users(id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?)',id(),input.data.name,input.data.email,passwordHash(input.data.password),'agency',now());console.log('Amministratore creato. Accedi con le credenziali impostate.');}catch(error){console.error(error instanceof Error?error.message:'Bootstrap fallito');process.exitCode=1;}finally{db.close();}
