/** Thrown when the browser or the machine cannot provide a WebGPU device. */
export class GpuError extends Error {}

/** A WebGPU device, the canvas context that presents from it, and the canvas texture format. */
export interface Gpu {
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
}

/**
 * Acquire a device and configure `canvas` to present from it.
 * @throws a {@link GpuError} if WebGPU setup fails.
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

  // Request the adapter's highest compute limits, so that workgroups can be as large as possible.
  const requiredLimits = {
    maxComputeWorkgroupSizeX: adapter.limits.maxComputeWorkgroupSizeX, // The maximum X dimension of `workgroup_size`.
    maxComputeWorkgroupSizeY: adapter.limits.maxComputeWorkgroupSizeY, // The maximum Y dimension of `workgroup_size`.
    maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup, // The maximum product of the `workgroup_size` dimensions.
  };

  const device = await adapter.requestDevice({ requiredLimits }).catch((cause) => {
    throw new GpuError("Your machine could not provide a WebGPU device.", { cause });
  });

  // A lost device cannot recover, so tell the user and reload the page.
  void device.lost.then((info) => {
    console.error("The GPU device was lost", info);
    alert("The GPU device was lost. The page will refresh to restart the simulation.");
    location.reload();
  });

  // Log validation errors, which are otherwise silent.
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
