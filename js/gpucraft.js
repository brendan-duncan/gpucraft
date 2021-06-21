import { Engine } from "./engine.js";

const canvas = document.getElementById("gpucraft");
const engine = new Engine();
engine.run(canvas, { autoResizeCanvas: true });
