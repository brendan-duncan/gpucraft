import { Texture } from "../gpu/texture.js";

export class SSAOPass {
    constructor(engine, forwardPass) {
        this.engine = engine;
        this.canvas = engine.canvas;
        this.device = engine.device;
        this.forwardPass = forwardPass;

        this.ssaoTexture = Texture.renderBuffer(
            this.device,
            this.canvas.width,
            this.canvas.height,
            "r8unorm",
            "SSAO Texture"
        );
        this.ssaoTextureView = this.ssaoTexture.createView();

        this.noiseTexture = this.device.createTexture({
            size: { width: 4, height: 4 },
            format: 'rgba32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
        });
        this.noiseTextureView = this.noiseTexture.createView();
        const noiseData = new Float32Array(4 * 4 * 4);
        for (let i = 0; i < 16; i++) {
            const angle = Math.random() * Math.PI * 2;
            noiseData[i * 4] = Math.cos(angle);
            noiseData[i * 4 + 1] = Math.sin(angle);
            noiseData[i * 4 + 2] = 0;
            noiseData[i * 4 + 3] = 0;
        }
        this.device.queue.writeTexture(
            { texture: this.noiseTexture },
            noiseData,
            { bytesPerRow: 64 },
            { width: 4, height: 4 }
        );

        this.ssaoModule = this.device.createShaderModule({ code: ssaoShader, label: "SSAO Pass Shader Module" });

        this.ssaoPipeline = this.device.createRenderPipeline({
            layout: "auto",
            label: "SSAO Pipeline",
            vertex: {
                module: this.ssaoModule,
                entryPoint: 'vertexMain'
            },
            fragment: {
                module: this.ssaoModule,
                entryPoint: 'fragmentMain',
                targets: [ { format: "r8unorm" } ]
            },
            primitive: {
                topology: 'triangle-list',
            }
        });

        this.sampler = engine.textureUtil.pointSampler;

        this.ssaoBuffer = this.device.createBuffer({
            size: 4*4 + 16*4, // 4 floats for params + 16 floats for projection matrix
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: "SSAO Params Buffer"
        });

        this._updateSSAOParams = true;

        this.ssaoBindGroup = null;

        const blurXCode = blurShader.replace('BLUR_DIR', '1, 0');
        const blurYCode = blurShader.replace('BLUR_DIR', '0, 1');
        const blurXModule = this.device.createShaderModule({ code: blurXCode, label: "SSAO Blur X Shader Module" });
        const blurYModule = this.device.createShaderModule({ code: blurYCode, label: "SSAO Blur Y Shader Module" });
        this.blurTexture = null;
        this.blurTextureView = null;
        this.blurXBindGroup = null;
        this.blurYBindGroup = null;
        
        this.blurXPipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: blurXModule,
                entryPoint: 'vs_main'
            },
            fragment: {
                module: blurXModule,
                entryPoint: 'fs_main',
                targets: [{ format: 'r8unorm' }]
            },
            primitive: { topology: 'triangle-list' }
        });

        this.blurYPipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: blurYModule,
                entryPoint: 'vs_main'
            },
            fragment: {
                module: blurYModule,
                entryPoint: 'fs_main',
                targets: [{ format: 'r8unorm' }]
            },
            primitive: { topology: 'triangle-list' }
        });

        this.outputTexture = null;
        this.outputTextureView = null;
        this.depthTextureView = null;

        this.ssaoOutputModule = this.device.createShaderModule({ code: outputShader, label: "SSAO Output Shader Module" });

        this.ssaoOutputPipeline = this.device.createRenderPipeline({
            layout: "auto",
            label: "SSAO Output Pipeline",
            vertex: {
                module: this.ssaoOutputModule,
                entryPoint: 'vertexMain'
            },
            fragment: {
                module: this.ssaoOutputModule,
                entryPoint: 'fragmentMain',
                targets: [ { format: "rgba8unorm" } ]
            },
            primitive: {
                topology: 'triangle-list',
            }
        });

        this.ssaoOutputBindGroup = null;
    }

    resize(width, height) {
        this.depthTextureView = this.forwardPass.depthTextureView;

        this.ssaoTexture?.destroy();
        this.ssaoTexture = Texture.renderBuffer(
            this.device,
            width,
            height,
            "r8unorm",
            "SSAO Texture"
        );
        this.ssaoTextureView = this.ssaoTexture.createView();

        this.ssaoBindGroup = this.device.createBindGroup({
            layout: this.ssaoPipeline.getBindGroupLayout(0),
            label: "SSAO Bind Group",
            entries: [
                { binding: 0, resource: { buffer: this.ssaoBuffer } },
                { binding: 1, resource: this.sampler },
                { binding: 2, resource: this.forwardPass.positionTextureView },
                { binding: 3, resource: this.forwardPass.normalTextureView },
                { binding: 4, resource: this.depthTextureView },
                { binding: 5, resource: this.noiseTextureView },
            ],
        });

        this.blurTexture?.destroy();
        this.blurTexture = Texture.renderBuffer(
            this.device,
            width,
            height,
            "r8unorm",
            "SSAO Blur Texture"
        );
        this.blurTextureView = this.blurTexture.createView();
        this.blurXBindGroup = this.device.createBindGroup({
            layout: this.blurXPipeline.getBindGroupLayout(0),
            label: "SSAO Blur X Bind Group",
            entries: [
                { binding: 0, resource: this.ssaoTextureView },
                { binding: 1, resource: this.depthTextureView },
            ],
        });
        this.blurYBindGroup = this.device.createBindGroup({
            layout: this.blurYPipeline.getBindGroupLayout(0),
            label: "SSAO Blur Y Bind Group",
            entries: [
                { binding: 0, resource: this.blurTextureView },
                { binding: 1, resource: this.depthTextureView },
            ],
        });

        this.outputTexture?.destroy();
        this.outputTexture = Texture.renderBuffer(
            this.device,
            width,
            height,
            "rgba8unorm",
            "SSAO Output"
        );
        this.outputTextureView = this.outputTexture.createView();

        this.ssaoOutputBindGroup = this.device.createBindGroup({
            layout: this.ssaoOutputPipeline.getBindGroupLayout(0),
            label: "SSAO Output Bind Group",
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: this.forwardPass.outputTextureView },
                { binding: 2, resource: this.ssaoTextureView },
            ],
        });
    }

    render(commandEncoder) {
        if (this._updateSSAOParams) {
            const data = new Float32Array(4 + 16);
            data[0] = 1.2;   // intensity
            data[1] = 0.4;   // radius
            data[2] = 0.025; // bias
            data[3] = 0.0;   // padding
            const projectionMatrix = this.engine.camera.projection;
            data.set(projectionMatrix, 4);
            this.device.queue.writeBuffer(this.ssaoBuffer, 0, data);
            this._updateSSAOParams = false;
        }

        commandEncoder.pushDebugGroup("SSAO");
        commandEncoder.pushDebugGroup("Calculate");
        {
            const passEncoder = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: this.ssaoTextureView,
                    loadOp: "clear",
                    clearValue: { r: 0, g: 0, b: 0, a: 1.0 },
                    storeOp: "store",
                }],
            });
            passEncoder.setPipeline(this.ssaoPipeline);
            passEncoder.setBindGroup(0, this.ssaoBindGroup);
            passEncoder.draw(3, 1, 0, 0);
            passEncoder.end();
        }
        commandEncoder.popDebugGroup();

        commandEncoder.pushDebugGroup("Blur X");
        {
            const passEncoder = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: this.blurTextureView,
                    loadOp: "clear",
                    clearValue: { r: 0, g: 0, b: 0, a: 1.0 },
                    storeOp: "store",
                }],
            });
            passEncoder.setPipeline(this.blurXPipeline);
            passEncoder.setBindGroup(0, this.blurXBindGroup);
            passEncoder.draw(6, 1, 0, 0);
            passEncoder.end();
        }
        commandEncoder.popDebugGroup();

        commandEncoder.pushDebugGroup("Blur Y");
        {
            const passEncoder = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: this.ssaoTextureView,
                    loadOp: "clear",
                    clearValue: { r: 0, g: 0, b: 0, a: 1.0 },
                    storeOp: "store",
                }],
            });
            passEncoder.setPipeline(this.blurYPipeline);
            passEncoder.setBindGroup(0, this.blurYBindGroup);
            passEncoder.draw(6, 1, 0, 0);
            passEncoder.end();
        }
        commandEncoder.popDebugGroup();

        commandEncoder.pushDebugGroup("Apply");
        {
            const passEncoder = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: this.outputTextureView,
                    loadOp: "load",
                    storeOp: "store",
                }],
            });
            passEncoder.setPipeline(this.ssaoOutputPipeline);
            passEncoder.setBindGroup(0, this.ssaoOutputBindGroup);
            passEncoder.draw(3, 1, 0, 0);
            passEncoder.end();
        }
        commandEncoder.popDebugGroup();
        commandEncoder.popDebugGroup();
    }
}

