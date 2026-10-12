export { cn } from "cn";

/** "1 supporter", "3 supporters". */
export function supportersLabel(count: number) {
  return `${count} supporter${count === 1 ? "" : "s"}`;
}
