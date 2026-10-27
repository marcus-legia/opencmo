"use client";

import { PageHeader, Screen, SkeletonBlocks } from "../kit";

export function LibraryScreen() {
  return (
    <Screen label="Library">
      <PageHeader eyebrow="Library" title="Library" sample />
      <SkeletonBlocks />
    </Screen>
  );
}
