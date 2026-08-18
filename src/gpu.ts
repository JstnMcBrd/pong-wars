/** Raised when the browser or the machine cannot give us a WebGPU device. */
export class GpuError extends Error {}

/**
 * Acquire a device.
 *
 * Deliberately knows nothing about canvases: a headless run needs a device but
 * no swap chain, and on some software renderers the swap chain is the only part
 * that fails. See `configureCanvas` for the presenting half.
 *
 * @throws `GpuError` if WebGPU could not be configured.
 */
export async function requestDevice(): Promise<GPUDevice> {
  if (!navigator.gpu) {
    throw new GpuError("Your browser does not support WebGPU.");
  }

  // Prefer the discrete GPU on dual-GPU machines.
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) {
    throw new GpuError("No WebGPU adapter is available on this machine.");
  }

  // Request the highest possible limits to optimize workgroup sizes.
  let device: GPUDevice;
  try {
    device = await adapter.requestDevice({
      requiredLimits: {
        maxComputeWorkgroupSizeX: adapter.limits.maxComputeWorkgroupSizeX, // The maximum value of the `workgroup_size` X dimension.
        maxComputeWorkgroupSizeY: adapter.limits.maxComputeWorkgroupSizeY, // The maximum value of the `workgroup_size` Y dimension.
        maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup, // The maximum value of the product of the `workgroup_size` dimensions.
      },
    });
  } catch (error) {
    // An adapter that cannot produce a device is a broken driver, not a missing
    // one, so report it as a GPU failure rather than letting it escape raw.
    throw new GpuError(`The GPU driver could not create a device. ${String(error)}`);
  }

  // Surface validation errors that would otherwise be silent.
  device.onuncapturederror = function (event) {
    console.error(event.error);
  };

  return device;
}

/**
 * Configure `canvas` to present from `device`.
 * @throws `GpuError` if the canvas could not be configured.
 */
export function configureCanvas(
  device: GPUDevice,
  canvas: HTMLCanvasElement,
): { context: GPUCanvasContext; format: GPUTextureFormat } {
  const format = navigator.gpu.getPreferredCanvasFormat();

  const context = canvas.getContext("webgpu");
  if (!context) {
    throw new GpuError("Your browser does not support WebGPU canvases.");
  }
  context.configure({ device, format, alphaMode: "opaque" });

  return { context, format };
}
