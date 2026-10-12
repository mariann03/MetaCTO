export { cn } from "cn";

/** "1 supporter", "3 supporters": English nouns that take an s. */
export const plural = (n: number, noun: string) =>
  `${n} ${noun}${n === 1 ? "" : "s"}`;
