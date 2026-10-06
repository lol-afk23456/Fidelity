import 'dotenv/config';
import { openDb, one, run, id, now, passwordHash } from '../server/db.js';
import { createMember, transact } from '../server/domain.js';
if(process.env.NODE_ENV==='production'){console.error('Il seed dimostrativo è disabilitato in produzione.');process.exit(1);}
const db=openDb();
try{
if(one(db,'SELECT count(*) n FROM users')!.n>0)throw new Error('Il database contiene già utenti: seed annullato per preservare i dati.');
const created=now(),tenantId=id(),adminId=id(),password=passwordHash('FidelityDemo!2026');
run(db,"INSERT OR REPLACE INTO metadata VALUES('demo','true')");
run(db,'INSERT INTO users(id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?)',adminId,'Team Agenzia','admin@fidelity.local',password,'agency',created);
run(db,'INSERT INTO tenants(id,name,slug,industry,color,address,created_at) VALUES(?,?,?,?,?,?,?)',tenantId,'Forno Contemporaneo','forno-contemporaneo','Food & beverage','#7357ff','Via del Forno 12 · Milano (esempio)',created);
run(db,'INSERT INTO users(id,tenant_id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?)',id(),tenantId,'Giulia · Titolare','negozio@fidelity.local',password,'owner',created);
run(db,'INSERT INTO users(id,tenant_id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?)',id(),tenantId,'Luca · Banco','banco@fidelity.local',password,'staff',created);
const programs=[{id:id(),name:'La pausa che premia',type:'stamps',threshold:10,reward:'Una colazione offerta',description:'Un timbro per ogni colazione. Con 10 timbri, la prossima la offriamo noi.',color:'#7357ff'}, {id:id(),name:'Punti di gusto',type:'points',threshold:100,reward:'Buono sconto da 5 €',description:'Ogni euro vale un punto. Raccogli 100 punti per il tuo buono da 5 €.',color:'#172e29'}, {id:id(),name:'Un buon inizio',type:'coupon',threshold:1,reward:'Un caffè di benvenuto',description:'Il piacere di conoscerti: un caffè offerto, una sola volta.',color:'#a73c5d'}];
for(const p of programs)run(db,'INSERT INTO programs(id,tenant_id,name,type,description,reward_threshold,reward_name,color,points_per_euro,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',p.id,tenantId,p.name,p.type,p.description,p.threshold,p.reward,p.color,1,created);
const names=['Sofia Rossi','Marco Bianchi','Elena Moretti','Andrea Conti','Giulia Romano','Luca Ferri','Francesca Costa','Matteo Gallo','Chiara Ricci','Alessandro Riva','Valentina Greco','Davide Villa','Sara Fontana','Lorenzo Marchetti','Martina Sala','Paolo Esposito','Alice Colombo','Simone Bruno','Federica Neri','Gabriele Martinelli','Beatrice Lombardi','Riccardo Pellegrini','Anna Bellini','Tommaso De Luca'];
for(let i=0;i<names.length;i++){const p=programs[i%3]!,m=createMember(db,tenantId,{programId:p.id,name:names[i]!,email:`cliente${i+1}@example.test`,phone:'',marketingConsent:i%4!==0},adminId,'demo');const timestamp=new Date(Date.now()-(i%14)*86400000-3600000).toISOString();run(db,'UPDATE members SET created_at=? WHERE id=?',timestamp,m.id);if(p.type!=='coupon'){transact(db,tenantId,adminId,m.id,{type:'credit',amount:p.type==='points'?30+i*11:3+i%13,note:'Acquisto dimostrativo',idempotencyKey:id()});if(i%5===0&&one(db,'SELECT balance FROM members WHERE id=?',m.id)!.balance>=p.threshold)transact(db,tenantId,adminId,m.id,{type:'redeem',note:'Premio dimostrativo',idempotencyKey:id()});run(db,'UPDATE members SET last_visit_at=?,updated_at=? WHERE id=?',timestamp,timestamp,m.id);run(db,'UPDATE transactions SET created_at=? WHERE member_id=?',timestamp,m.id);}if(i>=21)run(db,"UPDATE members SET last_visit_at=?,created_at=? WHERE id=?",new Date(Date.now()-45*86400000).toISOString(),new Date(Date.now()-60*86400000).toISOString(),m.id);}
const second=id();run(db,'INSERT INTO tenants(id,name,slug,industry,color,address,created_at) VALUES(?,?,?,?,?,?,?)',second,'Studio Forma','studio-forma','Benessere','#287769','Via della Forma 8 · Milano (esempio)',created);
run(db,'INSERT INTO campaigns(id,tenant_id,name,title,body,segment,created_at) VALUES(?,?,?,?,?,?,?)',id(),tenantId,'Ci manchi a colazione','Una pausa insieme?','La tua prossima colazione ti aspetta. Passa a trovarci e continua la raccolta timbri.','inactive',created);
console.log('Ambiente dimostrativo creato: dati sintetici, nessun cliente reale.');
console.log('Agenzia: admin@fidelity.local | Negoziante: negozio@fidelity.local | Banco: banco@fidelity.local');
console.log('Password demo per tutti: FidelityDemo!2026');
}catch(error){console.error(error instanceof Error?error.message:'Seed fallito');process.exitCode=1;}finally{db.close();}
