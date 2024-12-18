export default function parseSize(val: string): number {
  const match = val.match(/^(\d+)([km])?$/i);
  if (!match) {
    throw new Error("Invalid size format. Use number with optional k/m suffix (e.g., 100, 2k, 1m)");
  }

  const num = parseInt(match[1], 10);
  const unit = match[2]?.toLowerCase() || "";

  let result: number;
  switch (unit) {
    case "k":
      result = num * 1000;
      break;
    case "m":
      result = num * 1000000;
      break;
    default:
      result = num;
  }

  const MAX_SIZE = 99 * 1000000; // 99m
  if (result > MAX_SIZE) {
    throw new Error(`Size cannot exceed 99m (${MAX_SIZE.toLocaleString()} entries)`);
  }

  return result;
}
