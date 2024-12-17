function getPingArgs(target: string): string[] {
  switch (process.platform) {
    case "win32":
      return ["ping", "-n", "1", "-w", "1000", target];
    case "darwin": // macOS specific
      return ["ping", "-c", "1", "-t", "1", target]; // -t for timeout on macOS
    case "linux":
      return ["ping", "-c", "1", "-W", "1", target];
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

function parsePingOutput(output: string): number {
  let timeMatch;

  if (process.platform === "win32") {
    timeMatch = output.match(/time[=<](\d+)ms/);
  } else if (process.platform === "darwin") {
    timeMatch = output.match(/time=(\d+\.?\d*) ms/); // Handle both integer and decimal values
  } else {
    timeMatch = output.match(/time=(\d+\.\d+) ms/);
  }

  if (!timeMatch) {
    throw new Error(`Failed to parse ping output: ${output}`);
  }

  return parseFloat(timeMatch[1]);
}

export async function ping(target: string): Promise<number> {
  if (!target) {
    throw new Error("Target is required");
  }

  const args = getPingArgs(target);
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (stderr.includes("Operation not permitted")) {
    throw new Error("Ping requires root privileges on macOS. Run with sudo.");
  }

  if (output.includes("Request timed out") || output.includes("100% packet loss") || output.includes("Destination host unreachable") || !output.includes("time")) {
    throw new Error(`Packet dropped: ${output}`);
  }

  return parsePingOutput(output);
}
