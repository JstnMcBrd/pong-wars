/** Raised when the browser or the machine cannot give us a WebGPU device. */
export class GpuError extends Error {}

/** A live device, its canvas, and the capabilities the rest of the app derives from it. */
export interface Gpu {
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
}

/**
 * Acquire a device and configure `canvas` to present from it.
 * @throws `GpuError` if WebGPU could not be configured.
 */
export async function requestGpu(canvas: HTMLCanvasElement): Promise<Gpu> {
  if (!navigator.gpu) {
    throw new GpuError("Your browser does not support WebGPU.");
  }

  const format = navigator.gpu.getPreferredCanvasFormat();

  // Prefer the discrete GPU on dual-GPU machines.
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) {
    throw new GpuError("No WebGPU adapter is available on this machine.");
  }

  // Request the highest possible limits to optimize workgroup sizes.
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxComputeWorkgroupSizeX: adapter.limits.maxComputeWorkgroupSizeX, // The maximum value of the `workgroup_size` X dimension.
      maxComputeWorkgroupSizeY: adapter.limits.maxComputeWorkgroupSizeY, // The maximum value of the `workgroup_size` Y dimension.
      maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup, // The maximum value of the product of the `workgroup_size` dimensions.
    },
  });

  // Losing the GPU device is an unrecoverable error, so alert the user and refresh.
  void device.lost.then((info) => {
    console.error("The GPU device was lost", info);
    alert("The GPU device was lost. The page will refresh to restart the simulation.");
    location.reload();
  });

  // Surface validation errors that would otherwise be silent.
  device.onuncapturederror = function (event) {
    console.error(event.error);
  };

  // Configure the canvas to present from the device.
  const context = canvas.getContext("webgpu");
  if (!context) {
    throw new GpuError("Your browser does not support WebGPU canvases.");
  }
  context.configure({ device, format, alphaMode: "opaque" });

  return { device, context, format };
}
