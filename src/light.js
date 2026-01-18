import { Camera } from "./camera.js";

export class Light extends Camera {
    constructor(parent) {
        super(parent);
        this.color = { r: 1.0, g: 1.0, b: 1.0 };
        this.intensity = 0.8;
    }
}

export class DirectionalLight extends Light {
    constructor(parent) {
        super(parent);
        this.size = 50; // orthographic size
        this.near = -100;
        this.far = 100;
    }

    get projection() {
        if (this._projectionDirty) {
            this._projection.setOrtho(-this.size, this.size, -this.size, this.size, this.near, this.far);
            this._projectionDirty = false;
        }
        return this._projection;
    }
}

export class SpotLight extends Light {
    constructor(parent) {
        super(parent);
    }
}
