import { Texture } from "../gpu/texture.js";

export class ForwardPass {
    constructor(renderData, ssaoPass) {
        this.renderData = renderData;
        const engine = renderData.engine;
        this.engine = engine;
        this.device = engine.device;
        this.canvas = engine.canvas;
        this.camera = engine.camera;
        this.ssaoPass = ssaoPass;

        this.outputTexture = null;
        this.outputTextureView = null;

        this.depthTexture = null;
        this.depthTextureView = null;

        this.texture = new Texture(this.device, { mipmap: true });

        const self = this;
        this.textureLoaded = false;
        this.texture.loadUrl("resources/BlockAtlas.png").then(() => {
            self.textureView = this.texture.createView();
            self.textureLoaded = true;
        });

        this.bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
                { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
                { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
                { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
                { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
            ],
            label: "Forward Pass Bind Group Layout"
        });

        this.pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout], label: "Forward Pass Pipeline Layout" });

        this.shaderModule = this.device.createShaderModule({ code: shaderSource, label: "Forward Pass Shader Module" });
        this.pipeline = this.device.createRenderPipeline({
            layout: this.pipelineLayout,
            vertex: {
                module: this.shaderModule,
                entryPoint: "vertexMain",
                buffers: [
                    {
                        // Position
                        arrayStride: 3 * 4,
                        attributes: [
                            {
                                shaderLocation: 0,
                                offset: 0,
                                format: "float32x3",
                            },
                        ],
                    },
                    {
                        // Normal
                        arrayStride: 3 * 4,
                        attributes: [
                            {
                                shaderLocation: 1,
                                offset: 0,
                                format: "float32x3",
                            },
                        ],
                    },
                    {
                        // Color
                        arrayStride: 4 * 4,
                        attributes: [
                            {
                                shaderLocation: 2,
                                offset: 0,
                                format: "float32x4",
                            },
                        ],
                    },
                    {
                        // UV
                        arrayStride: 2 * 4,
                        attributes: [
                            {
                                shaderLocation: 3,
                                offset: 0,
                                format: "float32x2",
                            },
                        ],
                    },
                ],
            },
            fragment: {
                module: this.shaderModule,
                entryPoint: "fragmentMain",
                targets: [ { format: "rgba8unorm" } ],
            },
            primitive: {
                topology: "triangle-list",
                cullMode: "none",
            },
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: "less",
                format: "depth24plus",
            },
            label: "Forward Pass Pipeline",
        });

        this._bindGroups = [];
    }

    _getBindGroup(index) {
        if (index < this._bindGroups.length) {
            return this._bindGroups[index];
        }

        const modelBuffer = this.renderData.getModelBuffer(index);

        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.renderData.viewUniformBuffer } },
                { binding: 1, resource: { buffer: this.renderData.lightUniformBuffer } },
                { binding: 2, resource: { buffer: modelBuffer } },
                { binding: 3, resource: this.engine.textureUtil.pointSampler },
                { binding: 4, resource: this.textureView },
                { binding: 5, resource: this.ssaoPass.outputTextureView },
            ],
            label: `Forward Pass Bind Group ${index}`,
        });

        this._bindGroups.push(bindGroup);

        return bindGroup;
    }

    resize(width, height) {
        this._bindGroups = [];

        this.outputTexture?.destroy();
        this.outputTexture = Texture.renderBuffer(
            this.device,
            width,
            height,
            "rgba8unorm",
            "Forward Output Color"
        );
        this.outputTextureView = this.outputTexture.createView();

        this.depthTexture?.destroy();
        this.depthTexture = Texture.renderBuffer(
            this.device,
            width,
            height,
            "depth24plus",
            "Forward Output Depth"
        );
        this.depthTextureView = this.depthTexture.createView({aspect: "depth-only"});
    }

    render(commandEncoder) {
        if (!this.textureLoaded) {
            return;
        }

        const world = this.engine.world;

        commandEncoder.pushDebugGroup("Forward Pass");
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [
                {
                    view: this.outputTextureView,
                    loadOp: "clear",
                    clearValue: { r: 0.1, g: 0.1, b: 0.2, a: 1.0 },
                    storeOp: "store",
                }
            ],
            depthStencilAttachment: {
                view: this.depthTextureView,
                depthLoadOp: "clear",
                depthClearValue: 1.0,
                depthStoreOp: "store"
            }
        });
        passEncoder.setPipeline(this.pipeline);

        const numObjects = world.children.length;
        let chunkIndex = 0;
        for (let i = 0; i < numObjects; ++i) {
            const chunk = world.children[i];
            if (chunk.active && chunk.mesh) {
                const mesh = chunk.mesh;
                const bindGroup = this._getBindGroup(chunkIndex);
                passEncoder.setBindGroup(0, bindGroup);
                passEncoder.setVertexBuffer(0, mesh.buffers.points);
                passEncoder.setVertexBuffer(1, mesh.buffers.normals);
                passEncoder.setVertexBuffer(2, mesh.buffers.colors);
                passEncoder.setVertexBuffer(3, mesh.buffers.uvs);
                passEncoder.setIndexBuffer(mesh.buffers.triangles, "uint16");
                passEncoder.drawIndexed(mesh.indexCount);
                chunkIndex++;
            }
        }

        passEncoder.end();
        commandEncoder.popDebugGroup();
    }
}