const ssaoShader = `
var<private> posTex: array<vec4<f32>, 3> = array<vec4<f32>, 3>(
    vec4<f32>(-1.0, 1.0, 0.0, 0.0),
    vec4<f32>(3.0, 1.0, 2.0, 0.0),
    vec4<f32>(-1.0, -3.0, 0.0, 2.0));

struct VertexOutput {
    @builtin(position) v_position: vec4<f32>,
    @location(0) v_uv : vec2<f32>
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;

    output.v_uv = posTex[vertexIndex].zw;
    output.v_position = vec4<f32>(posTex[vertexIndex].xy, 0.0, 1.0);

    return output;
}

struct SSAOParams {
    intensity: f32,
    radius: f32,
    bias: f32,
    padding: f32,
    projection: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> params: SSAOParams;
@group(0) @binding(1) var imgSampler: sampler;
@group(0) @binding(2) var viewPosTex: texture_2d<f32>;
@group(0) @binding(3) var normalTex: texture_2d<f32>;
@group(0) @binding(4) var depthTex: texture_depth_2d;
@group(0) @binding(5) var noiseTex: texture_2d<f32>;

fn rand(co: vec2f) -> f32 {
    return abs(fract(sin(dot(co, vec2f(12.9898, 78.233))) * 43758.5453));
}

fn linearEyeDepth(depth: f32) -> f32 {
    let zNear = 0.1;
    let zFar = 1000.0;
    return (2.0 * zNear) / (zFar + zNear - depth * (zFar - zNear));
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) f32 {
    let texSize = textureDimensions(depthTex, 0);
    let fragCoord = input.v_uv * vec2f(texSize);

    var viewPosition = textureSampleLevel(viewPosTex, imgSampler, input.v_uv, 0.0).xyz;
    let depth = linearEyeDepth(textureLoad(depthTex, vec2<i32>(fragCoord), 0));
    let normalData = textureSampleLevel(normalTex, imgSampler, input.v_uv, 0);
    var normal = normalize(normalData.xyz * 2.0 - 1.0);

    if (normalData.z == 0.0) {
      return 0.0;
    }

    // Noise using textureLoad instead of textureSample
    let noiseScale = vec2f(f32(texSize.x) / 4.0, f32(texSize.y) / 4.0);
    let noiseUV = input.v_uv * noiseScale;
    let noiseCoord = vec2i(i32(noiseUV.x) % 4, i32(noiseUV.y) % 4);
    let randomVec = textureLoad(noiseTex, noiseCoord, 0).xyz;

    // Create TBN matrix in view space
    let tangent = normalize(randomVec - normal * dot(randomVec, normal));
    let bitangent = cross(normal, tangent);
    let tbn = mat3x3f(tangent, bitangent, normal);

    let numSamples = 16;
    var occlusion = 0.0;

    for (var i = 0; i < numSamples; i = i + 1) {
        let t = f32(i) / f32(numSamples);
        let angle = t * 6.283185 * 4.0;
        let radius = sqrt(t) * params.radius;

        let offset = vec3f(cos(angle), sin(angle), t) * radius;
        let samplePos = viewPosition + (tbn * offset);

        // Project sample
        var sampleProj = params.projection * vec4f(samplePos, 1.0);
        sampleProj = sampleProj / sampleProj.w;
        let sampleUV = vec2f(sampleProj.x * 0.5 + 0.5, (1.0 - sampleProj.y) * 0.5);

        // Clamp to valid range
        let validSample = sampleUV.x >= 0.0 && sampleUV.x <= 1.0 && sampleUV.y >= 0.0 && sampleUV.y <= 1.0;

        // Load depth sample
        let sampleCoord = vec2i(i32(sampleUV.x * f32(texSize.x)), i32(sampleUV.y * f32(texSize.y)));
        let clampedCoord = clamp(sampleCoord, vec2i(0), vec2i(i32(texSize.x) - 1, i32(texSize.y) - 1));
        let sampleViewPos = textureSampleLevel(viewPosTex, imgSampler, sampleUV, 0.0).xyz;

        // Range check
        let rangeCheck = smoothstep(0.0, 1.0, params.radius / abs(viewPosition.z - sampleViewPos.z));

        // Horizon-based occlusion
        let occluded = select(0.0, rangeCheck, validSample && sampleViewPos.z > samplePos.z + params.bias);
        occlusion += occluded;
    }

    occlusion = 1.0 - (occlusion / f32(numSamples));

    return pow(occlusion, params.intensity);
}`;

