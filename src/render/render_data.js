import { Matrix4 } from "../math/matrix4.js";

export class RenderData {
    constructor(device) {
        this.device = device;
        this._modelBuffers = [];
        this._viewUniformBuffer = device.createBuffer({
            size: 64 * 2,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: "View Uniform"
        });

        this._inverseViewProjection = new Matrix4();
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
        modelViewProjection.invert(this._inverseViewProjection);

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
            this._inverseViewProjection.buffer,
            this._inverseViewProjection.byteOffset,
            this._inverseViewProjection.byteLength
        );
    }
}
