import * as THREE from 'three';
import './style.css';
import { Snd } from './audio.js';
import { fbm, ridged, mulberry32 } from './noise.js';
import { FlyPilot } from './flypilot.js';
import { BrainViz } from './brainviz.js';
import { Director } from './director.js';
import { createPost } from './post.js';
import { Learner, SITUATIONS, TACTICS } from './learning.js';

function main(){

/* ---------------- helpers ---------------- */
const V3=THREE.Vector3, Q=THREE.Quaternion;
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const rand=(a,b)=>a+Math.random()*(b-a);
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const col=h=>new THREE.Color(h); // hex is sRGB; three converts it to linear
const lin=a=>a.map(v=>Math.pow(v,2.2));
const _a=new V3(),_b=new V3(),_c=new V3(),_d=new V3(),_q=new Q(),_m=new THREE.Matrix4(),_e=new THREE.Euler();
const AX=new V3(1,0,0),AY=new V3(0,1,0),AZ=new V3(0,0,1),FWD=new V3(0,0,-1),ORIGIN=new V3();
function randDir(o){const u=Math.random()*2-1,t=Math.random()*Math.PI*2,s=Math.sqrt(1-u*u);return o.set(s*Math.cos(t),u,s*Math.sin(t));}
function setHeading(quat,dir){_m.lookAt(ORIGIN,dir,AY);quat.setFromRotationMatrix(_m);}
const $=id=>document.getElementById(id);

/* ---------------- renderer / scene ---------------- */
const gameEl=$('game'),glCanvas=$('gl');
let renderer;
try{renderer=new THREE.WebGLRenderer({canvas:glCanvas,antialias:false,powerPreference:'high-performance'});}
catch(err){$('fatal').hidden=false;return;}
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.0;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const ANISO=renderer.capabilities.getMaxAnisotropy();

const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(60,1,2,70000);

const ZEN=col('#3a6db0'),HOR=col('#d9dcd6'),SUNC=col('#ffd39a');
const SUN=new V3(0.55,0.33,0.77).normalize();
const FOG_DEN=0.000098;
scene.fog=new THREE.FogExp2(HOR.clone(),FOG_DEN);

scene.add(new THREE.HemisphereLight(col('#bcd2ea'),col('#6a5c46'),0.8*Math.PI));
const sunLight=new THREE.DirectionalLight(col('#fff0d6'),2.6*Math.PI);
sunLight.castShadow=true;sunLight.shadow.mapSize.set(2048,2048);
Object.assign(sunLight.shadow.camera,{left:-170,right:170,top:170,bottom:-170,near:10,far:4500});
sunLight.shadow.bias=-0.0004;sunLight.shadow.normalBias=0.06;
scene.add(sunLight,sunLight.target);
const flashLights=[];for(let i=0;i<3;i++){const l=new THREE.PointLight(col('#ffa458'),0,1400,2);scene.add(l);flashLights.push({l,t:0,peak:0});}

/* sky */
const skyMat=new THREE.ShaderMaterial({
  uniforms:{sunDir:{value:SUN},zen:{value:ZEN},hor:{value:HOR},sunC:{value:SUNC}},
  vertexShader:`varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:`uniform vec3 sunDir,zen,hor,sunC;varying vec3 vDir;
  void main(){vec3 d=normalize(vDir);float y=d.y;float h=pow(clamp(y,0.0,1.0),0.42);
    vec3 c=mix(hor,zen,h);float s=max(dot(d,sunDir),0.0);
    c+=sunC*pow(s,6.0)*0.24*(1.0-h*0.6);c+=sunC*pow(s,90.0)*0.6;
    c+=vec3(1.0,0.95,0.86)*smoothstep(0.99925,0.9998,s)*24.0;
    if(y<0.0)c=mix(hor,hor*0.86,clamp(-y*5.0,0.0,1.0));
    gl_FragColor=vec4(c,1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`,
  side:THREE.BackSide,depthWrite:false,fog:false});
const sky=new THREE.Mesh(new THREE.SphereGeometry(48000,40,20),skyMat);
sky.renderOrder=-10;scene.add(sky);
{const envScene=new THREE.Scene();envScene.add(new THREE.Mesh(new THREE.SphereGeometry(500,32,16),skyMat));
 const pm=new THREE.PMREMGenerator(renderer);scene.environment=pm.fromScene(envScene,0,1,2000).texture;pm.dispose();}

/* ---------------- terrain ---------------- */
const T_SIZE=40000,T_HALF=20000,T_SEG=384,T_CELL=T_SIZE/T_SEG,T_N=T_SEG+1;
const AF={x:-2600,z:5600,h:62};
const ARENA=14000;
function rawHeight(x,z){
  const nx=x/9000,nz=z/9000;
  let h=fbm(nx,nz,5)*240;
  const dr=Math.hypot(x,z)/T_HALF, dq=Math.max(Math.abs(x),Math.abs(z))/T_HALF;
  const m=clamp(smooth(0.3,0.9,dr)*0.95+smooth(0.0,0.6,fbm(nx*0.5+3.1,nz*0.5-1.7,3)*0.5+0.5)*0.55,0,1.25);
  const r=ridged(nx*0.85+11.3,nz*0.85-7.9,5);
  h+=r*r*2100*m;
  const lake=fbm(nx*0.7-20.2,nz*0.7+13.4,3);
  h-=smooth(0.1,0.42,lake)*330*(1-clamp(m,0,1)*0.8);
  h+=70;
  h*=1-smooth(0.94,1.0,dq)*0.85;
  const dd=Math.max(Math.abs(x-AF.x)-1450,Math.abs(z-AF.z)-200,0);
  h=lerp(h,AF.h,1-smooth(0,900,dd));
  return h;
}
const tGeo=new THREE.PlaneGeometry(T_SIZE,T_SIZE,T_SEG,T_SEG);tGeo.rotateX(-Math.PI/2);
const tPos=tGeo.attributes.position;const HMAP=new Float32Array(T_N*T_N);
for(let iz=0;iz<T_N;iz++)for(let ix=0;ix<T_N;ix++){const i=iz*T_N+ix,x=-T_HALF+ix*T_CELL,z=-T_HALF+iz*T_CELL,h=rawHeight(x,z);HMAP[i]=h;tPos.setXYZ(i,x,h,z);}
tGeo.computeVertexNormals();
const tNorm=tGeo.attributes.normal;
function forestN(x,z){return fbm(x/2600+40,z/2600-12,4);}
{
  const C=new Float32Array(T_N*T_N*3);
  const sand=lin([0.78,0.72,0.55]),grassA=lin([0.36,0.47,0.21]),grassB=lin([0.56,0.56,0.31]),forest=lin([0.17,0.27,0.13]),
        rock=lin([0.49,0.46,0.42]),rockD=lin([0.31,0.29,0.27]),snow=lin([0.95,0.96,0.98]),bed=lin([0.42,0.40,0.32]);
  const rnd=mulberry32(7);const c=[0,0,0];
  const mix=(w,b)=>{c[0]+=(b[0]-c[0])*w;c[1]+=(b[1]-c[1])*w;c[2]+=(b[2]-c[2])*w;};
  for(let i=0;i<T_N*T_N;i++){
    const x=tPos.getX(i),z=tPos.getZ(i),h=HMAP[i],ny=tNorm.getY(i);
    const dry=smooth(-0.3,0.45,fbm(x/3200,z/3200,3));
    c[0]=lerp(grassA[0],grassB[0],dry);c[1]=lerp(grassA[1],grassB[1],dry);c[2]=lerp(grassA[2],grassB[2],dry);
    const fw=smooth(-0.08,0.16,forestN(x,z))*(1-smooth(650,1050,h))*smooth(0.8,0.9,ny);mix(fw*0.85,forest);
    mix(1-smooth(3,16,h),sand);
    const rn=fbm(x/700,z/700,2)*0.5+0.5;
    const rw=clamp(smooth(0.86,0.7,ny)+smooth(950,1500,h)*0.55,0,1);
    mix(rw,[lerp(rock[0],rockD[0],rn),lerp(rock[1],rockD[1],rn),lerp(rock[2],rockD[2],rn)]);
    const sw=smooth(1250,1480,h+fbm(x/1500,z/1500,2)*160)*smooth(0.6,0.78,ny);mix(sw,snow);
    if(h<0)mix(0.8,bed);
    const j=0.9+rnd()*0.18;C[i*3]=c[0]*j;C[i*3+1]=c[1]*j;C[i*3+2]=c[2]*j;
  }
  tGeo.setAttribute('color',new THREE.BufferAttribute(C,3));
}
// tileable 3-channel value noise for terrain detail at three scales
function tileNoiseTex(size){
  const data=new Uint8Array(size*size*4);
  const chan=(seed,cells,oct)=>{const out=new Float32Array(size*size);let amp=1,tot=0;
    for(let o=0;o<oct;o++){const n=cells<<o,r=mulberry32(seed+o*17),g=new Float32Array(n*n);for(let i=0;i<n*n;i++)g[i]=r();
      for(let y=0;y<size;y++)for(let x=0;x<size;x++){const fx=x/size*n,fy=y/size*n,ix=fx|0,iy=fy|0,tx=fx-ix,ty=fy-iy;
        const sx=tx*tx*(3-2*tx),sy=ty*ty*(3-2*ty),a=g[iy*n+ix],b=g[iy*n+(ix+1)%n],c2=g[((iy+1)%n)*n+ix],d=g[((iy+1)%n)*n+(ix+1)%n];
        out[y*size+x]+=amp*lerp(lerp(a,b,sx),lerp(c2,d,sx),sy);}
      tot+=amp;amp*=0.5;}
    for(let i=0;i<out.length;i++)out[i]/=tot;return out;};
  const r=chan(3,8,5),g=chan(11,4,4),b=chan(29,4,3);
  for(let i=0;i<size*size;i++){data[i*4]=r[i]*255;data[i*4+1]=g[i]*255;data[i*4+2]=b[i]*255;data[i*4+3]=255;}
  const t=new THREE.DataTexture(data,size,size);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;
  t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.anisotropy=ANISO;t.needsUpdate=true;return t;
}
const detailTex=tileNoiseTex(256);
const terrainMat=new THREE.MeshLambertMaterial({vertexColors:true});
terrainMat.onBeforeCompile=sh=>{
  sh.uniforms.detail={value:detailTex};
  sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vWP;')
    .replace('#include <project_vertex>','#include <project_vertex>\nvWP=(modelMatrix*vec4(transformed,1.0)).xyz;');
  sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vWP;uniform sampler2D detail;')
    .replace('#include <color_fragment>',`#include <color_fragment>
      float d1=texture2D(detail,vWP.xz/41.0).r,d2=texture2D(detail,vWP.xz/290.0).g,d3=texture2D(detail,vWP.xz/2300.0).b;
      float near=1.0-smoothstep(500.0,3200.0,length(vWP-cameraPosition));
      diffuseColor.rgb*=mix(1.0,0.55+0.9*d1,near)*(0.68+0.64*d2)*(0.82+0.36*d3);`);
};
const terrain=new THREE.Mesh(tGeo,terrainMat);terrain.receiveShadow=true;scene.add(terrain);

function groundRaw(x,z){
  const fx=(x+T_HALF)/T_CELL,fz=(z+T_HALF)/T_CELL;
  if(fx<0||fz<0||fx>=T_SEG||fz>=T_SEG)return 0;
  const ix=fx|0,iz=fz|0,tx=fx-ix,tz=fz-iz,i=iz*T_N+ix;
  return lerp(lerp(HMAP[i],HMAP[i+1],tx),lerp(HMAP[i+T_N],HMAP[i+T_N+1],tx),tz);
}
const groundAt=(x,z)=>Math.max(groundRaw(x,z),0);

/* water */
const waterMat=new THREE.ShaderMaterial({
  uniforms:{time:{value:0},sunDir:{value:SUN},zen:{value:ZEN},hor:{value:HOR},deep:{value:col('#1b4452')},fogCol:{value:HOR},fogDen:{value:FOG_DEN}},
  vertexShader:`varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
  fragmentShader:`uniform float time,fogDen;uniform vec3 sunDir,zen,hor,deep,fogCol;varying vec3 vW;
  vec2 wv(vec2 p,vec2 d,float f,float s){return d*cos(dot(p,d)*f+time*s)*f;}
  void main(){vec2 p=vW.xz;vec2 g=vec2(0.0);
    g+=wv(p,normalize(vec2(1.0,0.3)),0.021,1.2)*0.6;g+=wv(p,normalize(vec2(-0.4,1.0)),0.039,1.7)*0.45;
    g+=wv(p,normalize(vec2(0.7,-0.8)),0.087,2.5)*0.28;g+=wv(p,normalize(vec2(-1.0,-0.2)),0.19,3.3)*0.14;
    g+=wv(p,normalize(vec2(0.2,-1.0)),0.41,4.6)*0.06;
    vec3 toC=cameraPosition-vW;float dist=length(toC);vec3 V=toC/dist;
    float fl=clamp(dist/7000.0,0.0,1.0);
    vec3 N=normalize(mix(vec3(-g.x*2.2,1.0,-g.y*2.2),vec3(0.0,1.0,0.0),fl*0.75));
    vec3 R=reflect(-V,N);R.y=abs(R.y);
    vec3 sk=mix(hor,zen,pow(R.y,0.45));
    float fr=0.02+0.98*pow(1.0-max(dot(N,V),0.0),5.0);
    vec3 c=mix(deep,sk,clamp(fr,0.0,1.0));
    float sd=max(dot(R,sunDir),0.0);
    c+=vec3(1.0,0.88,0.7)*(pow(sd,380.0)*9.0+pow(sd,24.0)*0.12);
    float f=1.0-exp(-fogDen*fogDen*dist*dist);c=mix(c,fogCol,f);
    gl_FragColor=vec4(c,1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`});
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(240000,240000).rotateX(-Math.PI/2),waterMat));

/* trees */
{
  const r=mulberry32(42);const MAXT=36000;
  const cone=new THREE.ConeGeometry(1,1,7).translate(0,0.5,0);
  const blob=new THREE.IcosahedronGeometry(1,1).translate(0,1,0);
  const conifers=new THREE.InstancedMesh(cone,new THREE.MeshLambertMaterial({color:0xffffff}),MAXT);
  const broad=new THREE.InstancedMesh(blob,new THREE.MeshLambertMaterial({color:0xffffff,flatShading:true}),MAXT/2);
  const dm=new THREE.Object3D();const cc=new THREE.Color();let nc=0,nb=0;
  for(let k=0;k<420000&&(nc<MAXT||nb<MAXT/2);k++){
    const x=(r()*2-1)*17000,z=(r()*2-1)*17000;
    const h=groundRaw(x,z);if(h<8||h>1050)continue;
    if(Math.abs(x-AF.x)<1800&&Math.abs(z-AF.z)<500)continue;
    const fx=Math.round((x+T_HALF)/T_CELL),fz=Math.round((z+T_HALF)/T_CELL);const ny=tNorm.getY(fz*T_N+fx);if(ny<0.86)continue;
    const fn=forestN(x,z);if(fn<-0.05&&r()>0.02)continue;
    const big=r()<0.68;
    if(big&&nc<MAXT){const hh=14+r()*16,rr=hh*(0.26+r()*0.08);dm.position.set(x,h-1.5,z);dm.rotation.set(0,r()*6.3,0);dm.scale.set(rr,hh,rr);dm.updateMatrix();
      conifers.setMatrixAt(nc,dm.matrix);cc.setRGB(0.045+r()*0.03,0.10+r()*0.05,0.04+r()*0.02);conifers.setColorAt(nc,cc);nc++;}
    else if(!big&&nb<MAXT/2){const s=6+r()*6;dm.position.set(x,h-1,z);dm.rotation.set(r(),r()*6.3,r());dm.scale.set(s,s*0.9,s);dm.updateMatrix();
      broad.setMatrixAt(nb,dm.matrix);cc.setRGB(0.08+r()*0.07,0.15+r()*0.07,0.04+r()*0.03);broad.setColorAt(nb,cc);nb++;}
  }
  conifers.count=nc;broad.count=nb;conifers.frustumCulled=broad.frustumCulled=false;
  scene.add(conifers,broad);
}

/* airfield */
const afFires=[];
{
  const cv=document.createElement('canvas');cv.width=2048;cv.height=64;const x=cv.getContext('2d');
  x.fillStyle='#3a3c3f';x.fillRect(0,0,2048,64);
  for(let i=0;i<4000;i++){x.fillStyle=`rgba(${Math.random()<0.5?0:255},${Math.random()<0.5?0:255},255,0.04)`;x.fillRect(Math.random()*2048,Math.random()*64,2,2);}
  x.fillStyle='#e9e7df';for(let i=60;i<1990;i+=36)x.fillRect(i,30,20,3);
  for(const e0 of [10,2018])for(let k=0;k<8;k++)x.fillRect(e0,6+k*7,20,4);
  x.fillRect(0,2,2048,1.5);x.fillRect(0,60.5,2048,1.5);
  const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=ANISO;
  const rw=new THREE.Mesh(new THREE.PlaneGeometry(2600,60).rotateX(-Math.PI/2),new THREE.MeshLambertMaterial({map:t,polygonOffset:true,polygonOffsetFactor:-2}));
  rw.position.set(AF.x,AF.h+0.4,AF.z);rw.receiveShadow=true;scene.add(rw);
  const apron=new THREE.Mesh(new THREE.PlaneGeometry(700,110).rotateX(-Math.PI/2),new THREE.MeshLambertMaterial({color:col('#56585a'),polygonOffset:true,polygonOffsetFactor:-1}));
  apron.position.set(AF.x+300,AF.h+0.3,AF.z+150);apron.receiveShadow=true;scene.add(apron);
  const wallM=new THREE.MeshLambertMaterial({color:col('#8e9088')}),roofM=new THREE.MeshLambertMaterial({color:col('#5d625c')});
  const roofG=new THREE.CylinderGeometry(20,20,48,14,1,false,0,Math.PI).rotateZ(Math.PI/2).rotateY(Math.PI/2);
  for(let k=0;k<4;k++){
    const hx=AF.x+80+k*62,hz=AF.z+245;
    const w=new THREE.Mesh(new THREE.BoxGeometry(40,10,48),wallM);w.position.set(hx,AF.h+5,hz);scene.add(w);
    const rf=new THREE.Mesh(roofG,roofM);rf.scale.set(1,0.55,1);rf.position.set(hx,AF.h+10,hz);scene.add(rf);
  }
  const tower=new THREE.Mesh(new THREE.BoxGeometry(9,24,9),wallM);tower.position.set(AF.x+400,AF.h+12,AF.z+230);scene.add(tower);
  const cab=new THREE.Mesh(new THREE.BoxGeometry(13,5,13),new THREE.MeshStandardMaterial({color:col('#203038'),metalness:0.6,roughness:0.15}));
  cab.position.set(AF.x+400,AF.h+26.5,AF.z+230);scene.add(cab);
}

/* clouds: cumulus clusters lit from the sun side, plus a high cirrus deck */
function blobTex(sz,lumps,soft,seed=0){
  const cv=document.createElement('canvas');cv.width=cv.height=sz;const x=cv.getContext('2d');const r=mulberry32(sz+lumps+seed);
  for(let i=0;i<lumps;i++){const cx=sz*(0.3+r()*0.4),cy=sz*(0.32+r()*0.4),rr=sz*(0.14+r()*0.2);
    const g=x.createRadialGradient(cx,cy,0,cx,cy,rr);g.addColorStop(0,`rgba(255,255,255,${soft})`);g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(0,0,sz,sz);}
  const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;return t;
}
{
  const texs=[blobTex(128,14,0.42,1),blobTex(128,18,0.36,2),blobTex(128,10,0.5,3)];const r=mulberry32(11);
  const tones=[['#ffffff',0.95],['#fff6ea',0.9],['#e8ebef',0.9],['#b9c0cb',0.85],['#9ea7b4',0.8]];
  const mats=[];for(const t of texs)for(const [c,o] of tones)mats.push(new THREE.SpriteMaterial({map:t,color:col(c),transparent:true,depthWrite:false,fog:true,opacity:o}));
  for(let k=0;k<84;k++){
    const a=r()*Math.PI*2,d=Math.sqrt(r())*17500,cx=Math.cos(a)*d,cz=Math.sin(a)*d,cy=1600+r()*1500;
    const n=10+Math.floor(r()*12),sx=450+r()*800,sz=450+r()*800;
    for(let i=0;i<n;i++){
      const oy=(r()-0.3)*260;const s=360+r()*560;
      const ox=(r()*2-1)*sx,oz=(r()*2-1)*sz;
      const sunSide=(ox*SUN.x+oz*SUN.z)/Math.max(sx,sz);
      const tone=oy<-40?(r()<0.5?3:4):(sunSide>0.2?(r()<0.5?0:1):(r()<0.6?2:1));
      const sp=new THREE.Sprite(mats[Math.floor(r()*3)*tones.length+tone]);
      sp.position.set(cx+ox,cy+oy,cz+oz);sp.scale.set(s,s*0.72,1);
      scene.add(sp);
    }
  }
}
const cirrus=(()=>{
  const cv=document.createElement('canvas');cv.width=cv.height=512;const x=cv.getContext('2d');const r=mulberry32(5);
  x.filter='blur(6px)';
  for(let i=0;i<70;i++){const y=r()*512,len=120+r()*300,x0=r()*512;x.strokeStyle=`rgba(255,255,255,${0.05+r()*0.12})`;x.lineWidth=4+r()*14;
    x.beginPath();x.moveTo(x0,y);x.bezierCurveTo(x0+len*0.3,y-20+r()*40,x0+len*0.7,y-20+r()*40,x0+len,y+r()*20);x.stroke();
    for(const dx of [-512,512]){x.beginPath();x.moveTo(x0+dx,y);x.bezierCurveTo(x0+dx+len*0.3,y,x0+dx+len*0.7,y,x0+dx+len,y);x.stroke();}}
  const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(6,6);
  const m=new THREE.Mesh(new THREE.PlaneGeometry(90000,90000).rotateX(Math.PI/2),new THREE.MeshBasicMaterial({map:t,transparent:true,opacity:0.55,depthWrite:false,fog:false,color:col('#fff7ec')}));
  m.position.y=8500;m.renderOrder=-5;scene.add(m);return m;
})();

/* ---------------- particles ---------------- */
function softTex(){const cv=document.createElement('canvas');cv.width=cv.height=64;const x=cv.getContext('2d');
  const g=x.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(0.35,'rgba(255,255,255,.55)');g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g;x.fillRect(0,0,64,64);return new THREE.CanvasTexture(cv);}
const glowTex=softTex(),smokeTex=blobTex(64,6,0.6);
class Particles{
  constructor(max,additive,tex){
    this.max=max;this.add=additive;this.i=0;
    this.pos=new Float32Array(max*3);this.col=new Float32Array(max*3);this.size=new Float32Array(max);this.alpha=new Float32Array(max);
    this.vel=new Float32Array(max*3);this.life=new Float32Array(max);this.ml=new Float32Array(max);
    this.s0=new Float32Array(max);this.s1=new Float32Array(max);this.a0=new Float32Array(max);this.drag=new Float32Array(max);this.grav=new Float32Array(max);
    const g=new THREE.BufferGeometry();
    const mk=(arr,n)=>{const a=new THREE.BufferAttribute(arr,n);a.setUsage(THREE.DynamicDrawUsage);return a;};
    g.setAttribute('position',this.aPos=mk(this.pos,3));g.setAttribute('pcolor',this.aCol=mk(this.col,3));
    g.setAttribute('psize',this.aSize=mk(this.size,1));g.setAttribute('palpha',this.aAlpha=mk(this.alpha,1));
    this.mat=new THREE.ShaderMaterial({
      uniforms:{map:{value:tex},scale:{value:500},fogCol:{value:HOR},fogDen:{value:FOG_DEN},additive:{value:additive?1:0},sunDir:{value:SUN}},
      vertexShader:`attribute float psize;attribute float palpha;attribute vec3 pcolor;uniform float scale;varying float vA;varying vec3 vC;varying float vD;
        void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mv;vD=-mv.z;gl_PointSize=psize*scale/max(vD,0.5);vA=palpha;vC=pcolor;if(palpha<=0.0)gl_PointSize=0.0;}`,
      fragmentShader:`uniform sampler2D map;uniform vec3 fogCol;uniform float fogDen,additive;varying float vA;varying vec3 vC;varying float vD;
        void main(){vec4 t=texture2D(map,gl_PointCoord);float f=1.0-exp(-fogDen*fogDen*vD*vD);vec3 c=vC;
          if(additive>0.5)c*=(1.0-f);else{c*=mix(1.15,0.75,gl_PointCoord.y);c=mix(c,fogCol,f);}
          gl_FragColor=vec4(c,vA*t.a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent:true,depthWrite:false,blending:additive?THREE.AdditiveBlending:THREE.NormalBlending});
    this.points=new THREE.Points(g,this.mat);this.points.frustumCulled=false;this.points.renderOrder=additive?3:2;scene.add(this.points);
  }
  spawn(x,y,z,vx,vy,vz,life,s0,s1,a0,r,g,b,drag,grav){
    const i=this.i;this.i=(i+1)%this.max;const j=i*3;
    this.pos[j]=x;this.pos[j+1]=y;this.pos[j+2]=z;this.vel[j]=vx;this.vel[j+1]=vy;this.vel[j+2]=vz;
    this.col[j]=r;this.col[j+1]=g;this.col[j+2]=b;this.life[i]=life;this.ml[i]=life;this.s0[i]=s0;this.s1[i]=s1;this.a0[i]=a0;
    this.drag[i]=drag||0;this.grav[i]=grav||0;this.size[i]=s0;this.alpha[i]=0;
  }
  update(dt){
    const P=this.pos,V=this.vel;
    for(let i=0;i<this.max;i++){
      let L=this.life[i];if(L<=0)continue;L-=dt;this.life[i]=L;
      if(L<=0){this.alpha[i]=0;this.size[i]=0;continue;}
      const k=Math.max(0,1-this.drag[i]*dt),j=i*3;
      V[j]*=k;V[j+1]=V[j+1]*k+this.grav[i]*dt;V[j+2]*=k;
      P[j]+=V[j]*dt;P[j+1]+=V[j+1]*dt;P[j+2]+=V[j+2]*dt;
      const t=1-L/this.ml[i];
      this.size[i]=this.s0[i]+(this.s1[i]-this.s0[i])*(1-(1-t)*(1-t));
      this.alpha[i]=this.a0[i]*Math.min(1,t*12)*(1-t);
    }
    this.aPos.needsUpdate=this.aCol.needsUpdate=this.aSize.needsUpdate=this.aAlpha.needsUpdate=true;
  }
}
const smoke=new Particles(7000,false,smokeTex);
const fire=new Particles(6000,true,glowTex);

/* ---------------- aircraft models ---------------- */
const SCHEMES={
  player:{name:'player',base:'#808b96',dark:'#5e6974',camo:false,accent:'#1f4c8f',mark:'#f2efe6',fin:null},
  fighter:{name:'fighter',base:'#9b9070',dark:'#6a6148',camo:true,accent:'#b3302a',mark:'#e8d9b0',fin:'accent'},
  ace:{name:'ace',base:'#41454c',dark:'#25282d',camo:true,accent:'#c9261c',mark:'#e9e2d2',fin:'accent'},
  bomber:{name:'bomber',base:'#5c6352',dark:'#3e4438',camo:true,accent:'#b3302a',mark:'#e8d9b0',fin:null},
};
function skinTex(s,seed){
  const W=1024,H=512,cv=document.createElement('canvas');cv.width=W;cv.height=H;const x=cv.getContext('2d');const r=mulberry32(seed);
  x.fillStyle=s.base;x.fillRect(0,0,W,H);
  if(s.camo){x.fillStyle=s.dark;for(let i=0;i<46;i++){const cx=r()*W,cy=r()*H,rx=40+r()*120,ry=25+r()*70;x.beginPath();
    for(let k=0;k<=10;k++){const a=k/10*Math.PI*2,rr=0.7+r()*0.5;x.lineTo(cx+Math.cos(a)*rx*rr,cy+Math.sin(a)*ry*rr);}x.fill();
    for(const dx of [-W,W]){x.beginPath();x.ellipse(cx+dx,cy,rx,ry,0,0,7);x.fill();}}}
  else{const g=x.createLinearGradient(0,0,0,H);g.addColorStop(0,'rgba(0,0,0,0.0)');g.addColorStop(0.5,'rgba(0,0,0,0.06)');g.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=g;x.fillRect(0,0,W,H);}
  for(let i=0;i<9000;i++){x.fillStyle=`rgba(${r()<0.5?0:255},${r()<0.5?0:255},${r()<0.5?0:255},0.035)`;x.fillRect(r()*W,r()*H,2,2);}
  for(let i=0;i<40;i++){x.fillStyle='rgba(30,30,30,0.05)';x.fillRect(r()*W,r()*H,2+r()*4,30+r()*120);}
  x.strokeStyle='rgba(18,22,26,0.5)';x.lineWidth=1.3;
  for(const v of [0.1,0.18,0.27,0.36,0.45,0.53,0.6,0.68,0.77,0.86]){x.beginPath();x.moveTo(0,v*H);x.lineTo(W,v*H);x.stroke();}
  for(let i=0;i<70;i++){const xx=r()*W,y0=Math.floor(r()*9)/10*H;x.beginPath();x.moveTo(xx,y0);x.lineTo(xx,y0+H*(0.06+r()*0.08));x.stroke();}
  x.fillStyle='rgba(15,18,22,0.35)';for(const v of [0.1,0.27,0.45,0.6,0.77])for(let xx=4;xx<W;xx+=9)x.fillRect(xx,v*H+3,1.5,1.5);
  const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=ANISO;t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;
}
function abTex(){ // afterburner plume with shock diamonds
  const cv=document.createElement('canvas');cv.width=64;cv.height=256;const x=cv.getContext('2d');
  const g=x.createLinearGradient(0,256,0,0);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(0.15,'rgba(255,220,170,0.95)');g.addColorStop(0.6,'rgba(255,140,60,0.45)');g.addColorStop(1,'rgba(255,90,30,0)');
  x.fillStyle=g;x.fillRect(0,0,64,256);
  x.globalCompositeOperation='lighter';
  for(let i=0;i<5;i++){const y=256-30-i*38,rr=14-i*2;const gg=x.createRadialGradient(32,y,0,32,y,rr*2.2);gg.addColorStop(0,`rgba(255,255,230,${0.8-i*0.13})`);gg.addColorStop(1,'rgba(255,200,120,0)');x.fillStyle=gg;x.fillRect(0,y-rr*2.4,64,rr*4.8);}
  const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;return t;
}
const AB_TEX=abTex();
function slab(pts,th,bev=0.05){const s=new THREE.Shape();s.moveTo(pts[0][0],pts[0][1]);for(let i=1;i<pts.length;i++)s.lineTo(pts[i][0],pts[i][1]);s.closePath();
  const g=new THREE.ExtrudeGeometry(s,{depth:th,bevelEnabled:true,bevelThickness:bev*0.8,bevelSize:bev,bevelSegments:2,steps:1});g.translate(0,0,-th/2);return g;}
const mirror=pts=>pts.map(p=>[-p[0],p[1]]);
let JG=null;const JM={};
function jetGeos(){
  if(JG)return JG;
  const prof=[[0,-8.7],[0.62,-8.6],[0.92,-7.8],[1.04,-5.2],[1.1,-1.2],[1.05,2],[0.9,3.9],[0.66,5.5],[0.4,6.9],[0.16,8.1],[0,8.7]].map(p=>new THREE.Vector2(p[0],p[1]));
  const W=[[0.8,2.4],[6.3,-2.5],[6.3,-3.6],[0.8,-4.9]],L=[[0.7,5.4],[1.25,2.3],[0.75,1.9]],S=[[0,1.0],[2.9,-1.2],[2.9,-2.0],[0,-1.8]];
  const bprof=[[0,-17.5],[0.9,-17],[1.6,-15.5],[1.95,-12],[2.05,-4],[2.0,6],[1.6,12],[1.0,15.5],[0.55,17.5],[0,17.9]].map(p=>new THREE.Vector2(p[0],p[1]));
  JG={
    fus:new THREE.LatheGeometry(prof,36).rotateX(-Math.PI/2).scale(1.3,0.86,1),
    radome:new THREE.LatheGeometry([[0,-8.72],[0.42,-8.3],[0.66,-7.4],[0.72,-6.9]].map(p=>new THREE.Vector2(p[0],p[1])),28).rotateX(Math.PI/2).scale(1.31,0.87,1),
    spine:new THREE.CylinderGeometry(0.42,0.5,6.2,20).rotateX(Math.PI/2).scale(1.0,0.7,1),
    canopy:new THREE.SphereGeometry(1,28,18).scale(0.62,0.56,1.95),
    frame:new THREE.TorusGeometry(0.6,0.035,6,24,Math.PI).scale(1,0.95,1),
    wingR:slab(W,0.2).rotateX(-Math.PI/2),wingL:slab(mirror(W),0.2).rotateX(-Math.PI/2),
    lerxR:slab(L,0.12).rotateX(-Math.PI/2),lerxL:slab(mirror(L),0.12).rotateX(-Math.PI/2),
    stabR:slab(S,0.14).rotateX(-Math.PI/2).translate(0.85,0,0),stabL:slab(mirror(S),0.14).rotateX(-Math.PI/2).translate(-0.85,0,0),
    fin:slab([[-4.8,0],[-7.5,3.9],[-8.55,3.9],[-8.45,0]],0.14).rotateY(Math.PI/2),
    ventral:slab([[-6.2,0],[-7.6,-0.7],[-8.0,-0.7],[-7.8,0]],0.08).rotateY(Math.PI/2),
    intake:new THREE.BoxGeometry(0.78,1.0,3.4),intakeLip:new THREE.BoxGeometry(0.66,0.86,0.06),
    nozzle:new THREE.CylinderGeometry(0.57,0.48,1.5,28,1,true).rotateX(Math.PI/2),
    nozzleIn:new THREE.ConeGeometry(0.46,0.9,24,1,true).rotateX(-Math.PI/2),
    ab:new THREE.CylinderGeometry(0.05,0.42,1,24,1,true).translate(0,0.5,0).rotateX(Math.PI/2),
    disk:new THREE.CircleGeometry(0.44,24),
    brake:new THREE.BoxGeometry(1.1,0.05,1.7).translate(0,0,0.85),
    pylon:new THREE.BoxGeometry(0.09,0.2,1.6),
    rail:new THREE.BoxGeometry(0.12,0.1,2.4),
    roundel:new THREE.CircleGeometry(0.62,28).rotateX(-Math.PI/2),
    roundelIn:new THREE.CircleGeometry(0.28,22).rotateX(-Math.PI/2),
    nav:new THREE.SphereGeometry(0.09,10,8),
    mBody:new THREE.CylinderGeometry(0.11,0.11,2.9,10).rotateX(Math.PI/2),
    mNose:new THREE.ConeGeometry(0.11,0.42,10).rotateX(-Math.PI/2).translate(0,0,-1.66),
    mFin:new THREE.BoxGeometry(0.62,0.02,0.36).translate(0,0,1.2),
    // bomber
    bFus:new THREE.LatheGeometry(bprof,36).rotateX(-Math.PI/2).scale(1,1.05,1),
    bNose:new THREE.SphereGeometry(1,24,16,0,Math.PI*2,0,Math.PI/2).rotateX(-Math.PI/2).scale(1.0,1.0,2.2),
    bWingR:slab([[1.6,5],[22,-6],[22,-8.6],[1.6,-5.5]],0.55,0.12).rotateX(-Math.PI/2),bWingL:slab(mirror([[1.6,5],[22,-6],[22,-8.6],[1.6,-5.5]]),0.55,0.12).rotateX(-Math.PI/2),
    bStabR:slab([[0.8,-12.4],[8.5,-16.4],[8.5,-17.8],[0.8,-17.4]],0.3).rotateX(-Math.PI/2),bStabL:slab(mirror([[0.8,-12.4],[8.5,-16.4],[8.5,-17.8],[0.8,-17.4]]),0.3).rotateX(-Math.PI/2),
    bFin:slab([[-10.5,0],[-15.6,7.5],[-17.8,7.5],[-17.4,0]],0.3).rotateY(Math.PI/2),
    bEng:new THREE.CylinderGeometry(0.85,0.7,5.2,24).rotateX(Math.PI/2),
    bPylon:new THREE.BoxGeometry(0.25,1.0,3.0),
    bTurret:new THREE.SphereGeometry(0.75,16,12),bGun:new THREE.CylinderGeometry(0.06,0.06,1.6,6).rotateX(Math.PI/2),
  };
  return JG;
}
function jetMats(s){
  if(JM[s.name])return JM[s.name];
  const tex=skinTex(s,s.name.length*97+3),wtex=tex.clone();wtex.repeat.set(0.13,0.13);wtex.needsUpdate=true;
  return JM[s.name]={
    body:new THREE.MeshStandardMaterial({map:tex,roughness:0.52,metalness:0.32}),
    wing:new THREE.MeshStandardMaterial({map:wtex,roughness:0.55,metalness:0.3}),
    dark:new THREE.MeshStandardMaterial({color:col(s.dark),roughness:0.6,metalness:0.3}),
    radome:new THREE.MeshStandardMaterial({color:col(s.name==='player'?'#4a525b':'#3f3a2e'),roughness:0.4,metalness:0.2}),
    accent:new THREE.MeshStandardMaterial({color:col(s.accent),roughness:0.5,metalness:0.2,polygonOffset:true,polygonOffsetFactor:-2}),
    mark:new THREE.MeshStandardMaterial({color:col(s.mark),roughness:0.5,metalness:0.1,polygonOffset:true,polygonOffsetFactor:-3}),
    metal:new THREE.MeshStandardMaterial({color:col('#3b3e43'),roughness:0.3,metalness:0.95}),
    burnt:new THREE.MeshStandardMaterial({color:col('#2a2522'),roughness:0.45,metalness:0.9}),
    glass:s.name==='player'
      ?new THREE.MeshPhysicalMaterial({color:col('#b9d4e2'),roughness:0.04,metalness:0.0,transmission:0,transparent:true,opacity:0.2,envMapIntensity:2.2,depthWrite:false,clearcoat:1})
      :new THREE.MeshStandardMaterial({color:col('#2b3f4c'),roughness:0.04,metalness:0.75,envMapIntensity:2}),
    msl:new THREE.MeshStandardMaterial({color:col('#e4e2da'),roughness:0.45,metalness:0.2}),
    navR:new THREE.MeshBasicMaterial({color:new THREE.Color(6,0.3,0.2)}),navG:new THREE.MeshBasicMaterial({color:new THREE.Color(0.3,6,1)}),
  };
}
function missileMesh(m){
  const G=jetGeos(),g=new THREE.Group();
  g.add(new THREE.Mesh(G.mBody,m.msl),new THREE.Mesh(G.mNose,m.dark));
  const f1=new THREE.Mesh(G.mFin,m.dark),f2=new THREE.Mesh(G.mFin,m.dark);f2.rotation.z=Math.PI/2;g.add(f1,f2);
  g.traverse(o=>{if(o.isMesh)o.castShadow=true;});
  return g;
}
function engineParts(g,M,x,y,z,r,add){ // nozzle + glow + afterburner plume
  const glowMat=new THREE.MeshBasicMaterial({color:new THREE.Color(1.6,0.55,0.18),fog:false});
  const abMat=new THREE.MeshBasicMaterial({map:AB_TEX,color:new THREE.Color(1.6,1.2,1.0),transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,fog:false});
  const disk=add(jetGeos().disk,glowMat,x,y,z+0.1);disk.scale.setScalar(r/0.44);
  const ab=add(jetGeos().ab,abMat,x,y,z+0.12);ab.scale.set(r/0.42,r/0.42,1);ab.castShadow=false;
  return {glowMat,abMat,ab};
}
function buildFighter(s){
  const G=jetGeos(),M=jetMats(s),g=new THREE.Group();
  const add=(geo,mat,x,y,z,parent=g)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x||0,y||0,z||0);m.castShadow=m.receiveShadow=true;parent.add(m);return m;};
  add(G.fus,M.body);add(G.radome,M.radome);
  add(G.spine,M.body,0,0.6,0.6);
  const can=add(G.canopy,M.glass,0,0.6,-4.4);can.castShadow=false;
  for(const z of [-5.3,-3.6]){const f=add(G.frame,M.dark,0,0.6,z);f.scale.set(0.98,0.92,1);}
  add(G.wingR,M.wing,0,-0.15,0);add(G.wingL,M.wing,0,-0.15,0);
  add(G.lerxR,M.wing,0,0.0,0);add(G.lerxL,M.wing,0,0.0,0);
  const stabs=[];for(const [geo,x] of [[G.stabR,1],[G.stabL,-1]]){const piv=new THREE.Group();piv.position.set(0,-0.1,7.0);g.add(piv);add(geo,M.wing,0,0,0,piv);stabs.push({piv,side:x});}
  const finMat=s.fin==='accent'?M.accent:M.body;
  const fr=add(G.fin,finMat,1.0,0.55,0);fr.rotation.z=-0.22;const fl=add(G.fin,finMat,-1.0,0.55,0);fl.rotation.z=0.22;
  const vr=add(G.ventral,M.dark,0.9,-0.8,0);vr.rotation.z=0.4;const vl=add(G.ventral,M.dark,-0.9,-0.8,0);vl.rotation.z=-0.4;
  add(G.intake,M.body,1.38,-0.35,-1.3);add(G.intake,M.body,-1.38,-0.35,-1.3);
  add(G.intakeLip,M.burnt,1.38,-0.35,-3.0);add(G.intakeLip,M.burnt,-1.38,-0.35,-3.0);
  add(G.nozzle,M.burnt,0.6,0,8.9);add(G.nozzle,M.burnt,-0.6,0,8.9);
  add(G.nozzleIn,M.burnt,0.6,0,9.2);add(G.nozzleIn,M.burnt,-0.6,0,9.2);
  const eng=[engineParts(g,M,0.6,0,9.55,0.44,add),engineParts(g,M,-0.6,0,9.55,0.44,add)];
  const brakePiv=new THREE.Group();brakePiv.position.set(0,0.88,3.4);g.add(brakePiv);add(G.brake,M.body,0,0,0,brakePiv);
  // roundels sit on the wing's top surface, mid-chord
  add(G.roundel,M.accent,4.6,0.012,2.4);add(G.roundel,M.accent,-4.6,0.012,2.4);
  add(G.roundelIn,M.mark,4.6,0.02,2.4);add(G.roundelIn,M.mark,-4.6,0.02,2.4);
  // pylons and rails under the wing; missiles hang from them
  add(G.pylon,M.dark,3.6,-0.32,1.5);add(G.pylon,M.dark,-3.6,-0.32,1.5);
  add(G.rail,M.dark,6.4,-0.15,2.7);add(G.rail,M.dark,-6.4,-0.15,2.7);
  const pyl=[[3.6,-0.5,1.3],[-3.6,-0.5,1.3],[6.4,-0.28,2.6],[-6.4,-0.28,2.6]];
  const msls=pyl.map(p=>{const mm=missileMesh(M);mm.position.set(p[0],p[1],p[2]);g.add(mm);return mm;});
  const navR=add(G.nav,M.navR,-6.3,-0.12,2.2),navG=add(G.nav,M.navG,6.3,-0.12,2.2);navR.castShadow=navG.castShadow=false;
  const strobe=add(G.nav,new THREE.MeshBasicMaterial({color:new THREE.Color(8,8,8)}),0,0.62,8.6);strobe.castShadow=false;
  g.userData={eng,msls,stabs,brakePiv,strobe,
    tips:[new V3(6.3,-0.12,3.0),new V3(-6.3,-0.12,3.0)],
    guns:[new V3(1.2,0.3,-3.2),new V3(-1.2,0.3,-3.2)],
    nozz:[new V3(0.6,0,9.7),new V3(-0.6,0,9.7)],canopy:new V3(0,1.0,-4.2)};
  return g;
}
function buildBomber(s){
  const G=jetGeos(),M=jetMats(s),g=new THREE.Group();
  const add=(geo,mat,x,y,z,parent=g)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x||0,y||0,z||0);m.castShadow=m.receiveShadow=true;parent.add(m);return m;};
  add(G.bFus,M.body);const nose=add(G.bNose,M.glass,0,0.15,-15.2);nose.scale.set(1.3,1.25,1.6);
  add(G.bWingR,M.wing,0,0.9,0);add(G.bWingL,M.wing,0,0.9,0);
  add(G.bStabR,M.wing,0,0.6,0);add(G.bStabL,M.wing,0,0.6,0);
  add(G.bFin,M.accent.clone(),0,1.6,0).material=M.body;
  const eng=[],nozz=[];
  for(const x of [-13,-7,7,13]){const z=x*x>100?3.0:-0.2;add(G.bPylon,M.dark,x,-0.1,z);add(G.bEng,M.dark,x,-0.9,z);
    eng.push(engineParts(g,M,x,-0.9,z+2.65,0.62,add));nozz.push(new V3(x,-0.9,z+2.8));}
  const tur=add(G.bTurret,M.glass,0,0.5,17.6);
  add(G.bGun,M.metal,0.18,0.5,18.4);add(G.bGun,M.metal,-0.18,0.5,18.4);
  add(G.roundel,M.accent,12,1.2,-1);add(G.roundel,M.accent,-12,1.2,-1);
  const navR=add(G.nav,M.navR,-22,0.9,7.2),navG=add(G.nav,M.navG,22,0.9,7.2);navR.scale.setScalar(2);navG.scale.setScalar(2);
  const strobe=add(G.nav,new THREE.MeshBasicMaterial({color:new THREE.Color(8,8,8)}),0,9.1,16.8);strobe.scale.setScalar(2);
  g.userData={eng,msls:[],stabs:[],brakePiv:null,strobe,
    tips:[new V3(22,0.9,7),new V3(-22,0.9,7)],guns:[new V3(0,0.5,19.2)],nozz,tail:new V3(0,0.5,19.2)};
  return g;
}

/* ---------------- aircraft ---------------- */
class Aircraft{
  constructor(kind){
    this.kind=kind;this.isPlayer=kind==='player';
    this.mesh=kind==='bomber'?buildBomber(SCHEMES.bomber):buildFighter(SCHEMES[kind]);scene.add(this.mesh);
    this.pos=this.mesh.position;this.quat=this.mesh.quaternion;
    this.vel=new V3();this.fwd=new V3(0,0,-1);this.up=new V3(0,1,0);
    this.ctl={p:0,r:0,y:0};this.inp={p:0,r:0,y:0};
    this.radius=kind==='bomber'?20:kind==='player'?7.5:9.5;
    this.maxHp=kind==='bomber'?420:kind==='ace'?150:100;
    this.pitchRate=kind==='bomber'?0.45:1.4;this.rollRate=kind==='bomber'?0.9:3.1;this.yawRate=0.38;this.gLimit=kind==='bomber'?3:12;
    this.thrustMax=kind==='bomber'?17:30;
    this.reset(new V3(0,1500,0),new V3(0,0,-1),230);
  }
  reset(pos,dir,speed){
    this.pos.copy(pos);setHeading(this.quat,dir);this.fwd.copy(dir).normalize();this.up.set(0,1,0).applyQuaternion(this.quat);
    this.speed=speed;this.vel.copy(this.fwd).multiplyScalar(speed);this.throttle=0.9;this.brake=0;
    this.ctl.p=this.ctl.r=this.ctl.y=0;this.inp.p=this.inp.r=this.inp.y=0;
    this.hp=this.maxHp;this.alive=true;this.falling=false;this.mesh.visible=true;this.stall=0;this.g=1;
    this.gunCd=0;this.gunSide=0;this.missiles=this.mesh.userData.msls.length;this.mslCd=0;this.smokeAcc=0;this.vaporAcc=0;
    this.mesh.userData.msls.forEach(m=>m.visible=true);
  }
  physics(dt){
    const c=this.ctl,i=this.inp,k=1-Math.exp(-dt*7);
    c.p+=(i.p-c.p)*k;c.r+=(i.r-c.r)*k;c.y+=(i.y-c.y)*k;
    const v=Math.max(this.speed,1);
    let eff=clamp((v-45)/130,0.12,1);if(v>340)eff*=clamp(1-(v-340)/500,0.6,1);
    const pr=Math.min(this.pitchRate*eff,this.gLimit*9.81/v);
    _e.set(c.p*pr*dt,-c.y*this.yawRate*eff*dt,-c.r*this.rollRate*clamp(eff*1.4,0.25,1)*dt,'XYZ');
    _q.setFromEuler(_e);this.quat.multiply(_q);
    if(this.stall>0&&this.fwd.y>-0.75){_q.setFromAxisAngle(AX,-this.stall*0.9*dt);this.quat.multiply(_q);}
    this.quat.normalize();
    this.fwd.copy(FWD).applyQuaternion(this.quat);this.up.copy(AY).applyQuaternion(this.quat);
    const thr=this.throttle,tm=this.thrustMax,thrust=thr<=1?thr*tm:tm+(thr-1)*tm*4.7;
    const drag=3.1e-4*v*v+this.brake*(5+1.1e-3*v*v),induced=Math.abs(c.p)*eff*(6+v*0.035);
    this.speed=Math.max(0,this.speed+(thrust-drag-induced-9.81*this.fwd.y)*dt);
    this.stall=clamp((72-this.speed)/45,0,1);
    this.vel.copy(this.fwd).multiplyScalar(this.speed);this.vel.y-=this.stall*38;
    this.pos.addScaledVector(this.vel,dt);
    this.g=lerp(this.g,c.p*pr*this.speed/9.81+this.up.y,1-Math.exp(-dt*5));
    // moving parts and engine visuals
    const ud=this.mesh.userData,wep=clamp((thr-1)/0.1,0,1);
    for(const e of ud.eng){
      e.abMat.opacity=this.alive?wep*0.9+thr*0.08:0;
      e.ab.scale.z=0.6+wep*(5.5+Math.random()*1.2)+thr*0.6;
      e.glowMat.color.setRGB(0.6+thr*1.8+wep*2,0.25+thr*0.7+wep*0.8,0.1+thr*0.2);
    }
    for(const s of ud.stabs)s.piv.rotation.x=-c.p*0.32+s.side*c.r*0.18;
    if(ud.brakePiv)ud.brakePiv.rotation.x=lerp(ud.brakePiv.rotation.x,-0.95*this.brake,1-Math.exp(-dt*6));
    if(ud.strobe)ud.strobe.visible=((performance.now()*0.001+this.pos.x*1e-3)%1.2)<0.08;
  }
  world(local,out){return out.copy(local).applyQuaternion(this.quat).add(this.pos);}
  effects(dt){
    if(!this.mesh.visible)return;
    const ud=this.mesh.userData;
    if(Math.abs(this.ctl.p)>0.45&&this.speed>130&&!this.falling&&this.kind!=='bomber'){
      this.vaporAcc+=dt*45;
      while(this.vaporAcc>1){this.vaporAcc--;for(const t of ud.tips){this.world(t,_a);smoke.spawn(_a.x,_a.y,_a.z,0,0,0,0.8,1.0,4.5,0.38,1,1,1,0,0);}}
    }
    if(this.pos.y>2600&&this.alive){ // contrails at altitude
      for(const n of ud.nozz){this.world(n,_a);smoke.spawn(_a.x,_a.y,_a.z,0,0,0,4,1.5,14,0.25*clamp((this.pos.y-2600)/600,0,1),1,1,1,0,0);}
    }
    if(this.throttle>1.0&&this.alive){for(const n of ud.nozz){this.world(n,_a);_b.copy(this.fwd).multiplyScalar(-this.speed*0.15);
      fire.spawn(_a.x,_a.y,_a.z,_b.x,_b.y,_b.z,0.08,2.4,0.8,0.7,2.4,1.0,0.4,0,0);}}
    const hpF=this.hp/this.maxHp;
    if(hpF<0.6||this.falling){
      this.smokeAcc+=dt*(this.falling?55:22*(1-hpF/0.6)+6);
      while(this.smokeAcc>1){this.smokeAcc--;
        const dark=this.falling?0.05:0.18;_a.set(rand(-1,1),rand(-1,1),rand(-1,1));
        smoke.spawn(this.pos.x+_a.x,this.pos.y+_a.y,this.pos.z+_a.z,_a.x*3,_a.y*3+2,_a.z*3,this.falling?4.5:2.5,4,this.falling?40:22,this.falling?0.8:0.5,dark,dark,dark,0.4,1.5);
        if(this.falling||hpF<0.3)fire.spawn(this.pos.x,this.pos.y,this.pos.z,rand(-4,4),rand(-4,4),rand(-4,4),0.35,6,2,0.9,2.8,1.2,0.35,0,0);
      }
    }
  }
}

/* instructor: turn a world direction into stick inputs */
const _lt=new V3(),_lu=new V3(),_iq=new Q();
function steer(a,dir,out){
  _iq.copy(a.quat).invert();_lt.copy(dir).applyQuaternion(_iq);_lu.copy(AY).applyQuaternion(_iq);
  const ang=Math.acos(clamp(-_lt.z,-1,1));
  let pitch=clamp(_lt.y*3.2,-0.35,1),yaw=clamp(_lt.x*2.4,-1,1);
  const aggressive=clamp(_lt.x*5,-1,1),level=clamp(_lu.x*2.5,-1,1);
  let roll=lerp(level,aggressive,clamp(ang/0.22,0,1));
  if(_lt.z>0){pitch=_lt.y>-0.15?1:0.25;if(Math.abs(_lt.x)<0.15&&_lt.y<-0.15)roll=1;}
  out.p=pitch;out.r=roll;out.y=yaw;return ang;
}
function avoidTerrain(a,out){
  const agl=a.pos.y-groundAt(a.pos.x,a.pos.z);const look=clamp(a.speed*0.022,2,7);let danger=agl<240;
  for(let s=1;s<=3&&!danger;s++){const t=look*s/3;const px=a.pos.x+a.vel.x*t,py=a.pos.y+a.vel.y*t,pz=a.pos.z+a.vel.z*t;if(py<groundAt(px,pz)+200)danger=true;}
  if(!danger)return null;
  out.set(a.fwd.x,0,a.fwd.z);if(out.lengthSq()<1e-4)out.set(0,0,-1);out.normalize();out.y=1.1;return out.normalize();
}

/* ---------------- weapons ---------------- */
const BULLET_V=1000;
const bulletMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(0.32,0.32,1).translate(0,0,0.5),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,fog:false}),900);
bulletMesh.frustumCulled=false;bulletMesh.renderOrder=4;scene.add(bulletMesh);
const TRACER_P=new THREE.Color(5,2.8,1),TRACER_E=new THREE.Color(5.5,1.2,0.7);
for(let i=0;i<900;i++)bulletMesh.setColorAt(i,TRACER_P);
const bullets=[];for(let i=0;i<900;i++)bullets.push({on:false,p:new V3(),v:new V3(),life:0,owner:null,dmg:0});
let bulletIdx=0;
function fireBullet(owner,origin,dir,spread,dmg,baseVel){
  const b=bullets[bulletIdx];bulletIdx=(bulletIdx+1)%bullets.length;
  b.on=true;b.p.copy(origin);_c.set(rand(-1,1),rand(-1,1),rand(-1,1)).multiplyScalar(spread).add(dir).normalize();
  b.v.copy(baseVel||owner.vel).addScaledVector(_c,BULLET_V);b.life=1.7;b.owner=owner;b.dmg=dmg;
}
const _bd=new THREE.Object3D();
function updateBullets(dt){
  let n=0;
  for(const b of bullets){
    if(!b.on)continue;
    _a.copy(b.p);b.p.addScaledVector(b.v,dt);b.v.y-=4.9*dt;b.life-=dt;
    if(b.life<=0){b.on=false;continue;}
    const targets=b.owner===P?enemies:[P];let hit=false;
    _b.subVectors(b.p,_a);const dd=_b.lengthSq();
    for(const t of targets){
      if(!t.alive||t.falling||t===b.owner)continue;
      _c.subVectors(t.pos,_a);const s=clamp(_c.dot(_b)/dd,0,1);_d.copy(_a).addScaledVector(_b,s);
      if(_d.distanceToSquared(t.pos)<t.radius*t.radius){
        hit=true;if(b.owner===P)rec.hits++;for(let k=0;k<6;k++)fire.spawn(_d.x,_d.y,_d.z,rand(-30,30)+t.vel.x,rand(-30,30)+t.vel.y,rand(-30,30)+t.vel.z,0.25,1.8,0.6,1,3.5,2.2,0.9,1,0);
        damage(t,b.dmg,'cannon',b.owner);break;
      }
    }
    if(hit){b.on=false;continue;}
    const gh=groundRaw(b.p.x,b.p.z);
    if(b.p.y<Math.max(gh,0)){b.on=false;
      if(b.p.distanceToSquared(camera.position)<9e6){const wet=gh<0;for(let k=0;k<3;k++)smoke.spawn(b.p.x,Math.max(gh,0),b.p.z,rand(-3,3),rand(6,14),rand(-3,3),1.2,2,9,0.55,wet?0.85:0.42,wet?0.88:0.36,wet?0.9:0.28,1,-6);}
      continue;}
    _bd.position.copy(b.p);_c.copy(b.v).normalize().negate();_bd.quaternion.setFromUnitVectors(AZ,_c);
    _bd.scale.set(1,1,b.owner===P?20:16);_bd.updateMatrix();bulletMesh.setMatrixAt(n,_bd.matrix);
    bulletMesh.setColorAt(n,b.owner===P?TRACER_P:TRACER_E);n++;
  }
  bulletMesh.count=n;bulletMesh.instanceMatrix.needsUpdate=true;if(bulletMesh.instanceColor)bulletMesh.instanceColor.needsUpdate=true;
}

const missiles=[],flares=[],bombs=[];
function launchMissile(owner,target){
  const ud=owner.mesh.userData;const idx=ud.msls.length-owner.missiles;const pyl=ud.msls[idx];
  owner.missiles--;
  pyl.getWorldPosition(_a);pyl.visible=false;
  const mm=missileMesh(jetMats(SCHEMES[owner.isPlayer?'player':'fighter']));scene.add(mm);
  const m={owner,target,pos:_a.clone(),dir:owner.fwd.clone(),speed:owner.speed+25,t:0,life:10,prevD:1e9,mesh:mm,
    turn:owner.isPlayer?0.82:0.55,flareRolled:false,trailAcc:0};
  missiles.push(m);
  Snd.whoosh(volAt(m.pos));
  if(owner.isPlayer){feed(target?`Fox two on <b>${target.name}</b>`:'Missile away','good');director.event('missile',m);rec.msl++;}
  else feed(`<b>${owner.name}</b> <i>missile launch</i>`);
}
function deployFlares(a,n){
  let first=null;
  for(let k=0;k<n;k++){
    const side=k%2?1:-1;
    const f={pos:a.pos.clone(),vel:a.vel.clone().multiplyScalar(0.55),life:4.2,alive:true,falling:false,isFlare:true,acc:0};
    _a.set(side,0,0).applyQuaternion(a.quat).multiplyScalar(rand(25,45));f.vel.add(_a);f.vel.y-=rand(10,25);
    flares.push(f);if(!first)first=f;
  }
  return first;
}
function updateMissiles(dt){
  for(let i=missiles.length-1;i>=0;i--){
    const m=missiles[i];m.t+=dt;m.life-=dt;
    if(m.t<2.6)m.speed=Math.min(m.speed+330*dt,800);else m.speed=Math.max(m.speed-25*dt,320);
    let tg=m.target;
    if(tg&&(!tg.alive||tg.falling)){m.target=tg=null;}
    let det=false;
    if(tg&&m.t>0.3){
      _a.subVectors(tg.pos,m.pos);const d=_a.length();
      if(!m.flareRolled&&!tg.isFlare&&m.owner===P&&d<1500){
        m.flareRolled=true;
        if(Math.random()<(tg.kind==='ace'?0.45:0.25)&&tg.kind!=='bomber'){const nm=tg.name;const f=deployFlares(tg,4);m.target=tg=f;feed(`<b>${nm}</b> <i>dumped flares · missile decoyed</i>`);}
      }
      if(tg){
        _a.subVectors(tg.pos,m.pos);const d2=_a.length();const losd=_a.clone().divideScalar(d2);
        if(losd.dot(m.dir)<0.45){m.target=null;}
        else{
          const closing=Math.max(m.speed-tg.vel.dot(losd),120),tgo=d2/closing;
          _b.copy(tg.pos).addScaledVector(tg.vel,tgo).sub(m.pos).normalize();
          const ang=Math.acos(clamp(m.dir.dot(_b),-1,1)),mx=m.turn*dt*(m.t<1?0.6:1);
          if(ang>1e-4)m.dir.lerp(_b,Math.min(1,mx/ang)).normalize();
          const fuse=tg.radius?tg.radius+6:15;
          if(d2<fuse||(d2<fuse+40&&d2>m.prevD))det=true;
          m.prevD=d2;
        }
      }
    }
    m.pos.addScaledVector(m.dir,m.speed*dt);
    m.mesh.position.copy(m.pos);m.mesh.quaternion.setFromUnitVectors(FWD,m.dir);
    _a.copy(m.pos).addScaledVector(m.dir,-1.6);
    fire.spawn(_a.x,_a.y,_a.z,0,0,0,0.06,6,2,1,4,2,0.8,0,0);
    m.trailAcc+=dt*(m.t<2.6?80:28);
    while(m.trailAcc>1){m.trailAcc--;const s=Math.random();
      smoke.spawn(_a.x-m.dir.x*s*m.speed*dt,_a.y-m.dir.y*s*m.speed*dt,_a.z-m.dir.z*s*m.speed*dt,rand(-1,1),rand(0,1),rand(-1,1),m.t<2.6?4.5:2.5,2.5,17,0.6,0.88,0.88,0.88,0.3,0.6);}
    if(m.pos.y<groundAt(m.pos.x,m.pos.z))det=true;
    if(det||m.life<=0){detonate(m);missiles.splice(i,1);}
  }
}
function detonate(m){
  scene.remove(m.mesh);explode(m.pos,0.75,null);
  for(const a of [P,...enemies]){
    if(!a.alive||a.falling)continue;
    const d=a.pos.distanceTo(m.pos);const reach=60+(a.radius||8);if(d>reach)continue;
    const base=m.owner===P?(a.kind==='bomber'?260:165):74;
    if(m.owner===P&&a!==P&&!m.counted){m.counted=true;rec.mslHits++;}
    damage(a,base*(1-clamp((d-12-(a.radius||8))/50,0,0.65)),'missile',m.owner);
  }
}
function updateFlares(dt){
  for(let i=flares.length-1;i>=0;i--){
    const f=flares[i];f.life-=dt;f.vel.multiplyScalar(1-0.6*dt);f.vel.y-=6*dt;f.pos.addScaledVector(f.vel,dt);
    fire.spawn(f.pos.x,f.pos.y,f.pos.z,0,0,0,0.12,10,4,1,6,4.5,3,0,0);
    f.acc+=dt*30;while(f.acc>1){f.acc--;smoke.spawn(f.pos.x,f.pos.y,f.pos.z,rand(-1,1),rand(0,2),rand(-1,1),2.2,1.5,9,0.5,0.9,0.9,0.92,0.4,1);}
    if(f.life<=0){f.alive=false;flares.splice(i,1);}
  }
}
function updateBombs(dt){
  for(let i=bombs.length-1;i>=0;i--){
    const b=bombs[i];b.vel.y-=9.81*dt;b.pos.addScaledVector(b.vel,dt);b.mesh.position.copy(b.pos);
    b.mesh.quaternion.setFromUnitVectors(FWD,_a.copy(b.vel).normalize());
    if(b.pos.y<=groundAt(b.pos.x,b.pos.z)){scene.remove(b.mesh);explode(b.pos,1.1,null);if(Math.random()<0.5)groundFire(b.pos);bombs.splice(i,1);}
  }
}

/* explosions */
const emitters=[];
function explode(pos,scale,vel){
  const vx=vel?vel.x*0.25:0,vy=vel?vel.y*0.25:0,vz=vel?vel.z*0.25:0;
  for(let i=0;i<3;i++)fire.spawn(pos.x,pos.y,pos.z,vx,vy,vz,0.25,24*scale,90*scale,0.8,3,2,1.2,0,0);
  for(let i=0;i<40;i++){randDir(_a).multiplyScalar(rand(10,70)*scale);
    fire.spawn(pos.x,pos.y,pos.z,_a.x+vx,_a.y+vy,_a.z+vz,rand(0.6,1.5),9*scale,rand(30,62)*scale,0.85,rand(2.2,2.8),rand(0.9,1.3),0.3,2.6,2);}
  for(let i=0;i<42;i++){randDir(_a).multiplyScalar(rand(4,34)*scale);
    const g=rand(0.07,0.15);smoke.spawn(pos.x,pos.y,pos.z,_a.x+vx,_a.y+vy,_a.z+vz,rand(3.5,7.5),16*scale,rand(85,160)*scale,0.85,g,g*0.95,g*0.9,1.1,3);}
  for(let i=0;i<50;i++){randDir(_a).multiplyScalar(rand(60,220)*scale);
    fire.spawn(pos.x,pos.y,pos.z,_a.x+vx,_a.y+vy,_a.z+vz,rand(0.8,2.4),2.4,1,1,4,2.2,0.7,0.5,-9.8);}
  const fl=flashLights.reduce((a,b)=>a.t<b.t?a:b);fl.l.position.copy(pos);fl.t=0.7;fl.peak=1.4e5*scale;
  const d=pos.distanceTo(camera.position);
  Snd.boom(clamp(1-d/5000,0,1)*Math.min(scale,1.4));
  shake=Math.max(shake,clamp(1-d/900,0,1)*1.6*scale);
}
function groundFire(pos){emitters.push({x:pos.x,y:groundAt(pos.x,pos.z),z:pos.z,t:30,acc:0});}
function updateEmitters(dt){
  for(let i=emitters.length-1;i>=0;i--){
    const e=emitters[i];e.t-=dt;if(e.t<=0){emitters.splice(i,1);continue;}
    e.acc+=dt*9;
    while(e.acc>1){e.acc--;const g=rand(0.05,0.1);
      smoke.spawn(e.x+rand(-8,8),e.y+4,e.z+rand(-8,8),rand(-2,2)+5,rand(9,16),rand(-2,2)+3,rand(8,13),18,rand(110,190),0.6*clamp(e.t/8,0,1),g,g,g,0.15,0.6);
      if(e.t>12)fire.spawn(e.x+rand(-6,6),e.y+3,e.z+rand(-6,6),0,rand(6,12),0,0.6,12,4,0.9,3,1.3,0.35,0,0);}
  }
}
let shake=0;
const volAt=p=>clamp(1-p.distanceTo(camera.position)/4500,0,1);

/* ---------------- game state ---------------- */
const P=new Aircraft('player');P.name='Viper 1';
const fly=new FlyPilot(),viz=new BrainViz(fly),learner=new Learner();viz.learner=learner;
fly.load(import.meta.env.BASE_URL+'fly/').then(()=>{
  if(!fly.ready){feed('The fruit fly pilot could not load <i>· autopilot only</i>');return;}
  fly.model.position.set(0,1.0,-3.9);P.mesh.add(fly.model);
});
const director=new Director(camera,groundAt);
director.onCut=(shot,title)=>{const el=$('shot');el.textContent=title;el.classList.remove('show');void el.offsetWidth;el.classList.add('show');};
const enemies=[],pool={fighter:[],ace:[],bomber:[]};
const CALLSIGNS=['Krait','Mamba','Viper','Asp','Taipan','Cobra','Adder','Racer','Boomslang','Sidewinder'];
let score=0,wave=0,kills=0,sortie=1,waveActive=false,waveTimer=3,deathT=-1,time=0,airfieldHits=0;
let ammo=1000,flareCount=16,mslCd=0,lockTarget=null,lockT=0,hitMarkT=0,hurt=0,gunHeat=0;
let soundOn=false,stats={best:0};
try{stats.best=+(localStorage.getItem('valley-intercept-best-wave')||0)||0;}catch(e){}

function resetPlayer(){
  P.reset(new V3(AF.x+2400,1500,AF.z+2600),new V3(0.25,0,-1).normalize(),240);P.throttle=0.95;
}
function waveSpec(n){
  const T=[{f:2},{f:3},{f:2,b:1},{f:3,a:1},{f:2,b:2},{f:3,a:2,b:1}];
  if(n<=T.length)return T[n-1];
  return {f:Math.min(3+Math.floor((n-6)/2),6),a:Math.min(1+Math.floor((n-6)/3),3),b:n%2?2:1};
}
function spawn(kind,pos,dir,i){
  let e=pool[kind].pop();
  if(!e)e=new Aircraft(kind);else scene.add(e.mesh);
  e.reset(pos,dir,kind==='bomber'?185:240);e.throttle=1;
  e.name=kind==='bomber'?`Bomber ${String.fromCharCode(65+i)}`:kind==='ace'?`Ace ${CALLSIGNS[(wave*3+i)%CALLSIGNS.length]}`:`Bandit ${i+1}`;
  const ace=kind==='ace';
  e.gLimit=kind==='bomber'?3:Math.min((ace?11.5:9.4)+wave*0.25,12);e.pitchRate=kind==='bomber'?0.45:1.25+(ace?0.12:0);
  e.skill=ace?0.25:clamp(1-wave*0.07,0.4,1);e.err=new V3();e.errT=0;e.evadeT=0;e.evadeDir=new V3();e.burst=0;e.burstCd=rand(1,3);
  e.mslCd=rand(10,22);e.missiles=kind==='bomber'?0:ace?2:(wave>=2?2:1);
  e.mesh.userData.msls.forEach((m,k)=>m.visible=k>=e.mesh.userData.msls.length-e.missiles);
  e.spread=new V3(rand(-1,1),rand(-0.3,0.3),rand(-1,1)).multiplyScalar(220);
  if(kind==='bomber'){e.run=0;e.dropped=false;e.home=pos.clone();}
  enemies.push(e);return e;
}
function clearEnemies(){for(const e of enemies){scene.remove(e.mesh);if(!e.human)pool[e.kind].push(e);}enemies.length=0;}
function startWave(){
  wave++;const s=waveSpec(wave);
  // enter ~8 km from the fly, on the side away from the airfield
  const away=Math.atan2(P.pos.z-AF.z,P.pos.x-AF.x)+rand(-0.9,0.9);
  const entry=new V3(P.pos.x+Math.cos(away)*8000,0,P.pos.z+Math.sin(away)*8000);
  const er=Math.hypot(entry.x,entry.z);if(er>ARENA-1500)entry.multiplyScalar((ARENA-1500)/er);
  const dirIn=new V3(P.pos.x-entry.x,0,P.pos.z-entry.z).normalize();
  let i=0;
  for(let k=0;k<(s.b||0);k++){const p=entry.clone().addScaledVector(new V3(-dirIn.z,0,dirIn.x),(k-0.5)*600);p.y=Math.max(1350,groundAt(p.x,p.z)+700);
    spawn('bomber',p,_a.set(AF.x-p.x,0,AF.z-p.z).normalize(),k);}
  for(let k=0;k<(s.f||0)+(s.a||0);k++){const kind=k<(s.a||0)?'ace':'fighter';
    const p=entry.clone().addScaledVector(new V3(-dirIn.z,0,dirIn.x),rand(-1500,1500)).addScaledVector(dirIn,rand(-500,800));
    p.y=clamp(P.pos.y+rand(-200,800),groundAt(p.x,p.z)+700,4200);
    spawn(kind,p,_a.subVectors(P.pos,p).setY(0).normalize(),i++);}
  waveActive=true;
  const parts=[s.f&&`${s.f} fighter${s.f>1?'s':''}`,s.a&&`${s.a} ace${s.a>1?'s':''}`,s.b&&`${s.b} bomber${s.b>1?'s':''}`].filter(Boolean).join(' · ');
  banner(`Wave ${wave}`,parts);director.event('wave');
  if(pilotMode==='fly')learner.startEpisode();
  if(wave>stats.best){stats.best=wave;try{localStorage.setItem('valley-intercept-best-wave',String(wave));}catch(e){}}
}
function newSortie(){
  rec.deaths++;
  for(const m of missiles)scene.remove(m.mesh);missiles.length=0;flares.length=0;
  for(const b of bombs)scene.remove(b.mesh);bombs.length=0;
  bullets.forEach(b=>b.on=false);clearEnemies();
  ammo=1000;flareCount=16;mslCd=0;lockTarget=null;lockT=0;hurt=0;
  resetPlayer();sortie++;wave=Math.max(0,wave-1);waveActive=false;waveTimer=3;deathT=-1;
  banner(`Sortie ${sortie}`,'The fly takes off again');director.cut('flyby',{},5);
}
function damage(a,amt,cause,by){
  if(!a.alive||a.falling)return;
  a.hp-=amt;
  if(a===P){if(pilotMode!=='duel')hurt=Math.min(1,hurt+amt/30);fly.notifyHit();shake=Math.max(shake,0.35+amt/80);Snd.thud();if(pilotMode!=='player')learner.punish(amt);}
  else if(a===HJ){hurt=Math.min(1,hurt+amt/30);Snd.thud();}
  else if(by===ctrl()&&cause==='cannon'){hitMarkT=0.12;Snd.hit();}
  if(a.hp<=0)kill(a,cause,by);
}
function kill(a,cause,by){
  if(a===P){
    a.alive=false;a.hp=0;explode(a.pos,1.5,a.vel);a.mesh.visible=false;deathT=0;
    feed(`<b>${pilotMode==='duel'?'The fly':'Viper 1'}</b> ${cause==='terrain'?'flew into terrain':cause==='missile'?'hit by a missile':'shot down'}`);
    if(cause==='terrain')groundFire(a.pos);
    if(pilotMode==='duel'){duel.you++;learner.endEpisode(true,false);}
    else if(pilotMode==='fly'){const r=learner.endEpisode(true,false);if(r)feed(`Fly learned <i>· ${learner.lastEvent}</i>`,'good');}
    director.event(pilotMode==='duel'&&director.mode==='player'?'kill':'death',a);
    return;
  }
  if(a.human){
    a.alive=false;a.hp=0;explode(a.pos,1.5,a.vel);a.mesh.visible=false;duel.fly++;duel.respawnH=4;
    feed(`<b>You</b> ${cause==='terrain'?'flew into terrain':'were shot down by the fly'}`);
    if(cause==='terrain')groundFire(a.pos);
    learner.reward();learner.endEpisode(false,true);learner.startEpisode();
    director.event('kill',a);
    return;
  }
  kills++;const pts=(a.kind==='bomber'?300:a.kind==='ace'?250:100)+(cause==='missile'?50:0);score+=pts;
  if(by===P&&pilotMode==='fly')learner.reward();
  feed(`<b>${a.name}</b> destroyed <i>· ${by==='flak'?'airfield flak':cause} +${pts}</i>`,'good');
  if(cause==='missile'&&Math.random()<0.5&&a.kind!=='bomber'){explode(a.pos,1.3,a.vel);a.alive=false;a.mesh.visible=false;}
  else{a.falling=true;a.hp=0;a.fallSpin=rand(-2.6,2.6)*(a.kind==='bomber'?0.3:1);explode(a.pos,a.kind==='bomber'?0.9:0.45,a.vel);}
  if(lockTarget===a){lockTarget=null;lockT=0;}
  director.event('kill',a);
}

/* enemy brains */
function think(e,dt){
  if(e.kind==='bomber'){bomberThink(e,dt);return;}
  const out=_d;let dir=avoidTerrain(e,out);
  const toP=_a.subVectors(P.pos,e.pos),d=toP.length();toP.divideScalar(Math.max(d,1));
  e.throttle=1;
  if(!dir&&Math.hypot(e.pos.x,e.pos.z)>ARENA-500)dir=out.set(-e.pos.x,0,-e.pos.z).normalize();
  let leadOK=false;
  if(!dir&&P.alive){
    const onMyTail=P.fwd.dot(_b.copy(toP).negate())>0.95&&e.fwd.dot(toP)<-0.2&&d<1600;
    e.evadeT-=dt;
    if(onMyTail){
      if(e.evadeT<=0){e.evadeT=rand(1.4,2.8);_c.set(Math.random()<0.5?1:-1,0,0).applyQuaternion(e.quat);
        e.evadeDir.copy(_c).addScaledVector(e.up,rand(-0.5,0.7)).addScaledVector(e.fwd,0.25).normalize();
        if(Math.random()<(e.kind==='ace'?0.5:0.25)&&flares.length<24)deployFlares(e,2);}
      dir=out.copy(e.evadeDir);e.throttle=1.1;
    }else{
      const t=d/(BULLET_V*0.95);
      dir=out.copy(P.vel).sub(e.vel).multiplyScalar(t).add(P.pos);
      if(d>1500)dir.add(e.spread); // spread out on the way in so they do not stack up
      dir.sub(e.pos).normalize();
      if(d>2600)dir.copy(toP);
      e.errT-=dt;if(e.errT<=0){e.errT=rand(0.6,1.6);randDir(e.err).multiplyScalar(e.skill);}
      leadOK=e.fwd.dot(dir)>0.9985&&d<1100;
      dir.addScaledVector(e.err,0.035).normalize();
      if(dir.y<-0.6){dir.y=-0.6;dir.normalize();}
      e.throttle=d>1800?1.1:(e.speed<170?1.1:0.92);
    }
  }
  if(!dir){dir=out.set(e.fwd.x,0,e.fwd.z).normalize();_q.setFromAxisAngle(AY,0.25);dir.applyQuaternion(_q);dir.y=clamp((2000-e.pos.y)*0.0006,-0.3,0.3);dir.normalize();e.throttle=0.85;}
  steer(e,dir,e.inp);
  e.burstCd-=dt;
  if(leadOK&&e.burst<=0&&e.burstCd<=0){e.burst=rand(0.4,0.9);e.burstCd=rand(1.2,2.6);}
  if(e.burst>0){e.burst-=dt;e.gunCd-=dt;
    if(e.gunCd<=0){e.gunCd=1/12;e.gunSide^=1;e.world(e.mesh.userData.guns[e.gunSide],_c);fireBullet(e,_c,e.fwd,0.006+0.008*e.skill,3.2);
      const v=volAt(_c);if(v>0.05)Snd.shot(v*0.6);}}
  e.mslCd-=dt;
  if(e.missiles>0&&e.mslCd<=0&&P.alive&&d>900&&d<3400&&e.fwd.dot(toP)>0.97){e.mslCd=rand(16,28);launchMissile(e,P);}
}
function bomberThink(e,dt){
  // bombing runs on the airfield; a tail gunner covers the rear
  const out=_d;let dir=avoidTerrain(e,out);
  const tx=e.dropped?e.home.x:AF.x,tz=e.dropped?e.home.z:AF.z;
  if(!dir){dir=out.set(tx-e.pos.x,(1400-e.pos.y)*0.004,tz-e.pos.z).normalize();}
  e.throttle=0.85;steer(e,dir,e.inp);
  const hd=Math.hypot(e.pos.x-AF.x,e.pos.z-AF.z);
  if(!e.dropped&&hd<650){
    e.dropped=true;airfieldHits++;score=Math.max(0,score-200);
    feed(`<b>${e.name}</b> bombed the airfield <i>· −200</i>`);banner('Airfield hit',`${e.name} got through`);
    for(let k=0;k<8;k++){const m=new THREE.Mesh(jetGeos().mBody,jetMats(SCHEMES.bomber).dark);m.scale.set(3,3,0.6);scene.add(m);
      bombs.push({pos:e.pos.clone().addScaledVector(e.fwd,-k*14).add(_a.set(rand(-4,4),-2,rand(-4,4))),vel:e.vel.clone().multiplyScalar(0.95),mesh:m});}
  }
  if(e.dropped&&Math.hypot(e.pos.x-e.home.x,e.pos.z-e.home.z)<1500)e.dropped=false; // come back for another run
  // tail gunner
  if(P.alive){
    const rel=_a.subVectors(P.pos,e.pos),d=rel.length();
    e.gunCd-=dt;
    if(d<900&&e.fwd.dot(rel.divideScalar(d))<-0.35&&e.gunCd<=0){
      e.gunCd=1/7;e.world(e.mesh.userData.tail,_c);
      const t=d/BULLET_V;_b.copy(P.vel).sub(e.vel).multiplyScalar(t).add(P.pos).sub(_c).normalize();
      fireBullet(e,_c,_b,0.028,1.7);const v=volAt(_c);if(v>0.05)Snd.shot(v*0.5);
    }
  }
}

/* ---------------- fly control ---------------- */
let flyCmd=null;
const worldCtx={P,enemies,missiles,groundAt,fogDen:FOG_DEN,locked:false,lockTarget:null,time:0,patrol:AF,home:AF,learner};
function tryMissile(){if(!P.alive||P.missiles<=0||mslCd>0||!(lockT>=LOCK_T&&lockTarget))return;mslCd=1.2;launchMissile(P,lockTarget);}
function tryFlares(a=P){
  if(!a.alive)return;
  if(a===P){if(flareCount<=0)return;flareCount--;}else{if(!(a.flares>0))return;a.flares--;}
  const f=deployFlares(a,4);let spoofed=0;
  for(const m of missiles)if(m.target===a&&m.pos.distanceTo(a.pos)<4000&&Math.random()<0.75){m.target=flares[flares.length-1-Math.floor(Math.random()*4)]||f;spoofed++;}
  if(spoofed)feed('Missile <i>decoyed by flares</i>','good');
}
function updatePlayer(dt){
  if(!P.alive)return;
  if(fly.ready&&pilotMode==='player'){
    worldCtx.locked=lockT>=LOCK_T&&!!lockTarget;worldCtx.lockTarget=lockTarget;worldCtx.time=time;
    flyCmd=fly.update(dt,worldCtx); // the fly still sees and decides; its wish is drawn on the HUD
    humanControl(P,dt);
  }else if(fly.ready){
    worldCtx.locked=lockT>=LOCK_T&&!!lockTarget;worldCtx.lockTarget=lockTarget;worldCtx.time=time;
    flyCmd=fly.update(dt,worldCtx);
    _d.copy(flyCmd.dir);
    if(Math.hypot(P.pos.x,P.pos.z)>ARENA+3000)_d.set(-P.pos.x,0,-P.pos.z).normalize();
    steer(P,_d,P.inp);
    P.throttle=lerp(P.throttle,flyCmd.throttle,1-Math.exp(-dt*2.5));P.brake=lerp(P.brake,flyCmd.brake,1-Math.exp(-dt*4));
    if(flyCmd.escaped){feed('Giant fiber fired <i>· escape manoeuvre</i>');director.event('escape');}
    if(flyCmd.missile)tryMissile();
    if(flyCmd.flares)tryFlares();
    P.gunCd-=dt;gunHeat=Math.max(0,gunHeat-dt*0.25);
    if(flyCmd.fire&&gunHeat<1&&shootGun(P))gunHeat+=0.012;
  }else{
    const av=avoidTerrain(P,_d);steer(P,av||_d.set(AF.x-P.pos.x,(1600-P.pos.y)*0.5,AF.z-P.pos.z).normalize(),P.inp);P.throttle=0.9;
  }
  P.physics(dt);
}
const LOCK_T=0.6; // seeker locks within ~29 deg of the nose, out to 4 km
function lockScan(shooter,cands,st,dt){
  let cand=null,bestA=0.5;
  if(shooter&&shooter.alive)for(const e of cands){
    if(!e||e===shooter||!e.alive||e.falling)continue;_a.subVectors(e.pos,shooter.pos);const d=_a.length();_a.divideScalar(d);
    const ang=Math.acos(clamp(_a.dot(shooter.fwd),-1,1));
    if(d<4000&&ang<bestA){bestA=ang;cand=e;}
  }
  if(cand&&cand===st.t)st.time+=dt;else{st.t=cand;st.time=0;}
}
const pLock={t:null,time:0},hLock={t:null,time:0};
function updateLock(dt){
  lockScan(P,enemies,pLock,dt);lockTarget=pLock.t;lockT=pLock.time;
  if(HJ)lockScan(HJ,[P],hLock,dt);
}

/* ---------------- pilot modes: the fly flies · you fly · 1v1 against the fly ---------------- */
let pilotMode='fly',HJ=null,lastShotT=-9,hMslCd=0;
const duel={you:0,fly:0,respawnH:-1};
const aim={yaw:0,pitch:0,dir:new V3(0,0,-1)};const holdDir=new V3();
const keys=new Set();let firing=false,pointerLocked=false,mouseNX=0,mouseNY=0,freeLook=false,dragging=false;
const SENS=0.0021;
function ctrl(){return pilotMode==='duel'?HJ:P;}
function aimFrom(a){aim.yaw=Math.atan2(-a.fwd.x,-a.fwd.z);aim.pitch=Math.asin(clamp(a.fwd.y,-1,1));}
function shootGun(a){
  if(a.gunCd>0)return false;
  if(a===P){if(ammo<=0)return false;ammo--;}else{if(!(a.ammo>0))return false;a.ammo--;}
  a.gunCd=1/22;a.gunSide^=1;a.world(a.mesh.userData.guns[a.gunSide],_c);
  fireBullet(a,_c,a.fwd,0.0022,a===P?8.5:6);fire.spawn(_c.x,_c.y,_c.z,a.vel.x,a.vel.y,a.vel.z,0.04,3.5,1.5,1,4,2.4,1,0,0);
  Snd.shot(0.6*volAt(a.pos)+0.1);if(a===P){lastShotT=time;if(pilotMode!=='player')rec.shots++;}
  return true;
}
function humanMissile(a){
  if(!a||!a.alive)return;
  if(a===P){tryMissile();return;}
  if(a.missiles>0&&hMslCd<=0&&hLock.t&&hLock.time>=LOCK_T){hMslCd=1.2;launchMissile(a,hLock.t);}
}
// mouse-aim flying: the jet flies toward where the camera points
function humanControl(a,dt){
  a.gunCd-=dt;
  if(keys.has('KeyW'))a.throttle=Math.min(1.1,a.throttle+0.55*dt);
  if(keys.has('KeyS'))a.throttle=Math.max(0,a.throttle-0.55*dt);
  a.brake=lerp(a.brake,keys.has('ShiftLeft')||keys.has('ShiftRight')?1:0,1-Math.exp(-dt*6));
  if(!pointerLocked){
    const dz=v=>Math.abs(v)<0.06?0:(v-Math.sign(v)*0.06)/0.94;
    const fy=Math.atan2(-a.fwd.x,-a.fwd.z),fp=Math.asin(clamp(a.fwd.y,-1,1));
    aim.yaw=fy-dz(mouseNX)*1.1;aim.pitch=clamp(fp-dz(mouseNY)*0.85,-1.45,1.45);
  }
  dirFromYP(aim.yaw,aim.pitch,aim.dir);
  steer(a,freeLook?holdDir:aim.dir,a.inp);
  if(keys.has('KeyA')||keys.has('ArrowLeft'))a.inp.r=-1;
  if(keys.has('KeyD')||keys.has('ArrowRight'))a.inp.r=1;
  if(keys.has('ArrowUp'))a.inp.p=-0.6;
  if(keys.has('ArrowDown'))a.inp.p=1;
  if(keys.has('KeyQ'))a.inp.y=-1;
  if(keys.has('KeyE'))a.inp.y=1;
  if(firing||keys.has('Space'))shootGun(a);
  if(a!==P)a.physics(dt);
}
function dirFromYP(yaw,p,o){const c=Math.cos(p);return o.set(-Math.sin(yaw)*c,Math.sin(p),-Math.cos(yaw)*c);}
function spawnHuman(){
  if(!HJ){HJ=new Aircraft('fighter');HJ.human=true;HJ.name='You';}else if(!HJ.mesh.parent)scene.add(HJ.mesh);
  const dir=_a.set(rand(-1,1),0,rand(-1,1)).normalize();
  const pos=new V3().copy(P.pos).addScaledVector(dir,4000);
  const r=Math.hypot(pos.x,pos.z);if(r>ARENA-1000){pos.x*=(ARENA-1000)/r;pos.z*=(ARENA-1000)/r;}
  pos.y=clamp(P.pos.y+rand(-200,300),groundAt(pos.x,pos.z)+700,3500);
  HJ.reset(pos,_b.subVectors(P.pos,pos).setY(0).normalize(),240);HJ.throttle=0.95;HJ.ammo=1000;HJ.flares=16;
  if(!enemies.includes(HJ))enemies.push(HJ);
  aimFrom(HJ);hurt=0;
}
function setPilotMode(m){
  if(m===pilotMode)return;
  const prev=pilotMode;pilotMode=m;
  if(prev==='duel'){if(HJ){scene.remove(HJ.mesh);const i=enemies.indexOf(HJ);if(i>=0)enemies.splice(i,1);}clearEnemies();waveActive=false;waveTimer=3;wave=Math.max(0,wave-1);}
  if(prev==='fly')learner.ep=null; // an interrupted wave does not count
  freeLook=false;firing=false;
  if(m==='fly'){director.setMode(camPref==='player'?'cinematic':camPref);feed('The fruit fly has the controls','good');try{document.exitPointerLock&&document.exitPointerLock();}catch(e){}}
  if(m==='player'){aimFrom(P);director.setMode('player');feed('You have the controls <i>· the fly still watches and suggests</i>','good');}
  if(m==='duel'){
    for(const x of missiles)scene.remove(x.mesh);missiles.length=0;clearEnemies();waveActive=false;
    duel.you=duel.fly=0;if(!P.alive){resetPlayer();deathT=-1;}
    spawnHuman();learner.startEpisode();director.setMode('player');
    banner('1v1','You against the fruit fly');feed('Duel: <i>the fly hunts you · it learns from every hit</i>','good');
  }
  syncPane();
}
function requestLock(){try{const r=glCanvas.requestPointerLock();if(r&&r.catch)r.catch(()=>{});}catch(e){}}
document.addEventListener('pointerlockchange',()=>{pointerLocked=document.pointerLockElement===glCanvas;});
window.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT')return;
  if(!e.repeat&&shortcut(e))return;
  if(e.target.closest&&e.target.closest('#pane'))return;
  keys.add(e.code);
  if(pilotMode==='fly')return;
  if(e.code==='Space')e.preventDefault();
  if(e.repeat)return;
  const a=ctrl();
  if(e.code==='KeyF')humanMissile(a);
  if(e.code==='KeyX')tryFlares(a);
  if(e.code==='KeyC'&&!freeLook){freeLook=true;holdDir.copy(aim.dir);}
  if(e.code==='KeyV')setCamMode(director.mode==='player'?'flycam':'player');
});
window.addEventListener('keyup',e=>{keys.delete(e.code);if(e.code==='KeyC'&&freeLook){freeLook=false;aim.yaw=Math.atan2(-holdDir.x,-holdDir.z);aim.pitch=Math.asin(clamp(holdDir.y,-1,1));}});
window.addEventListener('blur',()=>{keys.clear();firing=false;dragging=false;});
glCanvas.addEventListener('mousedown',e=>{
  if(pilotMode==='fly'){if(director.mode==='orbit')dragging=true;return;}
  if(!pointerLocked)requestLock();
  if(e.button===0)firing=true;
  if(e.button===2)humanMissile(ctrl());
});
window.addEventListener('mouseup',e=>{if(e.button===0)firing=false;dragging=false;});
glCanvas.addEventListener('contextmenu',e=>e.preventDefault());
window.addEventListener('mousemove',e=>{
  if(pilotMode!=='fly'){
    if(pointerLocked){if(freeLook||true){aim.yaw-=e.movementX*SENS;aim.pitch=clamp(aim.pitch-e.movementY*SENS,-1.45,1.45);}}
    else{const r=gameEl.getBoundingClientRect();mouseNX=((e.clientX-r.left)/r.width)*2-1;mouseNY=((e.clientY-r.top)/r.height)*2-1;}
  }else if(dragging&&director.mode==='orbit'){director.free.yaw+=e.movementX*0.006;director.free.pitch=clamp(director.free.pitch+e.movementY*0.004,-0.3,1.3);}
});
glCanvas.addEventListener('wheel',e=>{if(director.mode==='orbit'){director.free.dist=clamp(director.free.dist*(1+Math.sign(e.deltaY)*0.12),25,600);e.preventDefault();}},{passive:false});

/* ---------------- the airfield: repairs the fly's jet, flak covers it ---------------- */
let repairNote=-99;
function flakBurst(p){
  for(let i=0;i<10;i++){randDir(_b).multiplyScalar(rand(2,9));const g=rand(0.04,0.09);smoke.spawn(p.x,p.y,p.z,_b.x,_b.y,_b.z,rand(2.5,4),8,rand(30,48),0.85,g,g,g,0.8,0.5);}
  for(let i=0;i<3;i++)fire.spawn(p.x,p.y,p.z,0,0,0,0.12,10,26,1,4,2.4,1,0,0);
  const v=volAt(p);if(v>0.05)Snd.boom(v*0.25);
}
function updateAirfield(dt){
  if(P.alive){
    const hd=Math.hypot(P.pos.x-AF.x,P.pos.z-AF.z),agl=P.pos.y-AF.h;
    if(hd<1800&&agl<1700&&waveActive!==undefined){
      const before=P.hp;P.hp=Math.min(100,P.hp+5*dt);ammo=Math.min(1000,ammo+Math.ceil(80*dt));flareCount=Math.min(16,flareCount+dt*1.5);
      P.rearmT=(P.rearmT||0)+dt;if(P.rearmT>3&&P.missiles<4){P.rearmT=0;P.missiles++;P.mesh.userData.msls[4-P.missiles].visible=true;}
      if(before<99&&time-repairNote>15){repairNote=time;feed('Repairing and rearming <i>over the airfield</i>','good');}
    }
  }
  for(const e of enemies){
    if(!e.alive||e.falling||e.human)continue;
    if(Math.hypot(e.pos.x-AF.x,e.pos.z-AF.z)>2400||e.pos.y>3300)continue;
    e.flakT=(e.flakT??rand(0.4,1.4))-dt;if(e.flakT>0)continue;e.flakT=rand(0.6,1.4);
    _a.copy(e.pos).addScaledVector(e.vel,rand(0,0.5)).add(randDir(_b).multiplyScalar(rand(8,70)));
    flakBurst(_a);if(_a.distanceTo(e.pos)<35+(e.radius||9))damage(e,9,'flak','flak');
  }
}

/* ---------------- settings + control pane ---------------- */
const settings={brain:true,marks:true,slowmo:true,quality:'high',sound:false,volume:0.6};
try{Object.assign(settings,JSON.parse(localStorage.getItem('valley-intercept-settings')||'{}'));}catch(e){}
settings.sound=false; // browsers need a click before sound
let camPref='cinematic';
function saveSettings(){try{localStorage.setItem('valley-intercept-settings',JSON.stringify(settings));}catch(e){}}
function applySettings(){
  const q=settings.quality,dpr=window.devicePixelRatio||1;
  renderer.setPixelRatio(q==='high'?Math.min(dpr,1.5):q==='medium'?Math.min(dpr,1):0.8);
  const sh=q!=='low';
  if(sunLight.castShadow!==sh||sunLight.shadow.mapSize.x!==(q==='high'?2048:1024)){
    sunLight.castShadow=sh;sunLight.shadow.mapSize.set(q==='high'?2048:1024,q==='high'?2048:1024);
    if(sunLight.shadow.map){sunLight.shadow.map.dispose();sunLight.shadow.map=null;}
  }
  if(post)post.bloom.enabled=q!=='low';
  director.slowmo=settings.slowmo;
  resize();
}
function setSound(on){
  settings.sound=on;
  if(on){Snd.init();soundOn=true;Snd.setMuted(false);if(Snd.master)Snd.master.gain.value=settings.volume;}
  else{Snd.setMuted(true);}
  $('sound').hidden=on;syncPane();
}
function setCamMode(m){
  if(m==='player'&&pilotMode==='fly')return;
  if(pilotMode==='fly')camPref=m;
  director.setMode(m);syncPane();
}
const pane=$('pane'),paneTab=$('paneTab');
function openPane(open){pane.hidden=!open;paneTab.setAttribute('aria-expanded',String(open));paneTab.hidden=open;if(open)syncPane();}
paneTab.addEventListener('click',()=>openPane(true));
$('paneClose').addEventListener('click',()=>openPane(false));
pane.addEventListener('click',e=>{
  const b=e.target.closest('button[data-v]');if(!b)return;
  const g=b.parentElement.dataset.group,v=b.dataset.v;
  if(g==='pilot')setPilotMode(v);
  if(g==='cam')setCamMode(v);
  if(g==='quality'){settings.quality=v;saveSettings();applySettings();syncPane();}
});
for(const [id,key] of [['setBrain','brain'],['setMarks','marks'],['setSlow','slowmo']])
  $(id).addEventListener('change',e=>{settings[key]=e.target.checked;saveSettings();director.slowmo=settings.slowmo;});
$('setSound').addEventListener('change',e=>setSound(e.target.checked));
$('setVol').addEventListener('input',e=>{settings.volume=+e.target.value;saveSettings();if(Snd.master&&settings.sound)Snd.master.gain.value=settings.volume;});
$('setLearn').addEventListener('change',e=>{learner.enabled=e.target.checked;});
let resetArm=0;
$('learnReset').addEventListener('click',e=>{
  if(performance.now()-resetArm<3000){learner.reset();e.target.textContent='Memory wiped';resetArm=0;setTimeout(()=>e.target.textContent='Forget everything',2000);syncPane();}
  else{resetArm=performance.now();e.target.textContent='Click again to forget';setTimeout(()=>{if(resetArm&&performance.now()-resetArm>=2900)e.target.textContent='Forget everything';},3000);}
});
function syncPane(){
  for(const seg of pane.querySelectorAll('.seg[data-group="pilot"],.seg[data-group="cam"],.seg[data-group="quality"]')){
    const g=seg.dataset.group,cur=g==='pilot'?pilotMode:g==='cam'?director.mode:settings.quality;
    for(const b of seg.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.v===cur));
  }
  pane.querySelector('[data-group="cam"] [data-v="player"]').disabled=pilotMode==='fly';
  $('setBrain').checked=settings.brain;$('setMarks').checked=settings.marks;$('setSlow').checked=settings.slowmo;
  $('setSound').checked=settings.sound;$('setVol').value=settings.volume;$('setLearn').checked=learner.enabled;
  $('keysSec').hidden=pilotMode==='fly';
  $('pilotHint').textContent=pilotMode==='fly'?'The fly is flying. Watch its brain on the left.'
    :pilotMode==='player'?'You fly its jet. The teal diamond shows where the fly would steer.'
    :'You fly a bandit jet against the fly. It learns from every hit you land.';
  gameEl.classList.toggle('controlling',pilotMode!=='fly');
  if(typeof paused!=='undefined'){
    pane.querySelector('[data-act="pause"]').textContent=paused?'Resume':'Pause';
    pane.querySelector('[data-act="hud"]').textContent=hudHidden?'Show HUD':'Hide HUD';
    for(const b of pane.querySelectorAll('[data-group="speed"] button'))b.setAttribute('aria-pressed',String(+b.dataset.v===gameSpeed));
    for(const a of ['next','restart'])pane.querySelector(`[data-act="${a}"]`).disabled=pilotMode!=='fly';
  }
}
let paneAcc=0;
function paneTick(dt){
  paneAcc+=dt;if(paneAcc<0.4||pane.hidden)return;paneAcc=0;
  recTick();
  $('learnEvent').textContent=learner.lastEvent||'Nothing learned yet. Damage teaches it what to avoid.';
  $('learnBars').innerHTML=Object.entries(SITUATIONS).map(([k,label])=>`<div class="lrow"><span>${label}</span><span class="lbar"><i style="width:${Math.round(learner.V[k]*100)}%"></i></span></div>`).join('');
  $('learnTactics').innerHTML=Object.entries(TACTICS).map(([k,[,,, ,label,unit]])=>`<div class="trow"><span>${label}</span><b>${Math.round(learner.theta[k]*10)/10} ${unit}</b></div>`).join('')
    +`<div class="trow"><span>Waves learned from</span><b>${learner.episodes}</b></div>`;
  const cv=$('learnChart'),h=learner.history.slice(-24),cx=cv.getContext('2d'),wpx=cv.clientWidth,hpx=cv.clientHeight,d=Math.min(window.devicePixelRatio||1,2);
  cv.width=wpx*d;cv.height=hpx*d;cx.scale(d,d);cx.clearRect(0,0,wpx,hpx);
  if(h.length>1){const lo=Math.min(...h.map(x=>x.fit)),hi=Math.max(...h.map(x=>x.fit)),sx=wpx/(h.length-1),sy=v=>hpx-6-(v-lo)/Math.max(hi-lo,1)*(hpx-12);
    cx.strokeStyle='rgba(242,236,220,.5)';cx.lineWidth=1.5;cx.beginPath();h.forEach((x,i)=>i?cx.lineTo(i*sx,sy(x.fit)):cx.moveTo(0,sy(x.fit)));cx.stroke();
    h.forEach((x,i)=>{cx.fillStyle=x.died?'#ff5d4b':x.kept?'#a6dc9a':'rgba(242,236,220,.6)';cx.beginPath();cx.arc(i*sx,sy(x.fit),2.8,0,7);cx.fill();});}
  else{cx.fillStyle='rgba(242,236,220,.45)';cx.font='11px "IBM Plex Mono", monospace';cx.fillText('Score per wave appears here',4,hpx/2+4);}
}


/* ---------------- small things: pause, speed, photo mode, screenshots ---------------- */
let paused=false,gameSpeed=1,hudHidden=false,shotPending=false;
const rec={shots:0,hits:0,msl:0,mslHits:0,deaths:0};
function setPaused(v){paused=v;$('paused').hidden=!v;if(v){firing=false;keys.clear();}syncPane();}
function setSpeed(v){gameSpeed=v;syncPane();feed(`Game speed <i>${v===0.5?'½':v}×</i>`);}
function setHud(hidden){hudHidden=hidden;document.body.classList.toggle('nohud',hidden);if(hidden)feed('HUD hidden <i>· press H to bring it back</i>');syncPane();}
function saveScreenshot(){
  try{const a=document.createElement('a');a.href=glCanvas.toDataURL('image/png');
    a.download=`valley-intercept-${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}.png`;document.body.appendChild(a);a.click();a.remove();
    flashShutter();}catch(e){feed('Screenshot failed <i>· this browser blocked it</i>');}
}
function flashShutter(){const f=$('shutter');f.classList.remove('go');void f.offsetWidth;f.classList.add('go');}
function toggleFullscreen(){
  try{if(document.fullscreenElement)document.exitFullscreen();else{const r=document.documentElement.requestFullscreen();if(r&&r.catch)r.catch(()=>feed('Fullscreen is not available here'));}}
  catch(e){feed('Fullscreen is not available here');}
}
function nextWave(){if(pilotMode!=='fly')return;learner.ep=null;for(const m of missiles)scene.remove(m.mesh);missiles.length=0;clearEnemies();waveActive=false;waveTimer=0;}
function restartSortie(){if(pilotMode!=='fly')return;learner.ep=null;wave=Math.max(0,wave);newSortie();rec.deaths--;}
const CAMS=['cinematic','flycam','cockpit','chase','orbit'];
function shortcut(e){
  const k=e.code;
  if(k==='KeyP'){setPaused(!paused);return true;}
  if(k==='KeyH'){setHud(!hudHidden);return true;}
  if(k==='KeyK'){shotPending=true;return true;}
  if(k==='Digit1'){setSpeed(0.5);return true;}
  if(k==='Digit2'){setSpeed(1);return true;}
  if(k==='Digit3'){setSpeed(2);return true;}
  if(k==='Escape'&&!pane.hidden){openPane(false);return true;}
  if(pilotMode!=='fly')return false; // in control modes the rest are flight keys
  if(k==='KeyC'){setCamMode(CAMS[(CAMS.indexOf(director.mode)+1)%CAMS.length]);feed(`Camera <i>· ${$('pane').querySelector(`[data-group="cam"] [data-v="${director.mode}"]`).textContent}</i>`);return true;}
  if(k==='KeyB'){settings.brain=!settings.brain;saveSettings();syncPane();return true;}
  if(k==='KeyN'){nextWave();return true;}
  if(k==='Space'){e.preventDefault();setPaused(!paused);return true;}
  return false;
}
$('paused').addEventListener('click',()=>setPaused(false));
pane.addEventListener('click',e=>{
  const b=e.target.closest('button[data-act]');if(!b)return;
  const a=b.dataset.act;
  if(a==='pause')setPaused(!paused);
  if(a==='hud')setHud(!hudHidden);
  if(a==='shot')shotPending=true;
  if(a==='full')toggleFullscreen();
  if(a==='next')nextWave();
  if(a==='restart')restartSortie();
});
pane.addEventListener('click',e=>{const b=e.target.closest('[data-group="speed"] button');if(b)setSpeed(+b.dataset.v);});
function recTick(){
  const acc=rec.shots?Math.round(rec.hits/rec.shots*100)+'%':'–',macc=rec.msl?`${rec.mslHits} / ${rec.msl}`:'–';
  $('flyRec').innerHTML=[['Kills',kills],['Deaths',rec.deaths],['Gun accuracy',acc],['Missile hits',macc],['Escapes (giant fiber)',fly.escapes],['Best wave',stats.best]]
    .map(([k,v])=>`<div class="trow"><span>${k}</span><b>${v}</b></div>`).join('');
}

/* ---------------- UI ---------------- */
const U={wave:$('uWave'),score:$('uScore'),foes:$('uFoes'),sortie:$('uSortie'),kills:$('uKills'),spd:$('uSpd'),alt:$('uAlt'),g:$('uG'),thr:$('uThr'),
  brake:$('uBrake'),mode:$('uMode'),skill:$('uSkill'),ammo:$('uAmmo'),msl:$('uMsl'),flr:$('uFlr'),hp:$('uHp'),hpFill:$('hpFill'),hpBar:$('hpBar'),warn:$('warn'),vig:$('vig')};
for(let i=0;i<4;i++){const s=document.createElement('span');s.className='pip on';U.msl.appendChild(s);}
const last={};
function setText(el,key,v){if(last[key]!==v){last[key]=v;el.textContent=v;}}
function feed(html,cls){
  const f=$('feed');const d=document.createElement('div');d.className='fi'+(cls?' '+cls:'');d.innerHTML=html;f.prepend(d);
  while(f.children.length>5)f.lastChild.remove();
  setTimeout(()=>{d.style.opacity='0';setTimeout(()=>d.remove(),700);},4500);
}
let bannerTimer=0;
function banner(t,s){$('bTitle').textContent=t;$('bSub').textContent=s;$('banner').classList.add('show');clearTimeout(bannerTimer);bannerTimer=setTimeout(()=>$('banner').classList.remove('show'),3000);}
const MODE_NAMES={attack:'Attack',memory:'Chasing from memory',defend:'Defending',escape:'Escape reflex',terrain:'Terrain',search:'Searching',patrol:'Patrol',rtb:'Going home'};
function updateUI(){
  setText(U.wave,'w',String(Math.max(wave,1)));setText(U.score,'s',score.toLocaleString());setText(U.sortie,'so',String(sortie));setText(U.kills,'k',String(kills));
  setText(U.foes,'f',String(enemies.filter(e=>e.alive&&!e.falling&&!e.human).length));
  const C=ctrl()||P;
  setText(U.spd,'spd',String(Math.round(C.speed*3.6)));setText(U.alt,'alt',Math.round(C.pos.y).toLocaleString());
  setText(U.g,'g',C.g.toFixed(1));
  const thr=Math.round(C.throttle*100);setText(U.thr,'thr',thr>100?'WEP':thr+'%');U.thr.classList.toggle('wep',thr>100);
  U.brake.classList.toggle('on',C.brake>0.25);
  const prefix=pilotMode==='player'?'Fly would: ':pilotMode==='duel'?'Fly: ':'';
  setText(U.mode,'mode',fly.ready?prefix+(MODE_NAMES[fly.mode]||fly.mode):'Autopilot');setText(U.skill,'skill',fly.ready?fly.skill:'');
  setText(U.ammo,'ammo',String(C===HJ?HJ.ammo:ammo));setText(U.flr,'flr',String(Math.floor(C===HJ?HJ.flares:flareCount)));
  const hp=Math.max(0,Math.round(C.hp));setText(U.hp,'hp',String(hp));U.hpFill.style.width=hp+'%';
  U.hpBar.className='bar'+(hp<35?' low':hp<65?' mid':'');
  if(last.msl!==C.missiles){last.msl=C.missiles;[...U.msl.children].forEach((p,i)=>p.classList.toggle('on',i<C.missiles));}
  $('duelScore').hidden=pilotMode!=='duel';$('waveStats').hidden=pilotMode==='duel';
  if(pilotMode==='duel'){setText($('dYou'),'dy',String(duel.you));setText($('dFly'),'df',String(duel.fly));}
  let w='',cls='';
  const incoming=missiles.some(m=>m.target===C);
  if(!C.alive)w='';
  else if(incoming){w='Missile';cls='blink';}
  else if(C.stall>0.2){w='Stall';cls='amber';}
  setText(U.warn,'warn',w);if(last.wcls!==cls){last.wcls=cls;U.warn.className=cls;}
  U.vig.style.opacity=String(clamp(hurt*0.9+(C.alive&&C.hp<30&&pilotMode!=='fly'?0.25+0.15*Math.sin(time*6):0),0,1));
  document.body.classList.toggle('letterbox',director.letterbox);
  return incoming;
}

/* HUD canvas */
const hud=$('hud'),hctx=hud.getContext('2d'),radar=$('radar'),rctx=radar.getContext('2d');
let W=1,H=1,hdpr=1,post=null;
function resize(){
  W=gameEl.clientWidth;H=gameEl.clientHeight;hdpr=Math.min(window.devicePixelRatio||1,2);
  renderer.setSize(W,H,false);camera.aspect=W/H;camera.updateProjectionMatrix();
  if(post)post.setSize(W,H);
  hud.width=W*hdpr;hud.height=H*hdpr;
  const rs=radar.clientWidth||170;radar.width=rs*hdpr;radar.height=rs*hdpr;
  updatePointScale();
}
function updatePointScale(){const s=renderer.domElement.height/(2*Math.tan(camera.fov*Math.PI/360));smoke.mat.uniforms.scale.value=s;fire.mat.uniforms.scale.value=s;}
window.addEventListener('resize',resize);
const _pv=new V3();
function project(v){_pv.copy(v).applyMatrix4(camera.matrixWorldInverse);if(_pv.z>-1)return null;_pv.applyMatrix4(camera.projectionMatrix);return{x:(_pv.x*0.5+0.5)*W,y:(-_pv.y*0.5+0.5)*H};}
const C_HUD='rgba(242,236,220,0.95)',C_FOE='#ff5d4b',C_LOCK='#ffb446';
function drawHUD(dtReal){
  const c=hctx;c.setTransform(hdpr,0,0,hdpr,0,0);c.clearRect(0,0,W,H);
  const C=ctrl()||P,control=pilotMode!=='fly';
  const camOK=control?director.mode==='player':(director.mode==='chase'||(director.mode==='cinematic'&&(director.shot==='chase'||director.shot==='twoShot')));
  const showMarks=C.alive&&settings.marks&&camOK;
  if(showMarks){
    c.lineWidth=1.5;c.shadowColor='rgba(0,0,0,.6)';c.shadowBlur=3;
    const fpx=(H/2)/Math.tan(camera.fov*Math.PI/360);
    c.font='500 10.5px "IBM Plex Mono", monospace';c.textAlign='center';
    const lk=C===HJ?hLock:pLock;
    const marks=C===HJ?[P]:enemies;
    for(const e of marks){
      if(!e.alive||e.falling||e===C)continue;
      const p=project(e.pos);if(!p||p.x<0||p.x>W||p.y<0||p.y>H)continue;
      const d=e.pos.distanceTo(C.pos),s=Math.max(9,(e.radius||8)*1.1*fpx/d),k=s*0.45;
      const focus=!control&&e===fly.focus,locked=e===lk.t&&lk.time>=LOCK_T;
      c.strokeStyle=locked?C_LOCK:C_FOE;c.globalAlpha=focus||control?1:0.65;
      c.beginPath();
      c.moveTo(p.x-s,p.y-s+k);c.lineTo(p.x-s,p.y-s);c.lineTo(p.x-s+k,p.y-s);c.moveTo(p.x+s-k,p.y-s);c.lineTo(p.x+s,p.y-s);c.lineTo(p.x+s,p.y-s+k);
      c.moveTo(p.x+s,p.y+s-k);c.lineTo(p.x+s,p.y+s);c.lineTo(p.x+s-k,p.y+s);c.moveTo(p.x-s+k,p.y+s);c.lineTo(p.x-s,p.y+s);c.lineTo(p.x-s,p.y+s-k);c.stroke();
      const nm=e===P?'FRUIT FLY':e.name.toUpperCase();
      c.fillStyle=c.strokeStyle;c.fillText(`${nm} · ${d<1000?Math.round(d)+' m':(d/1000).toFixed(1)+' km'}`,p.x,p.y+s+12);
      if(e.hp<e.maxHp){c.fillStyle='rgba(0,0,0,.4)';c.fillRect(p.x-s,p.y-s-7,s*2,3);c.fillStyle=c.strokeStyle;c.fillRect(p.x-s,p.y-s-7,s*2*Math.max(0,e.hp)/e.maxHp,3);}
      if(e===lk.t&&!locked){c.strokeStyle=C_LOCK;c.beginPath();c.arc(p.x,p.y,s+8,-Math.PI/2,-Math.PI/2+Math.min(lk.time/LOCK_T,1)*Math.PI*2);c.stroke();}
      if(locked){c.fillStyle=C_LOCK;c.font='700 11px "Saira Condensed", sans-serif';c.fillText('LOCK',p.x,p.y-s-11);c.font='500 10.5px "IBM Plex Mono", monospace';}
      if(focus){c.fillStyle='#38c3b8';c.font='700 10px "Saira Condensed", sans-serif';c.fillText('FLY IS WATCHING',p.x,p.y-s-(locked?22:11));c.font='500 10.5px "IBM Plex Mono", monospace';}
      c.globalAlpha=1;
    }
    for(const m of missiles){if(m.target!==C)continue;const p=project(m.pos);if(p){c.strokeStyle=C_FOE;c.beginPath();c.arc(p.x,p.y,9,0,Math.PI*2);c.stroke();}}
    // gun reticle, lead indicator and mouse aim when you fly
    const r=project(_c.copy(C.fwd).multiplyScalar(700).add(C.pos));
    if(r){c.strokeStyle=C_HUD;c.lineWidth=1.6;c.beginPath();c.arc(r.x,r.y,13,0,Math.PI*2);c.stroke();
      c.fillStyle=C_HUD;c.fillRect(r.x-1.2,r.y-1.2,2.4,2.4);
      if(hitMarkT>0){c.strokeStyle=C_LOCK;c.lineWidth=2;c.beginPath();for(const [sx,sy] of [[-1,-1],[1,-1],[-1,1],[1,1]]){c.moveTo(r.x+sx*8,r.y+sy*8);c.lineTo(r.x+sx*16,r.y+sy*16);}c.stroke();}}
    if(control){
      const tg=C===HJ?P:(lk.t||fly.focus);
      if(tg&&tg.alive&&tg.pos.distanceTo(C.pos)<1800){
        const rel=_a.subVectors(tg.pos,C.pos);let t=rel.length()/BULLET_V;
        for(let it=0;it<2;it++){_b.copy(tg.vel).sub(C.vel).multiplyScalar(t).add(rel);t=_b.length()/BULLET_V;}
        const lp=project(_b.add(C.pos));
        if(lp){c.strokeStyle=C_HUD;c.lineWidth=1.4;c.beginPath();c.arc(lp.x,lp.y,6,0,Math.PI*2);c.moveTo(lp.x-11,lp.y);c.lineTo(lp.x-7,lp.y);c.moveTo(lp.x+7,lp.y);c.lineTo(lp.x+11,lp.y);c.stroke();}
      }
      const m=project(_c.copy(freeLook?holdDir:aim.dir).multiplyScalar(3000).add(camera.position));
      if(m){c.strokeStyle='rgba(242,236,220,.55)';c.lineWidth=1.3;c.beginPath();c.arc(m.x,m.y,5,0,Math.PI*2);c.stroke();}
      if(pilotMode==='player'&&fly.ready){ // where the fly would steer
        const fp=project(_c.copy(fly.out.dir).multiplyScalar(900).add(P.pos));
        if(fp){c.strokeStyle='#38c3b8';c.lineWidth=1.8;c.beginPath();c.moveTo(fp.x,fp.y-9);c.lineTo(fp.x+9,fp.y);c.lineTo(fp.x,fp.y+9);c.lineTo(fp.x-9,fp.y);c.closePath();c.stroke();
          c.fillStyle='#38c3b8';c.font='700 10px "Saira Condensed", sans-serif';c.fillText('FLY',fp.x,fp.y-13);}
      }
      if(!pointerLocked){c.fillStyle='rgba(242,236,220,.6)';c.font='500 12px "IBM Plex Mono", monospace';c.fillText('Click the view to capture the mouse · or steer with the cursor offset',W/2,H-96);}
    }
    c.shadowBlur=0;
  }
  if(fly.ready&&settings.brain&&W>=640){
    const pw=clamp(W*0.25,236,340),avail=H-60-14;
    viz.draw(c,14,58,pw,avail,dtReal,flyCmd||fly.out);
  }
}

function drawRadar(){
  const s=radar.width/hdpr,c=rctx,R=s/2-4,range=7000,sc=R/range;
  c.setTransform(hdpr,0,0,hdpr,0,0);c.clearRect(0,0,s,s);
  c.save();c.translate(s/2,s/2);
  c.fillStyle='rgba(9,14,20,.6)';c.beginPath();c.arc(0,0,R,0,Math.PI*2);c.fill();
  c.strokeStyle='rgba(242,236,220,.16)';c.lineWidth=1;
  for(const k of [1/3,2/3,1]){c.beginPath();c.arc(0,0,R*k,0,Math.PI*2);c.stroke();}
  c.beginPath();c.moveTo(-R,0);c.lineTo(R,0);c.moveTo(0,-R);c.lineTo(0,R);c.stroke();
  const RC=ctrl()||P;
  const fx=RC.fwd.x,fz=RC.fwd.z,fl=Math.hypot(fx,fz)||1,ux=fx/fl,uz=fz/fl,rx=-uz,rz=ux;
  const toS=(x,z)=>{const dx=x-RC.pos.x,dz=z-RC.pos.z;return[(dx*rx+dz*rz)*sc,-(dx*ux+dz*uz)*sc];};
  // blind cone of the fly's eyes (46 deg half-angle behind)
  c.fillStyle='rgba(255,93,75,.08)';c.beginPath();c.moveTo(0,0);c.arc(0,0,R,Math.PI/2-0.8,Math.PI/2+0.8);c.closePath();c.fill();
  const af=toS(AF.x,AF.z);if(Math.hypot(af[0],af[1])<R){c.save();c.translate(af[0],af[1]);c.rotate(-Math.atan2(rz,rx));c.fillStyle='rgba(242,236,220,.5)';c.fillRect(-1300*sc,-2.5,2600*sc,5);c.restore();}
  for(const e of (RC===HJ?[P]:enemies)){if(!e.alive||e===RC)continue;let [x,y]=toS(e.pos.x,e.pos.z);const l=Math.hypot(x,y);if(l>R){x*=R/l;y*=R/l;}
    const hx=e.fwd.x*rx+e.fwd.z*rz,hy=-(e.fwd.x*ux+e.fwd.z*uz);
    c.save();c.translate(x,y);c.rotate(Math.atan2(hy,hx));c.fillStyle=e.falling?'rgba(242,236,220,.4)':(e===fly.focus?'#38c3b8':C_FOE);
    const sz=e.kind==='bomber'?1.6:1;c.beginPath();c.moveTo(6*sz,0);c.lineTo(-4*sz,-4*sz);c.lineTo(-4*sz,4*sz);c.closePath();c.fill();c.restore();}
  for(const m of missiles){const [x,y]=toS(m.pos.x,m.pos.z);if(Math.hypot(x,y)>R)continue;c.fillStyle=m.target===RC?C_FOE:'#fff';c.fillRect(x-1.5,y-1.5,3,3);}
  c.fillStyle=C_HUD;c.beginPath();c.moveTo(0,-7);c.lineTo(5,6);c.lineTo(0,3);c.lineTo(-5,6);c.closePath();c.fill();
  c.restore();
  c.fillStyle='rgba(242,236,220,.5)';c.font='500 9.5px "IBM Plex Mono", monospace';c.textAlign='left';c.fillText('7 km',6,s-6);
}

/* sun glare visibility (terrain can hide the sun) */
const sunState={vis:0,pos:new THREE.Vector2()};
function updateSun(dt){
  _a.copy(SUN).multiplyScalar(30000).add(camera.position);
  _b.copy(_a).project(camera);
  const camDir=camera.getWorldDirection(_c);
  let target=0;
  if(camDir.dot(SUN)>0&&Math.abs(_b.x)<1.3&&Math.abs(_b.y)<1.3){
    target=(1-smooth(0.85,1.3,Math.max(Math.abs(_b.x),Math.abs(_b.y))));
    for(let d=150;d<24000&&target>0;d*=1.45)if(camera.position.y+SUN.y*d<groundAt(camera.position.x+SUN.x*d,camera.position.z+SUN.z*d))target=0;
  }
  sunState.vis=lerp(sunState.vis,target,1-Math.exp(-dt*8));
  sunState.pos.set(_b.x*0.5+0.5,_b.y*0.5+0.5);
}

/* ---------------- main loop ---------------- */
function simulate(dt){
  time+=dt;
  updatePlayer(dt);
  for(const e of enemies){
    if(!e.alive)continue;
    if(e.falling){e.inp.r=e.fallSpin;e.inp.p=-0.25;e.inp.y=0;e.throttle=0;}
    else if(e.human)humanControl(e,dt);
    else think(e,dt);
    e.physics(dt);
  }
  if(P.alive&&P.pos.y<groundAt(P.pos.x,P.pos.z)+2.5)kill(P,'terrain');
  for(const e of enemies){
    if(!e.alive)continue;
    if(e.pos.y<groundAt(e.pos.x,e.pos.z)+2.5){
      if(e.human&&!e.falling){kill(e,'terrain');continue;}
      if(!e.falling&&!e.human){kills++;score+=100;feed(`<b>${e.name}</b> <i>flew into the ground +100</i>`,'good');}
      e.alive=false;e.falling=false;e.mesh.visible=false;explode(e.pos,e.kind==='bomber'?2:1.2,null);groundFire(e.pos);
      if(lockTarget===e){lockTarget=null;lockT=0;}
    }
  }
  P.effects(dt);for(const e of enemies)if(e.alive)e.effects(dt);
  updateBullets(dt);updateMissiles(dt);updateFlares(dt);updateBombs(dt);updateEmitters(dt);
  smoke.update(dt);fire.update(dt);
  for(const f of flashLights){if(f.t>0){f.t-=dt;f.l.intensity=f.peak*Math.max(0,f.t/0.7);}else f.l.intensity=0;}
  updateLock(dt);mslCd-=dt;hMslCd-=dt;hitMarkT-=dt;hurt=Math.max(0,hurt-dt*0.8);
  updateAirfield(dt);
  if(pilotMode==='duel'){if(HJ&&!HJ.alive){duel.respawnH-=dt;if(duel.respawnH<=0)spawnHuman();}}
  else if(P.alive){
    if(waveActive&&enemies.every(e=>!e.alive)){
      waveActive=false;waveTimer=6;score+=250;
      P.hp=Math.min(100,P.hp+40);P.missiles=4;P.mesh.userData.msls.forEach(m=>m.visible=true);ammo=1000;flareCount=16;
      banner(`Wave ${wave} cleared`,'+250 · repaired and rearmed');
      if(pilotMode==='fly'){const r=learner.endEpisode(false,true);if(r)feed(`Fly learned <i>· ${learner.lastEvent}</i>`,'good');}
    }
    if(!waveActive){waveTimer-=dt;if(waveTimer<=0){clearEnemies();startWave();}}
  }
}
let lastNow=performance.now();
function frame(now){
  requestAnimationFrame(frame);
  const dtReal=Math.min((now-lastNow)/1000,0.05);lastNow=now;
  let steps=paused?0:(window.__vi&&window.__vi.steps)||1;
  let dt=dtReal*director.timeScale;
  if(gameSpeed>1)steps*=gameSpeed;else dt*=gameSpeed;
  for(let s=0;s<steps;s++)simulate(dt);
  if(!paused&&!P.alive&&deathT>=0){deathT+=dtReal*gameSpeed;if(pilotMode==='duel'){if(deathT>4){resetPlayer();deathT=-1;learner.startEpisode();}}else if(deathT>6.5)newSortie();}
  // camera
  const subj=director.mode==='player'?ctrl():P;
  const tgt=pilotMode==='duel'?(subj===P?HJ:P):(fly.focus||fly.memTarget);
  const critical=P.alive&&(time-lastShotT<1.5||(tgt&&tgt.alive&&tgt.pos.distanceTo(P.pos)<800)||missiles.some(m=>(m.target===P&&m.pos.distanceTo(P.pos)<2500)||(m.owner===P&&m.target&&m.pos.distanceTo(m.target.pos)<1500)));
  director.update(dtReal,{P:subj,target:tgt,enemies,missiles,critical,aim:aim.dir});
  if(shake>0.01){camera.position.x+=rand(-1,1)*shake;camera.position.y+=rand(-1,1)*shake;camera.position.z+=rand(-1,1)*shake;shake*=Math.exp(-dtReal*5);}
  camera.updateProjectionMatrix();updatePointScale();camera.updateMatrixWorld();
  sky.position.copy(camera.position);
  cirrus.position.x=camera.position.x;cirrus.position.z=camera.position.z;
  cirrus.material.map.offset.set(camera.position.x/90000*6,-camera.position.z/90000*6);
  waterMat.uniforms.time.value=time;
  // shadows follow the action
  const focus=ctrl()&&ctrl().alive?ctrl().pos:camera.position;
  sunLight.target.position.copy(focus);sunLight.position.copy(focus).addScaledVector(SUN,2000);
  updateSun(dtReal);
  const incoming=updateUI();
  drawHUD(dtReal);drawRadar();
  const C=ctrl()||P,lk=C===HJ?hLock:pLock;
  if(soundOn)Snd.update(C.alive,C.throttle,C.speed,lk.t?(lk.time>=LOCK_T?2:1):0,incoming,time);
  paneTick(dtReal);
  post.render(dtReal,sunState);
  if(shotPending){shotPending=false;saveScreenshot();}
}

/* sound needs one click; nothing else takes input */
$('sound').addEventListener('click',()=>{setSound(true);});
document.addEventListener('visibilitychange',()=>{lastNow=performance.now();if(document.hidden)setPaused(true);});

/* boot */
post=createPost(renderer,scene,camera);
resetPlayer();
applySettings();
resize();
if(location.hash==='#debug')window.__vi={fly,P,enemies,director,
  setWave(n){wave=n-1;clearEnemies();waveActive=false;waveTimer=0;},learner,setPilotMode:m=>setPilotMode(m),setCam:m=>setCamMode(m),
  get stats(){return{mode2:pilotMode,lastEvent:learner.lastEvent,V:Object.values(learner.V).map(v=>v.toFixed(2)).join(','),foeHp:enemies.filter(e=>e.alive&&!e.falling).map(e=>Math.round(e.hp)).join('/'),score,kills,wave,sortie,hp:P.hp,alive:P.alive,alt:P.pos.y,spd:P.speed,brake:P.brake,mode:fly.mode,skill:fly.skill,escapes:fly.escapes,ammo,msl:P.missiles,shot:director.shot};}};
banner('Valley Intercept','A fruit fly is flying this jet');
requestAnimationFrame(t=>{lastNow=t;frame(t);});
}

main();
