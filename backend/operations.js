const fs = require('node:fs');
const path = require('node:path');
const DEFAULTS = { enabled:false, warningPercent:80, criticalPercent:90, cooldownHours:6, recipients:[] };
function normalize(input) {
  if (!input || typeof input.enabled !== 'boolean') throw new Error('告警开关无效');
  const config = {enabled:input.enabled,warningPercent:input.warningPercent,criticalPercent:input.criticalPercent,cooldownHours:input.cooldownHours,recipients:input.recipients};
  if (![config.warningPercent,config.criticalPercent,config.cooldownHours].every(Number.isInteger) || config.warningPercent<50 || config.criticalPercent>99 || config.warningPercent>=config.criticalPercent || config.cooldownHours<1 || config.cooldownHours>168) throw new Error('预警阈值需为50至98，严重阈值需更高且不超过99；提醒间隔1至168小时');
  if (!Array.isArray(config.recipients) || config.recipients.length>10 || config.recipients.some(v=>typeof v!=='string' || v.length>254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v))) throw new Error('请填写最多10个有效邮箱');
  config.recipients=[...new Set(config.recipients)];
  if(config.enabled&&!config.recipients.length) throw new Error('启用告警前请填写接收邮箱');
  return config;
}
function createOperations({directory,send,statfs=fs.statfsSync,now=Date.now}) {
  const filename=path.join(directory,'operations-settings.json'), stateFile=path.join(directory,'operations-alert-state.json');
  function read(file,fallback) { try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;} }
  function write(file,value) { const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600});fs.renameSync(temp,file); }
  const settings=()=>normalize(read(filename,DEFAULTS));
  let busy=false, lastStatus=null;
  function status(){ const info=statfs(directory),total=info.blocks*info.bsize,free=info.bavail*info.bsize;
    const usedPercent=total?Math.round((total-free)/total*1000)/10:0,config=settings();
    return {total,free,usedPercent,level:usedPercent>=config.criticalPercent?'critical':usedPercent>=config.warningPercent?'warning':'ok',lastCheck:lastStatus}; }
  async function check(){
    if(busy)return;busy=true;
    try{
      const config=settings(),disk=status(),state=read(stateFile,{lastAttempt:0,level:'ok'});
      lastStatus={at:new Date(now()).toISOString(),level:disk.level};
      if(!config.enabled)return;
      if(disk.level==='ok'){if(state.level!=='ok')write(stateFile,{lastAttempt:0,level:'ok'});return;}
      if(now()-state.lastAttempt<config.cooldownHours*3600000 && !(disk.level==='critical'&&state.level==='warning'))return;
      write(stateFile,{lastAttempt:now(),level:disk.level});
      await send(config.recipients,'网站磁盘空间'+(disk.level==='critical'?'严重不足':'预警'),`磁盘已用 ${disk.usedPercent}%，可用 ${(disk.free/1024**3).toFixed(2)} GiB。请进入超级管理员系统设置检查。`);
      lastStatus.sent=true;
    }catch(e){lastStatus={at:new Date(now()).toISOString(),error:'运行检查或邮件发送失败，请检查SMTP配置和服务器日志'};console.error('[operations]',e.message);}finally{busy=false;}
  }
  return {settings,status,check,save(input){const config=normalize(input);write(filename,config);return config;}};
}
module.exports={createOperations,normalize};
