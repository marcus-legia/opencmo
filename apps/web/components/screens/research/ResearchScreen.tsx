"use client";

import { PageHeader, Screen, SkeletonBlocks } from "../kit";

export function ResearchScreen() {
  return (
    <Screen label="Research">
      <PageHeader eyebrow="Research" title="Research" sample />
      <SkeletonBlocks />
    </Screen>
  );
}
