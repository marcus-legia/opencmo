"use client";

import { PageHeader, Screen, SkeletonBlocks } from "../kit";

export function WriterScreen() {
  return (
    <Screen label="Writer">
      <PageHeader eyebrow="Writer" title="Writer" sample />
      <SkeletonBlocks />
    </Screen>
  );
}
