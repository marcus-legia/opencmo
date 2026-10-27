"use client";

import { PageHeader, Screen, SkeletonBlocks } from "../kit";

export function SetupScreen() {
  return (
    <Screen label="Setup">
      <PageHeader eyebrow="Setup" title="Setup" sample />
      <SkeletonBlocks />
    </Screen>
  );
}
