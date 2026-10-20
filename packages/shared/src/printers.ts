import { z } from "zod";

/** Paths under the printer's G-code root: no absolute paths, no "..", no control characters. */
export const gcodePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (path) =>
      !path.startsWith("/") && !path.split("/").some((part) => part === ".." || part === ""),
    "Invalid path.",
  )
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what paths must not contain.
  .refine((path) => !/[\u0000-\u001f\u007f]/.test(path), "Invalid path.");
export const gcodeDirectorySchema = z.union([z.literal(""), gcodePathSchema]);

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
  /** Heater duty cycle 0–1; null for sensors. */
  power: z.number().nullable(),
});

export const fanIdSchema = z
  .string()
  .regex(/^(fan|fan_generic [A-Za-z0-9_-]+|output_pin [A-Za-z0-9_-]+)$/, "Unknown fan.");

export const fanSchema = z.object({
  id: z.string(),
  name: z.string(),
  speed: z.number(),
  controllable: z.boolean(),
});
export type FanDto = z.infer<typeof fanSchema>;

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

export const axisSchema = z.enum(["x", "y", "z"]);
export type Axis = z.infer<typeof axisSchema>;
const xyz = z.object({ x: z.number(), y: z.number(), z: z.number() });

export const motionStatusSchema = z.object({
  position: xyz,
  homedAxes: z.array(axisSchema),
  min: xyz.nullable(),
  max: xyz.nullable(),
  zOffset: z.number(),
  speedFactor: z.number(),
  flowFactor: z.number(),
});
export type MotionStatusDto = z.infer<typeof motionStatusSchema>;

export const objectExclusionSchema = z.object({
  objects: z.array(z.string()),
  excluded: z.array(z.string()),
  current: z.string().nullable(),
});

export const printerStatusSchema = z.object({
  state: printerStateSchema,
  message: z.string().nullable(),
  temperatures: z.array(temperatureSchema),
  job: printProgressSchema.nullable(),
  motion: motionStatusSchema.nullable(),
  fans: z.array(fanSchema),
  exclusion: objectExclusionSchema.nullable(),
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
  z.object({ action: z.literal("home"), axes: z.array(axisSchema).max(3) }),
  z.object({
    action: z.literal("jog"),
    axis: axisSchema,
    distance: z
      .number()
      .min(-500)
      .max(500)
      .refine((d) => d !== 0, "Distance must not be zero."),
  }),
  z.object({ action: z.literal("motors_off") }),
  z.object({ action: z.literal("start_print"), path: gcodePathSchema }),
  z.object({ action: z.literal("z_offset"), delta: z.number().min(-1).max(1) }),
  /** Factors: 1 = 100 %. */
  z.object({ action: z.literal("speed_factor"), factor: z.number().min(0.1).max(3) }),
  z.object({ action: z.literal("flow_factor"), factor: z.number().min(0.5).max(1.5) }),
  z.object({ action: z.literal("fan_speed"), fan: fanIdSchema, speed: z.number().min(0).max(1) }),
  z.object({
    action: z.literal("exclude_object"),
    // Klipper object names are single tokens; reject anything that could inject G-code.
    name: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[^\s;"'\\]+$/),
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

export const printFileSchema = z.object({
  path: z.string(),
  name: z.string(),
  size: z.number(),
  modified: z.iso.datetime(),
  estimatedSeconds: z.number().nullable(),
  filamentMm: z.number().nullable(),
  filamentGrams: z.number().nullable(),
  layerHeight: z.number().nullable(),
  objectHeight: z.number().nullable(),
  slicer: z.string().nullable(),
  hasThumbnail: z.boolean(),
});
export type PrintFileDto = z.infer<typeof printFileSchema>;

export const fileListingSchema = z.object({
  directory: z.string(),
  directories: z.array(z.string()),
  files: z.array(printFileSchema),
});
export type FileListingDto = z.infer<typeof fileListingSchema>;

export const jobStatusSchema = z.enum([
  "completed",
  "cancelled",
  "error",
  "interrupted",
  "in_progress",
]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const printJobSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  status: jobStatusSchema,
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  printSeconds: z.number(),
  filamentMm: z.number(),
  hasThumbnail: z.boolean(),
});
export type PrintJobDto = z.infer<typeof printJobSchema>;

export const jobHistorySchema = z.object({
  jobs: z.array(printJobSchema),
  totals: z.object({ jobs: z.number(), printSeconds: z.number(), filamentMm: z.number() }),
});
export type JobHistoryDto = z.infer<typeof jobHistorySchema>;

export const consoleEntrySchema = z.object({
  time: z.iso.datetime(),
  kind: z.enum(["command", "response"]),
  message: z.string(),
});
export type ConsoleEntryDto = z.infer<typeof consoleEntrySchema>;

export const consoleHistorySchema = z.object({ entries: z.array(consoleEntrySchema) });
export type ConsoleHistoryDto = z.infer<typeof consoleHistorySchema>;

export const macroSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  params: z.array(z.object({ name: z.string(), defaultValue: z.string().nullable() })),
});
export type MacroDto = z.infer<typeof macroSchema>;

export const gcodeCommandSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
});
export type GcodeCommandDto = z.infer<typeof gcodeCommandSchema>;

export const macroListSchema = z.object({
  macros: z.array(macroSchema),
  commands: z.array(gcodeCommandSchema),
});
export type MacroListDto = z.infer<typeof macroListSchema>;

/** Path relative to the printer's config root (same rules as G-code paths). */
export const configPathSchema = gcodePathSchema;

export const configFileSchema = z.object({
  path: z.string(),
  size: z.number(),
  modified: z.iso.datetime(),
});
export type ConfigFileDto = z.infer<typeof configFileSchema>;

export const configFileContentSchema = z.object({
  path: z.string(),
  content: z.string(),
  modified: z.iso.datetime().nullable(),
});
export type ConfigFileContentDto = z.infer<typeof configFileContentSchema>;

export const MAX_CONFIG_BYTES = 2 * 1024 * 1024;

export const configSaveSchema = z.object({
  path: configPathSchema,
  content: z.string().max(MAX_CONFIG_BYTES),
  /** `modified` of the version the editor loaded; null for a new file. Saving fails with 409 if the printer's copy changed since. */
  baseModified: z.iso.datetime().nullable(),
  /** Overwrite even if the file changed on the printer since it was loaded. */
  force: z.boolean().default(false),
  /** Restart Klipper afterwards so the new config is loaded. */
  restart: z.boolean().default(false),
});
export type ConfigSave = z.infer<typeof configSaveSchema>;

export const configBackupSchema = z.object({
  id: z.uuid(),
  path: z.string(),
  size: z.number(),
  createdAt: z.iso.datetime(),
  createdBy: z.string().nullable(),
});
export type ConfigBackupDto = z.infer<typeof configBackupSchema>;

export const restartRequestSchema = z.discriminatedUnion("target", [
  z.object({ target: z.literal("klipper") }),
  z.object({ target: z.literal("firmware") }),
  z.object({ target: z.literal("service"), service: z.string().regex(/^[\w@.-]{1,64}$/) }),
  z.object({ target: z.literal("host"), action: z.enum(["reboot", "shutdown"]) }),
]);
export type RestartRequest = z.infer<typeof restartRequestSchema>;

export const hostServiceSchema = z.object({ name: z.string(), state: z.string().nullable() });
export type HostServiceDto = z.infer<typeof hostServiceSchema>;
