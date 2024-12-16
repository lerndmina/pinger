export async function ping(target: string): Promise<number> {
  // Check if target is not empty
  if (!target) {
    throw new Error("Target is required");
  }

  const args = getPingArgs(target);
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const output = await new Response(proc.stdout).text();

  // Check for packet loss indicators
  if (output.includes("Request timed out") || output.includes("100% packet loss") || output.includes("Destination host unreachable") || !output.includes("time=")) {
    throw new Error("Packet dropped");
  }

  return parsePingOutput(output);
}

function getPingArgs(target: string): string[] {
  switch (process.platform) {
    case "win32":
      return ["ping", "-n", "1", "-w", "1000", target]; // 1 second timeout
    case "linux":
    case "darwin":
      return ["ping", "-c", "1", "-W", "1", target]; // 1 second timeout
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

function parsePingOutput(output: string): number {
  const timeMatch = process.platform === "win32" ? output.match(/time[=<](\d+)ms/) : output.match(/time=(\d+\.\d+) ms/);

  if (!timeMatch) throw new Error("Packet dropped");
  return parseFloat(timeMatch[1]);
}
