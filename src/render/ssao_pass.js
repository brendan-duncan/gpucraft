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

        this.ssaoBindGroup = null;

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
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: this.forwardPass.positionTextureView },
                { binding: 2, resource: this.forwardPass.normalTextureView },
                { binding: 3, resource: this.depthTextureView }
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
@group(0) @binding(3) var depthTex: texture_depth_2d;

fn rand(co: vec2f) -> f32 {
    return abs(fract(sin(dot(co, vec2f(12.9898, 78.233))) * 43758.5453));
}

struct SSAOParams {
    intensity: f32,
    radius: f32,
    bias: f32,
    padding: f32
};

fn linearEyeDepth(depth: f32) -> f32 {
    let zNear = 0.1;
    let zFar = 1000.0;
    return (2.0 * zNear) / (zFar + zNear - depth * (zFar - zNear));
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) f32 {
    let params = SSAOParams(1.0, 0.2, 0.025, 0.0);

    let texSize = textureDimensions(depthTex, 0);
    let fragCoord = input.v_uv * vec2f(texSize);

    var worldPosition = textureSampleLevel(worldPosTex, imgSampler, input.v_uv, 0.0).xyz;
    let depth = linearEyeDepth(textureLoad(depthTex, vec2<i32>(fragCoord), 0));
    let normalData = textureSampleLevel(normalTex, imgSampler, input.v_uv, 0);
    var normal = normalize(normalData.xyz * 2.0 - 1.0);

    if (depth >= 1.0) {
      return 0.0;
    }

    let lightDir = normalize(vec3<f32>(1.0, 1.0, 1.0));
    let diffuse = max(0.0, dot(normal, lightDir)) * 0.6 + 0.4;

    let radius = 3.0;
    let numSamples = 16;
    var occlusion = 0.0;

    for (var i = 0; i < numSamples; i = i + 1) {
        let angle = f32(i) / f32(numSamples) * 6.28318;
        let sampleOffset = vec2<f32>(cos(angle), sin(angle)) * radius;
        let samplePos = vec2<i32>(fragCoord.xy) + vec2<i32>(sampleOffset);

        if (samplePos.x >= 0 && samplePos.x < i32(texSize.x) &&
            samplePos.y >= 0 && samplePos.y < i32(texSize.y)) {
            let sampleDepth = linearEyeDepth(textureLoad(depthTex, samplePos, 0));

            if (sampleDepth > depth) {
                let diff = sampleDepth - depth;
                let falloff = 0.01;
                let area = 0.05;
                let weight = smoothstep(0.0, 0.001, diff) * (1.0 - smoothstep(falloff, area, diff));
                //let weight = step(falloff, diff) * (1.0 - smoothstep(falloff, area, diff));
                occlusion = occlusion + weight;
            }
        }
    }

    occlusion = occlusion / f32(numSamples);

    let intensity = 1.2;
    let ao = 1.0 - occlusion * intensity;

    return ao * diffuse;
    //return ao;
    //return diffuse;

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
