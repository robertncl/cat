import * as THREE from 'three';

// Shell fur: the coat mesh is drawn many times, each copy pushed a little further
// out along the surface normal, keeping only the pixels that fall inside a strand.

export const FUR_SHELLS = 28; // the most layers drawn, when the cat fills the screen

export function createFurMaterial() {
  const uniforms = {
    uShells: { value: FUR_SHELLS },
    uFurLength: { value: 0.021 },
    uDensity: { value: 400 },
    uWind: { value: new THREE.Vector3() }, // extra bend from the cat's own motion
    uRoomLight: { value: Array.from({ length: 9 }, () => new THREE.Vector3()) }, // the room's light, as spherical harmonics
  };
  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.78,
    sheen: 0.25,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color('#fff1df'),
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float furLen;
        attribute vec3 furDir;
        uniform float uShells;
        uniform float uFurLength;
        uniform vec3 uWind;
        varying float vShell;
        varying vec3 vFurP;`)
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
        float shell = (float(gl_InstanceID) + 1.0) / uShells;
        vShell = shell;
        vFurP = position;
        vec3 comb = furDir;
        #ifdef USE_SKINNING
          comb = (skinMatrix * vec4(comb, 0.0)).xyz;
        #endif
        // Hairs leave the skin along the normal, then lie over in the combing direction and droop.
        vec3 bend = comb * 1.15 + vec3(0.0, -0.22, 0.0) + uWind;
        transformed += (normalize(objectNormal) * shell * (1.0 - 0.5 * shell) + bend * shell * shell) * uFurLength * furLen;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uDensity;
        uniform vec3 uRoomLight[9];
        varying float vShell;
        varying vec3 vFurP;
        float furHash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 furQ = vFurP * uDensity;
        vec3 furCell = floor(furQ);
        float furRnd = furHash(furCell);
        vec3 furJitter = vec3(furHash(furCell + 7.3), furHash(furCell + 13.7), furHash(furCell + 29.1)) - 0.5;
        float furH = vShell / mix(0.5, 1.0, furRnd); // 0 at the root of this strand, 1 at its tip
        if (furH > 1.0 || length(fract(furQ) - 0.5 - furJitter * 0.4) > 0.78 * (1.0 - 0.85 * furH)) discard;
        // Roots sit in shadow; each strand is a slightly different shade.
        diffuseColor.rgb *= mix(0.38, 1.0, vShell) * mix(0.8, 1.14, furRnd);`)
      // The room's light comes from nine colours rather than environment-map lookups. The fur is too
      // rough to show the difference, and the lookups were a large part of the cost of shading every shell.
      .replace('#include <lights_fragment_maps>', `
        vec3 furUp = inverseTransformDirection(geometryNormal, viewMatrix);
        vec3 furMirror = reflect(-geometryViewDir, geometryNormal);
        furMirror = inverseTransformDirection(normalize(mix(furMirror, geometryNormal, material.roughness * material.roughness)), viewMatrix);
        iblIrradiance += shGetIrradianceAt(furUp, uRoomLight);
        radiance += shGetIrradianceAt(furMirror, uRoomLight) * RECIPROCAL_PI;`);
  };
  material.userData.uniforms = uniforms;
  return material;
}

/** Skin under the fur: the same colours, darkened so gaps between strands read as depth. */
export function createSkinMaterial() {
  return new THREE.MeshStandardMaterial({ vertexColors: true, color: '#6b6b6b', roughness: 1 });
}

/** Glossy eye with a procedural iris and a slit pupil that can widen. */
export function createEyeMaterial() {
  const uniforms = {
    uIris: { value: new THREE.Color('#8fbf4d') },
    uPupil: { value: 0.3 }, // pupil width: about 0.12 (slit) to 0.6 (round)
  };
  const material = new THREE.MeshPhysicalMaterial({ roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.04 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEyeP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEyeP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uIris;
        uniform float uPupil;
        varying vec3 vEyeP;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 eyeP = normalize(vEyeP);
        float eyeR = length(eyeP.xy);
        float eyeFront = step(0.0, eyeP.z);
        float eyeA = atan(eyeP.y, eyeP.x);
        float streak = 0.88 + 0.12 * sin(eyeA * 38.0) * sin(eyeA * 17.0 + 1.3);
        vec3 irisCol = mix(uIris * 1.35 + 0.06, uIris * 0.55, smoothstep(0.15, 0.8, eyeR)) * streak;
        vec3 eyeCol = mix(vec3(0.03, 0.025, 0.02), irisCol, smoothstep(0.84, 0.78, eyeR) * eyeFront);
        float pupil = length(vec2(eyeP.x / uPupil, eyeP.y / 0.62));
        eyeCol = mix(eyeCol, vec3(0.004), smoothstep(1.0, 0.86, pupil) * eyeFront);
        diffuseColor.rgb = eyeCol;`);
  };
  material.userData.uniforms = uniforms;
  return material;
}
