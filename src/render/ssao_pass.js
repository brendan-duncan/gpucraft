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
            "r32float",
            "SSAO Texture"
        );
        this.ssaoTextureView = this.ssaoTexture.createView();

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
                targets: [ { format: "r32float" } ]
            },
            primitive: {
                topology: 'triangle-list',
            }
        });

        this.sampler = engine.textureUtil.pointSampler;

        this.ssaoBindGroup = this.device.createBindGroup({
            layout: this.ssaoPipeline.getBindGroupLayout(0),
            label: "SSAO Bind Group",
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: this.forwardPass.positionTextureView },
                { binding: 2, resource: this.forwardPass.normalTextureView },
            ],
        });

        this.outputTexture = Texture.renderBuffer(
            this.device,
            this.canvas.width,
            this.canvas.height,
            "rgba8unorm",
            "SSAO Output"
        );
        this.outputTextureView = this.outputTexture.createView();

        this.depthTextureView = this.forwardPass.depthTextureView;

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

    resize(width, height) {
        this.ssaoTexture.destroy();
        this.ssaoTexture = Texture.renderBuffer(
            this.device,
            width,
            height,
            "r32float",
            "SSAO Texture"
        );
        this.ssaoTextureView = this.ssaoTexture.createView();

        this.ssaoBindGroup = this.device.createBindGroup({
            layout: this.ssaoPipeline.getBindGroupLayout(0),
            label: "SSAO Bind Group",
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: this.forwardPass.positionTextureView },
                { binding: 2, resource: this.forwardPass.normalTextureView },
            ],
        });

        this.outputTexture.destroy();
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

        this.depthTextureView = this.forwardPass.depthTextureView;
    }

    render(commandEncoder) {
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

@group(0) @binding(0) var imgSampler: sampler;
@group(0) @binding(1) var worldPosTex: texture_2d<f32>;
@group(0) @binding(2) var normalTex: texture_2d<f32>;

fn rand(n: f32) -> f32 { return fract(sin(n) * 43758.5453123); }

struct SSAOParams {
    intensity: f32,
    radius: f32,
    bias: f32,
    padding: f32
};

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) f32 {
    let params = SSAOParams(1.0, 0.1, 0.025, 0.0);

    var position = textureSampleLevel(worldPosTex, imgSampler, input.v_uv, 0.0).xyz;
    var normal = textureSampleLevel(normalTex, imgSampler, input.v_uv, 0.0).xyz;
    let normalLen = length(normal);

    if (normalLen < 0.1) {
      return 0.0;
    }

    normal = normalize(normal);

    let lightDir = normalize(vec3<f32>(1.0, 1.0, 1.0));
    let diffuse = max(0.0, dot(normal, lightDir)) * 0.6 + 0.4;

    var occlusion = 0.0;
    let samples = 16;

    for (var i = 0; i < samples; i++) {
        let angle = f32(i) * 6.28318 / f32(samples);
        let spiralRadius = (f32(i + 1) / f32(samples)) * params.radius;
        let offset = vec2<f32>(cos(angle), sin(angle)) * spiralRadius * 0.05;

        let sampleUV = input.v_uv + offset;
        if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) {
            continue;
        }

        let samplePos = textureSampleLevel(worldPosTex, imgSampler, sampleUV, 0.0).xyz;
        let diff = samplePos - position;
        let dist = length(diff);

        if (dist > 0.001) {
            let diffNorm = normalize(diff);
            let weight = max(0.0, dot(normal, diffNorm) - 0.1);
            let rangeCheck = 1.0 - smoothstep(params.radius * 0.5, params.radius, dist);
            occlusion += weight * rangeCheck;
        }
    }

    occlusion = occlusion / f32(samples) * params.intensity;
    let ao = 1.0 - clamp(occlusion, 0.0, 1.0);

    //return ao * diffuse;
    //return ao;
    return diffuse;

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
}`;
