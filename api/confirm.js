const{readToken}=require('./_lib');
module.exports=async(req,res)=>{
  if(req.query.c){const v=readToken(req.query.t);const m=/^claim\|(.+)\|(.+)$/.exec(v||'');const ok=m&&m[1]===req.query.c&&await require('../lib/claims').verify(m[1],m[2]).catch(()=>false);res.writeHead(302,{Location:ok?'/confirmed?claim=1':'/confirm-error'});return res.end()}
  const email=readToken(req.query.t);
  if(!email){res.writeHead(302,{Location:'/confirm-error'});return res.end()}
  const H={Authorization:`Bearer ${process.env.RESEND_CONTACTS_KEY}`,'Content-Type':'application/json'};
  const seg=process.env.RESEND_SEGMENT_ID;
  const c=await fetch('https://api.resend.com/contacts',{method:'POST',headers:H,body:JSON.stringify({email,unsubscribed:false})});
  if(!c.ok&&c.status!==409&&c.status!==422)console.error('contact create',c.status);
  const s=await fetch(`https://api.resend.com/contacts/${encodeURIComponent(email)}/segments/${seg}`,{method:'POST',headers:H});
  if(!s.ok){console.error('segment add',s.status,await s.text().catch(()=>''));res.writeHead(302,{Location:'/confirm-error'});return res.end()}
  res.writeHead(302,{Location:'/confirmed'});res.end();
};
