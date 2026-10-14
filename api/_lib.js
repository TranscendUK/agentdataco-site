const crypto=require('crypto');
const SECRET=()=>process.env.SIGNUP_SECRET;
const sign=(email,ts)=>crypto.createHmac('sha256',SECRET()).update(`${email}|${ts}`).digest('base64url');
exports.makeToken=email=>{const ts=Date.now().toString(36);return Buffer.from(email).toString('base64url')+'.'+ts+'.'+sign(email,ts)};
exports.readToken=t=>{try{const[e,ts,s]=String(t).split('.');const email=Buffer.from(e,'base64url').toString();const exp=sign(email,ts);if(!s||s.length!==exp.length||!crypto.timingSafeEqual(Buffer.from(s),Buffer.from(exp)))return null;if(Date.now()-parseInt(ts,36)>7*864e5)return null;return email}catch{return null}};
exports.validEmail=e=>typeof e==='string'&&e.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
