import { Matrix4 } from "../math/matrix4.js";

export class RenderData {
    constructor(device, canvas) {
        this.device = device;
        this.canvas = canvas;
        this._modelBuffers = [];
        this._viewUniformBuffer = device.createBuffer({
            size: 64 * 2 + 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: "View Uniform"
        });
        this.frame = 0;
    }

    // Halton sequence for jitter
    halton(index, base) {
        let result = 0;
        let f = 1 / base;
        let i = index;
        while (i > 0) {
            result += f * (i % base);
            i = Math.floor(i / base);
            f /= base;
        }
        return result;
    }

    getJitter(frame) {
        const samples = 8;
        const idx = frame % samples;
        return {
            x: ((this.halton(idx, 2) - 0.5) / this.canvas.width),
            y: ((this.halton(idx, 3) - 0.5) / this.canvas.height)
        };
    }

    getModelBuffer(index) {
        if (index < this._modelBuffers.length) {
            return this._modelBuffers[index];
        }

        const buffer = this.device.createBuffer({
            size: 4 * 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: `Model Uniform ${index}`,
        });
        this._modelBuffers.push(buffer);

        return buffer;
    }

    updateChunkTransform(chunk, chunkIndex) {
        const modelBuffer = this.getModelBuffer(chunkIndex);
        const transform = chunk.worldTransform;
        this.device.queue.writeBuffer(
            modelBuffer,
            0,
            transform.buffer,
            transform.byteOffset,
            transform.byteLength
        );
    }

    updateWorldChunks(world) {
        const numObjects = world.children.length;
        let chunkIndex = 0;
        for (let i = 0; i < numObjects; ++i) {
            const chunk = world.children[i];
            if (chunk.active && chunk.mesh) {
                this.updateChunkTransform(chunk, chunkIndex);
                chunkIndex++;
            }
        }
    }

    updateViewUniforms(camera) {
        const modelViewProjection = camera.modelViewProjection;
        const worldToView = camera.worldToView;

        this.device.queue.writeBuffer(
            this._viewUniformBuffer,
            0,
            modelViewProjection.buffer,
            modelViewProjection.byteOffset,
            modelViewProjection.byteLength
        );

        this.device.queue.writeBuffer(
            this._viewUniformBuffer,
            64,
            worldToView.buffer,
            worldToView.byteOffset,
            worldToView.byteLength
        );

        const jitter = this.getJitter(this.frame);
        this.device.queue.writeBuffer(
            this._viewUniformBuffer,
            128,
            new Float32Array([jitter.x, jitter.y, 0, 0]).buffer,
            0,
            16
        );
        this.frame++;
    }
}
