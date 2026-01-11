import { ForwardPass } from "./forward_pass.js";
import { SSAOPass } from "./ssao_pass.js";
import { SkyboxPass } from "./skybox_pass.js";
import { PresentPass } from "./present_pass.js";

export class Renderer {
    constructor(engine) {
        this.engine = engine;
        this.device = engine.device;

        this.forwardPass = new ForwardPass(engine, this.renderData);
        this.ssaoPass = new SSAOPass(engine, this.forwardPass);
        this.skyboxPass = new SkyboxPass(engine, this.ssaoPass);
        this.presentPass = new PresentPass(engine, this.ssaoPass);
    }

    resize(width, height) {
        this.forwardPass.resize(width, height);
        this.ssaoPass.resize(width, height);
        this.skyboxPass.resize(width, height);
        this.presentPass.resize(width, height);
    }

    render() {
        const commandEncoder = this.device.createCommandEncoder();

        this.forwardPass.render(commandEncoder);
        this.ssaoPass.render(commandEncoder);
        this.skyboxPass.render(commandEncoder);
        this.presentPass.render(commandEncoder, this.engine.context.getCurrentTexture());

        this.device.queue.submit([commandEncoder.finish()]);
    }
}
