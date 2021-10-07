// Derived from: https://github.com/toji/webgpu-test/blob/main/js/webgpu-renderer/webgpu-texture-helper.js

/* eslint-disable no-undef */
export class TextureUtil {
    static get(device) {
        let t = TextureUtil._devices.get(device);
        if (t) return t;
        t = new TextureUtil(device);
        TextureUtil._devices.set(device, t);
        return t;
    }

    constructor(device) {
        this.device = device;

        this.mipmapSampler = device.createSampler({ minFilter: 'linear' });

         this.mipmapPipeline = device.createRenderPipeline({
            vertex: {
                module: device.createShaderModule({ code: mipmapVertex }),
                entryPoint: 'main'
            },
            fragment: {
                module: device.createShaderModule({ code: mipmapFragment }),
                entryPoint: 'main',
                targets: [ { format: 'rgba8unorm' } ]
            },
            primitive: {
                topology: 'triangle-strip',
                stripIndexFormat: 'uint32'
            }
        });
    }

    static getNumMipmapLevels(w, h) {
        return Math.floor(Math.log2(Math.max(w, h))) + 1;
    }

    generateMipmap(imageBitmap) {
        const mipLevelCount = TextureUtil.getNumMipmapLevels(imageBitmap.width, imageBitmap.height);

        const textureSize = {
            width: imageBitmap.width,
            height: imageBitmap.height,
        };

        const texture = this.device.createTexture({
            size: textureSize,
            format: "rgba8unorm",
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
            mipLevelCount: mipLevelCount
        });

        this.device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture }, textureSize);
    
        const commandEncoder = this.device.createCommandEncoder({});

        const bindGroupLayout = this.mipmapPipeline.getBindGroupLayout(0);

        for (let i = 1; i < mipLevelCount; ++i) {
            const bindGroup = this.device.createBindGroup({
                layout: bindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: this.mipmapSampler,
                    },
                    {
                        binding: 1,
                        resource: texture.createView({
                            baseMipLevel: i - 1,
                            mipLevelCount: 1
                        })
                    }
                ]
            });

            const passEncoder = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: texture.createView({
                        baseMipLevel: i,
                        mipLevelCount: 1
                    }),
                    loadValue: 'load'
                }]
            });

            passEncoder.setPipeline(this.mipmapPipeline);
            passEncoder.setBindGroup(0, bindGroup);
            passEncoder.draw(4, 1, 0, 0);
            passEncoder.endPass();

            textureSize.width = Math.ceil(textureSize.width / 2);
            textureSize.height = Math.ceil(textureSize.height / 2);
        }
    
        this.device.queue.submit([ commandEncoder.finish() ]);

        return texture;
    }
}

TextureUtil._devices = new Map();

const vertexOutput = `
struct VertexOutput {
    [[builtin(position)]] v_position: vec4<f32>;
    [[location(0)]] v_uv : vec2<f32>;
};`;

const mipmapVertex = `
var<private> pos: array<vec2<f32>, 4> = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0));

var<private> tex: array<vec2<f32>, 4> = array<vec2<f32>, 4>(
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 0.0),
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0));

struct VertexInput {
    [[builtin(vertex_index)]] vertexIndex: u32;
};

${vertexOutput}

[[stage(vertex)]]
fn main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;

    output.v_uv = tex[input.vertexIndex];
    output.v_position = vec4<f32>(pos[input.vertexIndex], 0.0, 1.0);

    return output;
}`;

const mipmapFragment = `
[[binding(0), group(0)]] var imgSampler: sampler;
[[binding(1), group(0)]] var img: texture_2d<f32>;

${vertexOutput}

[[stage(fragment)]]
fn main(input: VertexOutput) -> [[location(0)]] vec4<f32> {
    var outColor = textureSample(img, imgSampler, input.v_uv);
    return outColor;
}`;


// Copyright 2020 Brandon Jones
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
