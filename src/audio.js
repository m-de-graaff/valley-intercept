const clamp=(v,a,b)=>v<a?a:v>b?b:v;

/* ---------------- audio ---------------- */
export const Snd={ctx:null,muted:false,
  init(){
    if(this.ctx){this.resume();return;}
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    let c;try{c=new AC();}catch(e){return;}this.ctx=c;
    this.master=c.createGain();this.master.gain.value=this.muted?0:0.55;this.master.connect(c.destination);
    const len=c.sampleRate*2;const nb=c.createBuffer(1,len,c.sampleRate),nd=nb.getChannelData(0);for(let i=0;i<len;i++)nd[i]=Math.random()*2-1;this.noise=nb;
    const bb=c.createBuffer(1,len,c.sampleRate),bd=bb.getChannelData(0);let l=0;for(let i=0;i<len;i++){l=(l+0.02*(Math.random()*2-1))/1.02;bd[i]=l*3.5;}this.brown=bb;
    const loop=b=>{const s=c.createBufferSource();s.buffer=b;s.loop=true;s.start();return s;};
    const chain=(...n)=>{for(let i=0;i<n.length-1;i++)n[i].connect(n[i+1]);return n[n.length-1];};
    this.engF=c.createBiquadFilter();this.engF.type='lowpass';this.engF.frequency.value=300;this.engG=c.createGain();this.engG.gain.value=0;
    chain(loop(this.brown),this.engF,this.engG,this.master);
    this.whine=c.createOscillator();this.whine.type='sawtooth';this.whF=c.createBiquadFilter();this.whF.type='bandpass';this.whF.Q.value=5;this.whG=c.createGain();this.whG.gain.value=0;
    chain(this.whine,this.whF,this.whG,this.master);this.whine.start();
    this.wF=c.createBiquadFilter();this.wF.type='bandpass';this.wF.Q.value=0.7;this.wG=c.createGain();this.wG.gain.value=0;
    chain(loop(this.noise),this.wF,this.wG,this.master);
    this.tone=c.createOscillator();this.tone.type='square';this.toneG=c.createGain();this.toneG.gain.value=0;chain(this.tone,this.toneG,this.master);this.tone.start();
    this.warn=c.createOscillator();this.warn.type='triangle';this.warnG=c.createGain();this.warnG.gain.value=0;chain(this.warn,this.warnG,this.master);this.warn.start();
  },
  resume(){if(this.ctx&&this.ctx.state==='suspended')this.ctx.resume();},
  setMuted(m){this.muted=m;if(this.master)this.master.gain.setTargetAtTime(m?0:0.55,this.ctx.currentTime,0.05);},
  update(active,thr,speed,lock,warn,tm){
    if(!this.ctx)return;const t=this.ctx.currentTime,T=(p,v)=>p.setTargetAtTime(v,t,0.06);
    const on=active?1:0;
    T(this.engG.gain,on*(0.16+0.22*Math.min(thr,1)+(thr>1?0.18:0)));T(this.engF.frequency,180+thr*520);
    T(this.whG.gain,on*(0.008+0.016*Math.min(thr,1.1)));T(this.whine.frequency,520+thr*700);T(this.whF.frequency,1100+thr*1300);
    T(this.wG.gain,on*clamp(speed/380,0,1)*0.12);T(this.wF.frequency,300+speed*2.2);
    let tg=0,tf=800;
    if(lock===1){tg=(tm*7%1)<0.5?0.025:0;tf=820;}else if(lock===2){tg=0.03;tf=1320;}
    T(this.toneG.gain,on*tg);this.tone.frequency.setValueAtTime(tf,t);
    T(this.warnG.gain,on*(warn?((tm*5%1)<0.5?0.05:0):0));this.warn.frequency.setValueAtTime((tm*2.5%1)<0.5?950:1250,t);
  },
  _burst(buf,dur,ftype,f0,f1,vol,off){
    const c=this.ctx;if(!c||vol<=0.005)return;const t=c.currentTime;
    const s=c.createBufferSource();s.buffer=buf;const f=c.createBiquadFilter();f.type=ftype;f.frequency.setValueAtTime(f0,t);f.frequency.exponentialRampToValueAtTime(f1,t+dur);
    const g=c.createGain();g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.0008,t+dur);
    s.connect(f);f.connect(g);g.connect(this.master);s.start(t,off==null?Math.random()*1.4:off,dur+0.05);
  },
  shot(v){this._burst(this.noise,0.075,'lowpass',2600,500,0.32*v);},
  boom(v){this._burst(this.brown,2.0,'lowpass',900,60,1.6*v);this._burst(this.noise,0.5,'lowpass',2400,200,0.4*v);},
  whoosh(v){this._burst(this.noise,1.3,'bandpass',500,2600,0.45*v);},
  thud(){this._burst(this.brown,0.18,'lowpass',500,120,0.9);},
  hit(){const c=this.ctx;if(!c)return;const t=c.currentTime,o=c.createOscillator(),g=c.createGain();o.type='triangle';o.frequency.setValueAtTime(1900,t);
    g.gain.setValueAtTime(0.06,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.06);o.connect(g);g.connect(this.master);o.start(t);o.stop(t+0.07);},
};