const blurShader = `
@group(0) @binding(0) var aoTex: texture_2d<f32>;
@group(0) @binding(1) var depthTex: texture_depth_2d;

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> @builtin(position) vec4f {
    var pos = array<vec2f, 6>(
        vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
        vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
    );
    return vec4f(pos[idx], 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) f32 {
    let texSize = textureDimensions(aoTex);
    let uv = pos.xy / vec2f(f32(texSize.x), f32(texSize.y));
    let centerDepth = textureLoad(depthTex, vec2i(pos.xy), 0);

    var result = 0.0;
    var weight = 0.0;

    for (var i = -2; i <= 2; i++) {
        let offset = vec2i(BLUR_DIR) * i;
        let samplePos = vec2i(pos.xy) + offset;
 
        if (samplePos.x < 0 || samplePos.x >= i32(texSize.x) || 
            samplePos.y < 0 || samplePos.y >= i32(texSize.y)) {
            continue;
        }
 
        let sampleDepth = textureLoad(depthTex, samplePos, 0);
        let depthDiff = abs(centerDepth - sampleDepth);
        let w = exp(-depthDiff * 100.0);
 
        result += textureLoad(aoTex, samplePos, 0).r * w;
        weight += w;
    }
 
    return result / weight;
}`;

const outputShader = `
var<private> posTex: array<vec4<f32>, 3> = array<vec4<f32>, 3>(
    vec4<f32>(-1.0, 1.0, 0.0, 0.0),
    vec4<f32>(3.0, 1.0, 2.0, 0.0),
    vec4<f32>(-1.0, -3.0, 0.0, 2.0));

struct VertexOutput {
    @builtin(position) v_position: vec4<f32>,
    @location(0) v_uv : vec2<f32>
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;
    output.v_uv = posTex[vertexIndex].zw;
    output.v_position = vec4<f32>(posTex[vertexIndex].xy, 0.0, 1.0);
    return output;
}

@group(0) @binding(0) var imgSampler: sampler;
@group(0) @binding(1) var img: texture_2d<f32>;
@group(0) @binding(2) var ssao: texture_2d<f32>;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
    let color = textureSampleLevel(img, imgSampler, input.v_uv, 0.0);
    let ao = textureSampleLevel(ssao, imgSampler, input.v_uv, 0.0).r;

    return vec4<f32>(color.rgb * ao, color.a);
    //return color;
    //return vec4<f32>(ao, ao, ao, 1.0);
}`;
