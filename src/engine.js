import { Camera } from "./camera.js";
import { Globals } from "./globals.js";
import { Input } from "./input.js";
import { Player } from "./player.js";
import { World } from "./world.js";
import { Renderer } from "./render/renderer.js";
import { TextureUtil } from "./gpu/texture_util.js";

export class Engine {
  constructor() {
    this.initialized = false;
  }

  async run(canvas, options) {
    options = options || {};

    Globals.engine = this;
    Globals.canvas = canvas;
    Globals.input = new Input(canvas);

    this.canvas = canvas;
    this.adapter = await navigator.gpu.requestAdapter();
    this.device = await this.adapter.requestDevice({ requiredFeatures: this.adapter.features, requiredLimits: this.adapter.limits });
    this.context = this.canvas.getContext("webgpu");
    this.preferredFormat = navigator.gpu.getPreferredCanvasFormat();

    const device = this.device;

    this.context.configure({
      device,
      format: this.preferredFormat,
      alphaMode: "opaque",
    });

    this.textureUtil = TextureUtil.get(this.device);

    this.camera = new Camera();
    this.player = new Player(this.camera);
    this.world = new World();

    this.world.start();

    this.renderer = new Renderer(this);

    this.autoResizeCanvas = !!options.autoResizeCanvas;
    if (options.autoResizeCanvas) {
      this.updateCanvasResolution();
    }

    this.initialized = true;

    Globals.time = Globals.now() * 0.01;

    const self = this;
    const frame = function () {
      requestAnimationFrame(frame);
      const lastTime = Globals.time;
      Globals.time = Globals.now() * 0.01;
      Globals.deltaTime = Globals.time - lastTime;
      self.update();
      self.render();
    };
    requestAnimationFrame(frame);
  }

  updateCanvasResolution() {
    const canvas = this.canvas;
    const rect = canvas.getBoundingClientRect();
    if (rect.width != canvas.width || rect.height != canvas.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
      this._onCanvasResize();
    }
  }

  update() {
    if (this.autoResizeCanvas) {
      this.updateCanvasResolution();
    }

    this.camera.aspect = this.canvas.width / this.canvas.height;

    this.world.update(this.device);
    this.player.update();
  }

  render() {
    this.renderer.render();
  }

  _onCanvasResize() {
    this.renderer.resize(this.canvas.width, this.canvas.height);
  }
}
