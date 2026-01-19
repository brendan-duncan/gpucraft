import { Texture } from "../gpu/texture.js";

export class SSAOPass {
    constructor(renderData, gbufferPass) {
        this.renderData = renderData;
        const engine = renderData.engine;
        this.engine = engine;
        this.canvas = engine.canvas;
        this.device = engine.device;
        this.gbufferPass = gbufferPass;

        this.ssaoTexture = Texture.renderBuffer(
            this.device,
            this.canvas.width,
            this.canvas.height,
            "r8unorm",
            "SSAO Texture"
        );
        this.ssaoTextureView = this.ssaoTexture.createView();

        let noiseWidth = 4;
        let noiseHeight = 4;
        this.noiseTexture = this.device.createTexture({
            size: { width: noiseWidth, height: noiseHeight },
            format: 'rgba32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
        });

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
            label: "SSAO Uniforms"
        });

        this._updateSSAOParams = true;

        this.ssaoBindGroup = null;

        const blurModule = this.device.createShaderModule({ code: blurShader, label: "SSAO Blur Shader Module" });
        this.outputTexture = null;
        this.outputTextureView = null;
        this.blurBindGroup = null;
        
        this.blurPipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: blurModule,
                entryPoint: 'vs_main'
            },
            fragment: {
                module: blurModule,
                entryPoint: 'fs_main',
                targets: [{ format: 'r8unorm' }]
            },
            primitive: { topology: 'triangle-list' }
        });
    }

    resize(width, height) {
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
                { binding: 2, resource: this.gbufferPass.positionTextureView },
                { binding: 3, resource: this.gbufferPass.normalTextureView },
            ],
        });

        this.outputTexture?.destroy();
        this.outputTexture = Texture.renderBuffer(
            this.device,
            width,
            height,
            "r8unorm",
            "SSAO Blur Texture"
        );
        this.outputTextureView = this.outputTexture.createView();

        this.blurBindGroup = this.device.createBindGroup({
            layout: this.blurPipeline.getBindGroupLayout(0),
            label: "SSAO Blur Bind Group",
            entries: [
                { binding: 0, resource: this.ssaoTextureView },
                { binding: 1, resource: this.engine.textureUtil.linearSampler }
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

        commandEncoder.pushDebugGroup("Blur");
        {
            const passEncoder = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: this.outputTextureView,
                    loadOp: "clear",
                    clearValue: { r: 0, g: 0, b: 0, a: 1.0 },
                    storeOp: "store",
                }],
            });
            passEncoder.setPipeline(this.blurPipeline);
            passEncoder.setBindGroup(0, this.blurBindGroup);
            passEncoder.draw(6, 1, 0, 0);
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

fn rand(co: vec2f) -> f32 {
    return abs(fract(sin(dot(co, vec2f(12.9898, 78.233))) * 43758.5453));
}

