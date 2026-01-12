import { Texture } from "../gpu/texture.js";
import { RenderData } from "./render_data.js";

export class ForwardPass {
    constructor(engine, renderData) {
        this.engine = engine;
        this.device = engine.device;
        this.canvas = engine.canvas;
        this.renderData = renderData;
        this.camera = engine.camera;

        this.renderData = new RenderData(this.device);

        this.sampler = engine.textureUtil.pointSampler;

        this.outputTexture = null;
        this.outputTextureView = null;

        this.normalTexture = null;
        this.normalTextureView = null;

        this.positionTexture = null;
        this.positionTextureView = null;

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
                { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
            ],
            label: "Forward Pass Bind Group Layout"
        });

        this.pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [this.bindGroupLayout],
        });

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
                targets: [
                    { format: "rgba8unorm" },
                    { format: "rgba16float" },
                    { format: "rgba16float" }
                ],
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
                { binding: 0, resource: { buffer: this.renderData._viewUniformBuffer } },
                { binding: 1, resource: { buffer: modelBuffer } },
                { binding: 2, resource: this.sampler },
                { binding: 3, resource: this.textureView },
            ],
            label: `Forward Pass Bind Group ${index}`,
        });

        this._bindGroups.push(bindGroup);

        return bindGroup;
    }

    resize(width, height) {
        this.outputTexture?.destroy();
        this.outputTexture = Texture.renderBuffer(
            this.device,
            width,
            height,
            "rgba8unorm",
            "Output Color Texture"
        );
        this.outputTextureView = this.outputTexture.createView();

        this.positionTexture?.destroy();
        this.positionTexture = Texture.renderBuffer(
            this.device,
            width,
            height,
            "rgba16float",
            "GBuffer Position"
        );
        this.positionTextureView = this.positionTexture.createView();

        this.normalTexture?.destroy();
        this.normalTexture = Texture.renderBuffer(
            this.device,
            width,
            height,
            "rgba16float",
            "GBuffer Normal"
        );
        this.normalTextureView = this.normalTexture.createView();

        this.depthTexture?.destroy();
        this.depthTexture = Texture.renderBuffer(
            this.device,
            width,
            height,
            "depth24plus",
            "GBuffer Depth"
        );
        this.depthTextureView = this.depthTexture.createView({aspect: "depth-only"});
    }

    render(commandEncoder) {
        if (!this.textureLoaded) {
            return;
        }

        this.renderData.updateViewUniforms(this.engine.camera);
        this.renderData.updateWorldChunks(this.engine.world);

        const world = this.engine.world;

        commandEncoder.pushDebugGroup("Forward Pass");
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [
                {
                    view: this.outputTextureView,
                    loadOp: "clear",
                    clearValue: { r: 0.1, g: 0.1, b: 0.2, a: 1.0 },
                    storeOp: "store",
                },
                {
                    view: this.positionTextureView,
                    loadOp: "clear",
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
                    storeOp: "store",
                },
                {
                    view: this.normalTextureView,
                    loadOp: "clear",
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
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
    view: mat4x4f
};

struct ModelUniforms {
    model: mat4x4f
};

@binding(0) @group(0) var<uniform> viewUniforms: ViewUniforms;
@binding(1) @group(0) var<uniform> modelUniforms: ModelUniforms;

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
    @location(4) v_view: vec4f
};

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    let worldPosition = modelUniforms.model * vec4f(input.a_position, 1.0);
    var viewPosition = viewUniforms.view * worldPosition;
    output.Position = viewUniforms.viewProjection * worldPosition;
    output.v_position = worldPosition;
    output.v_normal = normalize(input.a_normal.xyz);
    output.v_color = input.a_color;
    output.v_uv = input.a_uv;
    output.v_view = viewPosition;
    return output;
}

@binding(2) @group(0) var u_sampler: sampler;
@binding(3) @group(0) var u_texture: texture_2d<f32>;

struct FragmentOutput {
    @location(0) color: vec4f,
    @location(1) position: vec4f,
    @location(2) normal: vec4f
};

@fragment
fn fragmentMain(input: VertexOutput) -> FragmentOutput {
    let GlobalLightLevel: f32 = 0.8;
    let minGlobalLightLevel: f32 = 0.2;
    let maxGlobalLightLevel: f32 = 0.9;

    var shade: f32 = (maxGlobalLightLevel - minGlobalLightLevel) * GlobalLightLevel + minGlobalLightLevel;
    shade = shade * input.v_color.a;

    shade = clamp(shade, minGlobalLightLevel, maxGlobalLightLevel);

    var light: vec4f = vec4f(shade, shade, shade, 1.0);

    var color: vec4f = textureSample(u_texture, u_sampler, input.v_uv);

    var output: FragmentOutput;
    output.color = color * light;
    output.position = input.v_position;
    output.normal = vec4f(normalize(input.v_normal) * 0.5 + 0.5, input.v_view.z);
    return output;
}`;
