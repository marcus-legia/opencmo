"use client";

import { PageHeader, Screen, SkeletonBlocks } from "../kit";

export function BrainScreen() {
  return (
    <Screen label="Brain">
      <PageHeader eyebrow="Brain" title="Brain" sample />
      <SkeletonBlocks />
    </Screen>
  );
}
