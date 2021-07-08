function SSAOEffect(e,t){pc.PostEffect.call(this,e),this.ssaoScript=t,this.needsDepthBuffer=!0,this.ssaoShader=new pc.Shader(e,{attributes:{aPosition:pc.SEMANTIC_POSITION},vshader:[e.webgl2?"#version 300 es\n\n"+pc.shaderChunks.gles3VS:"",e.webgl2?"":"#extension GL_OES_standard_derivatives: enable\n","attribute vec2 aPosition;","","varying vec2 vUv0;","","void main(void)","{","    gl_Position = vec4(aPosition, 0.0, 1.0);","    vUv0 = (aPosition.xy + 1.0) * 0.5;","}"].join("\n"),fshader:[e.webgl2?"#version 300 es\n\n"+pc.shaderChunks.gles3PS:"",e.webgl2?"":"#extension GL_OES_standard_derivatives: enable\n","precision "+e.precision+" float;",pc.shaderChunks.screenDepthPS,"","varying vec2 vUv0;","","uniform sampler2D uColorBuffer;","uniform vec4 uResolution;","","uniform float uAspect;","","#define saturate(x) clamp(x,0.0,1.0)","","// Largely based on 'Dominant Light Shadowing'","// 'Lighting Technology of The Last of Us Part II' by Hawar Doghramachi, Naughty Dog, LLC","","const float kSSCTLog2LodRate = 3.0;","","highp float getWFromProjectionMatrix(const mat4 p, const vec3 v) {","    // this essentially returns (p * vec4(v, 1.0)).w, but we make some assumptions","    // this assumes a perspective projection","    return -v.z;","    // this assumes a perspective or ortho projection","    // return p[2][3] * v.z + p[3][3];","}","","highp float getViewSpaceZFromW(const mat4 p, const float w) {","    // this assumes a perspective projection","    return -w;","    // this assumes a perspective or ortho projection","   // return (w - p[3][3]) / p[2][3];","}","","","const float kLog2LodRate = 3.0;","","vec2 sq(const vec2 a) {","    return a * a;","}","","uniform float uInvFarPlane;","","vec2 pack(highp float depth) {","// we need 16-bits of precision","    highp float z = clamp(depth * uInvFarPlane, 0.0, 1.0);","    highp float t = floor(256.0 * z);","    mediump float hi = t * (1.0 / 256.0);   // we only need 8-bits of precision","    mediump float lo = (256.0 * z) - t;     // we only need 8-bits of precision","    return vec2(hi, lo);","}","","// random number between 0 and 1, using interleaved gradient noise","float random(const highp vec2 w) {","    const vec3 m = vec3(0.06711056, 0.00583715, 52.9829189);","    return fract(m.z * fract(dot(w, m.xy)));","}","","// returns the frag coord in the GL convention with (0, 0) at the bottom-left","highp vec2 getFragCoord() {","    return gl_FragCoord.xy;","}","","highp vec3 computeViewSpacePositionFromDepth(highp vec2 uv, highp float linearDepth) {","    return vec3((0.5 - uv) * vec2(uAspect, 1.0) * linearDepth, linearDepth);","}","","highp vec3 faceNormal(highp vec3 dpdx, highp vec3 dpdy) {","    return normalize(cross(dpdx, dpdy));","}","","// Compute normals using derivatives, which essentially results in half-resolution normals","// this creates arifacts around geometry edges.","// Note: when using the spirv optimizer, this results in much slower execution time because","//       this whole expression is inlined in the AO loop below.","highp vec3 computeViewSpaceNormal(const highp vec3 position) {","    return faceNormal(dFdx(position), dFdy(position));","}","","// Compute normals directly from the depth texture, resulting in full resolution normals","// Note: This is actually as cheap as using derivatives because the texture fetches","//       are essentially equivalent to textureGather (which we don't have on ES3.0),","//       and this is executed just once.","highp vec3 computeViewSpaceNormal(const highp vec3 position, const highp vec2 uv) {","    highp vec2 uvdx = uv + vec2(uResolution.z, 0.0);","    highp vec2 uvdy = uv + vec2(0.0, uResolution.w);","    highp vec3 px = computeViewSpacePositionFromDepth(uvdx, -getLinearScreenDepth(uvdx));","    highp vec3 py = computeViewSpacePositionFromDepth(uvdy, -getLinearScreenDepth(uvdy));","    highp vec3 dpdx = px - position;","    highp vec3 dpdy = py - position;","    return faceNormal(dpdx, dpdy);","}","","// Ambient Occlusion, largely inspired from:","// 'The Alchemy Screen-Space Ambient Obscurance Algorithm' by Morgan McGuire","// 'Scalable Ambient Obscurance' by Morgan McGuire, Michael Mara and David Luebke","","uniform vec2 uSampleCount;","uniform float uSpiralTurns;","","#define PI (3.14159)","","vec3 tapLocation(float i, const float noise) {","    float offset = ((2.0 * PI) * 2.4) * noise;","    float angle = ((i * uSampleCount.y) * uSpiralTurns) * (2.0 * PI) + offset;","    float radius = (i + noise + 0.5) * uSampleCount.y;","    return vec3(cos(angle), sin(angle), radius * radius);","}","","highp vec2 startPosition(const float noise) {","    float angle = ((2.0 * PI) * 2.4) * noise;","    return vec2(cos(angle), sin(angle));","}","","uniform vec2 uAngleIncCosSin;","","highp mat2 tapAngleStep() {","    highp vec2 t = uAngleIncCosSin;","    return mat2(t.x, t.y, -t.y, t.x);","}","","vec3 tapLocationFast(float i, vec2 p, const float noise) {","    float radius = (i + noise + 0.5) * uSampleCount.y;","    return vec3(p, radius * radius);","}","","uniform float uMaxLevel;","uniform float uInvRadiusSquared;","uniform float uMinHorizonAngleSineSquared;","uniform float uBias;","uniform float uPeak2;","","void computeAmbientOcclusionSAO(inout float occlusion, float i, float ssDiskRadius,","        const highp vec2 uv,  const highp vec3 origin, const vec3 normal,","        const vec2 tapPosition, const float noise) {","","    vec3 tap = tapLocationFast(i, tapPosition, noise);","","    float ssRadius = max(1.0, tap.z * ssDiskRadius);","","    vec2 uvSamplePos = uv + vec2(ssRadius * tap.xy) * uResolution.zw;","","    float level = clamp(floor(log2(ssRadius)) - kLog2LodRate, 0.0, float(uMaxLevel));","    highp float occlusionDepth = -getLinearScreenDepth(uvSamplePos);","    highp vec3 p = computeViewSpacePositionFromDepth(uvSamplePos, occlusionDepth);","","    // now we have the sample, compute AO","    vec3 v = p - origin;        // sample vector","    float vv = dot(v, v);       // squared distance","    float vn = dot(v, normal);  // distance * cos(v, normal)","","    // discard samples that are outside of the radius, preventing distant geometry to","    // cast shadows -- there are many functions that work and choosing one is an artistic","    // decision.","    float w = max(0.0, 1.0 - vv * uInvRadiusSquared);","    w = w*w;","","    // discard samples that are too close to the horizon to reduce shadows cast by geometry","    // not sufficiently tessellated. The goal is to discard samples that form an angle 'beta'","    // smaller than 'epsilon' with the horizon. We already have dot(v,n) which is equal to the","    // sin(beta) * |v|. So the test simplifies to vn^2 < vv * sin(epsilon)^2.","    w *= step(vv * uMinHorizonAngleSineSquared, vn * vn);","","    occlusion += w * max(0.0, vn + origin.z * uBias) / (vv + uPeak2);","}","","uniform float uProjectionScaleRadius;","uniform float uIntensity;","","float scalableAmbientObscurance(highp vec2 uv, highp vec3 origin, vec3 normal) {","    float noise = random(getFragCoord());","    highp vec2 tapPosition = startPosition(noise);","    highp mat2 angleStep = tapAngleStep();","","    // Choose the screen-space sample radius","    // proportional to the projected area of the sphere","    float ssDiskRadius = -(uProjectionScaleRadius / origin.z);","","    float occlusion = 0.0;",e.webgl2?"    for (float i = 0.0; i < uSampleCount.x; i += 1.0) {":"   const float maxSampleCount = 256.0;   for (float i = 0.0; i < maxSampleCount; i += 1.0) {       if (i >= uSampleCount.x) break;","        computeAmbientOcclusionSAO(occlusion, i, ssDiskRadius, uv, origin, normal, tapPosition, noise);","        tapPosition = angleStep * tapPosition;","    }","    return sqrt(occlusion * uIntensity);","}","","uniform float uPower;","","void main() {","    highp vec2 uv = vUv0; //variable_vertex.xy; // interpolated to pixel center","","    highp float depth = -getLinearScreenDepth(vUv0);","    highp vec3 origin = computeViewSpacePositionFromDepth(uv, depth);","    vec3 normal = computeViewSpaceNormal(origin, uv);","","    float occlusion = 0.0;","","    if (uIntensity > 0.0) {","        occlusion = scalableAmbientObscurance(uv, origin, normal);","    }","","    // occlusion to visibility","    float aoVisibility = pow(saturate(1.0 - occlusion), uPower);","","    vec4 inCol = vec4(1.0, 1.0, 1.0, 1.0); //texture2D( uColorBuffer,  uv );","","    gl_FragColor.rgb = inCol.rgb * vec3(aoVisibility); //postProcess.color.rgb = vec3(aoVisibility, pack(origin.z));","    gl_FragColor.a = 1.0;","}","","void main_old()","{","    vec2 aspectCorrect = vec2( 1.0, uAspect );","","    float depth = getLinearScreenDepth(vUv0);","    gl_FragColor.rgb = vec3(fract(floor(depth*256.0*256.0)),fract(floor(depth*256.0)),fract(depth));","    gl_FragColor.a = 1.0;","}"].join("\n")}),this.blurShader=new pc.Shader(e,{attributes:{aPosition:pc.SEMANTIC_POSITION},vshader:[e.webgl2?"#version 300 es\n\n"+pc.shaderChunks.gles3VS:"",e.webgl2?"":"#extension GL_OES_standard_derivatives: enable\n","attribute vec2 aPosition;","","varying vec2 vUv0;","","void main(void)","{","    gl_Position = vec4(aPosition, 0.0, 1.0);","    vUv0 = (aPosition.xy + 1.0) * 0.5;","}"].join("\n"),fshader:[e.webgl2?"#version 300 es\n\n"+pc.shaderChunks.gles3PS:"",e.webgl2?"":"#extension GL_OES_standard_derivatives: enable\n","precision "+e.precision+" float;",pc.shaderChunks.screenDepthPS,"","varying vec2 vUv0;","","uniform sampler2D uColorBuffer;","uniform sampler2D uSSAOBuffer;","uniform vec4 uResolution;","","uniform float uAspect;","","uniform int uBilatSampleCount;","uniform float uFarPlaneOverEdgeDistance;","uniform float uBrightness;","","float random(const highp vec2 w) {","    const vec3 m = vec3(0.06711056, 0.00583715, 52.9829189);","    return fract(m.z * fract(dot(w, m.xy)));","}","","float bilateralWeight(in float depth, in float sampleDepth) {","    float diff = (sampleDepth - depth) * uFarPlaneOverEdgeDistance;","    return max(0.0, 1.0 - diff * diff);","}","","void tap(inout float sum, inout float totalWeight, float weight, float depth, vec2 position) {","    // ambient occlusion sample","    float ssao = texture2D( uSSAOBuffer, position ).r;","    float tdepth = -getLinearScreenDepth( position );","","    // bilateral sample","    float bilateral = bilateralWeight(depth, tdepth);","    bilateral *= weight;","    sum += ssao * bilateral;","    totalWeight += bilateral;","}","","void main() {","    highp vec2 uv = vUv0; // variable_vertex.xy; // interpolated at pixel's center","","    // we handle the center pixel separately because it doesn't participate in bilateral filtering","    float depth = -getLinearScreenDepth(vUv0); // unpack(data.gb);","    float totalWeight = 0.0; // float(uBilatSampleCount*2+1)*float(uBilatSampleCount*2+1);","    float ssao = texture2D( uSSAOBuffer, vUv0 ).r;","    float sum = ssao * totalWeight;","",e.webgl2?"    for (int x = -uBilatSampleCount; x <= uBilatSampleCount; x++) {       for (int y = -uBilatSampleCount; y < uBilatSampleCount; y++) {":"    for (int x = -4; x <= 4; x++) {       for (int y = -4; y < 4; y++) {","           float weight = 1.0;","           vec2 offset = vec2(x,y)*uResolution.zw;","           tap(sum, totalWeight, weight, depth, uv + offset);","       }","    }","","    float ao = sum / totalWeight;","","    // simple dithering helps a lot (assumes 8 bits target)","    // this is most useful with high quality/large blurs","    // ao += ((random(gl_FragCoord.xy) - 0.5) / 255.0);","","    vec4 inCol = texture2D( uColorBuffer,  vUv0 );","","    ao = mix(ao, 1.0, uBrightness);","    gl_FragColor.rgb = inCol.rgb * ao;","    gl_FragColor.a = 1.0;","}"].join("\n")});var i=e.width,o=e.height,a=new pc.Texture(e,{format:pc.PIXELFORMAT_R8_G8_B8_A8,minFilter:pc.FILTER_LINEAR,magFilter:pc.FILTER_LINEAR,addressU:pc.ADDRESS_CLAMP_TO_EDGE,addressV:pc.ADDRESS_CLAMP_TO_EDGE,width:i,height:o,mipmaps:!1});a.name="ssao",this.target=new pc.RenderTarget(e,a,{depth:!1}),this.radius=4,this.brightness=0,this.samples=20}SSAOEffect.prototype=Object.create(pc.PostEffect.prototype),SSAOEffect.prototype.constructor=SSAOEffect,Object.assign(SSAOEffect.prototype,{render:function(e,t,i){var o=this.device,a=o.scope,s=this.samples,n=1/(s-.5)*10*2*3.141,r=this.radius,l=.1*r,u=2*l*3.141*.125,c=.5*o.height,p=this.ssaoScript.entity.camera.farClip;a.resolve("uAspect").setValue(o.width/o.height),a.resolve("uResolution").setValue([o.width,o.height,1/o.width,1/o.height]),a.resolve("uColorBuffer").setValue(e.colorBuffer),a.resolve("uBrightness").setValue(this.brightness),a.resolve("uInvFarPlane").setValue(1/p),a.resolve("uSampleCount").setValue([s,1/s]),a.resolve("uSpiralTurns").setValue(10),a.resolve("uAngleIncCosSin").setValue([Math.cos(n),Math.sin(n)]),a.resolve("uMaxLevel").setValue(0),a.resolve("uInvRadiusSquared").setValue(1/(r*r)),a.resolve("uMinHorizonAngleSineSquared").setValue(0),a.resolve("uBias").setValue(.001),a.resolve("uPeak2").setValue(l*l),a.resolve("uIntensity").setValue(u),a.resolve("uPower").setValue(1),a.resolve("uProjectionScaleRadius").setValue(c*r),pc.drawFullscreenQuad(o,this.target,this.vertexBuffer,this.ssaoShader,i),a.resolve("uSSAOBuffer").setValue(this.target.colorBuffer),a.resolve("uFarPlaneOverEdgeDistance").setValue(1),a.resolve("uBilatSampleCount").setValue(4),pc.drawFullscreenQuad(o,t,this.vertexBuffer,this.blurShader,i)}});var SSAO=pc.createScript("ssao");SSAO.attributes.add("radius",{type:"number",default:4,min:0,max:20,title:"Radius"}),SSAO.attributes.add("brightness",{type:"number",default:0,min:0,max:1,title:"Brightness"}),SSAO.attributes.add("samples",{type:"number",default:16,min:1,max:256,title:"Samples"}),SSAO.prototype.initialize=function(){this.effect=new SSAOEffect(this.app.graphicsDevice,this),this.effect.radius=this.radius,this.effect.brightness=this.brightness,this.effect.samples=this.samples,this.on("attr",(function(e,t){this.effect[e]=t}),this);var e=this.entity.camera.postEffects;e.addEffect(this.effect),this.on("state",(function(t){t?e.addEffect(this.effect):e.removeEffect(this.effect)})),this.on("destroy",(function(){e.removeEffect(this.effect)}))};