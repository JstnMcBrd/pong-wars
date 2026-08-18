import wgsl from "../shaders/main.wgsl?raw";
import type { RenderTarget } from "./target.js";

/** Number of vertices in a quad drawn with triangle strip topology. */
const QUAD_VERTICES = 4;

/** Maximum number of frames the queue may hold at once. */
const MAX_FRAMES_IN_FLIGHT = 2;

/** @returns the maximum supported grid size for this device. */
export function maxGpuSupportedGridSize(device: GPUDevice): number {
  const maxGridBytes = Math.min(
    device.limits.maxBufferSize, // The maximum `size` when creating a GPUBuffer.
    device.limits.maxStorageBufferBindingSize, // The maximum `size` for storage buffer bindings.
  );
  return Math.floor(Math.sqrt(maxGridBytes / Uint32Array.BYTES_PER_ELEMENT));
}

/** @returns number of workgroups needed to give every item its own invocation. */
function workgroupCount(items: number, workgroupSize: number): number {
  return Math.ceil(items / workgroupSize);
}

/** The whole simulation, start to finish, on the GPU. */
export class Engine {
  // GPU objects
  private readonly device: GPUDevice;
  private readonly target: RenderTarget;

  // Buffers
  private readonly canvasDimBuffer: GPUBuffer;
  private readonly gridDimBuffer: GPUBuffer;
  private readonly numTeamsBuffer: GPUBuffer;
  private readonly numTicksBuffer: GPUBuffer;
  private gridBuffer: GPUBuffer | null; // Assigned at reset
  private ballsBuffer: GPUBuffer | null; // Assigned at reset

  // Bind group layouts
  private readonly bindGroup0Layout: GPUBindGroupLayout;
  private readonly computeBindGroup1Layout: GPUBindGroupLayout;
  private readonly renderBindGroup1Layout: GPUBindGroupLayout;

  // Bind groups
  private readonly bindGroup0: GPUBindGroup;
  private computeBindGroup1: GPUBindGroup | null; // Assigned at reset
  private renderBindGroup1: GPUBindGroup | null; // Assigned at reset

  // Pipelines
  private readonly initGridPipeline: GPUComputePipeline;
  private readonly initBallsPipeline: GPUComputePipeline;
  private readonly simPipeline: GPUComputePipeline;
  private readonly gridPipeline: GPURenderPipeline;
  private readonly ballPipeline: GPURenderPipeline;

  // Workgroup size overrides
  private readonly initGridWorkgroupSize: number;
  private readonly initBallsWorkgroupSize: number;
  private readonly simWorkgroupSize: number;

  private numTeams = 2;
  private framesInFlight = 0;

