import { z } from "zod";

export const printerStateSchema = z.enum([
  "offline",
  "connecting",
  "idle",
  "printing",
  "paused",
  "error",
]);
export type PrinterState = z.infer<typeof printerStateSchema>;

export const temperatureSchema = z.object({
  /** Stable id used for commands, e.g. "extruder", "heater_generic chamber". */
  id: z.string(),
  /** Display name, e.g. "extruder", "heater_bed", "chamber", "mcu_temp". */
  name: z.string(),
  current: z.number(),
  target: z.number().nullable(),
  controllable: z.boolean(),
});

/** Heaters whose target can be set (Klipper object names). */
export const heaterIdSchema = z
  .string()
  .regex(/^(extruder\d*|heater_bed|heater_generic [A-Za-z0-9_-]+)$/);
export const MAX_HEATER_TARGET = 500;

export const temperatureHistorySchema = z.object({
  intervalSeconds: z.number(),
  series: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      temperatures: z.array(z.number()),
      targets: z.array(z.number()).nullable(),
    }),
  ),
});
export type TemperatureHistoryDto = z.infer<typeof temperatureHistorySchema>;

export const webcamSchema = z.object({
  index: z.number().int(),
  name: z.string(),
  service: z.string(),
  /** How the UI shows it: a proxied MJPEG stream, polled snapshots, or not at all. */
  mode: z.enum(["mjpeg", "snapshot", "unsupported"]),
  flipHorizontal: z.boolean(),
  flipVertical: z.boolean(),
  rotation: z.number(),
});
export type WebcamDto = z.infer<typeof webcamSchema>;

export const printProgressSchema = z.object({
  fileName: z.string(),
  /** 0–1 */
  progress: z.number(),
  elapsedSeconds: z.number(),
  remainingSeconds: z.number().nullable(),
  filamentUsedMm: z.number(),
});

export const printerStatusSchema = z.object({
  state: printerStateSchema,
  message: z.string().nullable(),
  temperatures: z.array(temperatureSchema),
  job: printProgressSchema.nullable(),
  updatedAt: z.iso.datetime(),
});
export type PrinterStatusDto = z.infer<typeof printerStatusSchema>;

export const printerDriverIdSchema = z.enum(["moonraker"]);

const httpUrl = z
  .url({ protocol: /^https?$/, message: "Enter an http:// or https:// address." })
  .max(500)
  .transform((value) => value.replace(/\/+$/, ""));
const tagSchema = z.string().trim().min(1).max(32);

export const printerSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  driver: printerDriverIdSchema,
  url: z.string(),
  hasApiKey: z.boolean(),
  groupId: z.uuid().nullable(),
  tags: z.array(z.string()),
  /** False when the printer exceeds the tier's printer limit: visible, but cannot start jobs. */
  withinLimit: z.boolean(),
  status: printerStatusSchema,
});
export type Printer = z.infer<typeof printerSchema>;

export const printerInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(80),
  url: httpUrl,
  apiKey: z.string().trim().max(256).nullable().optional(),
  groupId: z.uuid().nullable().optional(),
  tags: z.array(tagSchema).max(20).optional(),
});
export type PrinterInput = z.infer<typeof printerInputSchema>;

/** `apiKey`: omitted = keep, null = remove, string = replace. */
export const printerUpdateSchema = printerInputSchema.partial();
export type PrinterUpdate = z.infer<typeof printerUpdateSchema>;

export const connectionTestSchema = z.object({
  url: httpUrl,
  apiKey: z.string().trim().max(256).nullable().optional(),
});
export type ConnectionTest = z.infer<typeof connectionTestSchema>;

export const connectionTestResultSchema = z.object({
  ok: z.boolean(),
  hostname: z.string().nullable(),
  klippyState: z.string().nullable(),
  error: z.string().nullable(),
});
export type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>;

export const printerGroupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
});
export type PrinterGroup = z.infer<typeof printerGroupSchema>;

export const printerGroupInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(60),
});

export const printerCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("emergency_stop") }),
  z.object({ action: z.literal("gcode"), script: z.string().trim().min(1).max(2000) }),
  z.object({
    action: z.literal("set_temperature"),
    heater: heaterIdSchema,
    target: z.number().min(0).max(MAX_HEATER_TARGET),
  }),
]);
export type PrinterCommand = z.infer<typeof printerCommandSchema>;

/** Messages pushed over /api/ws. */
export const realtimeMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("printer.status"),
    printerId: z.uuid(),
    status: printerStatusSchema,
  }),
  z.object({ type: z.literal("printers.changed") }),
  z.object({
    type: z.literal("printer.console"),
    printerId: z.uuid(),
    line: z.string(),
  }),
]);
export type RealtimeMessage = z.infer<typeof realtimeMessageSchema>;
