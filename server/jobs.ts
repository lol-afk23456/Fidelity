import { type DB, all, one, run, now, sequence } from './db.js';
import { queueCampaign } from './domain.js';
import { getWalletStatus, updateGooglePass, notifyAppleDevices, sendGoogleMessage, WalletError, ApplePushError } from './wallet/index.js';
import { walletData } from './wallet-data.js';
import { runAutomation } from './automations.js';
export const walletProvider={getWalletStatus,updateGooglePass,notifyAppleDevices,sendGoogleMessage};

export async function processJobs(db:DB,limit=20,provider=walletProvider,shouldStop=()=>false){
  for(const a of all(db,"SELECT a.* FROM automations a JOIN tenants t ON t.id=a.tenant_id WHERE a.active=1 AND t.active=1 AND (a.last_run_at IS NULL OR a.last_run_at<?)",new Date(Date.now()-86400000).toISOString()))runAutomation(db,a.tenant_id,a.id,null);
  run(db,"DELETE FROM apple_registrations WHERE member_id IN(SELECT id FROM members WHERE status='deleted' AND updated_at<?)",new Date(Date.now()-7*86400000).toISOString());
  for(const c of all(db,"SELECT * FROM campaigns WHERE status='scheduled' AND scheduled_at<=?",now()))queueCampaign(db,c.tenant_id,c.id,null);
  const jobs=all(db,"SELECT * FROM jobs WHERE status='pending' AND available_at<=? ORDER BY created_at LIMIT ?",now(),limit);
  for(const job of jobs){if(shouldStop())break;const claimed=run(db,"UPDATE jobs SET status='processing',attempts=attempts+1 WHERE id=? AND status='pending'",job.id);if(!claimed.changes)continue;const payload=JSON.parse(job.payload_json);try{
    const m=one(db,job.type==='wallet_revoke'?'SELECT * FROM members WHERE id=?':"SELECT * FROM members WHERE id=? AND status='active'",job.member_id);
    if(!m)throw new WalletError('Tessera o attività non disponibile','MEMBER_INACTIVE',409);
    const data=walletData(db,m),status=provider.getWalletStatus();
    if(job.type==='campaign'){
      if(!m.marketing_consent)throw new WalletError('Consenso marketing assente o revocato','NO_CONSENT',409);
      if(data.member.voided||(data.program.expiresAt&&data.program.expiresAt<=now()))throw new WalletError('Programma non attivo o scaduto','PROGRAM_INACTIVE',409);
      const c=one(db,'SELECT * FROM campaigns WHERE id=?',payload.campaignId);if(!c)throw new WalletError('Campagna non disponibile','CAMPAIGN_MISSING',404);
      if(payload.channel==='google'){
        if(!status.google.configured)throw new WalletError('Google Wallet da configurare','NOT_CONFIGURED',503);
        if(!m.google_issued)throw new WalletError('Nessuna tessera Google emessa','NO_DEVICE',409);
        const sent=Number(one(db,'SELECT count(*) n FROM google_notifications WHERE member_id=? AND sent_at>?',m.id,new Date(Date.now()-86400000).toISOString())!.n);
        if(sent>=3){const next=one(db,'SELECT min(sent_at) time FROM google_notifications WHERE member_id=? AND sent_at>?',m.id,new Date(Date.now()-86400000).toISOString())!.time;run(db,"UPDATE jobs SET status='pending',available_at=?,error='Limite notifiche: invio differito' WHERE id=?",new Date(new Date(next).getTime()+86401000).toISOString(),job.id);continue;}
        await provider.sendGoogleMessage(data.member,data.program,{id:payload.deliveryId,title:c.title,body:c.body});run(db,'INSERT INTO google_notifications VALUES(?,?)',m.id,now());
      }else{
        if(!status.apple.configured)throw new WalletError('Apple Wallet da configurare','NOT_CONFIGURED',503);
        const tokens=all(db,'SELECT DISTINCT push_token FROM apple_registrations WHERE member_id=?',m.id).map(x=>x.push_token);if(!tokens.length)throw new WalletError('Nessun dispositivo Apple registrato','NO_DEVICE',409);
        run(db,'UPDATE members SET offer=?,updated_at=?,update_seq=? WHERE id=?',`${c.title}: ${c.body}`,now(),sequence(db),m.id);
        const result=await provider.notifyAppleDevices(tokens);for(const t of result.invalidTokens)run(db,'DELETE FROM apple_registrations WHERE push_token=?',t);
        if(result.invalidTokens.length===tokens.length)throw new WalletError('Registrazioni Apple non più valide','NO_DEVICE',409);
      }
      run(db,"UPDATE campaign_deliveries SET status='sent',error=NULL,sent_at=? WHERE id=?",now(),payload.deliveryId);
    }else{
      const tokens=all(db,'SELECT DISTINCT push_token FROM apple_registrations WHERE member_id=?',m.id).map(x=>x.push_token);
      if((m.google_issued&&!status.google.configured)||(tokens.length&&!status.apple.configured))throw new WalletError('Configura i wallet richiesti per sincronizzare le carte','NOT_CONFIGURED',503);
      if(m.google_issued)await provider.updateGooglePass(data.member,data.program,false);
      if(tokens.length){const result=await provider.notifyAppleDevices(tokens);for(const t of result.invalidTokens)run(db,'DELETE FROM apple_registrations WHERE push_token=?',t);}
    }
    run(db,"UPDATE jobs SET status='sent',error=NULL,payload_json='{}' WHERE id=?",job.id);
  }catch(error){if(error instanceof ApplePushError)for(const t of error.invalidTokens)run(db,'DELETE FROM apple_registrations WHERE push_token=?',t);const uncertainCampaign=job.type==='campaign'&&payload.channel==='google'&&error instanceof WalletError&&error.code==='GOOGLE_UNAVAILABLE';const retryable=error instanceof WalletError&&error.retryable&&!uncertainCampaign;const state=retryable&&job.attempts<4?'pending':error instanceof WalletError&&['NOT_CONFIGURED','APPLE_NOT_CONFIGURED','GOOGLE_NOT_CONFIGURED','NO_CONSENT','NO_DEVICE','MEMBER_INACTIVE'].includes(error.code)?'blocked':'failed';const message=uncertainCampaign?'Esito Google incerto: verifica nella console prima di ripetere l’invio.':error instanceof WalletError?error.message:'Errore sincronizzazione wallet';run(db,'UPDATE jobs SET status=?,error=?,available_at=? WHERE id=?',state,message,new Date(Date.now()+Math.min(3600000,30000*2**job.attempts)).toISOString(),job.id);if(payload.deliveryId)run(db,'UPDATE campaign_deliveries SET status=?,error=? WHERE id=?',state==='pending'?'pending':state,message,payload.deliveryId);}
  }
  run(db,"UPDATE campaigns SET status='complete' WHERE status='queued' AND NOT EXISTS(SELECT 1 FROM campaign_deliveries d WHERE d.campaign_id=campaigns.id AND d.status='pending')");
  return jobs.length;
}
export function recoverProcessingJobs(db:DB){
  for(const job of all(db,"SELECT * FROM jobs WHERE status='processing'")){
    const payload=JSON.parse(job.payload_json);
    if(job.type==='campaign'&&payload.channel==='google'){
      const error='Esito Google incerto dopo riavvio: verifica nella console prima di ripetere l’invio.';
      run(db,"UPDATE jobs SET status='failed',error=? WHERE id=?",error,job.id);
      if(payload.deliveryId)run(db,"UPDATE campaign_deliveries SET status='failed',error=? WHERE id=?",error,payload.deliveryId);
    }else run(db,"UPDATE jobs SET status='pending' WHERE id=?",job.id);
  }
}
export function startJobs(db:DB){
  recoverProcessingJobs(db);let stopped=false;let running:Promise<void>|null=null;
  const tick=()=>{if(stopped||running)return;running=processJobs(db,20,walletProvider,()=>stopped).then(()=>{}).catch(error=>console.error('Worker: ciclo non completato',error instanceof WalletError?error.code:'INTERNAL_ERROR')).finally(()=>{running=null;});};
  const interval=setInterval(tick,10000);tick();return async()=>{stopped=true;clearInterval(interval);await running;};
}
