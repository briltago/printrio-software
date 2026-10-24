import type { WebcamDto } from "@printrio/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { Panel } from "./panel.tsx";

const SNAPSHOT_INTERVAL_MS = 1000;

/** Live camera view; media is proxied by the Printrio server (see printer-media routes). */
export function WebcamPanel({ printerId, connected }: { printerId: string; connected: boolean }) {
  const t = useT();
  const figureRef = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState(0);
  const { data, isError } = useQuery({
    queryKey: ["webcams", printerId],
    queryFn: () => api<{ webcams: WebcamDto[] }>(`/api/printers/${printerId}/webcams`),
    enabled: connected,
    staleTime: 60_000,
    retry: false,
  });
  const webcams = data?.webcams ?? [];
  const cam = webcams[selected] ?? webcams[0];

  const actions = (
    <div className="flex items-center gap-2">
      {webcams.length > 1 && (
        <select
          className="input w-auto py-1 text-xs"
          aria-label={t("webcam.select")}
          value={cam?.index}
          onChange={(event) => setSelected(Number(event.target.value))}
        >
          {webcams.map((webcam) => (
            <option key={webcam.index} value={webcam.index}>
              {webcam.name}
            </option>
          ))}
        </select>
      )}
      {cam && cam.mode !== "unsupported" && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => void figureRef.current?.requestFullscreen?.()}
        >
          {t("webcam.fullscreen")}
        </button>
      )}
    </div>
  );

  // The webcam is optional: without a configured camera the panel is not shown at all.
  if (!connected || isError || !cam) return null;

  let body: React.ReactNode;
  if (cam.mode === "unsupported")
    body = (
      <p className="text-sm text-muted">{t("webcam.unsupported", { service: cam.service })}</p>
    );
  else
    body = (
      <figure
        ref={figureRef}
        className="grid aspect-video place-items-center overflow-hidden rounded-[7px] bg-black"
      >
        <CameraImage printerId={printerId} cam={cam} />
      </figure>
    );

  return (
    <Panel id="webcam" title={cam?.name ?? t("webcam.title")} actions={actions}>
      {body}
    </Panel>
  );
}

function CameraImage({ printerId, cam }: { printerId: string; cam: WebcamDto }) {
  const t = useT();
  const [tick, setTick] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (cam.mode !== "snapshot") return;
    const timer = setInterval(() => setTick((value) => value + 1), SNAPSHOT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [cam.mode]);

  if (failed) return <p className="text-sm text-muted">{t("webcam.unavailable")}</p>;
  const base = `/api/printers/${printerId}/webcams/${cam.index}`;
  const src = cam.mode === "mjpeg" ? `${base}/stream` : `${base}/snapshot?t=${tick}`;
  const transform = [
    cam.rotation ? `rotate(${cam.rotation}deg)` : "",
    cam.flipHorizontal ? "scaleX(-1)" : "",
    cam.flipVertical ? "scaleY(-1)" : "",
  ].join(" ");
  return (
    <img
      src={src}
      alt={cam.name}
      className="h-full w-full object-contain"
      style={transform.trim() ? { transform } : undefined}
      onError={() => cam.mode === "mjpeg" && setFailed(true)}
    />
  );
}
