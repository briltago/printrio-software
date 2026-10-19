// Starts simulated Moonraker printers for UI development: `pnpm dev:printers`.
// Add them in Printrio with the printed URLs.
import { FakeMoonraker } from "./fake-moonraker.ts";

const printers = [
  { name: "Voron 2.4", printing: { fileName: "enclosure_panel_left.gcode", progress: 0.42 } },
  { name: "Ender 3 V3", printing: { fileName: "3DBenchy.gcode", progress: 0.76 } },
  { name: "Voron Trident", printing: undefined },
  { name: "Prusa MK3S (Klipper)", printing: { fileName: "spool_holder.gcode", progress: 0.08 } },
  { name: "RatRig V-Core", printing: undefined },
  { name: "Sovol SV08", printing: { fileName: "gridfinity_bins.gcode", progress: 0.93 } },
];

const basePort = Number(process.env.FAKE_PRINTER_PORT ?? 7125);
for (const [index, printer] of printers.entries()) {
  const fake = new FakeMoonraker({
    port: basePort + index,
    hostname: printer.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    printing: printer.printing,
    progressPerTick: 0.0015,
  });
  console.log(`${printer.name.padEnd(22)} ${await fake.start()}`);
}
console.log("\nSimulated printers running. Ctrl+C to stop.");