  public constructor(device: GPUDevice, target: RenderTarget) {
    this.device = device;
    this.target = target;

    // Workgroup size overrides

    this.initGridWorkgroupSize = Math.min(
      Math.floor(Math.sqrt(this.device.limits.maxComputeInvocationsPerWorkgroup)),
      this.device.limits.maxComputeWorkgroupSizeX,
      this.device.limits.maxComputeWorkgroupSizeY,
    );
    this.initBallsWorkgroupSize = Math.min(
      this.device.limits.maxComputeWorkgroupSizeX,
      this.device.limits.maxComputeInvocationsPerWorkgroup,
    );
    this.simWorkgroupSize = this.initBallsWorkgroupSize;

    const shaderModule = this.device.createShaderModule({ code: wgsl });

    // ── Buffers ─────────────────────────────────────────────────────────────

    this.canvasDimBuffer = this.device.createBuffer({
      label: "canvas_dim",
      size: 2 * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.gridDimBuffer = this.device.createBuffer({
      label: "grid_dim",
      size: 2 * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.numTeamsBuffer = this.device.createBuffer({
      label: "num_teams",
      size: Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.numTicksBuffer = this.device.createBuffer({
      label: "num_ticks",
      size: Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Assigned at reset
    this.gridBuffer = null;
    this.ballsBuffer = null;

    // ── Bind Group Layouts ──────────────────────────────────────────────────

    this.bindGroup0Layout = this.device.createBindGroupLayout({
      label: "@group(0) layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });

    this.computeBindGroup1Layout = this.device.createBindGroupLayout({
      label: "@group(1) compute layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
      ],
    });

    this.renderBindGroup1Layout = this.device.createBindGroupLayout({
      label: "@group(1) render layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage" },
        },
      ],
    });

    const computePipelineLayout = this.device.createPipelineLayout({
      label: "compute pipeline layout",
      bindGroupLayouts: [this.bindGroup0Layout, this.computeBindGroup1Layout],
    });

    const renderPipelineLayout = this.device.createPipelineLayout({
      label: "render pipeline layout",
      bindGroupLayouts: [this.bindGroup0Layout, this.renderBindGroup1Layout],
    });

    // ── Bind Groups ─────────────────────────────────────────────────────────

    this.bindGroup0 = this.device.createBindGroup({
      label: "@group(0) bindings",
      layout: this.bindGroup0Layout,
      entries: [
        { binding: 0, resource: { buffer: this.canvasDimBuffer } },
        { binding: 1, resource: { buffer: this.gridDimBuffer } },
        { binding: 2, resource: { buffer: this.numTeamsBuffer } },
        { binding: 3, resource: { buffer: this.numTicksBuffer } },
      ],
    });

    // Assigned at reset
    this.computeBindGroup1 = null;
    this.renderBindGroup1 = null;

    // ── Pipelines ───────────────────────────────────────────────────────────

    this.initGridPipeline = this.device.createComputePipeline({
      label: "init_grid",
      layout: computePipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: "init_grid",
        constants: { INIT_GRID_WORKGROUP_SIZE: this.initGridWorkgroupSize },
      },
    });

    this.initBallsPipeline = this.device.createComputePipeline({
      label: "init_balls",
      layout: computePipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: "init_balls",
        constants: { INIT_BALLS_WORKGROUP_SIZE: this.initBallsWorkgroupSize },
      },
    });

    this.simPipeline = this.device.createComputePipeline({
      label: "sim",
      layout: computePipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: "sim",
        constants: { SIM_WORKGROUP_SIZE: this.simWorkgroupSize },
      },
    });

    this.gridPipeline = this.device.createRenderPipeline({
      label: "grid",
      layout: renderPipelineLayout,
      vertex: { module: shaderModule, entryPoint: "grid_vertex" },
      fragment: {
        module: shaderModule,
        entryPoint: "grid_fragment",
        targets: [{ format: target.format }],
      },
      primitive: { topology: "triangle-strip" },
    });

    this.ballPipeline = this.device.createRenderPipeline({
      label: "ball",
      layout: renderPipelineLayout,
      vertex: { module: shaderModule, entryPoint: "ball_vertex" },
      fragment: {
        module: shaderModule,
        entryPoint: "ball_fragment",
        targets: [{ format: target.format }],
      },
      primitive: { topology: "triangle-strip" },
    });

    // ── Start ───────────────────────────────────────────────────────────────

    this.resize();

    this.target.onResize(() => {
      this.resize();
    });
  }

  /** Tell the shaders how large the target is now. */
  private resize(): void {
    this.device.queue.writeBuffer(
      this.canvasDimBuffer,
      0,
      new Uint32Array([this.target.width, this.target.height]),
    );
  }

  /** Throw away the current state, paint the starting grid, and place the balls. */
  public reset(cols: number, rows: number, numTeams: number): void {
    // Update settings buffers

    this.device.queue.writeBuffer(this.gridDimBuffer, 0, new Uint32Array([cols, rows]));
    this.device.queue.writeBuffer(this.numTeamsBuffer, 0, new Uint32Array([numTeams]));
    this.numTeams = numTeams;

    // Destroy and recreate the grid/ball buffers (if necessary)

    const gridBufferSize = cols * rows * Uint32Array.BYTES_PER_ELEMENT;
    if (this.gridBuffer?.size !== gridBufferSize) {
      this.gridBuffer?.destroy();
      this.gridBuffer = this.device.createBuffer({
        label: "grid",
        size: gridBufferSize,
        usage: GPUBufferUsage.STORAGE,
      });
    }

    const ballsBufferSize =
      numTeams *
      (2 * Float32Array.BYTES_PER_ELEMENT + // pos
        2 * Float32Array.BYTES_PER_ELEMENT); // vel
    if (this.ballsBuffer?.size !== ballsBufferSize) {
      this.ballsBuffer?.destroy();
      this.ballsBuffer = this.device.createBuffer({
        label: "balls",
        size: ballsBufferSize,
        usage: GPUBufferUsage.STORAGE,
      });
    }

    // Update the bind group for grid/ball buffers

    this.computeBindGroup1 = this.device.createBindGroup({
      label: "@group(1) compute bindings",
      layout: this.computeBindGroup1Layout,
      entries: [
        { binding: 0, resource: { buffer: this.gridBuffer } },
        { binding: 1, resource: { buffer: this.ballsBuffer } },
      ],
    });
    this.renderBindGroup1 = this.device.createBindGroup({
      label: "@group(1) render bindings",
      layout: this.renderBindGroup1Layout,
      entries: [
        { binding: 0, resource: { buffer: this.gridBuffer } },
        { binding: 1, resource: { buffer: this.ballsBuffer } },
      ],
    });

    // Run the init compute passes

    const encoder = this.device.createCommandEncoder();

    const pass = encoder.beginComputePass();

    pass.setBindGroup(0, this.bindGroup0);
    pass.setBindGroup(1, this.computeBindGroup1);

    pass.setPipeline(this.initGridPipeline);
    pass.dispatchWorkgroups(
      workgroupCount(cols, this.initGridWorkgroupSize),
      workgroupCount(rows, this.initGridWorkgroupSize),
    );

    pass.setPipeline(this.initBallsPipeline);
    pass.dispatchWorkgroups(workgroupCount(numTeams, this.initBallsWorkgroupSize));

    pass.end();

    this.device.queue.submit([encoder.finish()]);
  }

  /**
   * Advance the simulation by `ticks` and draw it.
   * @returns `true` if the frame was rendered, `false` if the frame was dropped.
   */
  public render(ticks: number): boolean {
    // Drop frames if the queue is full

    if (this.framesInFlight >= MAX_FRAMES_IN_FLIGHT) {
      return false;
    }

    // Update settings buffers

    this.device.queue.writeBuffer(this.numTicksBuffer, 0, new Uint32Array([ticks]));

    // Run simulation pass (if applicable)

    const encoder = this.device.createCommandEncoder();

    if (ticks > 0) {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.simPipeline);
      pass.setBindGroup(0, this.bindGroup0);
      pass.setBindGroup(1, this.computeBindGroup1);
      pass.dispatchWorkgroups(1); // Exactly one workgroup, looping over every tick internally.
      pass.end();
    }

    // Run render passes

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.target.currentView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });

    pass.setBindGroup(0, this.bindGroup0);
    pass.setBindGroup(1, this.renderBindGroup1);

    pass.setPipeline(this.gridPipeline);
    pass.draw(QUAD_VERTICES);

    pass.setPipeline(this.ballPipeline);
    pass.draw(QUAD_VERTICES, this.numTeams);

    pass.end();

    this.device.queue.submit([encoder.finish()]);

    // Track number of frames in queue

    this.framesInFlight++;
    void this.device.queue.onSubmittedWorkDone().then(() => {
      this.framesInFlight--;
    });

    return true;
  }
}
