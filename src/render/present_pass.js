export class PresentPass {
    constructor(engine, previousPass) {
        this.engine = engine;
        this.device = engine.device;
        this.queue = engine.device.queue;

        this.preferredFormat = navigator.gpu.getPreferredCanvasFormat();

        this.outputModule = this.device.createShaderModule({ code: outputShader, label: "Present Pass Shader Module" });

        this.outputPipeline = this.device.createRenderPipeline({
            layout: "auto",
            label: "Output Pipeline",
            vertex: {
                module: this.outputModule,
                entryPoint: 'vertexMain'
            },
            fragment: {
                module: this.outputModule,
                entryPoint: 'fragmentMain',
                targets: [ { format: this.preferredFormat } ]
            },
            primitive: {
                topology: 'triangle-strip',
                stripIndexFormat: 'uint32'
            }
        });

        this.pointSampler = this.engine.textureUtil.pointSampler;

        this.previousPass = previousPass;

        this.outputBindGroup = null;
    }

    resize(width, height) {
        this.outputBindGroup = this.device.createBindGroup({
            layout: this.outputPipeline.getBindGroupLayout(0),
            label: "Output Bind Group",
            entries: [
                { binding: 0, resource: this.pointSampler },
                { binding: 1, resource: this.previousPass.outputTextureView }
            ],
        });
    }

    render(commandEncoder, outputTexture) {
        commandEncoder.pushDebugGroup("Present Pass");
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: outputTexture.createView(),
                loadOp: "clear",
                clearValue: { r: 0, g: 0, b: 0, a: 1.0 },
                storeOp: "store",
            }],
        });
        passEncoder.setPipeline(this.outputPipeline);
        passEncoder.setBindGroup(0, this.outputBindGroup);
        passEncoder.draw(3, 1, 0, 0);
        passEncoder.end();
        commandEncoder.popDebugGroup();
    }
}

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

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
    return textureSampleLevel(img, imgSampler, input.v_uv, 0.0);
}`;
