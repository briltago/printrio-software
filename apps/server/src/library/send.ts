import { openAsBlob } from "node:fs";
import type { PrinterDriver } from "@printrio/sdk";
import type { Library } from "./store.ts";

/** File name a library file gets on a printer: folders are not mirrored, it lands in the G-code root. */
export const printerFileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Uploads a library file to a printer (streamed from disk) and optionally starts it. */
export async function sendToPrinter(
  library: Library,
  driver: PrinterDriver,
  path: string,
  print: boolean,
) {
  const target = printerFileName(path);
  await driver.uploadFile(target, await openAsBlob(library.resolvePath(path)));
  if (print) await driver.startPrint(target);
  return target;
}