@group(0) @binding(0) var<uniform> ssaoUniforms: SSAOParams;
@group(0) @binding(1) var imgSampler: sampler;
@group(0) @binding(2) var viewPosTex: texture_2d<f32>;
@group(0) @binding(3) var normalTex: texture_2d<f32>;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) f32 {
    let texSize = textureDimensions(normalTex, 0);
    let fragCoord = input.v_uv * vec2f(texSize);

    var viewPosition = textureSampleLevel(viewPosTex, imgSampler, input.v_uv, 0.0).xyz;

    let normalData = textureSampleLevel(normalTex, imgSampler, input.v_uv, 0);
    var normal = normalize(normalData.xyz * 2.0 - 1.0);

    if (normalData.z == 0.0) {
      return 0.0;
    }

    // Noise using textureLoad instead of textureSample
    let noiseScale = vec2f(f32(texSize.x) / 4.0, f32(texSize.y) / 4.0);
    let noiseUV = input.v_uv * noiseScale;
    let noiseCoord = vec2i(i32(noiseUV.x) % 4, i32(noiseUV.y) % 4);
    let randomVec = vec3f(
        rand(input.v_uv + vec2f(f32(noiseCoord.x), f32(noiseCoord.y))) * 2.0 - 1.0,
        rand(input.v_uv + vec2f(f32(noiseCoord.y), f32(noiseCoord.x))) * 2.0 - 1.0,
        rand(input.v_uv + vec2f(f32(noiseCoord.y + noiseCoord.x), f32(noiseCoord.x))));

    // Create TBN matrix in view space
    let tangent = normalize(randomVec - normal * dot(randomVec, normal));
    let bitangent = cross(normal, tangent);
    let tbn = mat3x3f(tangent, bitangent, normal);

    let numSamples = 16;
    var occlusion = 0.0;

    for (var i = 0; i < numSamples; i = i + 1) {
        let t = f32(i) / f32(numSamples);
        let angle = t * 6.283185 * 4.0;
        let radius = sqrt(t) * ssaoUniforms.radius;

        let offset = vec3f(cos(angle), sin(angle), t) * radius;
        let samplePos = viewPosition + (tbn * offset);

        // Project sample
        var sampleProj = ssaoUniforms.projection * vec4f(samplePos, 1.0);
        sampleProj = sampleProj / sampleProj.w;
        let sampleUV = vec2f(sampleProj.x * 0.5 + 0.5, (1.0 - sampleProj.y) * 0.5);

        // Clamp to valid range
        let validSample = sampleUV.x >= 0.0 && sampleUV.x <= 1.0 && sampleUV.y >= 0.0 && sampleUV.y <= 1.0;

        // Load depth sample
        let sampleCoord = vec2i(i32(sampleUV.x * f32(texSize.x)), i32(sampleUV.y * f32(texSize.y)));
        let clampedCoord = clamp(sampleCoord, vec2i(0), vec2i(i32(texSize.x) - 1, i32(texSize.y) - 1));
        let sampleViewPos = textureSampleLevel(viewPosTex, imgSampler, sampleUV, 0.0).xyz;

        // Range check
        let rangeCheck = smoothstep(0.0, 1.0, ssaoUniforms.radius / abs(viewPosition.z - sampleViewPos.z));

        // Horizon-based occlusion
        let occluded = select(0.0, rangeCheck, validSample && sampleViewPos.z > samplePos.z + ssaoUniforms.bias);
        occlusion += occluded;
    }

    occlusion = 1.0 - (occlusion / f32(numSamples));

    return pow(occlusion, ssaoUniforms.intensity);
}`;

const blurShader = `
@group(0) @binding(0) var aoTex: texture_2d<f32>;
@group(0) @binding(1) var aoSampler: sampler;

struct VertexOutput {
    @builtin(position) v_position: vec4<f32>,
    @location(0) v_uv : vec2<f32>
};

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VertexOutput {
    const posTex = array<vec4<f32>, 3>(
        vec4<f32>(-1.0, 1.0, 0.0, 0.0),
        vec4<f32>(3.0, 1.0, 2.0, 0.0),
        vec4<f32>(-1.0, -3.0, 0.0, 2.0));

    var output: VertexOutput;
    output.v_uv = posTex[idx].zw;
    output.v_position = vec4<f32>(posTex[idx].xy, 0.0, 1.0);
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) f32 {
    let texSize = textureDimensions(aoTex);
    let texelSize = vec2f(1.0) / vec2f(texSize);
    var result = 0.0;
    const blurSize = 4;
    var hlim = vec2f(f32(-blurSize) * 0.5 + 0.5);
    for (var x = 0; x < blurSize; x = x + 1) {
        for (var y = 0; y < blurSize; y = y + 1) {
            let offset = (hlim + vec2f(f32(x), f32(y))) * texelSize;
            let samplePos = input.v_uv + offset;
            result += textureSampleLevel(aoTex, aoSampler, samplePos, 0).r;  
        }
    }
    return result / f32(blurSize * blurSize);
}`;