const shaderSource = `
struct ViewUniforms {
    viewProjection: mat4x4f,
    view: mat4x4f,
    jitter: vec4f
};

struct LightUniforms {
    lightViewProjection: mat4x4f,
    lightPosition: vec4f,
    lightDirection: vec4f,
    lightColor: vec4f
};

struct ModelUniforms {
    model: mat4x4f
};

@group(0) @binding(0) var<uniform> viewUniforms: ViewUniforms;
@group(0) @binding(1) var<uniform> lightUniforms: LightUniforms;
@group(0) @binding(2) var<uniform> modelUniforms: ModelUniforms;

struct VertexInput {
    @location(0) a_position: vec3f,
    @location(1) a_normal: vec3f,
    @location(2) a_color: vec4f,
    @location(3) a_uv: vec2f
};

struct VertexOutput {
    @builtin(position) Position: vec4f,
    @location(0) v_position: vec4f,
    @location(1) v_normal: vec3f,
    @location(2) v_color: vec4f,
    @location(3) v_uv: vec2f,
    @location(4) v_view: vec4f,
    @location(5) v_worldNormal: vec3f,
    @location(6) v_screenPosition: vec4f
};

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    let worldPosition = modelUniforms.model * vec4f(input.a_position, 1.0);
    var viewPosition = viewUniforms.view * worldPosition;
    
    output.Position = viewUniforms.viewProjection * worldPosition;
    output.Position.x = output.Position.x + viewUniforms.jitter.x * output.Position.w;
    output.Position.y = output.Position.y + viewUniforms.jitter.y * output.Position.w;

    output.v_position = worldPosition;
    output.v_normal = normalize(viewUniforms.view * vec4f(input.a_normal, 0.0)).xyz;
    output.v_color = input.a_color;
    output.v_uv = input.a_uv;
    output.v_view = viewPosition;
    output.v_worldNormal = normalize((modelUniforms.model * vec4f(input.a_normal, 0.0)).xyz);

    output.v_screenPosition = output.Position;

    return output;
}

@group(0) @binding(3) var u_sampler: sampler;
@group(0) @binding(4) var u_texture: texture_2d<f32>;
@group(0) @binding(5) var u_ssaoTexture: texture_2d<f32>;

struct FragmentOutput {
    @location(0) color: vec4f,
};

@fragment
fn fragmentMain(input: VertexOutput) -> FragmentOutput {
    let GlobalLightLevel: f32 = 0.8;
    let minGlobalLightLevel: f32 = 0.3;
    let maxGlobalLightLevel: f32 = 0.9;

    let worldPos = input.v_position;
    let lightPos = lightUniforms.lightPosition;
    let lightDir = (lightPos - worldPos).xyz;
    let dirUnit = normalize(lightDir);

    var spotLight = 1.0;

    const lightAngle = 15 * (3.14159265 / 180.0);
    const lightAngleEnd = 30 * (3.14159265 / 180.0);
    const phi = cos(lightAngle * 0.5);
    const theta = cos(lightAngleEnd);
    const spotParamsW = 1.0 / (phi - theta);
    let spotDot = dot(lightUniforms.lightDirection.xyz, dirUnit.xyz);
    if (spotDot < theta) {
        spotLight = 0.0;
    } else if (spotDot < phi) {
        spotLight = pow((spotDot - theta) * spotParamsW, 1.0);
    }
    let spotLightColor = spotLight * lightUniforms.lightColor;

    var shade: f32 = (maxGlobalLightLevel - minGlobalLightLevel) * GlobalLightLevel + minGlobalLightLevel;
    shade = shade * input.v_color.a;
    shade = clamp(shade, minGlobalLightLevel, maxGlobalLightLevel);

    var light: vec4f = vec4f(shade, shade, shade, 1.0);

    var screenUv = ((input.v_screenPosition.xy / input.v_screenPosition.w) * 0.5 + 0.5).xy;
    screenUv.y = 1.0 - screenUv.y;

    let ssao = textureSampleLevel(u_ssaoTexture, u_sampler, screenUv.xy, 0).r;

    let normal: vec3f = input.v_worldNormal;   
    let dirLightDir: vec3f = normalize(vec3f(1.0, 1.0, 1.0));
    let diffuseFactor: f32 = max(dot(normal, dirLightDir), 0.0) * 1.0 + 0.4;
    light = vec4f((light.rgb * diffuseFactor) + spotLightColor.rgb, light.a);

    var color: vec4f = textureSample(u_texture, u_sampler, input.v_uv);

    color = color * light * ssao;

    var output: FragmentOutput;
    output.color = color;

    return output;
}`;
