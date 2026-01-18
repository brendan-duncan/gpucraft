export class RenderData {
    constructor(engine) {
        const device = engine.device;
        const canvas = engine.canvas;
        this.engine = engine;
        this.device = device;
        this.canvas = canvas;
        this._modelBuffers = [];
        this._viewUniformBuffer = device.createBuffer({
            size: 64 * 2 + 16, // viewProjection + view + jitter
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: "View Uniform"
        });
        this.frame = 0;

        this._lightBuffer = device.createBuffer({
            size: 64 + 16 + 16 + 16, // viewProject + position + direction + color
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: "Light Uniform"
        });
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


        const light = this.engine.spotlight;
        const lightViewProj = light.modelViewProjection;
        const lightPosition = light.getWorldPosition();
        const lightDirection = light.getWorldForward();
        const lightColor = light.color;
        const colorArray = new Float32Array([lightColor.r * light.intensity, lightColor.g * light.intensity, lightColor.b * light.intensity, 1.0]);

        this.device.queue.writeBuffer(
            this._lightBuffer,
            0,
            lightViewProj.buffer,
            lightViewProj.byteOffset,
            lightViewProj.byteLength
        );
        this.device.queue.writeBuffer(
            this._lightBuffer,
            64,
            new Float32Array([lightPosition[0], lightPosition[1], lightPosition[2], 1.0]).buffer,
            0,
            16
        );
        this.device.queue.writeBuffer(
            this._lightBuffer,
            80,
            new Float32Array([lightDirection[0], lightDirection[1], lightDirection[2], 0.0]).buffer,
            0,
            16
        );
        this.device.queue.writeBuffer(
            this._lightBuffer,
            96,
            colorArray.buffer,
            0,
            16
        );

        this.frame++;
    }
}
