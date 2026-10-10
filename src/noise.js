const clamp=(v,a,b)=>v<a?a:v>b?b:v;

export function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

/* simplex 2D */
export const noise2=(()=>{const r=mulberry32(90210),p=new Uint8Array(256);for(let i=0;i<256;i++)p[i]=i;
  for(let i=255;i>0;i--){const j=Math.floor(r()*(i+1));const t=p[i];p[i]=p[j];p[j]=t;}
  const perm=new Uint8Array(512);for(let i=0;i<512;i++)perm[i]=p[i&255];
  const gx=[1,-1,1,-1,1,-1,0,0],gy=[1,1,-1,-1,0,0,1,-1];
  const F2=0.5*(Math.sqrt(3)-1),G2=(3-Math.sqrt(3))/6;
  return function(xin,yin){
    const s=(xin+yin)*F2,i=Math.floor(xin+s),j=Math.floor(yin+s),t=(i+j)*G2;
    const x0=xin-(i-t),y0=yin-(j-t);const i1=x0>y0?1:0,j1=x0>y0?0:1;
    const x1=x0-i1+G2,y1=y0-j1+G2,x2=x0-1+2*G2,y2=y0-1+2*G2;const ii=i&255,jj=j&255;
    let n=0,tt;
    tt=0.5-x0*x0-y0*y0;if(tt>0){const g=perm[ii+perm[jj]]&7;tt*=tt;n+=tt*tt*(gx[g]*x0+gy[g]*y0);}
    tt=0.5-x1*x1-y1*y1;if(tt>0){const g=perm[ii+i1+perm[jj+j1]]&7;tt*=tt;n+=tt*tt*(gx[g]*x1+gy[g]*y1);}
    tt=0.5-x2*x2-y2*y2;if(tt>0){const g=perm[ii+1+perm[jj+1]]&7;tt*=tt;n+=tt*tt*(gx[g]*x2+gy[g]*y2);}
    return 70*n;};})();
export function fbm(x,y,o){let a=1,f=1,s=0,n=0;for(let i=0;i<o;i++){s+=a*noise2(x*f,y*f);n+=a;a*=0.5;f*=2.03;}return s/n;}
export function ridged(x,y,o){let a=1,f=1,s=0,n=0,w=1;for(let i=0;i<o;i++){let v=1-Math.abs(noise2(x*f,y*f));v*=v;v*=w;w=clamp(v*1.7,0,1);s+=v*a;n+=a;a*=0.5;f*=2.1;}return s/n;}
