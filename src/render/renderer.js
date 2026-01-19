import { GBufferPass } from "./gbuffer_pass.js";
import { ForwardPass } from "./forward_pass.js";
import { SSAOPass } from "./ssao_pass.js";
import { SkyboxPass } from "./skybox_pass.js";
import { PresentPass } from "./present_pass.js";
import { RenderData } from "./render_data.js";

export class Renderer {
    constructor(engine) {
        this.engine = engine;
        this.device = engine.device;
        this.renderData = new RenderData(this.engine);

        this.gbufferPass = new GBufferPass(this.renderData);
        this.ssaoPass = new SSAOPass(this.renderData, this.gbufferPass);
        this.forwardPass = new ForwardPass(this.renderData, this.ssaoPass);
        this.skyboxPass = new SkyboxPass(this.renderData, this.forwardPass);
        this.presentPass = new PresentPass(this.renderData, this.skyboxPass);
    }

    resize(width, height) {
        this.gbufferPass.resize(width, height);
        this.forwardPass.resize(width, height);
        this.ssaoPass.resize(width, height);
        this.skyboxPass.resize(width, height);
        this.presentPass.resize(width, height);
    }

    render() {
        const commandEncoder = this.device.createCommandEncoder();

        this.renderData.updateViewUniforms(this.engine.camera);
        this.renderData.updateWorldChunks(this.engine.world);

        this.gbufferPass.render(commandEncoder);
        this.ssaoPass.render(commandEncoder);
        this.forwardPass.render(commandEncoder);
        this.skyboxPass.render(commandEncoder);
        this.presentPass.render(commandEncoder, this.engine.context.getCurrentTexture());

        this.device.queue.submit([commandEncoder.finish()]);
    }
}
