import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** The standard shadcn/ui `cn()` helper: merges conditional class lists and resolves
 * conflicting Tailwind utilities (e.g. `cn("px-2", condition && "px-4")` keeps px-4). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
