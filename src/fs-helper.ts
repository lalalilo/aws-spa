import { readdirSync, statSync } from "fs";
import { join } from "path";

export const readRecursively = (dir: string): string[] => {
  return readdirSync(dir).reduce(
    (files, file) => {
      if (statSync(join(dir, file)).isDirectory()) {
        return files.concat(readRecursively(join(dir, file)));
      }
      return files.concat(join(dir, file));
    },
    [] as string[]
  );
};
