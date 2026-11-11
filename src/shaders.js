import * as THREE from 'three';
// Shared shader snippets: animated caustics and fish/tentacle motion.
// uCausticScale lets each scene dim or remove surface caustics without recompiling.
export const shared = { uTime: { value: 0 }, uCausticScale: { value: 1 } };

export const causticGLSL = /* glsl */`
float fathomCaustic(vec2 p, float t) {
  vec2 q = p * 0.42;
  float c = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    q += vec2(sin(q.y * 1.37 + t * 0.55 + fi * 1.9), cos(q.x * 1.21 - t * 0.47 + fi * 2.7));
    c += 1.0 / (1.0 + 7.0 * abs(sin(q.x) + sin(q.y)));
  }
  c /= 3.0;
  return c * c * c * 2.6;
}
`;

// Adds a world-position varying, caustic light from above, and optional
// motion (tail wiggle for fish, sway for tentacles) to a standard material.
export function patchMaterial(mat, opts = {}) {
  const { caustic = 0.6, wiggle = null, sway = null, glow = null } = opts;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uCaustic = { value: caustic };
    shader.uniforms.uCausticScale = shared.uCausticScale;
    if (glow) shader.uniforms.uGlow = { value: new THREE.Color(glow) };
    if (wiggle) {
      shader.uniforms.uLen = { value: wiggle.length };
      shader.uniforms.uAmp = { value: wiggle.amp };
    }
    let vhead = `uniform float uTime;\nvarying vec3 vFathomWorld;\n`;
    if (wiggle) vhead += `uniform float uLen;\nuniform float uAmp;\nattribute float aPhase;\n`;
    if (sway) vhead += `attribute float aPhase;\n`;
    if (glow) vhead += `attribute float glow;\nvarying float vGlow;\n${wiggle ? '' : 'attribute float aPhase;\n'}`;
    shader.vertexShader = vhead + shader.vertexShader;
    let motion = '';
    if (wiggle) {
      motion = `
        float zn = transformed.z / uLen;
        float w = clamp((0.22 - zn) / 0.95, 0.0, 1.35);
        transformed.x += sin(aPhase - zn * 4.2) * uAmp * uLen * w * w;
        transformed.x += sin(aPhase * 0.5 + 1.3) * uAmp * 0.12 * uLen * (1.0 - w);
      `;
    }
    if (sway) {
      motion = `
        float h = max(transformed.y, 0.0);
        float s = sin(uTime * 0.9 + aPhase) * 0.6 + sin(uTime * 1.7 + aPhase * 1.3) * 0.25;
        transformed.x += s * h * h * ${sway.toFixed(3)};
        transformed.z += cos(uTime * 0.7 + aPhase * 0.8) * 0.4 * h * h * ${sway.toFixed(3)};
      `;
    }
    if (glow) motion += `
        // photophores breathe slowly, each fish on its own phase
        vGlow = glow * (0.72 + 0.28 * sin(uTime * 1.3 + aPhase * 0.11));
      `;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${motion}`);
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      {
        vec4 fwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fwp = instanceMatrix * fwp;
        #endif
        vFathomWorld = (modelMatrix * fwp).xyz;
      }`);
    shader.fragmentShader = `uniform float uTime;\nuniform float uCaustic;\nuniform float uCausticScale;\nvarying vec3 vFathomWorld;\n${glow ? 'uniform vec3 uGlow;\nvarying float vGlow;\n' : ''}${causticGLSL}\n` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        float up = clamp(normal.y * 0.5 + 0.5, 0.0, 1.0);
        float depthFade = smoothstep(-2.0, 18.0, vFathomWorld.y) * 0.6 + 0.4;
        float cz = fathomCaustic(vFathomWorld.xz + vFathomWorld.y * 0.15, uTime);
        totalEmissiveRadiance += diffuseColor.rgb * vec3(0.75, 0.95, 1.0) * cz * uCaustic * uCausticScale * depthFade * (0.35 + 0.65 * up);
        ${glow ? 'totalEmissiveRadiance += uGlow * vGlow * 4.0;' : ''}
      }`);
  };
  mat.customProgramCacheKey = () => `fathom-${caustic}-${wiggle ? 'w' + wiggle.length : ''}-${sway || ''}-${glow ?? ''}`;
  return mat;
}
