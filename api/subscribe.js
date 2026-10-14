const{makeToken,validEmail}=require('./_lib');
module.exports=async(req,res)=>{
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const b=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
  if(b.website)return res.status(200).json({ok:true});
  const email=String(b.email||'').trim().toLowerCase();
  if(!validEmail(email))return res.status(400).json({error:'Please enter a valid email address.'});
  const url=`https://agentdataco.com/api/confirm?t=${encodeURIComponent(makeToken(email))}`;
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({
    from:'Agent Data Co <hello@agentdataco.com>',to:[email],reply_to:'hello@agentdataco.com',subject:'Confirm your Agent Data Weekly subscription',
    html:`<p>Hi,</p><p>Please confirm you'd like to receive <strong>Agent Data Weekly</strong> from Agent Data Co:</p><p><a href="${url}" style="background:#4f6bed;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Confirm subscription</a></p><p>If you didn't sign up, ignore this email — you won't be added.</p><p style="color:#888;font-size:12px">Agent Data Co · Transcend UK Holdings Ltd · Office 101, 1 Eastman Road, Harrow, HA1 4WL, UK</p>`,
    text:`Confirm your Agent Data Weekly subscription: ${url}\n\nIf you didn't sign up, ignore this email.`})});
  if(!r.ok){console.error('resend send failed',r.status);return res.status(502).json({error:'Could not send confirmation email. Please try again later.'})}
  return res.status(200).json({ok:true});
};
