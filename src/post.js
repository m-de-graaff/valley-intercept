// Post-processing: HDR render with MSAA -> bloom -> grade (sun glare, vignette, grain) -> tone map.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, time: { value: 0 }, sunPos: { value: new THREE.Vector2(0.5, 0.5) },
    sunVis: { value: 0 }, aspect: { value: 1 },
  },
  vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader: `
    uniform sampler2D tDiffuse;uniform float time,sunVis,aspect;uniform vec2 sunPos;varying vec2 vUv;
    float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
    void main(){
      vec2 uv=vUv,dc=uv-0.5;float r2=dot(dc,dc);
      vec3 col;
      col.r=texture2D(tDiffuse,uv+dc*r2*0.007).r;col.g=texture2D(tDiffuse,uv).g;col.b=texture2D(tDiffuse,uv-dc*r2*0.007).b;
      if(sunVis>0.001){
        vec2 d=uv-sunPos;d.x*=aspect;float dist=length(d);
        col+=vec3(1.0,0.86,0.62)*sunVis*(0.32*exp(-dist*8.0)+0.07*exp(-dist*2.2));
        col+=vec3(1.0,0.82,0.62)*sunVis*0.10*exp(-abs(d.y)*110.0)*exp(-abs(d.x)*2.5);
        vec2 axis=vec2(0.5)-sunPos;
        for(int i=1;i<=4;i++){vec2 gp=sunPos+axis*(float(i)*0.52);vec2 gd=uv-gp;gd.x*=aspect;float gr=0.025+0.018*float(i);
          col+=vec3(0.55,0.75,1.0)*sunVis*0.045*smoothstep(gr,gr*0.55,length(gd));}
      }
      float l=dot(col,vec3(0.2126,0.7152,0.0722));
      col=mix(col,col*vec3(1.05,1.0,0.93),smoothstep(0.25,1.6,l));
      col=mix(col,col*vec3(0.93,1.0,1.07),1.0-smoothstep(0.0,0.28,l));
      col*=1.0-0.38*smoothstep(0.12,0.7,r2*1.7);
      col+=(hash(uv*vec2(1931.0,1087.0)+fract(time))-0.5)*0.012;
      gl_FragColor=vec4(max(col,0.0),1.0);
    }`,
};

export function createPost(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.55, 0.92);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  return {
    composer, bloom, grade,
    setSize(w, h) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); grade.uniforms.aspect.value = w / h; },
    render(dt, sun) {
      grade.uniforms.time.value += dt;
      grade.uniforms.sunVis.value = sun.vis; grade.uniforms.sunPos.value.copy(sun.pos);
      composer.render(dt);
    },
  };
}
