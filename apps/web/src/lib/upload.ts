import { ApiError } from "./api.ts";

/** Upload with progress (fetch has no upload progress events). */
export function uploadFile(url: string, file: File, onProgress: (fraction: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (event) =>
      event.lengthComputable && onProgress(event.loaded / event.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = `Upload failed (${xhr.status})`;
      try {
        message = JSON.parse(xhr.responseText).error ?? message;
      } catch {}
      reject(new ApiError(xhr.status, message));
    };
    xhr.onerror = () => reject(new Error("Upload failed."));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}
