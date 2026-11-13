"use client";

import { api, jsonBody } from "@/components/clipping/api";
import { uploadResumable } from "@/lib/upload-tus";

/**
 * One photo from the browser to Storage: a reservation at `reservePath` (the post's uploads route), then TUS. Answers
 * the object name the post saves. Shared by the photo post page and a text post's card.
 */
export async function uploadPhoto(reservePath: string, file: File, onProgress?: (fraction: number) => void): Promise<string> {
  const reserved = await api<{ bucket: string; objectName: string }>(reservePath, jsonBody({ size: file.size, type: file.type }));
  await uploadResumable({ bucket: reserved.bucket, objectName: reserved.objectName, file, contentType: file.type, onProgress }).promise;
  return reserved.objectName;
}
