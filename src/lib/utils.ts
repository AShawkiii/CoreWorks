import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges Tailwind classes, letting later conditional classes win. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
